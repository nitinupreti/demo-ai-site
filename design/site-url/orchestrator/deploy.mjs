/**
 * Deterministic build and deploy. No model decides what to build or install.
 *
 * The whole reactor is built and installed as the single `all` package. Scoped per-module
 * installs were faster, but they left stale generated sources and half-updated modules behind
 * whenever a component was renamed or removed — which a fan-out does on every new source.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

export function planDeployment(aemPort) {
  return [{
    label: 'full build and deploy',
    module: 'all',
    command: 'mvn',
    // An editor's language server keeps handles on target/generated-sources, so on Windows clean
    // routinely cannot remove an empty directory. Clean must still run — stale generated sources
    // outlive a renamed component — but an undeletable leftover must not abort the deploy.
    args: [
      'clean', 'install', '-PautoInstallSinglePackage', `-Daem.port=${aemPort}`, '-DskipTests',
      '-Dmaven.clean.failOnError=false',
    ],
  }];
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
