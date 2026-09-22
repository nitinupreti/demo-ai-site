/**
 * Deterministic build and deploy. The scope-to-command mapping comes from
 * 03-assets-runtime.md; no model decides what to build or install. Installs are awaited in
 * dependency order so two packages never contend on one AEM instance.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const MODULE_RULES = [
  { test: /^ui\.frontend\//, module: 'ui.frontend', order: 0 },
  { test: /^core\/src\/main\/java\//, module: 'core', order: 1 },
  { test: /^ui\.apps\//, module: 'ui.apps', order: 2 },
  { test: /^ui\.config\//, module: 'ui.config', order: 3 },
  { test: /^ui\.content\//, module: 'ui.content', order: 4 },
];

const MODULE_COMMANDS = {
  'ui.frontend': (port) => [
    { label: 'frontend build', command: 'npm', args: ['run', 'build'], cwd: 'ui.frontend' },
    { label: 'ui.apps package', command: 'mvn', args: ['install', '-pl', 'ui.apps', '-PautoInstallPackage', `-Daem.port=${port}`, '-DskipTests'] },
  ],
  core: (port) => [
    { label: 'core bundle', command: 'mvn', args: ['install', '-pl', 'core', '-PautoInstallBundle', `-Daem.port=${port}`, '-DskipTests'] },
  ],
  'ui.apps': (port) => [
    { label: 'ui.apps package', command: 'mvn', args: ['install', '-pl', 'ui.apps', '-PautoInstallPackage', `-Daem.port=${port}`, '-DskipTests'] },
  ],
  'ui.config': (port) => [
    { label: 'ui.config package', command: 'mvn', args: ['install', '-pl', 'ui.config', '-PautoInstallPackage', `-Daem.port=${port}`, '-DskipTests'] },
  ],
  'ui.content': (port) => [
    { label: 'ui.content package', command: 'mvn', args: ['install', '-pl', 'ui.content', '-PautoInstallPackage', `-Daem.port=${port}`, '-DskipTests'] },
  ],
};

export function modulesFor(changedFiles) {
  const modules = new Map();
  for (const file of changedFiles) {
    const normalized = String(file).replaceAll('\\', '/');
    const rule = MODULE_RULES.find((entry) => entry.test.test(normalized));
    if (rule) modules.set(rule.module, rule.order);
  }
  return [...modules.entries()].sort((left, right) => left[1] - right[1]).map(([module]) => module);
}

/** Frontend output is copied into ui.apps, so a frontend change absorbs the ui.apps install. */
export function planDeployment(changedFiles, aemPort) {
  const modules = modulesFor(changedFiles);
  const effective = modules.includes('ui.frontend')
    ? modules.filter((module) => module !== 'ui.apps')
    : modules;
  return effective.flatMap((module) => MODULE_COMMANDS[module](aemPort).map((step) => ({ ...step, module })));
}

/** Focused tests are declared by workers and executed once here, in the warm tree. */
export function focusedTestPlan(results) {
  const tests = new Set();
  for (const result of results) {
    const declared = result?.result?.focused_test;
    if (!declared) continue;
    for (const name of declared.tests || []) tests.add(name);
  }
  if (!tests.size) return null;
  return {
    label: 'focused tests',
    command: 'mvn',
    args: ['-pl', 'core', 'test', `-Dtest=${[...tests].sort().join(',')}`, '-DfailIfNoTests=false'],
  };
}

function execute(step, repoRoot, execFn) {
  return new Promise((resolve, reject) => {
    const child = execFn(step.command, step.args, {
      cwd: step.cwd ? path.join(repoRoot, step.cwd) : repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });
    let output = '';
    child.stdout?.on('data', (chunk) => { output += chunk.toString(); });
    child.stderr?.on('data', (chunk) => { output += chunk.toString(); });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, output }));
  });
}

/**
 * Static correctness for one worker's checkout, scoped to what it actually touched.
 * These run before the merge so a broken build is a rejection the worker can still fix,
 * rather than a deploy failure discovered after every component has finished.
 */
const VALIDATION_RULES = [
  // HTL validation is bound to generate-sources, so that phase is what surfaces a syntax error.
  { test: /^[^/]*ui\.apps\//, label: 'HTL syntax', args: ['-pl', 'ui.apps', 'generate-sources'] },
  // test-compile, not compile: the worker writes a unit test, and that has to build as well.
  { test: /^[^/]*core\//, label: 'Java compile', args: ['-pl', 'core', 'test-compile'] },
];

export function validationPlan(changedFiles, { focusedTests = [] } = {}) {
  const touched = changedFiles.map((file) => String(file).replaceAll('\\', '/'));
  const steps = VALIDATION_RULES
    .filter((rule) => touched.some((file) => rule.test.test(file)))
    .map((rule) => ({ label: rule.label, module: rule.label, command: 'mvn', args: rule.args }));

  if (focusedTests.length && steps.some((step) => step.label === 'Java compile')) {
    steps.push({
      label: 'unit test',
      module: 'unit test',
      command: 'mvn',
      args: ['-pl', 'core', 'test', `-Dtest=${[...focusedTests].sort().join(',')}`, '-DfailIfNoTests=false'],
    });
  }
  return steps;
}

/** Runs a worker's validation steps in its own workspace; the first failure wins. */
export async function runValidation({ workspaceRoot, steps, execFn = spawn }) {
  for (const step of steps) {
    const { code, output } = await execute(step, workspaceRoot, execFn);
    if (code !== 0) {
      const reported = output.split('\n').filter((line) => line.includes('[ERROR]')).slice(0, 12);
      return { status: 'FAIL', label: step.label, detail: (reported.join('\n') || output.slice(-1500)).trim() };
    }
  }
  return { status: 'PASS' };
}

export async function runDeployment({
  repoRoot, steps, renderer, execFn = spawn, logPath, writeLog,
}) {
  const executed = [];
  for (const step of steps) {
    renderer?.note(`deploy: ${step.label}`);
    const started = Date.now();
    const { code, output } = await execute(step, repoRoot, execFn);
    const durationSeconds = Number(((Date.now() - started) / 1000).toFixed(2));
    executed.push({
      label: step.label, module: step.module, command: `${step.command} ${step.args.join(' ')}`, exit_code: code, duration_seconds: durationSeconds,
    });
    if (writeLog && logPath) writeLog(logPath, `\n=== ${step.label} ===\n${output}\n`);
    if (code !== 0) {
      return { status: 'FAIL', executed, failure: { step: step.label, exit_code: code, tail: output.slice(-2000) } };
    }
  }
  return { status: 'PASS', executed };
}
