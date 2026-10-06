/**
 * Deterministic completion report. Every number here is read from an artefact: parity scores from
 * parity.json, durations from run-state.json, counts from plan.json. Nothing is estimated.
 */
import fs from 'node:fs';
import path from 'node:path';

import { formatDuration } from './console.mjs';
import { breakpointLabel, explainParity } from '../tools/lib/verdict.mjs';

function percent(ratio) {
  return Number.isFinite(ratio) ? `${(ratio * 100).toFixed(2)}%` : 'n/a';
}

function similarityText(ratio) {
  return Number.isFinite(ratio) ? percent(ratio) : 'not scored';
}

function tierLabel(tier) {
  return { 1: 'reused', 2: 'extended project', 3: 'extended core', 4: 'new' }[tier] || `tier ${tier}`;
}

/** Empty when the component passed everywhere, so a reader can scan the column for defects. */
function failedAt(row) {
  if (!row.failed_breakpoints.length) return '—';
  const where = row.failed_breakpoints.map((width) => breakpointLabel(width)).join(', ');
  return row.breakpoint_scope === 'all' ? `all (${where})` : where;
}

export function buildReport({
  state, plan, parity, ledger, phases, invocations = [], workers = [], deployment, timings = null,
}) {
  const components = plan?.components || [];
  const byId = new Map((parity?.components || []).map((entry) => [entry.component_id, entry]));
  const ledgerById = new Map((ledger?.components || []).map((entry) => [entry.id, entry]));
  const workerById = new Map(workers.map((entry) => [entry.component_id, entry]));
  const totalSeconds = state?.duration_seconds || 0;
  const share = (seconds) => (totalSeconds && typeof seconds === 'number'
    ? `${((seconds / totalSeconds) * 100).toFixed(1)}%`
    : '—');

  const rows = components.map((component) => {
    const score = byId.get(component.id);
    const attempt = ledgerById.get(component.id);
    return {
      id: component.id,
      tier: component.tier,
      role: component.role,
      instances: component.instances.length,
      min_ratio: score?.min_ratio ?? null,
      // Lowest visual similarity across breakpoints, including crops that fail on their size.
      similarity: score?.min_progress_ratio ?? score?.min_ratio ?? null,
      status: attempt?.status || score?.status || 'NOT SCORED',
      parity_status: score?.status || null,
      failed_gates: score?.failed_gates || [],
      breakpoints: score?.breakpoints || {},
      failed_breakpoints: score?.failed_breakpoints || [],
      breakpoint_scope: score?.breakpoint_scope || 'none',
      owning_layer: score?.owning_layer_hint || null,
      attempts: attempt?.history?.length || 0,
      build_seconds: workerById.get(component.id)?.duration_seconds ?? null,
      build_attempts: workerById.get(component.id)?.attempts ?? null,
    };
  });

  const residual = rows.filter((row) => row.status === 'FAILED-FINAL' || row.status === 'FAIL');
  const status = !parity ? 'FAIL' : residual.length ? 'FAIL' : parity.status === 'PASS' ? 'COMPLETE' : 'FAIL';
  const breakpointKeys = [...new Set(rows.flatMap((row) => Object.keys(row.breakpoints)))]
    .sort((left, right) => Number.parseInt(left, 10) - Number.parseInt(right, 10));
  const modeOf = (key) => key.slice(key.indexOf('-') + 1);
  const showMode = new Set([...breakpointKeys, ...Object.keys(parity?.page_composite || {})].map(modeOf)).size > 1;
  const keyLabel = (key) => `${breakpointLabel(key)}${showMode ? ` ${modeOf(key)}` : ''}`;
  const verdict = parity ? explainParity(parity) : null;
  const scoredRows = rows.filter((row) => Number.isFinite(row.min_ratio));
  // A component with nothing measured has no similarity; counting it as 0% would invent a measurement.
  const unscored = rows.filter((row) => !Number.isFinite(row.similarity)).map((row) => row.id);
  const passBar = Number.isFinite(parity?.threshold) ? `visual similarity above ${percent(parity.threshold)} at every breakpoint` : null;

  const lines = [];
  lines.push('# AEM migration report', '');
  lines.push(`- Status: **${status}**`);
  lines.push(`- Source: ${state?.inputs?.SITE_URL || 'n/a'}`);
  lines.push(`- Target: http://${state?.inputs?.AEM_HOST}:${state?.inputs?.AEM_PORT}`);
  lines.push(`- Run: ${state?.run_id}`);
  lines.push(`- Total time: ${formatDuration(state?.duration_seconds)}`
    + `${timings?.sessions > 1 ? ` this session, ${formatDuration(timings.total_seconds)} across ${timings.sessions} sessions` : ''}`);
  lines.push(`- Components created: **${rows.length}** for ${rows.reduce((total, row) => total + row.instances, 0)} source instances`);
  lines.push(`- Visual parity: **${rows.length - residual.length} passed, ${residual.length} failed**`
    + `${passBar ? ` (pass: ${passBar})` : ''}`);
  if (ledger?.stopped) lines.push(`- Remediation stopped early: ${ledger.stopped}`);
  if (verdict?.lowest) {
    lines.push(`- Lowest visual similarity: **${percent(verdict.lowest.ratio)}**`
      + ` (${verdict.lowest.component_id} at ${verdict.lowest.label})`);
  }
  if (parity && unscored.length) lines.push(`- Not scored at any breakpoint: ${unscored.join(', ')}`);
  lines.push('');

  if (verdict) {
    lines.push('## Visual parity verdict', '');
    lines.push(verdict.headline, '');
    if (verdict.lines.length) lines.push('```text', ...verdict.lines, '```', '');
  }

  const modelSeconds = invocations.reduce((sum, entry) => sum + (entry.duration_seconds || 0), 0);
  lines.push('## Time', '');
  lines.push(`- **Total run time: ${formatDuration(totalSeconds)}**`);
  lines.push(`- Agent time: ${formatDuration(modelSeconds)} across ${invocations.length} invocation(s)`);
  if (deployment?.executed?.length) {
    const deploySeconds = deployment.executed.reduce((sum, step) => sum + (step.duration_seconds || 0), 0);
    lines.push(`- Build and deploy: ${formatDuration(deploySeconds)} across ${deployment.executed.length} step(s)`);
  }
  lines.push('');
  lines.push('| Stage | Status | Duration | Share of run |');
  lines.push('|---|---|---:|---:|');
  for (const phase of phases || []) {
    lines.push(`| ${phase.name} | ${phase.status} | ${formatDuration(phase.duration_seconds)} | ${share(phase.duration_seconds)} |`);
  }
  const measured = (phases || []).reduce((sum, phase) => sum + (phase.duration_seconds || 0), 0);
  lines.push(`| **total** | ${state?.status || ''} | **${formatDuration(totalSeconds)}** | ${share(measured)} measured |`);
  lines.push('');

  // The table above is this session only; a resume restarts its clock, so earlier sessions show here.
  if (timings?.sessions > 1) {
    lines.push(`## Time across ${timings.sessions} sessions`, '');
    lines.push('Every launch of this run, from `timings.json`. A reused stage only re-checked earlier work.', '');
    lines.push('| Stage | Total time | Runs | Notes |');
    lines.push('|---|---:|---:|---|');
    for (const stage of timings.stages) {
      const notes = [
        stage.interrupted ? `${stage.interrupted} interrupted` : null,
        stage.reused ? `${stage.reused} reused` : null,
        `last ${stage.status}`,
      ].filter(Boolean).join(', ');
      lines.push(`| ${stage.name} | ${formatDuration(stage.seconds)} | ${stage.runs} | ${notes} |`);
    }
    lines.push(`| **total** | **${formatDuration(timings.total_seconds)}** | | |`);
    lines.push('');
    lines.push('| Session | Started | Duration | Status |');
    lines.push('|---|---|---:|---|');
    for (const entry of timings.history) {
      lines.push(`| ${entry.session}${entry.resumed ? ' (resumed)' : ''} | ${entry.started_at} | ${formatDuration(entry.seconds)} | ${entry.status} |`);
    }
    lines.push('');
  }

  if (invocations.length) {
    lines.push('### Slowest agent invocations', '');
    lines.push('| Agent | Phase | Duration | Status |');
    lines.push('|---|---|---:|---|');
    for (const entry of [...invocations]
      .sort((left, right) => (right.duration_seconds || 0) - (left.duration_seconds || 0))
      .slice(0, 10)) {
      lines.push(`| ${entry.id} | ${entry.phase || entry.role} | ${formatDuration(entry.duration_seconds)} | ${entry.status} |`);
    }
    lines.push('');
  }

  if (deployment?.executed?.length) {
    lines.push('### Build and deploy steps', '');
    lines.push('| Step | Module | Duration | Exit |');
    lines.push('|---|---|---:|---:|');
    for (const step of deployment.executed) {
      lines.push(`| ${step.label} | ${step.module || '—'} | ${formatDuration(step.duration_seconds)} | ${step.exit_code} |`);
    }
    lines.push('');
  }

  lines.push('## Components', '');
  lines.push('| Component | Tier | Role | Instances | Build time | Build tries | Lowest visual similarity | Status | Failed at | Advisory gates | Fix attempts |');
  lines.push('|---|---|---|---:|---:|---:|---:|---|---|---|---:|');
  for (const row of rows) {
    lines.push(`| ${row.id} | ${tierLabel(row.tier)} | ${row.role} | ${row.instances} | ${formatDuration(row.build_seconds)} `
      + `| ${row.build_attempts ?? '—'} | ${similarityText(row.similarity)} | ${row.status} | ${failedAt(row)} `
      + `| ${row.failed_gates.join(', ') || '—'} | ${row.attempts} |`);
  }
  lines.push('');

  if (breakpointKeys.length) {
    lines.push('### Visual similarity by breakpoint', '');
    lines.push(`| Component | ${breakpointKeys.map(keyLabel).join(' | ')} | Lowest | Status |`);
    lines.push(`|---|${breakpointKeys.map(() => '---:').join('|')}|---:|---|`);
    for (const row of rows) {
      const cells = breakpointKeys.map((key) => {
        const entry = row.breakpoints[key];
        if (!entry) return '—';
        const value = similarityText(entry.similarity ?? entry.ratio);
        return entry.status === 'PASS' ? value : `**${value}**`;
      });
      lines.push(`| ${row.id} | ${cells.join(' | ')} | ${similarityText(row.similarity)} | ${row.status} |`);
    }
    lines.push('', `Bold marks a breakpoint that did not pass${passBar ? ` (pass: ${passBar})` : ''}.`, '');
  }

  const retried = workers.filter((worker) => (worker.attempts || 0) > 1);
  if (retried.length) {
    lines.push('### Component retries', '');
    lines.push('| Component | Attempt | Outcome | Rejection |');
    lines.push('|---|---:|---|---|');
    for (const worker of retried) {
      for (const entry of worker.history || []) {
        const reason = entry.rejection ? entry.rejection.split('\n')[0].slice(0, 110) : '—';
        lines.push(`| ${worker.component_id} | ${entry.attempt} | ${entry.status} | ${reason} |`);
      }
    }
    lines.push('');
  }

  if (parity?.page_composite) {
    lines.push('## Page composite', '');
    lines.push('| Breakpoint | Visual similarity where both pages overlap | Height delta | Status |');
    lines.push('|---|---:|---:|---|');
    for (const [key, entry] of Object.entries(parity.page_composite)) {
      lines.push(`| ${keyLabel(key)} | ${percent(entry.ratio)} | ${entry.height_delta ?? 'n/a'} | ${entry.status} |`);
    }
    lines.push('');
  }

  lines.push('## Status line', '');
  lines.push('```text');
  const ended = ledger?.stopped ? 'when remediation stopped early' : 'after bounded remediation';
  if (status === 'COMPLETE') {
    const measured = rows.filter((row) => Number.isFinite(row.similarity)).map((row) => row.similarity);
    const minimum = measured.length ? Math.min(...measured) : null;
    lines.push(`VISUAL PARITY GATE: PASSED at ${(state?.inputs?.BREAKPOINTS || []).map((width) => breakpointLabel(width)).join(', ')} `
      + `— lowest visual similarity ${percent(minimum)}${passBar ? ` (pass: ${passBar})` : ''}`);
  } else if (residual.length) {
    const where = residual.map((row) => `${row.id} (${row.failed_breakpoints.length
      ? row.failed_breakpoints.map((width) => breakpointLabel(width)).join(', ')
      : row.parity_status === 'PASS' ? 'passes in the last measurement' : 'not scored'})`).join(', ');
    lines.push(`VISUAL PARITY GATE: FAILED ${ended} — ${residual.length} component(s) unresolved: ${where}`
      + `${verdict?.page ? ` — the page as a whole also ${verdict.page}` : ''} — see residual gaps`);
  } else if (verdict) {
    // Parity ran and failed with every component passing: the page itself, or its capture, is what failed.
    lines.push(`VISUAL PARITY GATE: FAILED ${ended} — ${verdict.summary}`);
  } else {
    lines.push('VISUAL PARITY GATE: BLOCKED — parity was not produced in this run');
  }
  lines.push('```', '');

  if (residual.length) {
    lines.push('## Residual gaps', '');
    lines.push('| Component | Lowest visual similarity | Failed at | Owning layer | Advisory gates | Attempts |');
    lines.push('|---|---:|---|---|---|---:|');
    for (const row of residual) {
      lines.push(`| ${row.id} | ${similarityText(row.similarity)} | ${failedAt(row)} | ${row.owning_layer || '—'} `
        + `| ${row.failed_gates.join(', ') || '—'} | ${row.attempts} |`);
    }
    lines.push('');
  }

  return {
    status,
    markdown: `${lines.join('\n')}\n`,
    summary: {
      status,
      run_id: state?.run_id,
      duration_seconds: state?.duration_seconds,
      components_planned: rows.length,
      components_passed: rows.filter((row) => row.status === 'PASS').length,
      components_failed: residual.length,
      by_tier: rows.reduce((accumulator, row) => {
        accumulator[tierLabel(row.tier)] = (accumulator[tierLabel(row.tier)] || 0) + 1;
        return accumulator;
      }, {}),
      component_build_attempts: Object.fromEntries(rows.map((row) => [row.id, row.build_attempts])),
      min_ratio: scoredRows.length ? Math.min(...scoredRows.map((row) => row.min_ratio)) : null,
      threshold: parity?.threshold ?? null,
      remediation_stopped: ledger?.stopped || null,
      parity_verdict: verdict ? { status: verdict.status, headline: verdict.headline, details: verdict.lines } : null,
      breakpoints_scored: breakpointKeys,
      parity_by_component: Object.fromEntries(rows.map((row) => [row.id, {
        status: row.status,
        min_ratio: row.min_ratio,
        failed_breakpoints: row.failed_breakpoints,
        breakpoint_scope: row.breakpoint_scope,
        ratios: Object.fromEntries(Object.entries(row.breakpoints)
          .map(([key, entry]) => [key, { ratio: entry.ratio ?? null, status: entry.status }])),
      }])),
      residual_gaps: residual.map((row) => ({
        component: row.id,
        min_ratio: row.min_ratio,
        failed_breakpoints: row.failed_breakpoints,
        breakpoint_scope: row.breakpoint_scope,
        owning_layer: row.owning_layer,
        failed_gates: row.failed_gates,
      })),
      timings: {
        total_seconds: totalSeconds,
        agent_seconds: modelSeconds,
        deploy_seconds: (deployment?.executed || []).reduce((sum, step) => sum + (step.duration_seconds || 0), 0),
        phases: Object.fromEntries((phases || []).map((phase) => [phase.name, phase.duration_seconds ?? null])),
        components: Object.fromEntries(rows.map((row) => [row.id, row.build_seconds])),
        invocations: invocations.map((entry) => ({
          id: entry.id, phase: entry.phase || entry.role, duration_seconds: entry.duration_seconds, status: entry.status,
        })),
        across_sessions: timings,
      },
      phases: phases || [],
    },
  };
}

export function writeReport(evidenceDir, report) {
  const markdownPath = path.join(evidenceDir, 'completion-report.md');
  const summaryPath = path.join(evidenceDir, 'completion-summary.json');
  fs.writeFileSync(markdownPath, report.markdown, 'utf8');
  fs.writeFileSync(summaryPath, `${JSON.stringify(report.summary, null, 2)}\n`, 'utf8');
  return { markdownPath, summaryPath };
}
