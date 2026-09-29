/**
 * Fresh-machine setup with npm and the browser faked: which installs run, and which browser the
 * tools are pointed at, for each combination of what the machine already has.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { ensureCopilot, ensureTools } from '../setup.mjs';

const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-setup-'));
const LOCKED = { playwright: '1.63.0', pixelmatch: '7.1.0', pngjs: '7.0.0' };
const originalChannel = process.env.PLAYWRIGHT_CHANNEL;

function machine({ installed = LOCKED, chrome = true, chromium = false, download = 0 } = {}) {
  const dir = fs.mkdtempSync(path.join(sandbox, 'machine-'));
  const install = (versions) => {
    for (const [name, version] of Object.entries(versions)) {
      fs.mkdirSync(path.join(dir, 'node_modules', name), { recursive: true });
      fs.writeFileSync(path.join(dir, 'node_modules', name, 'package.json'), JSON.stringify({ name, version }));
    }
  };
  fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify({
    packages: Object.fromEntries(Object.entries(LOCKED).map(([name, version]) => [`node_modules/${name}`, { version }])),
  }));
  install(installed);
  const state = { chromium, calls: [] };
  return {
    dir,
    state,
    run: (command, args) => {
      state.calls.push([path.basename(command), ...args.map((arg) => path.basename(arg))].join(' '));
      if (command === 'npm') {
        install(LOCKED);
        return 0;
      }
      if (download === 0) state.chromium = true;
      return download;
    },
    launch: async () => {
      const channel = process.env.PLAYWRIGHT_CHANNEL ?? 'chrome';
      if (channel === 'chrome') return chrome ? null : "Chromium distribution 'chrome' is not found";
      return state.chromium ? null : "Executable doesn't exist";
    },
  };
}

async function setup(fake, channel) {
  if (channel === undefined) delete process.env.PLAYWRIGHT_CHANNEL;
  else process.env.PLAYWRIGHT_CHANNEL = channel;
  try {
    const state = await ensureTools({ dir: fake.dir, log: () => {}, run: fake.run, launch: fake.launch });
    return { state, channel: process.env.PLAYWRIGHT_CHANNEL };
  } catch (error) {
    return { error: error.message, channel: process.env.PLAYWRIGHT_CHANNEL };
  }
}

// A machine that has run the tools before needs nothing installed.
let fake = machine();
let outcome = await setup(fake);
expect(outcome.state === 'present, browser chrome' && !fake.state.calls.length,
  `a ready machine must install nothing, got ${JSON.stringify(outcome)} after ${fake.state.calls.join('; ')}`);

// A fresh checkout has no node_modules, so the locked versions are installed.
fake = machine({ installed: {} });
outcome = await setup(fake);
expect(fake.state.calls.join('; ') === 'npm ci --no-fund --no-audit' && outcome.state === 'installed, browser chrome',
  `a fresh checkout must npm ci exactly once, got ${fake.state.calls.join('; ') || 'nothing'}`);

// A dependency at another version than the lock is reinstalled rather than trusted.
fake = machine({ installed: { ...LOCKED, playwright: '1.48.0' } });
outcome = await setup(fake);
expect(fake.state.calls.join('; ') === 'npm ci --no-fund --no-audit',
  `a playwright that does not match the lock must be reinstalled, got ${fake.state.calls.join('; ') || 'nothing'}`);

// No system Chrome: Playwright's Chromium is downloaded once, and the tools spawned later inherit it.
fake = machine({ chrome: false });
outcome = await setup(fake);
expect(outcome.channel === 'chromium' && outcome.state === 'present, browser chromium'
  && fake.state.calls.join('; ') === `${path.basename(process.execPath)} cli.js install chromium`,
`a machine without Chrome must get Playwright Chromium, got ${JSON.stringify(outcome)} after ${fake.state.calls.join('; ')}`);

fake = machine({ chrome: false, chromium: true });
outcome = await setup(fake);
expect(outcome.channel === 'chromium' && !fake.state.calls.length,
  `an already downloaded Chromium must not be downloaded again, got ${fake.state.calls.join('; ')}`);

// A channel set on purpose is never swapped for another browser.
fake = machine({ chrome: false });
outcome = await setup(fake, 'chrome');
expect(outcome.error?.includes('PLAYWRIGHT_CHANNEL=chrome') && outcome.channel === 'chrome' && !fake.state.calls.length,
  `an explicit channel that cannot launch must fail, not fall back, got ${JSON.stringify(outcome)}`);

// A download that cannot complete says what to do instead.
fake = machine({ chrome: false, download: 1 });
outcome = await setup(fake);
expect(outcome.error?.includes('Install Google Chrome') && outcome.error.includes('NODE_EXTRA_CA_CERTS'),
  `a failed download must name the alternatives, got ${JSON.stringify(outcome)}`);

// The Copilot CLI and SDK: only what the lookups cannot find is installed, globally, in one npm call.
function copilotMachine(missing, { npmStatus = 0, lands = true } = {}) {
  const state = { missing, calls: [] };
  return {
    state,
    missing: () => state.missing,
    run: (command, args) => {
      state.calls.push([command, ...args].join(' '));
      if (npmStatus === 0 && lands) state.missing = [];
      return npmStatus;
    },
  };
}

function copilotSetup(fake) {
  try {
    return { state: ensureCopilot({ log: () => {}, run: fake.run, missing: fake.missing }) };
  } catch (error) {
    return { error: error.message };
  }
}

let copilot = copilotMachine([]);
let copilotOutcome = copilotSetup(copilot);
expect(copilotOutcome.state === 'present' && !copilot.state.calls.length,
  `a machine with the Copilot CLI and SDK must install nothing, got ${JSON.stringify(copilotOutcome)}`);

copilot = copilotMachine(['@github/copilot-sdk']);
copilotOutcome = copilotSetup(copilot);
expect(copilotOutcome.state === 'installed'
  && copilot.state.calls.join('; ') === 'npm install --global --no-fund --no-audit @github/copilot-sdk',
`a missing SDK must be installed alone, got ${copilot.state.calls.join('; ') || 'nothing'}`);

copilot = copilotMachine(['@github/copilot', '@github/copilot-sdk'], { npmStatus: 1 });
copilotOutcome = copilotSetup(copilot);
expect(copilotOutcome.error?.includes('npm could not install') && copilot.state.calls.length === 1,
  `a failed global install must stop with the npm cause, got ${JSON.stringify(copilotOutcome)}`);

copilot = copilotMachine(['@github/copilot'], { lands: false });
copilotOutcome = copilotSetup(copilot);
expect(copilotOutcome.error?.includes('COPILOT_BIN'),
  `an install the lookups still cannot find must name the override, got ${JSON.stringify(copilotOutcome)}`);

if (originalChannel === undefined) delete process.env.PLAYWRIGHT_CHANNEL;
else process.env.PLAYWRIGHT_CHANNEL = originalChannel;
fs.rmSync(sandbox, { recursive: true, force: true });

if (failures.length) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  console.log(`\n${failures.length} assertion(s) failed.`);
  process.exitCode = 1;
} else {
  console.log('tool setup assertions: all passed');
}
