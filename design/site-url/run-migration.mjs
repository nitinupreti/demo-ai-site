import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline';
import readlinePromises from 'node:readline/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const canonicalPromptPath = path.join(here, 'prompt_new.md');
const defaultAemPort = 4502;
const launcherVersion = '1.6.0';
const stageIds = [
  '01-source-discovery',
  '02-component-authoring',
  '03-assets-runtime',
  '04-visual-parity',
  '05-completion-output',
];

const colorsEnabled = process.stdout.isTTY && !process.env.NO_COLOR;
const color = {
  cyan: (text) => colorsEnabled ? `\x1b[36m${text}\x1b[0m` : text,
  green: (text) => colorsEnabled ? `\x1b[32m${text}\x1b[0m` : text,
  red: (text) => colorsEnabled ? `\x1b[31m${text}\x1b[0m` : text,
  yellow: (text) => colorsEnabled ? `\x1b[33m${text}\x1b[0m` : text,
  dim: (text) => colorsEnabled ? `\x1b[2m${text}\x1b[0m` : text,
};

function printHelp() {
  console.log(`
AEM URL Migration Launcher

Usage:
  run-migration.cmd
  run-migration.cmd --url <https://site/page> [options]
  node design/site-url/run-migration.mjs --url <https://site/page> [options]

Options:
  -u, --url <url>              Live source URL; blank uses prompt_new.md
      --target-path <path>     Optional AEM page path
      --aem-host <host>        Local AEM host (default: localhost)
      --aem-port <port>        Local AEM port; blank uses ${defaultAemPort}
      --breakpoints <list>     Comma-separated widths (default: 375,768,1440)
      --evidence-dir <path>    Override the generated evidence directory
      --model <model>          Model ID; prompted from account models when omitted
      --effort <level>         Thinking effort: high or xhigh, when supported
      --list-models            List models available to the authenticated account
      --login                  Open GitHub browser login before model discovery
      --no-login               Reuse existing credentials; fail if unauthenticated
      --max-ai-credits <n>     Optional Copilot credit cap (minimum: 30)
      --max-continues <n>      Autopilot continuation limit (default: 20)
      --no-open                Do not open the final AEM page
      --dry-run                Validate and create run inputs without invoking AI
      --agent-smoke-test       Invoke Copilot safely without tools or migration work
  -h, --help                   Show this help
`);
}

function readValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith('-')) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

