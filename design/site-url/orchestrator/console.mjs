/**
 * Live console renderer for a migration run. Everything shown here is derived from
 * observed events and file paths, not from the agent's own narration.
 */
const colorsEnabled = process.stdout.isTTY && !process.env.NO_COLOR;

// The classic Windows console host mangles box drawing; Windows Terminal and POSIX do not.
const unicodeSafe = process.env.MIGRATION_ASCII
  ? false
  : process.platform !== 'win32' || Boolean(process.env.WT_SESSION);

const SYMBOL = unicodeSafe
  ? {
    rule: '\u2501', stage: '\u25B6', pass: '\u2714', fail: '\u2718', blocked: '\u25A0', component: '\u25C6', dot: '\u00B7',
  }
  : {
    rule: '=', stage: '>', pass: 'OK', fail: 'X', blocked: '!', component: '*', dot: '-',
  };

const paint = (code) => (text) => (colorsEnabled ? `\u001b[${code}m${text}\u001b[0m` : text);
const cyan = paint(36);
const green = paint(32);
const red = paint(31);
const yellow = paint(33);
const dim = paint(2);
const bold = paint(1);

const TOOL_LABELS = {
  create: 'write',
  edit: 'edit',
  str_replace: 'edit',
  view: 'read',
  read: 'read',
  bash: 'shell',
  powershell: 'shell',
  shell: 'shell',
  fetch: 'fetch',
};

export function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return '--:--';
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

/**
 * Recognises which component a tool call is touching from the paths it mentions.
 * `knownIds` (the accepted plan's component ids) always wins, so any naming scheme works;
 * the patterns below are only a fallback for runs that have no plan yet.
 */
