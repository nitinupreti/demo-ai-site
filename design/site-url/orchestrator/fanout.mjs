/**
 * One component's build: agent, checks, merge, and early preview feedback. Agent slots and
 * validation slots are separate, so a finished worker's Maven checks never hold up the next
 * agent, and a fixable rejection continues the same session in the same workspace instead of
 * throwing twenty minutes of work away.
 */
import crypto from 'node:crypto';
import path from 'node:path';

import { runAgentRole } from './agent.mjs';
import { validateContribution } from './contributions.mjs';
import { runValidation, validationPlan } from './deploy.mjs';
import { writeComponentInputs } from './inputs.mjs';
import { staticRejection } from './static-checks.mjs';
import {
  collectChanges, createWorkspace, mergeChanges, removeWorkspace,
} from './workspaces.mjs';

export function createSemaphore(limit) {
  let active = 0;
  const waiting = [];
  const release = () => {
    active -= 1;
    const next = waiting.shift();
    if (next) {
      active += 1;
      next();
    }
  };
  return {
    acquire() {
      return new Promise((resolve) => {
        let released = false;
        const grant = () => resolve(() => {
          if (released) return;
          released = true;
          release();
        });
        if (active < limit) {
          active += 1;
          grant();
        } else {
          waiting.push(grant);
        }
      });
    },
  };
}

/** Longest first: new and extended components with many instances, and chrome, start before quick reuses. */
export function scheduleOrder(ids, byId) {
  const weight = (id) => {
    const component = byId.get(id) || {};
    return (component.execution_mode === 'authoring' ? 0 : 100)
      + (component.tier || 0) * 10
      + (component.role === 'chrome' ? 5 : 0)
      + (component.instances?.length || 0);
  };
  return [...ids].sort((left, right) => weight(right) - weight(left) || left.localeCompare(right));
}

const firstLine = (text) => String(text || '').split('\n')[0];

function absoluteRow(row, baseDir) {
  const resolve = (value) => (value ? path.resolve(baseDir, value) : null);
  const inventory = Object.fromEntries(Object.entries(row.deltas?.inventory || {})
    .map(([category, entries]) => [category, (entries || []).slice(0, 8)]));
  return {
    breakpoint: row.breakpoint,
    status: row.status,
    ratio: row.visual_match_ratio,
    withheld_reason: row.withheld_reason,
    owning_layer_hint: row.owning_layer_hint || null,
    deltas: {
      rect: row.deltas?.rect,
      dimension_mismatch: row.deltas?.dimension_mismatch,
      rendered_fonts: row.deltas?.rendered_fonts,
      playback: row.deltas?.playback,
      text: row.deltas?.text,
      inventory,
      hot_regions: (row.deltas?.hot_regions || []).slice(0, 5),
    },
    side_by_side: resolve(row.side_by_side),
    diff_mask: resolve(row.diff_mask),
    source_crop: resolve(row.source?.screenshot),
    target_crop: resolve(row.target?.screenshot),
  };
}

/** The measured deltas a preview returned, as the next message of the worker's own session. */
export function previewFollowUp(check, component, resultPath, round) {
  const rows = (check.parity?.results || []).filter((row) => row.component_id === component.id)
    .map((row) => absoluteRow(row, check.outDir));
  return [
    `## Preview measurement ${round}`,
    '',
    'Your merged component was deployed, with everything merged before it, and scored against the',
    `live source on its own. It did not pass (threshold ${check.parity?.threshold}):`,
    '',
    '```json',
    JSON.stringify({
      status: check.summary?.status,
      min_ratio: check.summary?.min_ratio,
      failed_breakpoints: check.summary?.failed_breakpoints,
      owning_layer_hint: check.summary?.owning_layer_hint,
      rows,
    }, null, 2),
    '```',
    '',
    'The numbers are the measurement; the images only help you find the declaration behind them.',
    'Fix what the deltas name inside your own files, run your checks, and write your result again to',
    `\`${resultPath}\`. If what remains lies outside your files (a font that does not load, a shared`,
    'token, the page around you), change nothing, say so in `notes`, and set `shared_defect` when the',
    'cause is a shared design layer.',
  ].join('\n');
}