function parseArgs(argv) {
  const options = {
    aemHost: 'localhost',
    aemPort: defaultAemPort,
    aemPortProvided: false,
    breakpoints: [375, 768, 1440],
    maxContinues: 20,
    loginMode: 'auto',
    openResult: true,
    dryRun: false,
    agentSmokeTest: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case '-h':
      case '--help':
        options.help = true;
        break;
      case '-u':
      case '--url':
        options.siteUrl = readValue(argv, index, argument);
        index += 1;
        break;
      case '--target-path':
        options.targetPath = readValue(argv, index, argument);
        index += 1;
        break;
      case '--aem-host':
        options.aemHost = readValue(argv, index, argument);
        index += 1;
        break;
      case '--aem-port':
        options.aemPort = Number.parseInt(readValue(argv, index, argument), 10);
        options.aemPortProvided = true;
        index += 1;
        break;
      case '--breakpoints':
        options.breakpoints = readValue(argv, index, argument)
          .split(',')
          .map((value) => Number.parseInt(value.trim(), 10));
        index += 1;
        break;
      case '--evidence-dir':
        options.evidenceDir = readValue(argv, index, argument);
        index += 1;
        break;
      case '--model':
        options.model = readValue(argv, index, argument);
        index += 1;
        break;
      case '--effort':
        options.effort = readValue(argv, index, argument).toLowerCase();
        index += 1;
        break;
      case '--list-models':
        options.listModels = true;
        break;
      case '--login':
        options.loginMode = 'force';
        break;
      case '--no-login':
        options.loginMode = 'existing';
        break;
      case '--max-ai-credits':
        options.maxAiCredits = readValue(argv, index, argument);
        index += 1;
        break;
      case '--max-continues':
        options.maxContinues = Number.parseInt(readValue(argv, index, argument), 10);
        index += 1;
        break;
      case '--no-open':
        options.openResult = false;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--agent-smoke-test':
        options.agentSmokeTest = true;
        break;
      case '--print-defaults':
        options.printDefaults = true;
        break;
      default:
        if (!argument.startsWith('-') && !options.siteUrl) {
          options.siteUrl = argument;
          break;
        }
        throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!Number.isInteger(options.aemPort) || options.aemPort < 1 || options.aemPort > 65535) {
    throw new Error('--aem-port must be an integer between 1 and 65535.');
  }
  if (!options.breakpoints.length || options.breakpoints.some((width) => !Number.isInteger(width) || width < 240)) {
    throw new Error('--breakpoints must contain comma-separated integer widths of at least 240.');
  }
  if (options.effort && !['high', 'xhigh'].includes(options.effort)) {
    throw new Error('--effort must be high or xhigh.');
  }
  if (options.maxAiCredits !== undefined
      && (!Number.isInteger(Number(options.maxAiCredits)) || Number(options.maxAiCredits) < 30)) {
    throw new Error('--max-ai-credits must be an integer of at least 30.');
  }
  if (!Number.isInteger(options.maxContinues) || options.maxContinues < 1 || options.maxContinues > 100) {
    throw new Error('--max-continues must be an integer between 1 and 100.');
  }
  if (options.dryRun && options.agentSmokeTest) {
    throw new Error('--dry-run and --agent-smoke-test cannot be used together.');
  }
  return options;
}

async function promptForInputs(options) {
  const needsSiteUrl = !options.siteUrl;
  const needsAemPort = !options.aemPortProvided;
  if (!needsSiteUrl && !needsAemPort) return;

  const defaultSiteUrl = needsSiteUrl ? readDefaultSiteUrl() : null;

  if (!process.stdin.isTTY) {
    if (needsSiteUrl) options.siteUrl = defaultSiteUrl;
    if (needsAemPort) options.aemPort = defaultAemPort;
    return;
  }

  const terminal = readlinePromises.createInterface({ input: process.stdin, output: process.stdout });
  try {
    if (needsSiteUrl) {
      const answer = ((await terminal.question(`Live site URL [${defaultSiteUrl}]: `)) || '').trim();
      options.siteUrl = answer || defaultSiteUrl;
    }
    if (needsAemPort) {
      const answer = ((await terminal.question(`Local AEM author port [${defaultAemPort}]: `)) || '').trim();
      options.aemPort = Number.parseInt(answer || String(defaultAemPort), 10);
    }
  } finally {
    terminal.close();
  }
}

function readDefaultSiteUrl() {
  if (!fs.existsSync(canonicalPromptPath)) {
    throw new Error(`Missing canonical prompt: ${canonicalPromptPath}`);
  }
  const prompt = fs.readFileSync(canonicalPromptPath, 'utf8');
  const match = prompt.match(/^SITE_URL:\s*(?:"([^"]+)"|'([^']+)'|(\S+))\s*$/m);
  const value = match && (match[1] || match[2] || match[3]);
  if (!value || value === '<runtime-required>') {
    throw new Error('prompt_new.md must contain a concrete SITE_URL fallback or the launcher must receive --url.');
  }
  return normalizeSiteUrl(value);
}

function normalizeSiteUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid URL: ${value}`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('SITE_URL must use http or https.');
  }
  parsed.hash = '';
  return parsed.toString();
}

async function probeUrl(url, label, headers = {}) {
  const methods = ['HEAD', 'GET'];
  let lastFailure;
  for (const method of methods) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(url, {
        method,
        headers: {
          'User-Agent': 'AEM-Migration-Launcher/1.0',
          ...headers,
        },
        redirect: 'follow',
        signal: controller.signal,
      });
      if (response.body) {
        await response.body.cancel();
      }
      if (response.ok || (response.status >= 300 && response.status < 400)) {
        return { status: response.status, finalUrl: response.url, method };
      }
      lastFailure = `${method} returned HTTP ${response.status}`;
    } catch (error) {
      lastFailure = `${method} failed: ${error.message}`;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`${label} is not reachable (${lastFailure}): ${url}`);
}

function assertProjectConfiguration() {
  const configPath = path.join(repoRoot, '.aem-skills-config.yaml');
  if (!fs.existsSync(configPath)) {
    throw new Error('Missing .aem-skills-config.yaml in the repository root.');
  }
  const config = fs.readFileSync(configPath, 'utf8');
  if (!/^configured:\s*true\s*$/mi.test(config)) {
    throw new Error('.aem-skills-config.yaml must contain configured: true.');
  }
}

function findCopilot() {
  const candidates = [];
  if (process.env.COPILOT_BIN) candidates.push(process.env.COPILOT_BIN);
  if (process.platform === 'win32' && process.env.APPDATA) {
    const architecture = process.arch === 'arm64' ? 'arm64' : 'x64';
    candidates.push(path.join(
      process.env.APPDATA,
      'npm',
      'node_modules',
      '@github',
      'copilot',
      'node_modules',
      '@github',
      `copilot-win32-${architecture}`,
      'copilot.exe',
    ));
  }
  candidates.push('copilot');

  for (const executable of [...new Set(candidates)]) {
    if (path.isAbsolute(executable) && !fs.existsSync(executable)) continue;
    const versionResult = spawnSync(executable, ['--version'], {
      cwd: repoRoot,
      encoding: 'utf8',
      shell: false,
    });
    if (!versionResult.error && versionResult.status === 0) {
      const version = (versionResult.stdout || versionResult.stderr)
        .split(/\r?\n/)
        .find((line) => line.trim())
        ?.trim();
      return { executable, version: version || 'GitHub Copilot CLI' };
    }
  }
  throw new Error('GitHub Copilot CLI was not found. Run `npm install -g @github/copilot` and `copilot login`, then retry.');
}

function findCopilotSdk(copilot) {
  const candidates = [];
  if (process.env.COPILOT_SDK_PATH) candidates.push(process.env.COPILOT_SDK_PATH);
  if (path.isAbsolute(copilot.executable)) {
    candidates.push(path.join(path.dirname(copilot.executable), 'copilot-sdk', 'index.js'));
  }
  if (process.platform === 'win32' && process.env.APPDATA) {
    const architecture = process.arch === 'arm64' ? 'arm64' : 'x64';
    candidates.push(path.join(
      process.env.APPDATA,
      'npm',
      'node_modules',
      '@github',
      'copilot',
      'node_modules',
      '@github',
      `copilot-win32-${architecture}`,
      'copilot-sdk',
      'index.js',
    ));
  }
  const sdkPath = [...new Set(candidates)].find((candidate) => fs.existsSync(candidate));
  if (!sdkPath) {
    throw new Error('Copilot SDK was not found beside the installed CLI. Reinstall `@github/copilot` or set COPILOT_SDK_PATH.');
  }
  return sdkPath;
}

async function listAvailableModels(copilot) {
  const sdkPath = findCopilotSdk(copilot);
  const { CopilotClient } = await import(pathToFileURL(sdkPath).href);
  const client = new CopilotClient();
  try {
    await client.start();
    const auth = await client.getAuthStatus();
    if (!auth.isAuthenticated) {
      throw new Error('GitHub Copilot CLI is not authenticated. Run `copilot login`, then retry.');
    }
    const models = await client.listModels();
    return models.filter((model) => model.policy?.state !== 'disabled');
  } finally {
    await client.stop();
  }
}

async function getCopilotAuthStatus(copilot) {
  const sdkPath = findCopilotSdk(copilot);
  const { CopilotClient } = await import(pathToFileURL(sdkPath).href);
  const client = new CopilotClient();
  try {
    await client.start();
    return await client.getAuthStatus();
  } finally {
    await client.stop();
  }
}

async function ensureCopilotAuthenticated(copilot, loginMode) {
  let auth = await getCopilotAuthStatus(copilot);
  if (loginMode === 'force' || !auth.isAuthenticated) {
    if (loginMode === 'existing') {
      throw new Error('GitHub Copilot CLI is not authenticated. Rerun without --no-login or run `copilot login --web-flow`.');
    }
    console.log(color.cyan('\nOpening GitHub sign-in in your browser...'));
    const login = spawnSync(copilot.executable, ['login', '--web-flow'], {
      cwd: repoRoot,
      stdio: 'inherit',
      shell: false,
    });
    if (login.error || login.status !== 0) {
      throw new Error(`GitHub Copilot browser login failed${login.error ? `: ${login.error.message}` : ` with exit code ${login.status}`}.`);
    }
    auth = await getCopilotAuthStatus(copilot);
  }
  if (!auth.isAuthenticated) {
    throw new Error('GitHub Copilot authentication did not complete. Run `copilot login --web-flow`, then retry.');
  }
  console.log(color.green(`  GitHub authenticated${auth.login ? ` as ${auth.login}` : ''}.`));
  return auth;
}

function preferredModelIndex(models) {
  const opusCandidates = models
    .map((model, index) => ({ model, index }))
    .filter(({ model }) => /opus/i.test(`${model.name} ${model.id}`))
    .sort((left, right) => right.model.name.localeCompare(left.model.name, undefined, { numeric: true }));
  if (opusCandidates.length) return opusCandidates[0].index;
  const autoIndex = models.findIndex((model) => model.id === 'auto');
  return autoIndex >= 0 ? autoIndex : 0;
}

function modelEfforts(model) {
  if (!model.capabilities?.supports?.reasoningEffort) return [];
  return (model.supportedReasoningEfforts || []).filter((effort) => ['high', 'xhigh'].includes(effort));
}

function printModels(models) {
  console.log(color.cyan('\nModels available to the authenticated GitHub account:'));
  models.forEach((model, index) => {
    const efforts = modelEfforts(model);
    const effortLabel = efforts.length ? `; effort: ${efforts.join('/')}` : '; effort: managed by model';
    const multiplier = model.billing?.multiplier === undefined ? '' : `; billing: ${model.billing.multiplier}x`;
    console.log(`  ${index + 1}. ${model.name} (${model.id})${effortLabel}${multiplier}`);
  });
}

async function selectModelAndEffort(options, models) {
  if (!models.length) {
    throw new Error('The authenticated GitHub account returned no enabled Copilot models.');
  }
  printModels(models);

  let selected;
  if (options.model) {
    const requested = options.model.toLowerCase();
    selected = models.find((model) => model.id.toLowerCase() === requested || model.name.toLowerCase() === requested);
    if (!selected) {
      throw new Error(`Model "${options.model}" is not available to this account. Use --list-models to inspect available IDs.`);
    }
  } else if (process.stdin.isTTY) {
    const defaultIndex = preferredModelIndex(models);
    const terminal = readlinePromises.createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = ((await terminal.question(`Select model [${defaultIndex + 1}]: `)) || '').trim();
      const selectedIndex = answer ? Number.parseInt(answer, 10) - 1 : defaultIndex;
      if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= models.length) {
        throw new Error(`Model selection must be a number between 1 and ${models.length}.`);
      }
      selected = models[selectedIndex];
    } finally {
      terminal.close();
    }
  } else {
    selected = models[preferredModelIndex(models)];
  }

  options.model = selected.id;
  const efforts = modelEfforts(selected);
  if (!efforts.length) {
    if (options.effort) {
      throw new Error(`Model "${selected.name}" does not support configurable high/xhigh effort.`);
    }
    options.effort = undefined;
    console.log(color.dim(`  Selected ${selected.name}; reasoning effort is managed by the model.`));
    return;
  }

  if (options.effort) {
    if (!efforts.includes(options.effort)) {
      throw new Error(`Model "${selected.name}" supports effort ${efforts.join('/')}, not ${options.effort}.`);
    }
  } else if (process.stdin.isTTY) {
    const defaultEffort = efforts.includes('high') ? 'high' : efforts[0];
    const terminal = readlinePromises.createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = ((await terminal.question(`Thinking effort [${defaultEffort}] (${efforts.join('/')}): `)) || '').trim().toLowerCase();
      options.effort = answer || defaultEffort;
    } finally {
      terminal.close();
    }
    if (!efforts.includes(options.effort)) {
      throw new Error(`Thinking effort must be ${efforts.join(' or ')} for ${selected.name}.`);
    }
  } else {
    options.effort = efforts.includes('high') ? 'high' : efforts[0];
  }
  console.log(color.green(`  Selected ${selected.name} with ${options.effort} effort.`));
}

function writeJson(filePath, value) {
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryPath, filePath);
}

function relativeToRepo(filePath) {
  return path.relative(repoRoot, filePath).replaceAll('\\', '/');
}

function createRuntimePrompt(options, runId, evidenceDir, statePath) {
  const lines = [
    '# Standalone AEM Migration Run',
    '',
    'Execute this migration end to end without VS Code. The runtime values below are authoritative and override placeholders or examples in repository prompt files.',
    '',
    '```yaml',
    `SITE_URL: ${JSON.stringify(options.siteUrl)}`,
    `TARGET_PAGE_PATH: ${options.targetPath ? JSON.stringify(options.targetPath) : 'null'}`,
    `BREAKPOINTS: [${options.breakpoints.join(', ')}]`,
    `AEM_HOST: ${JSON.stringify(options.aemHost)}`,
    `AEM_PORT: ${options.aemPort}`,
    `MODEL: ${JSON.stringify(options.model)}`,
    `THINKING_EFFORT: ${options.effort ? JSON.stringify(options.effort) : 'null'}`,
    `RUN_ID: ${JSON.stringify(runId)}`,
    `EVIDENCE_DIR: ${JSON.stringify(relativeToRepo(evidenceDir))}`,
    `RUN_STATE: ${JSON.stringify(relativeToRepo(statePath))}`,
    '```',
    '',
    'Read `design/site-url/prompt_new.md` first and execute its Stage Router in exact order. Read each numbered stage file only when that stage becomes active. Follow `AGENTS.md`, `CLAUDE.md`, `.aem-skills-config.yaml`, and every required AEM skill. Use Node.js Playwright/Chromium for browser evidence.',
    '',
    'Standalone execution rules:',
    '- Do not edit `design/site-url/prompt_new.md` or its numbered stage specifications to inject runtime values.',
    '- Do not commit, switch branches, reset, clean, or revert existing user changes.',
    '- Do not ask interactive questions. For genuinely required user input or an external blocker, persist a truthful `BLOCKED` result and stop.',
    '- The user explicitly authorizes autonomous component creation for this run. When a component workflow normally asks for field confirmation, derive the smallest exact field contract from accepted source evidence, persist it in `design-facts`, and proceed without inventing additional fields.',
    '- Before each stage, print one line exactly as `MIGRATION_PROGRESS {"stage":"<stage-id>","status":"STARTED","message":"<short message>"}`.',
    '- After each stage, print the same format with `PASS`, `FAIL`, or `BLOCKED`, and persist the full stage_result envelope to RUN_STATE before continuing.',
    '- Keep RUN_STATE current throughout the run. Preserve its `launcher` and `inputs` fields.',
    '- On terminal completion, set top-level `status` to `COMPLETE`, `FAIL`, or `BLOCKED`, set `current_stage`, and set `target_url` to the final disabled AEM URL when one exists.',
    '- A build success is not completion. Finish only under the completion contract in the canonical prompt.',
  ];
  return `${lines.join('\n')}\n`;
}

