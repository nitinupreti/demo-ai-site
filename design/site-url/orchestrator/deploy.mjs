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

/** Unambiguous failures. `Resolved` and `Starting` are legitimate for lazily activated bundles. */
const BROKEN_STATES = new Set(['Installed', 'Uninstalled']);

function unresolvedRequirements(detail) {
  const props = detail?.data?.[0]?.props || [];
  const imports = props.find((entry) => /^Imported Packages$/i.test(entry.key))?.value || [];
  return (Array.isArray(imports) ? imports : [imports])
    .map((line) => String(line).replace(/<[^>]+>/g, '').trim())
    .filter((line) => /ERROR|cannot be resolved/i.test(line));
}

/**
 * A green `mvn install` only proves the artefact was uploaded. A bundle whose imports the
 * instance cannot satisfy installs quietly and stays unresolved, so every class it holds is
 * simply absent — which surfaces much later as an HTL use-class that "cannot be resolved to a
 * type". Asking the instance what actually started is the only way to catch that at deploy time.
 */
export async function verifyBundles({
  aemUrl, username = 'admin', password, fetchFn = fetch,
}) {
  const headers = {
    authorization: `Basic ${Buffer.from(`${username}:${password ?? ''}`).toString('base64')}`,
  };
  let listing;
  try {
    const response = await fetchFn(`${aemUrl}/system/console/bundles.json`, { headers });
    if (!response.ok) {
      return { status: 'UNKNOWN', reason: `bundle listing returned HTTP ${response.status}`, broken: [] };
    }
    listing = await response.json();
  } catch (error) {
    return { status: 'UNKNOWN', reason: `bundle listing unreachable: ${error.message}`, broken: [] };
  }

  const broken = (listing.data || []).filter((bundle) => BROKEN_STATES.has(bundle.state));
  if (!broken.length) return { status: 'PASS', broken: [], total: (listing.data || []).length };

  const detailed = [];
  for (const bundle of broken) {
    let unresolved = [];
    try {
      const response = await fetchFn(`${aemUrl}/system/console/bundles/${bundle.id}.json`, { headers });
      if (response.ok) unresolved = unresolvedRequirements(await response.json());
    } catch {
      // The state alone is already enough to fail on; the detail is a convenience.
    }
    detailed.push({
      id: bundle.id, symbolicName: bundle.symbolicName, version: bundle.version, state: bundle.state, unresolved,
    });
  }
  return { status: 'FAIL', broken: detailed, total: (listing.data || []).length };
}

export function describeBrokenBundles(broken) {
  return broken.map((bundle) => {
    const why = bundle.unresolved.length ? `\n    ${bundle.unresolved.join('\n    ')}` : '';
    return `  ${bundle.symbolicName} ${bundle.version} is ${bundle.state}${why}`;
  }).join('\n');
}
