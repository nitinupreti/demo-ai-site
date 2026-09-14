import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const toolsDir = fileURLToPath(new URL('./', import.meta.url));
const runner = path.join(toolsDir, 'parity-runner.mjs');
const fixture = (name) => pathToFileURL(path.join(toolsDir, 'fixtures', name)).href;

const INSTANCES = [
  { id: 'hero', source: { selector: '#hero' }, target: { selector: '#hero' } },
  { id: 'band', source: { selector: '#band' }, target: { selector: '#band' } },
];

function runParity({ target, args = [] }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parity-runner-'));
  const configPath = path.join(dir, 'parity-config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    evidenceDir: 'evidence',
    sourceUrl: fixture('reference.html'),
    settleMs: 100,
    viewportHeight: 900,
    deviceScaleFactor: 1,
    pixelmatch: { threshold: 0.1, includeAA: false },
    target: { disabled: { url: target }, author: { url: target, editorUrl: target } },
    instances: INSTANCES,
  }, null, 2));

  const result = spawnSync(process.execPath, [runner, '--config', configPath, ...args], {
    encoding: 'utf8', timeout: 300_000,
  });
  assert.ifError(result.error);
  const evidenceDir = path.join(dir, 'evidence');
  return {
    dir,
    evidenceDir,
    status: result.status,
    report: JSON.parse(result.stdout),
    scores: JSON.parse(fs.readFileSync(path.join(evidenceDir, 'parity', 'scores.json'), 'utf8')),
  };
}

function assertArtifacts(evidenceDir, row) {
  for (const key of ['sourceScreenshot', 'targetScreenshot', 'sideBySide', 'mask']) {
    const file = path.resolve(evidenceDir, row[key]);
    assert.ok(fs.existsSync(file), `${key} missing on disk: ${row[key]}`);
    assert.ok(fs.statSync(file).size >= 1024, `${key} is implausibly small`);
  }
}

test('identical documents score a clean pass at every breakpoint and target mode', () => {
  const run = runParity({ target: fixture('reference.html') });
  try {
    assert.equal(run.status, 0, JSON.stringify(run.report.failures));
    assert.equal(run.report.status, 'PASS');
    assert.deepEqual(run.report.failures, []);

    // 2 instances x 3 breakpoints x 2 modes, and one full-page pair per breakpoint/mode.
    assert.equal(run.scores.per_instance_scores.length, 12);
    assert.equal(run.scores.full_page_scores.length, 6);
    for (const row of run.scores.per_instance_scores) {
      assert.equal(row.visualMatchRatio, 1);
      assert.equal(row.matchedPixels + row.differingPixels, row.totalPixels);
      assertArtifacts(run.evidenceDir, row);
    }
    for (const row of run.scores.full_page_scores) assert.equal(row.fullPageVisualMatchRatio, 1);

    const covered = new Set(run.scores.full_page_scores.map((row) => `${row.breakpoint}|${row.mode}`));
    for (const breakpoint of run.scores.contract.breakpoints) {
      for (const mode of ['disabled', 'author']) assert.ok(covered.has(`${breakpoint}|${mode}`));
    }
  } finally {
    fs.rmSync(run.dir, { recursive: true, force: true });
  }
});

test('a drifting region fails its own instance without failing an unchanged one', () => {
  const run = runParity({ target: fixture('drift.html'), args: ['--bp', '375', '--mode', 'disabled'] });
  try {
    assert.equal(run.status, 1);
    assert.equal(run.report.status, 'FAIL');

    const byInstance = Object.fromEntries(run.scores.per_instance_scores.map((row) => [row.instance_id, row]));
    assert.equal(byInstance.hero.visualMatchRatio, 1);
    assert.ok(byInstance.band.visualMatchRatio < run.scores.contract.ratio);
    assertArtifacts(run.evidenceDir, byInstance.band);

    const failed = run.report.failures.map((row) => row.instance_id);
    assert.ok(failed.includes('band'));
    assert.ok(!failed.includes('hero'));
  } finally {
    fs.rmSync(run.dir, { recursive: true, force: true });
  }
});
