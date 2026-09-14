import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  createAgentArguments,
  createRuntimePrompt,
  modelEfforts,
  selectModelAndEffort,
} from '../run-migration.mjs';

// Capability fixtures test launcher behavior, not account availability or LLM quality.
const efforts = ['low', 'medium', 'high', 'xhigh'];
const model = {
  id: 'fixture-reasoning-model',
  name: 'Fixture reasoning model',
  capabilities: { supports: { reasoningEffort: true } },
  supportedReasoningEfforts: efforts,
};
const evidenceDir = fileURLToPath(new URL('../../../scratch/reasoning-test-unused/', import.meta.url));
const optionsFor = (effort) => ({
  model: model.id,
  effort,
  siteUrl: 'https://example.com/source',
  targetPath: '/content/demo/en/test',
  aemHost: 'localhost',
  aemPort: 4504,
  breakpoints: [375, 768, 1440],
  maxContinues: 20,
});

test('supported efforts are filtered from advertised model capabilities', () => {
  assert.deepEqual(modelEfforts(model), efforts);
  assert.deepEqual(modelEfforts({ ...model, supportedReasoningEfforts: ['low', 'medium'] }), ['low', 'medium']);
  assert.deepEqual(modelEfforts({ ...model, supportedReasoningEfforts: ['high'] }), ['high']);
  assert.deepEqual(modelEfforts({ ...model, supportedReasoningEfforts: ['unknown', 'medium'] }), ['medium']);
  assert.deepEqual(modelEfforts({ ...model, supportedReasoningEfforts: undefined }), []);
  assert.deepEqual(modelEfforts({ id: 'managed' }), []);
  assert.deepEqual(modelEfforts({ ...model, capabilities: {} }), []);
});

test('CLI accepts every recognized effort case-insensitively and rejects invalid values offline', () => {
  const launcher = fileURLToPath(new URL('../run-migration.mjs', import.meta.url));
  for (const effort of [...efforts, 'LOW', 'MEDIUM', 'HIGH', 'XHIGH']) {
    const result = spawnSync(process.execPath, [launcher, '--help', '--effort', effort], {
      encoding: 'utf8', timeout: 10000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Thinking effort: low, medium, high, xhigh, when supported/);
  }
  for (const [args, message] of [
    [['--effort', 'invalid'], /--effort must be low, medium, high, xhigh/],
    [['--effort'], /--effort requires a value/],
  ]) {
    const result = spawnSync(process.execPath, [launcher, '--help', ...args], {
      encoding: 'utf8', timeout: 10000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, message);
  }
});

for (const effort of efforts) {
  test(`${effort} selection is preserved in runtime inputs and CLI arguments`, async (t) => {
    t.mock.method(console, 'log', () => {});
    const options = optionsFor(effort);
    await selectModelAndEffort(options, [model]);
    assert.equal(options.effort, effort);
    const prompt = createRuntimePrompt(options, 'test-run', evidenceDir, path.join(evidenceDir, 'run-state.json'));
    assert.ok(prompt.includes(`THINKING_EFFORT: "${effort}"`));
    const args = createAgentArguments(options, prompt, evidenceDir);
    assert.equal(args[args.indexOf('--effort') + 1], effort);
    assert.equal(args[args.indexOf('--model') + 1], model.id);
    assert.equal(args[args.indexOf('-p') + 1], prompt);
    assert.ok(args.includes('--autopilot'));
  });
}

test('all effort choices change only metadata, not workflow instructions or CLI protections', () => {
  const choices = [...efforts, undefined];
  const prompts = choices.map((effort) => createRuntimePrompt(
    optionsFor(effort), 'test-run', evidenceDir, path.join(evidenceDir, 'run-state.json'),
  ).replace(/^THINKING_EFFORT: .*$/m, 'THINKING_EFFORT: <selected>'));
  for (const prompt of prompts) assert.equal(prompt, prompts[0]);
  const args = choices.map((effort) => {
    const values = createAgentArguments(optionsFor(effort), 'same prompt', evidenceDir);
    const index = values.indexOf('--effort');
    if (index !== -1) values.splice(index, 2);
    return values;
  });
  for (const values of args) assert.deepEqual(values, args[0]);
});

for (const effort of efforts) {
  test(`unsupported ${effort} is rejected rather than silently replaced`, async (t) => {
    t.mock.method(console, 'log', () => {});
    await assert.rejects(
      selectModelAndEffort(optionsFor(effort), [{
        ...model, supportedReasoningEfforts: efforts.filter((value) => value !== effort),
      }]),
      new RegExp(`supports effort .+, not ${effort}`),
    );
  });
}

test('models advertising only low and medium remain configurable', async (t) => {
  t.mock.method(console, 'log', () => {});
  const lowerEffortModel = { ...model, supportedReasoningEfforts: ['low', 'medium'] };
  for (const effort of ['low', 'medium']) {
    const options = optionsFor(effort);
    await selectModelAndEffort(options, [lowerEffortModel]);
    assert.equal(options.effort, effort);
  }
});

test('model-managed reasoning rejects forced effort and omits the flag otherwise', async (t) => {
  t.mock.method(console, 'log', () => {});
  const managed = { ...model, capabilities: {} };
  for (const effort of efforts) {
    await assert.rejects(selectModelAndEffort(optionsFor(effort), [managed]), /does not support a configurable/);
  }
  const options = optionsFor(undefined);
  await selectModelAndEffort(options, [managed]);
  assert.equal(options.effort, undefined);
  assert.ok(!createAgentArguments(options, 'prompt', evidenceDir).includes('--effort'));
});

test('unavailable model is rejected without inventing a supported fallback', async (t) => {
  t.mock.method(console, 'log', () => {});
  await assert.rejects(
    selectModelAndEffort({ ...optionsFor('high'), model: 'not-available' }, [model]),
    /not available to this account/,
  );
});