export function detectComponent(text, knownIds = []) {
  if (!text) return null;
  const value = String(text).replaceAll('\\', '/');

  // Prefer an exact plan id appearing as a path segment or file stem; longest wins.
  const matches = knownIds
    .filter((id) => new RegExp(`(^|[/_.-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([/_.-]|$)`).test(value))
    .sort((left, right) => right.length - left.length);
  if (matches.length) return matches[0];

  const direct = value.match(/components\/_?([a-z][a-z0-9]*(?:-[a-z0-9]+)+)/);
  if (direct) return direct[1];
  const model = value.match(/([A-Z][A-Za-z0-9]+)(?:Model|Impl)?\.java/);
  if (model) {
    const kebab = model[1].replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().replace(/-model$/, '');
    if (kebab.includes('-')) return kebab;
  }
  // Any experience fragment resolves to its variation folder, whatever the project calls it.
  const fragment = value.match(/experience-fragments\/(?:[^/]+\/)*([^/]+)\/(?:master|[^/]+)\//);
  if (fragment && fragment[1] !== 'experience-fragments') return fragment[1];
  return null;
}

export function createRenderer({ stageIds, heartbeatSeconds = 45 }) {
  const startedAt = Date.now();
  const state = {
    stage: null,
    component: null,
    lastEventAt: Date.now(),
    activityCount: 0,
    stageStartedAt: null,
    knownComponents: [],
  };
  let heartbeatTimer = null;

  const elapsed = () => formatDuration((Date.now() - startedAt) / 1000);
  const stageLabel = (stageId) => {
    const index = stageIds.indexOf(stageId);
    return index === -1 ? stageId : `${index + 1}/${stageIds.length} ${stageId}`;
  };

  function line(text) {
    process.stdout.write(`${text}\n`);
  }

  return {
    /** Called once the plan is accepted so activity attribution uses real component ids. */
    setKnownComponents(ids) {
      state.knownComponents = Array.isArray(ids) ? ids.filter(Boolean) : [];
    },

    runHeader({ siteUrl, aemUrl, runId, evidenceDir, model, effort }) {
      line('');
      line(cyan(SYMBOL.rule.repeat(78)));
      line(`${bold('AEM migration')}  ${siteUrl}`);
      line(dim(`target ${aemUrl}   model ${model}${effort ? ` (${effort})` : ''}`));
      line(dim(`run ${runId}`));
      line(dim(`evidence ${evidenceDir}`));
      line(cyan(SYMBOL.rule.repeat(78)));
      line('');
    },

    stageStarted(stageId, message) {
      state.stage = stageId;
      state.component = null;
      state.stageStartedAt = Date.now();
      state.activityCount = 0;
      state.lastEventAt = Date.now();
      line('');
      line(cyan(`${SYMBOL.stage} STAGE ${stageLabel(stageId)}`) + dim(`   +${elapsed()}`));
      if (message) line(dim(`  ${message}`));
    },

    stageFinished(stageId, status, message) {
      const duration = state.stageStartedAt ? (Date.now() - state.stageStartedAt) / 1000 : null;
      const mark = status === 'PASS' || status === 'COMPLETE' ? green(`${SYMBOL.pass} ${status}`)
        : status === 'BLOCKED' ? yellow(`${SYMBOL.blocked} ${status}`) : red(`${SYMBOL.fail} ${status}`);
      line(`${mark} ${stageLabel(stageId)}  ${dim(`${formatDuration(duration)} ${SYMBOL.dot} ${state.activityCount} actions`)}`);
      if (message) line(dim(`  ${message}`));
      state.stageStartedAt = null;
    },

    componentStarted(componentId, note) {
      if (!componentId || componentId === state.component) return;
      state.component = componentId;
      line(`  ${cyan(SYMBOL.component)} ${bold(componentId)}${note ? dim(`  ${note}`) : ''}`);
    },

    componentFinished(componentId, status) {
      const mark = status === 'PASS' ? green(SYMBOL.pass) : status === 'FAIL' ? red(SYMBOL.fail) : yellow(SYMBOL.blocked);
      line(`  ${mark} ${componentId} ${dim(status)}`);
      if (state.component === componentId) state.component = null;
    },

    /** Called for every tool request; infers the component when the agent does not declare one. */
    activity(toolName, detail) {
      state.lastEventAt = Date.now();
      state.activityCount += 1;
      const inferred = detectComponent(detail, state.knownComponents);
      if (inferred && inferred !== state.component) {
        state.component = inferred;
        line(`  ${cyan(SYMBOL.component)} ${bold(inferred)}`);
      }
      const label = TOOL_LABELS[toolName] || toolName;
      const compact = String(detail || '').replace(/\s+/g, ' ').trim().slice(0, 92);
      line(dim(`    ${elapsed()}  ${label.padEnd(6)} ${compact}`));
    },

    note(text) {
      state.lastEventAt = Date.now();
      line(dim(`    ${elapsed()}  note   ${String(text).replace(/\s+/g, ' ').trim().slice(0, 92)}`));
    },

    warn(text) {
      line(yellow(`    ${elapsed()}  ! ${text}`));
    },

    startHeartbeat() {
      if (heartbeatTimer) return;
      heartbeatTimer = setInterval(() => {
        const idle = (Date.now() - state.lastEventAt) / 1000;
        if (idle < heartbeatSeconds) return;
        const where = [
          state.stage ? `stage ${stageLabel(state.stage)}` : 'starting',
          state.component ? `component ${state.component}` : null,
        ].filter(Boolean).join(` ${SYMBOL.dot} `);
        line(dim(`    ${elapsed()}  ...    working — ${where} — ${formatDuration(idle)} since last event`));
      }, Math.max(5, Math.floor(heartbeatSeconds / 3)) * 1000);
      heartbeatTimer.unref?.();
    },

    stopHeartbeat() {
      if (!heartbeatTimer) return;
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    },

    summary(runSummary, { evidenceDir, targetUrl, components }) {
      line('');
      line(cyan(SYMBOL.rule.repeat(78)));
      const status = runSummary.status;
      const mark = status === 'COMPLETE' ? green(status) : status === 'BLOCKED' ? yellow(status) : red(status);
      line(`${bold('Run')} ${mark}   ${dim(`total ${formatDuration(runSummary.duration_seconds)}`)}`);
      line('');
      for (const stage of runSummary.stages) {
        const statusMark = stage.status === 'PASS' || stage.status === 'COMPLETE' ? green(stage.status.padEnd(8))
          : stage.status === 'PENDING' ? dim(stage.status.padEnd(8))
            : stage.status === 'BLOCKED' ? yellow(stage.status.padEnd(8)) : red(stage.status.padEnd(8));
        const failing = stage.failing_checks.length ? red(`  failing: ${stage.failing_checks.join(', ')}`) : '';
        line(`  ${stage.stage.padEnd(24)} ${statusMark} ${formatDuration(stage.duration_seconds).padStart(8)}${failing}`);
      }
      if (components?.length) {
        line('');
        line(`  ${bold('Components')} (${components.length})`);
        for (const component of components) {
          const statusMark = component.status === 'PASS' ? green(component.status)
            : component.status === 'PENDING' ? dim(component.status) : red(component.status);
          line(`    ${component.id.padEnd(26)} ${statusMark} ${dim(formatDuration(component.duration_seconds))}`);
        }
      }
      line('');
      line(dim(`  evidence ${evidenceDir}`));
      if (targetUrl) line(dim(`  page     ${targetUrl}`));
      line(cyan(SYMBOL.rule.repeat(78)));
    },
  };
}
