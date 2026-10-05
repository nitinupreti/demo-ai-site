/**
 * Component fan-out, shared by page and site runs: one agent per component, each in its own copy of
 * the repository, merged back only when its writes stay in scope, its contributions compose and its
 * code builds. Waves run in order; components inside a wave run side by side.
 */
import path from 'node:path';

import { runAgentRole } from './agent.mjs';
import { runValidation, validationPlan } from './deploy.mjs';
import {
  collectChanges, createWorkspace, mergeChanges, removeWorkspace, watchTree,
} from './workspaces.mjs';

export async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

/**
 * Builds every component of `waves` not in `alreadyBuilt`. `taskPrompt(component, { agentDir })`
 * returns the prompt up to the task block; rejection feedback is appended to it. `checkContribution`
 * returns the problems with a result's contributions. Each finished component is pushed onto
 * `workerResults` and banked through `persist` at once, so a cancelled run keeps what finished.
 * With `continueOnFailure`, a failed component stops only the components that depend on it.
 */
export async function runFanout({
  components, waves, alreadyBuilt = new Set(), workerResults, claimed, persist = () => {},
  repoRoot, evidenceDir, copilot, renderer, spawnFn, execFn, track = () => {},
  maxParallel, componentAttempts, workspaceOptions, model, effort,
  taskPrompt, checkContribution, continueOnFailure = false,
}) {
  const byId = new Map(components.map((component) => [component.id, component]));
  // What is in the tree now is kept and shipped; a change made while workers run is refused.
  const guard = watchTree(repoRoot, workspaceOptions);
  let edited = [];
  let failed = false;

  const build = async (componentId, waveIndex) => {
    const component = byId.get(componentId);
    renderer.componentStarted(componentId, `tier ${component.tier}${component.role === 'chrome' ? ' · XF chrome' : ''}`);
    const maxAttempts = componentAttempts;
    const history = [];
    let feedback = '';

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const workspaceRoot = path.join(evidenceDir, 'workspaces', `${componentId}-attempt-${attempt}`);
      const workspace = createWorkspace(repoRoot, workspaceRoot, workspaceOptions);
      workspace.id = componentId;
      const agentDir = path.join(evidenceDir, 'agents', `component-${componentId}-attempt-${attempt}`);

      // A worker copy is large; it must be removed whatever the outcome.
      try {
        const invocation = await runAgentRole({
          copilot,
          role: 'component',
          id: componentId,
          componentId,
          prompt: [taskPrompt(component, { agentDir, workspaceRoot }), feedback].join('\n'),
          cwd: workspaceRoot,
          model,
          effort,
          agentDir,
          renderer,
          spawnFn,
        });
        track(invocation, {
          phase: 'fanout', component_id: componentId, wave: waveIndex + 1, attempt,
        });
        history.push({ attempt, status: invocation.status, duration_seconds: invocation.durationSeconds });

        const changes = collectChanges(workspace, component.owned_paths);
        let rejection = null;

        if (!changes.valid) {
          rejection = `Your changes touched files outside your scope: ${changes.violations.slice(0, 8).join(', ')}.\n`
            + `You may only write: ${component.owned_paths.join(', ')}.\n`
            + 'Shared files are declared through the `contributions` block, never edited directly.';
        } else if (invocation.status === 'BLOCKED') {
          // An external prerequisite will not resolve by asking again.
          renderer.componentFinished(componentId, 'BLOCKED');
          return {
            component_id: componentId,
            status: 'BLOCKED',
            invocation,
            attempts: attempt,
            history,
            duration_seconds: invocation.durationSeconds,
            error: invocation.result?.notes || invocation.error || 'agent reported an external blocker',
          };
        } else if (invocation.status !== 'PASS') {
          const failing = (invocation.result?.checks || [])
            .filter((check) => check.status !== 'PASS')
            .map((check) => `${check.name}: ${check.evidence || 'no evidence given'}`);
          rejection = invocation.error
            || `Your result reported ${invocation.status}. Failing checks: ${failing.join('; ') || 'none recorded'}.`;
        } else {
          const contributionProblems = checkContribution(component, invocation.result, { writtenFiles: changes.owned });
          if (contributionProblems.length) {
            rejection = 'Your `contributions` block cannot be composed onto the page:\n'
              + contributionProblems.map((problem) => `- ${problem}`).join('\n');
          } else {
            const validation = await runValidation({
              workspaceRoot,
              steps: validationPlan(changes.changed, {
                focusedTests: invocation.result?.focused_test?.tests || [],
              }),
              execFn,
            });
            if (validation.status !== 'PASS') {
              rejection = `Your code does not build (${validation.label}):\n${validation.detail}`;
            }
          }
        }

        if (!rejection && invocation.status === 'PASS') {
          const merged = mergeChanges(workspace, repoRoot, changes, claimed, guard);
          if (merged.edited.length) {
            // Not the worker's fault, and a retry would meet the same edit.
            renderer.componentFinished(componentId, 'FAIL');
            return {
              component_id: componentId,
              status: 'FAIL',
              invocation,
              attempts: attempt,
              history,
              duration_seconds: invocation.durationSeconds,
              error: `not merged: ${merged.edited.join(', ')} changed in the repository while it was being built`,
            };
          }
          if (merged.conflicts.length) {
            rejection = `Another component already owns ${merged.conflicts.map((entry) => `${entry.path} (${entry.owner})`).join(', ')}. `
              + 'Keep your changes inside your own scope and declare shared content through `contributions`.';
          } else {
            renderer.componentFinished(componentId, 'PASS');
            return {
              component_id: componentId,
              status: 'PASS',
              invocation,
              attempts: attempt,
              history,
              duration_seconds: invocation.durationSeconds,
              result: invocation.result,
              applied: merged.applied,
            };
          }
        }

        history[history.length - 1].rejection = rejection;
        if (attempt < maxAttempts) {
          renderer.warn(`${componentId} attempt ${attempt}/${maxAttempts} rejected: ${rejection.split('\n').slice(0, 2).join(' ')}`);
          feedback = [
            '', `## Attempt ${attempt} of ${maxAttempts} was rejected`, '',
            rejection, '',
            'Fix exactly this, then write your result again. Do not repeat the rejected approach,',
            'and do not start from your previous attempt — this is a fresh checkout of the repository.',
          ].join('\n');
        } else {
          renderer.componentFinished(componentId, 'FAIL');
          return {
            component_id: componentId,
            status: 'FAIL',
            invocation,
            attempts: attempt,
            history,
            duration_seconds: invocation.durationSeconds,
            error: `exhausted ${maxAttempts} attempts; last rejection: ${rejection}`,
          };
        }
      } finally {
        removeWorkspace(workspaceRoot);
      }
    }
    return { component_id: componentId, status: 'FAIL', attempts: maxAttempts, history, error: 'no attempt produced a result' };
  };

  const unbuilt = new Set();
  for (const [waveIndex, wave] of waves.entries()) {
    const pending = [];
    for (const componentId of wave.filter((id) => !alreadyBuilt.has(id))) {
      const blocker = (byId.get(componentId).depends_on || []).find((dependency) => unbuilt.has(dependency));
      if (!blocker) {
        pending.push(componentId);
        continue;
      }
      unbuilt.add(componentId);
      const skipped = {
        component_id: componentId, status: 'FAIL', attempts: 0, history: [], error: `not built: it depends on ${blocker}, which failed`,
      };
      renderer.componentFinished(componentId, 'FAIL');
      workerResults.push(skipped);
      persist();
    }
    if (!pending.length) continue;
    renderer.note(`wave ${waveIndex + 1}/${waves.length}: ${pending.join(', ')}`);
    const waveResults = await pool(pending, maxParallel, async (componentId) => {
      // Banked per component, not per wave: a cancellation must not discard finished work.
      const outcome = await build(componentId, waveIndex);
      workerResults.push(outcome);
      persist();
      return outcome;
    });
    waveResults.filter((entry) => entry.status !== 'PASS').forEach((entry) => unbuilt.add(entry.component_id));
    edited = guard.drift();
    if (edited.length || unbuilt.size) {
      failed = true;
      if (edited.length || !continueOnFailure) break;
    }
  }
  return { failed, edited };
}