/** Builds one component to a merged PASS, or to the reason it could not be. */
export async function buildComponent(ctx, componentId, waveIndex) {
  const {
    copilot, options, repoRoot, evidenceDir, discovery, byId, assets, renderer, spawnFn, execFn, track, readPrompt,
    instanceOrder, guard, claimed, agentSlots, validationSlots, treeLock, tokens, fonts, crops, preview,
    mergedResults, agentOptions,
  } = ctx;
  const component = byId.get(componentId);
  const maxAttempts = options.componentAttempts;
  const history = [];
  const ownAssets = assets.manifest.filter((entry) => entry.instances.some((id) => component.instances.includes(id)));
  let workspace = null;
  let workspaceRoot = null;
  let sessionId = null;
  let inputs = null;
  let feedback = '';
  let followUp = null;
  let fresh = true;
  let started = false;
  const elapsed = () => Number(history.reduce((sum, entry) => sum + (entry.duration_seconds || 0), 0).toFixed(2));

  const brief = (agentDir) => [
    readPrompt('_contract.md'), '', readPrompt('component.md'), '',
    '## Task', '',
    '```json',
    JSON.stringify({
      component,
      breakpoints: options.breakpoints,
      workspace: workspaceRoot,
      inputs: {
        evidence: inputs.evidence,
        tokens: inputs.tokens,
        assets: inputs.assets,
        source_crops: inputs.source_crops,
      },
      assets: inputs.assets_list.map((entry) => ({
        kind: entry.kind || 'media',
        dam_path: entry.dam_path,
        source: String(entry.source_url).startsWith('data:') ? 'data: URL (inline in the source)' : entry.source_url,
        local_file: entry.local_file || undefined,
        mime: entry.mime,
        alt: entry.alt,
        width: entry.width,
        height: entry.height,
      })),
      result_path: path.join(agentDir, 'result.json'),
    }, null, 2),
    '```',
    feedback,
  ].join('\n');

  /** Static checks, then Maven: exact and cheap before slow. `environment` is the machine's fault. */
  const judge = async (invocation, changes) => {
    const contributionProblems = validateContribution(component, invocation.result, {
      instanceOrder, writtenFiles: changes.owned,
    });
    if (contributionProblems.length) {
      return {
        rejection: 'Your `contributions` block cannot be composed onto the page:\n'
          + contributionProblems.map((problem) => `- ${problem}`).join('\n'),
      };
    }
    const problem = staticRejection({
      root: workspaceRoot, damRoot: repoRoot, changedFiles: changes.changed, ownedFiles: changes.owned,
    });
    if (problem) return { rejection: problem.text };
    const release = await validationSlots.acquire();
    let validation;
    try {
      validation = await runValidation({
        workspaceRoot,
        steps: validationPlan(changes.changed, { focusedTests: invocation.result?.focused_test?.tests || [] }),
        execFn,
      });
    } finally {
      release();
    }
    if (validation.status === 'PASS') return {};
    if (validation.kind === 'environment') return { environment: `${validation.label} could not run: ${firstLine(validation.detail)}` };
    return { rejection: `Your code does not build (${validation.label}):\n${validation.detail}` };
  };

  const runAgent = async (agentDir, message) => {
    const release = await agentSlots.acquire();
    if (!started) {
      started = true;
      renderer.componentStarted(componentId, `tier ${component.tier}${component.role === 'chrome' ? ' · XF chrome' : ''}`);
    }
    try {
      return await runAgentRole({
        copilot,
        role: 'component',
        id: componentId,
        componentId,
        prompt: brief(agentDir),
        followUp: message,
        sessionId,
        cwd: workspaceRoot,
        gitCeiling: path.dirname(workspaceRoot),
        ...agentOptions,
        agentDir,
        renderer,
        spawnFn,
      });
    } finally {
      release();
    }
  };

  const merge = async (changes) => {
    const release = await treeLock.acquire();
    try {
      return mergeChanges(workspace, repoRoot, changes, claimed, guard);
    } finally {
      release();
    }
  };

  /** Deploy, measure, and hand the deltas back to the same session while it still knows the code. */
  const previewLoop = async (accepted) => {
    const previews = [];
    let { result, applied } = accepted;
    for (let round = 1; round <= options.previewRounds; round += 1) {
      const check = await preview.check({ component, results: [...mergedResults(componentId), result], round });
      previews.push({
        round, status: check.skipped ? 'SKIPPED' : check.status, reason: check.skipped || null, min_ratio: check.summary?.min_ratio ?? null,
      });
      if (check.skipped || check.status === 'PASS') break;
      renderer.note(`${componentId} preview ${round}: ${check.status}, min ${check.summary?.min_ratio ?? 'withheld'}`
        + ' — the worker is fixing it in the same session');
      const agentDir = path.join(evidenceDir, 'agents', `component-${componentId}-preview-${round}`);
      const invocation = await runAgent(agentDir, previewFollowUp(check, component, path.join(agentDir, 'result.json'), round));
      sessionId = invocation.sessionId || sessionId;
      track(invocation, { phase: 'fanout', component_id: componentId, wave: waveIndex + 1, preview: round });
      history.push({
        attempt: `preview-${round}`, status: invocation.status, duration_seconds: invocation.durationSeconds, resumed: true,
      });
      if (invocation.status !== 'PASS') break;
      const changes = collectChanges(workspace, component.owned_paths);
      if (!changes.valid) break;
      const verdict = await judge(invocation, changes);
      // Whatever passed before stays merged; a follow-up that breaks the build is simply not taken.
      if (verdict.rejection || verdict.environment) {
        renderer.warn(`${componentId} preview fix not merged: ${firstLine(verdict.rejection || verdict.environment)}`);
        break;
      }
      const merged = await merge(changes);
      if (merged.edited.length || merged.conflicts.length) break;
      result = invocation.result;
      applied = [...new Set([...applied, ...merged.applied])];
    }
    return { result, applied, previews };
  };

  const finish = (status, extra) => {
    renderer.componentFinished(componentId, status);
    return {
      component_id: componentId, status, attempts: history.filter((entry) => typeof entry.attempt === 'number').length, history,
      duration_seconds: elapsed(), session_id: sessionId, ...extra,
    };
  };

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (fresh) {
        if (workspaceRoot) removeWorkspace(workspaceRoot);
        workspaceRoot = path.join(evidenceDir, 'workspaces', `${componentId}-attempt-${attempt}`);
        workspace = createWorkspace(repoRoot, workspaceRoot, options.workspace);
        workspace.id = componentId;
        inputs = writeComponentInputs({
          workspaceRoot, component, discovery, assets: ownAssets, tokens, fonts, crops,
        });
        sessionId = crypto.randomUUID();
      }
      const agentDir = path.join(evidenceDir, 'agents', `component-${componentId}-attempt-${attempt}`);
      const invocation = await runAgent(agentDir, fresh ? null : followUp(path.join(agentDir, 'result.json')));
      sessionId = invocation.sessionId || sessionId;
      track(invocation, {
        phase: 'fanout', component_id: componentId, wave: waveIndex + 1, attempt,
      });
      history.push({
        attempt, status: invocation.status, duration_seconds: invocation.durationSeconds, resumed: !fresh,
        relaunches: invocation.relaunches || 0, stalled_seconds: invocation.stalledSeconds || 0,
      });

      const changes = collectChanges(workspace, component.owned_paths);
      let rejection = null;
      let freshNext = false;
      if (!changes.valid) {
        rejection = `Your changes touched files outside your scope: ${changes.violations.slice(0, 8).join(', ')}.\n`
          + `You may only write: ${component.owned_paths.join(', ')}.\n`
          + 'Shared files are declared through the `contributions` block, never edited directly.';
        freshNext = true;
      } else if (invocation.status === 'BLOCKED') {
        // An external prerequisite will not resolve by asking again.
        return finish('BLOCKED', { invocation, error: invocation.result?.notes || invocation.error || 'agent reported an external blocker' });
      } else if (invocation.status !== 'PASS') {
        const failing = (invocation.result?.checks || [])
          .filter((check) => check.status !== 'PASS')
          .map((check) => `${check.name}: ${check.evidence || 'no evidence given'}`);
        rejection = invocation.error
          || `Your result reported ${invocation.status}. Failing checks: ${failing.join('; ') || 'none recorded'}.`;
      } else {
        const verdict = await judge(invocation, changes);
        if (verdict.environment) {
          // Not the worker's code: no attempt is spent and nothing it wrote is thrown away as wrong.
          return finish('BLOCKED', { invocation, environment: true, error: `environment: ${verdict.environment}` });
        }
        rejection = verdict.rejection || null;
      }

      if (!rejection) {
        const merged = await merge(changes);
        if (merged.edited.length) {
          // Not the worker's fault, and a retry would meet the same edit.
          return finish('FAIL', {
            invocation, error: `not merged: ${merged.edited.join(', ')} changed in the repository while it was being built`,
          });
        }
        if (merged.conflicts.length) {
          rejection = `Another component already owns ${merged.conflicts.map((entry) => `${entry.path} (${entry.owner})`).join(', ')}. `
            + 'Keep your changes inside your own scope and declare shared content through `contributions`.';
          freshNext = true;
        } else {
          const accepted = { result: invocation.result, applied: merged.applied };
          const final = preview && options.previewRounds > 0
            ? await previewLoop(accepted)
            : { ...accepted, previews: [] };
          return finish('PASS', {
            invocation, result: final.result, applied: final.applied, previews: final.previews,
          });
        }
      }

      history[history.length - 1].rejection = rejection;
      if (attempt >= maxAttempts) {
        return finish('FAIL', { invocation, error: `exhausted ${maxAttempts} attempts; last rejection: ${rejection}` });
      }
      renderer.warn(`${componentId} attempt ${attempt}/${maxAttempts} rejected: ${firstLine(rejection)}`
        + `${freshNext ? '' : ' — continuing in the same session'}`);
      const header = `## Attempt ${attempt} of ${maxAttempts} was rejected`;
      fresh = freshNext;
      if (fresh) {
        feedback = [
          '', header, '', rejection, '',
          'Fix exactly this, then write your result again. Do not repeat the rejected approach,',
          'and do not start from your previous attempt — this is a fresh checkout of the repository.',
        ].join('\n');
      } else {
        const text = rejection;
        followUp = (resultPath) => [
          header, '', text, '',
          'Your workspace still holds everything you wrote. Fix exactly this, run your checks again,',
          `and write your result to \`${resultPath}\`.`,
        ].join('\n');
      }
    }
    return finish('FAIL', { error: 'no attempt produced a result' });
  } finally {
    if (workspaceRoot) removeWorkspace(workspaceRoot);
  }
}