function summarizeTool(block) {
  const input = block.input || {};
  const detail = input.file_path
    || input.path
    || input.url
    || input.query
    || input.command
    || input.description
    || '';
  const compact = String(detail).replace(/\s+/g, ' ').slice(0, 180);
  return compact ? `${block.name}: ${compact}` : block.name;
}

function appendProgress(filePath, event) {
  fs.appendFileSync(filePath, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`, 'utf8');
}

function displayAgentEvent(event, progressPath) {
  if (event.type === 'session.auto_mode_resolved') {
    console.log(color.green(`Agent ready: ${event.data?.chosenModel || 'GitHub Copilot'}`));
    appendProgress(progressPath, { type: 'AGENT_READY', model: event.data?.chosenModel });
    return;
  }

  if (event.type === 'session.mcp_server_status_changed' && event.data?.status === 'connected') {
    console.log(color.dim(`  [service] ${event.data.serverName} connected`));
    return;
  }

  if (event.type === 'assistant.message') {
    for (const request of event.data?.toolRequests || []) {
      const block = {
        name: request.name || request.toolName || request.tool?.name || 'tool',
        input: request.arguments || request.input || request.tool?.arguments || {},
      };
      const summary = summarizeTool(block);
      console.log(color.dim(`  [tool] ${summary}`));
      appendProgress(progressPath, { type: 'TOOL_REQUESTED', tool: block.name, summary });
    }
    if (event.data?.content?.trim()) {
      console.log(event.data.content.trim());
      for (const line of event.data.content.split(/\r?\n/)) {
        const match = line.match(/^MIGRATION_PROGRESS\s+(.+)$/);
        if (!match) continue;
        try {
          const progress = JSON.parse(match[1]);
          appendProgress(progressPath, { type: 'STAGE_PROGRESS', ...progress });
        } catch {
          appendProgress(progressPath, { type: 'INVALID_PROGRESS_LINE', line });
        }
      }
    }
    return;
  }

  if (/tool.*(start|requested)/i.test(event.type)) {
    const block = {
      name: event.data?.toolName || event.data?.name || event.data?.tool?.name || 'tool',
      input: event.data?.arguments || event.data?.input || event.data?.tool?.arguments || {},
    };
    const summary = summarizeTool(block);
    console.log(color.dim(`  [tool] ${summary}`));
    appendProgress(progressPath, { type: 'TOOL_STARTED', tool: block.name, summary });
    return;
  }

  if (event.type === 'session.error') {
    const message = event.data?.message || event.data?.error || 'Unknown Copilot session error';
    console.log(color.red(`Agent error: ${message}`));
    appendProgress(progressPath, { type: 'AGENT_ERROR', message });
    return;
  }

  if (event.type === 'result') {
    const failed = event.exitCode !== 0;
    const label = failed ? color.red('Agent failed') : color.green('Agent finished');
    const requests = event.usage?.premiumRequests;
    console.log(`${label}${requests === undefined ? '' : ` (premium requests: ${requests})`}`);
    appendProgress(progressPath, {
      type: 'AGENT_RESULT',
      exit_code: event.exitCode,
      session_id: event.sessionId,
      usage: event.usage,
    });
  }
}

async function runAgent(copilot, options, runtimePrompt, evidenceDir) {
  const streamPath = path.join(evidenceDir, 'agent-stream.jsonl');
  const stderrPath = path.join(evidenceDir, 'agent-stderr.log');
  const progressPath = path.join(evidenceDir, 'launcher-progress.jsonl');
  const argumentsList = [
    '-p', runtimePrompt,
    '--output-format', 'json',
    '--stream', 'on',
    '--allow-all',
    '--no-ask-user',
    '--model', options.model,
    '--name', `aem-migration-${path.basename(evidenceDir).slice(-8)}`,
    '--no-remote',
    '--no-remote-export',
    '--no-auto-update',
    '--deny-tool', 'shell(git reset:*)',
    '--deny-tool', 'shell(git clean:*)',
    '--deny-tool', 'shell(git checkout:*)',
    '--deny-tool', 'shell(git switch:*)',
    '--deny-tool', 'shell(git commit:*)',
    '--deny-tool', 'shell(git push:*)',
  ];
  if (!options.agentSmokeTest) {
    argumentsList.push('--autopilot', '--max-autopilot-continues', String(options.maxContinues));
  }
  if (options.effort) argumentsList.push('--effort', options.effort);
  if (options.maxAiCredits) argumentsList.push('--max-ai-credits', String(options.maxAiCredits));

  const child = spawn(copilot.executable, argumentsList, {
    cwd: repoRoot,
    env: {
      ...process.env,
      AEM_HOST: options.aemHost,
      AEM_PORT: String(options.aemPort),
      MIGRATION_SITE_URL: options.siteUrl,
      MIGRATION_EVIDENCE_DIR: relativeToRepo(evidenceDir),
      COPILOT_WEB_FETCH_ALLOW_LOCALHOST: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  const exitPromise = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });

  const rawStream = fs.createWriteStream(streamPath, { flags: 'a' });
  const errorStream = fs.createWriteStream(stderrPath, { flags: 'a' });
  child.stderr.pipe(errorStream);
  child.stderr.on('data', (chunk) => process.stderr.write(color.yellow(chunk.toString())));

  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  for await (const line of lines) {
    rawStream.write(`${line}\n`);
    if (!line.trim()) continue;
    try {
      displayAgentEvent(JSON.parse(line), progressPath);
    } catch {
      console.log(line);
      appendProgress(progressPath, { type: 'UNPARSED_AGENT_OUTPUT', line });
    }
  }

  const exitCode = await exitPromise;
  rawStream.end();
  errorStream.end();
  return exitCode;
}

function findTargetUrl(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return null;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === 'string'
        && /(target|disabled|preview).*url/i.test(key)
        && /^https?:\/\//i.test(child)) {
      return child;
    }
  }
  for (const child of Object.values(value)) {
    const match = findTargetUrl(child, seen);
    if (match) return match;
  }
  return null;
}

function targetPathUrl(options) {
  if (!options.targetPath) return null;
  let targetPath = options.targetPath.startsWith('/') ? options.targetPath : `/${options.targetPath}`;
  if (!targetPath.endsWith('.html')) targetPath = `${targetPath}.html`;
  return `http://${options.aemHost}:${options.aemPort}${targetPath}?wcmmode=disabled`;
}

function openUrl(url) {
  const command = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const child = spawn(command, [url], { detached: true, stdio: 'ignore' });
  child.unref();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.printDefaults) {
    console.log(`SITE_URL=${readDefaultSiteUrl()}`);
    console.log(`AEM_PORT=${defaultAemPort}`);
    return;
  }
  if (options.help) {
    printHelp();
    return;
  }

  const copilot = findCopilot();
  await ensureCopilotAuthenticated(copilot, options.loginMode);
  if (options.listModels) {
    printModels(await listAvailableModels(copilot));
    return;
  }

  console.log(color.cyan('\nAEM URL Migration Launcher'));
  console.log(color.dim(`Repository: ${repoRoot}`));
  await promptForInputs(options);
  options.siteUrl = normalizeSiteUrl(options.siteUrl);
  if (!Number.isInteger(options.aemPort) || options.aemPort < 1 || options.aemPort > 65535) {
    throw new Error('AEM port must be an integer between 1 and 65535.');
  }
  assertProjectConfiguration();

  console.log(`Checking source: ${options.siteUrl}`);
  const sourceProbe = await probeUrl(options.siteUrl, 'SITE_URL');
  console.log(color.green(`  Source reachable: HTTP ${sourceProbe.status}`));

  const aemBaseUrl = `http://${options.aemHost}:${options.aemPort}`;
  console.log(`Checking AEM: ${aemBaseUrl}`);
  const aemProbe = await probeUrl(`${aemBaseUrl}/libs/granite/core/content/login.html`, 'AEM author');
  console.log(color.green(`  AEM reachable: HTTP ${aemProbe.status}`));

  console.log(color.green(`  Agent available: ${copilot.version}`));
  const models = await listAvailableModels(copilot);
  await selectModelAndEffort(options, models);

  const runId = crypto.randomUUID();
  const evidenceDir = options.evidenceDir
    ? path.resolve(repoRoot, options.evidenceDir)
    : path.join(repoRoot, 'design', 'scratch', `migration-${runId}`);
  fs.mkdirSync(evidenceDir, { recursive: true });
  const statePath = path.join(evidenceDir, 'run-state.json');
  const state = {
    schema_version: 1,
    run_id: runId,
    status: 'INITIALIZED',
    current_stage: null,
    created_at: new Date().toISOString(),
    launcher: {
      name: 'aem-url-migration-launcher',
      version: launcherVersion,
      agent: 'github-copilot-cli',
      agent_version: copilot.version,
      working_directory: repoRoot,
    },
    inputs: {
      SITE_URL: options.siteUrl,
      TARGET_PAGE_PATH: options.targetPath || null,
      BREAKPOINTS: options.breakpoints,
      AEM_HOST: options.aemHost,
      AEM_PORT: options.aemPort,
      MODEL: options.model,
      THINKING_EFFORT: options.effort || null,
      EVIDENCE_DIR: relativeToRepo(evidenceDir),
    },
    stages: stageIds.map((stage) => ({ stage, status: 'PENDING' })),
    stage_results: {},
  };
  writeJson(statePath, state);
  const runtimePrompt = options.agentSmokeTest
    ? 'Return exactly MIGRATION_LAUNCHER_AGENT_OK. Do not use tools, inspect files, or modify anything.'
    : createRuntimePrompt(options, runId, evidenceDir, statePath);
  fs.writeFileSync(path.join(evidenceDir, 'runtime-prompt.md'), runtimePrompt, 'utf8');

  console.log(`Run ID: ${runId}`);
  console.log(`Evidence: ${evidenceDir}`);
  if (options.dryRun) {
    console.log(color.green('Dry run passed. Runtime prompt and run-state.json were created; no agent was started.'));
    return;
  }

  console.log(color.cyan('\nStarting migration. Press Ctrl+C to stop the agent.\n'));
  const exitCode = await runAgent(copilot, options, runtimePrompt, evidenceDir);
  if (exitCode !== 0) {
    throw new Error(`GitHub Copilot CLI exited with code ${exitCode}. See ${path.join(evidenceDir, 'agent-stderr.log')}`);
  }
  if (options.agentSmokeTest) {
    const stream = fs.readFileSync(path.join(evidenceDir, 'agent-stream.jsonl'), 'utf8');
    if (!stream.includes('MIGRATION_LAUNCHER_AGENT_OK')) {
      throw new Error('Copilot smoke test completed without the expected marker.');
    }
    console.log(color.green('Agent smoke test passed. No migration work was performed.'));
    return;
  }

  let finalState;
  try {
    finalState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch {
    finalState = null;
  }
  const finalUrl = findTargetUrl(finalState) || targetPathUrl(options);
  console.log(color.cyan('\nRun complete'));
  console.log(`Status: ${finalState?.status || 'AGENT_FINISHED'}`);
  console.log(`Evidence: ${evidenceDir}`);
  if (finalUrl) {
    console.log(`AEM page: ${finalUrl}`);
    if (options.openResult) openUrl(finalUrl);
  } else {
    console.log(color.yellow('No final target URL was recorded. Check run-state.json for the terminal stage result.'));
  }
}

main().catch((error) => {
  console.error(color.red(`\nERROR: ${error.message}`));
  process.exitCode = 1;
});