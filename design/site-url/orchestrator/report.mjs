/**
 * Deterministic completion report. Every number here is read from an artefact: parity scores from
 * parity.json, durations from run-state.json, counts from plan.json. Nothing is estimated.
 */
import fs from 'node:fs';
import path from 'node:path';

import { formatDuration } from './console.mjs';

function percent(ratio) {
  return typeof ratio === 'number' ? `${(ratio * 100).toFixed(2)}%` : 'n/a';
}

function tierLabel(tier) {
  return { 1: 'reused', 2: 'extended project', 3: 'extended core', 4: 'new' }[tier] || `tier ${tier}`;
}

/** Empty when the component passed everywhere, so a reader can scan the column for defects. */
function failedAt(row) {
  if (!row.failed_breakpoints.length) return '—';
  if (row.breakpoint_scope === 'all') return `all (${row.failed_breakpoints.join(', ')})`;
  return row.failed_breakpoints.join(', ');
}

export function buildReport({
  state, plan, parity, ledger, phases, invocations = [], workers = [], deployment,
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
      status: attempt?.status || score?.status || 'NOT SCORED',
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

  const lines = [];
  lines.push('# AEM migration report', '');
  lines.push(`- Status: **${status}**`);
  lines.push(`- Source: ${state?.inputs?.SITE_URL || 'n/a'}`);
  lines.push(`- Target: http://${state?.inputs?.AEM_HOST}:${state?.inputs?.AEM_PORT}`);
  lines.push(`- Run: ${state?.run_id}`);
  lines.push(`- Total time: ${formatDuration(state?.duration_seconds)}`);
  lines.push(`- Components created: **${rows.length}** for ${rows.reduce((total, row) => total + row.instances, 0)} source instances`);
  lines.push(`- Visual parity: **${rows.length - residual.length} passed, ${residual.length} failed**`
    + `${typeof parity?.threshold === 'number' ? ` against a > ${percent(parity.threshold)} threshold` : ''}`);
  if (rows.length) {
    const worst = Math.min(...rows.map((row) => row.min_ratio ?? 0));
    lines.push(`- Lowest component match: **${percent(worst)}**`);
  }
  lines.push('');

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
  lines.push('| Component | Tier | Role | Instances | Build time | Build tries | Min ratio | Status | Failed at | Advisory gates | Fix attempts |');
  lines.push('|---|---|---|---:|---:|---:|---:|---|---|---|---:|');
  for (const row of rows) {
    lines.push(`| ${row.id} | ${tierLabel(row.tier)} | ${row.role} | ${row.instances} | ${formatDuration(row.build_seconds)} `
      + `| ${row.build_attempts ?? '—'} | ${percent(row.min_ratio)} | ${row.status} | ${failedAt(row)} `
      + `| ${row.failed_gates.join(', ') || '—'} | ${row.attempts} |`);
  }
  lines.push('');

  if (breakpointKeys.length) {
    lines.push('### Visual parity by breakpoint', '');
    lines.push(`| Component | ${breakpointKeys.join(' | ')} | Min | Status |`);
    lines.push(`|---|${breakpointKeys.map(() => '---:').join('|')}|---:|---|`);
    for (const row of rows) {
      const cells = breakpointKeys.map((key) => {
        const entry = row.breakpoints[key];
        if (!entry) return '—';
        const value = entry.ratio === null ? 'withheld' : percent(entry.ratio);
        return entry.status === 'PASS' ? value : `**${value}**`;
      });
      lines.push(`| ${row.id} | ${cells.join(' | ')} | ${percent(row.min_ratio)} | ${row.status} |`);
    }
    lines.push('', 'Bold marks a breakpoint that did not pass.', '');
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
    lines.push('| Breakpoint | Ratio | Height delta | Status |');
    lines.push('|---|---:|---:|---|');
    for (const [key, entry] of Object.entries(parity.page_composite)) {
      lines.push(`| ${key} | ${percent(entry.ratio)} | ${entry.height_delta ?? 'n/a'} | ${entry.status} |`);
    }
    lines.push('');
  }

  lines.push('## Status line', '');
  lines.push('```text');
  if (status === 'COMPLETE') {
    const minimum = Math.min(...rows.map((row) => row.min_ratio ?? 1));
    const required = typeof parity?.threshold === 'number' ? percent(parity.threshold) : 'the run threshold';
    lines.push(`VISUAL PARITY GATE: PASSED at ${(state?.inputs?.BREAKPOINTS || []).join('/')} `
      + `— minimum component ${percent(minimum)} (required > ${required})`);
  } else if (residual.length) {
    const everywhere = residual.filter((row) => row.breakpoint_scope === 'all').length;
    lines.push(`VISUAL PARITY GATE: FAILED after bounded remediation — ${residual.length} component(s) unresolved `
      + `(${everywhere} at every breakpoint, ${residual.length - everywhere} at specific breakpoints) — see residual gaps`);
  } else {
    lines.push('VISUAL PARITY GATE: BLOCKED — parity was not produced in this run');
  }
  lines.push('```', '');

  if (residual.length) {
    lines.push('## Residual gaps', '');
    lines.push('| Component | Min ratio | Failed at | Owning layer | Advisory gates | Attempts |');
    lines.push('|---|---:|---|---|---|---:|');
    for (const row of residual) {
      lines.push(`| ${row.id} | ${percent(row.min_ratio)} | ${failedAt(row)} | ${row.owning_layer || '—'} `
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
      min_ratio: rows.length ? Math.min(...rows.map((row) => row.min_ratio ?? 0)) : null,
      threshold: parity?.threshold ?? null,
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
