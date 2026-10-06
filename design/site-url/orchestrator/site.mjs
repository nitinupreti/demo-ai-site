/**
 * Site mode: one crawl decides which pages exist, and every later phase works across all of them.
 * The crawl, a review before anything is written and a capture of every page come first. Then
 * either the whole build (catalog, site plan, foundations, assets, one worker per component,
 * composed pages, deploy, verify, parity against every source page, remediation, report) or, with
 * --pages-only, one empty AEM page per crawled page.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensureFilterRoot } from './assets.mjs';
import {
  describeBrokenBundles, planDeployment, runDeployment, runValidation, validationPlan, verifyBundles,
} from './deploy.mjs';
import { buildSiteTree, formatTree, summarizeInventory } from './inventory.mjs';
import {
  CONTENT_FILTER, linkMap, resolveTemplate, verifyPages, writeLinkMap, writeSitePages,
} from './pages.mjs';
import { validate } from './schema.mjs';
import { buildSite } from './site-build.mjs';

const siteUrlDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tool = (name) => path.join(siteUrlDir, 'tools', `${name}.mjs`);
const schema = (name) => JSON.parse(fs.readFileSync(path.join(siteUrlDir, 'schemas', name), 'utf8'));
const crawlTool = tool('crawl');
const inventorySchema = schema('inventory.schema.json');
const contentSchema = schema('content.schema.json');

export const SITE_PHASES = [
  'crawl', 'review', 'capture', 'catalog', 'plan', 'foundations', 'assets', 'fanout', 'compose', 'deploy', 'verify',
  'parity', 'remediation', 'report',
];
/** --pages-only: the page tree alone, every page empty. */
export const PAGE_TREE_PHASES = ['crawl', 'review', 'capture', 'pages', 'deploy', 'verify'];

// Every capture drives a browser through each breakpoint; two at a time is what the source should see.
const CAPTURE_PARALLEL = 2;

export function crawlArguments(options, { outDir, runId }) {
  const args = [
    crawlTool,
    '--url', options.siteUrl,
    '--out', outDir,
    '--run-id', runId,
    '--max-pages', String(options.maxPages),
    '--max-depth', String(options.maxDepth),
    '--delay-ms', String(options.crawlDelayMs),
  ];
  if (options.include?.length) args.push('--include', options.include.join(','));
  if (options.exclude?.length) args.push('--exclude', options.exclude.join(','));
  if (options.includeHosts?.length) args.push('--include-host', options.includeHosts.join(','));
  if (options.keepQuery) args.push('--keep-query');
  return args;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return filePath;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

/** A resumed run reuses its crawl only when it was asked exactly the same question. */
export function crawlMatches(inventory, options) {
  if (inventory?.status !== 'PASS') return false;
  const scope = inventory.scope || {};
  const same = (left, right) => JSON.stringify((left || []).map((entry) => String(entry).toLowerCase()).sort())
    === JSON.stringify((right || []).map((entry) => String(entry).toLowerCase()).sort());
  let sameSeed = false;
  try {
    sameSeed = new URL(options.siteUrl).href === new URL(inventory.seed?.requested_url).href;
  } catch {
    sameSeed = false;
  }
  return sameSeed
    && scope.max_pages === options.maxPages
    && scope.max_depth === options.maxDepth
    && scope.keep_query === Boolean(options.keepQuery)
    && same(scope.include, options.include)
    && same(scope.exclude, options.exclude)
    && same(scope.include_hosts, options.includeHosts);
}

export async function orchestrateSite(options, {
  renderer, runId, evidenceDir, runTool, repoRoot, print = console.log, unicode = false,
  confirm = null, execFn, fetchFn = fetch, resumed = false, copilot = null, spawnFn,
}) {
  const phases = [];
  const relative = (file) => path.relative(repoRoot, file).replaceAll('\\', '/');
  const aemUrl = `http://${options.aemHost}:${options.aemPort}`;
  const start = (name) => {
    const entry = { name, status: 'RUNNING', started_at: Date.now() };
    phases.push(entry);
    renderer.stageStarted(name);
    return entry;
  };
  const end = (entry, status, message) => {
    entry.status = status;
    entry.duration_seconds = Number(((Date.now() - entry.started_at) / 1000).toFixed(2));
    renderer.stageFinished(entry.name, status, message);
    return entry;
  };
  const result = (status, extra = {}) => ({ status, phases, ...extra });

  // 1. Crawl, or the inventory an earlier session of this run already took for the same question.
  let phase = start('crawl');
  const crawlDir = path.join(evidenceDir, 'crawl');
  const inventoryPath = path.join(crawlDir, 'inventory.json');
  let inventory = resumed ? readJson(inventoryPath) : null;
  const crawlReused = crawlMatches(inventory, options);
  if (!crawlReused) {
    // An inventory left by an earlier attempt must never pass for this one's.
    fs.rmSync(inventoryPath, { force: true });
    const outcome = await runTool('crawl', crawlArguments(options, { outDir: crawlDir, runId }));
    inventory = readJson(inventoryPath);
    if (!inventory) {
      end(phase, 'FAIL', `the crawl tool exited ${outcome.code} without writing an inventory`);
      return result('FAIL');
    }
  }
  const problems = validate(inventory, inventorySchema);
  if (problems.length) {
    end(phase, 'FAIL', `the inventory does not match its schema: ${problems.slice(0, 3).join('; ')}`);
    return result('FAIL', { inventory });
  }
  if (inventory.status !== 'PASS') {
    end(phase, inventory.status, inventory.failures.join('; ') || `the crawl ended ${inventory.status}`);
    return result(inventory.status, { inventory });
  }

  const tree = buildSiteTree(inventory, { siteRoot: options.targetPath });
  const treePath = writeJson(path.join(evidenceDir, 'site-tree.json'), tree);
  end(phase, 'PASS', `${crawlReused ? 'reused, ' : ''}${tree.pages} pages, ${tree.placeholders} placeholder(s),`
    + ` ${inventory.external_links.length} external host(s) left alone`);

  print('');
  for (const line of summarizeInventory(inventory)) print(`  ${line}`);
  print('');
  print('  AEM page tree');
  for (const line of formatTree(tree, { unicode })) print(`    ${line}`);
  for (const entry of tree.renamed) print(`  renamed ${entry.url} to ${entry.aem_path}: ${entry.wanted} was taken`);
  print('');
  print(`  inventory  ${relative(inventoryPath)}`);
  print(`  page tree  ${relative(treePath)}`);
  if (options.crawlOnly) return result('PASS', { inventory, tree, stopped: 'crawl' });

  // 2. Review: nothing is written to the repository or deployed until someone has seen the tree.
  phase = start('review');
  const reviewPath = path.join(evidenceDir, 'review.json');
  // Approving empty pages is not approving agents that build code, so each needs its own yes.
  const mode = options.pagesOnly ? 'pages' : 'build';
  const earlier = readJson(reviewPath);
  let approvedBy = earlier?.inventory_fingerprint === inventory.fingerprint && (earlier.mode || 'pages') === mode
    ? 'an earlier session of this run' : null;
  if (!approvedBy && options.yes) approvedBy = '--yes';
  if (!approvedBy && confirm) {
    const question = options.pagesOnly
      ? `Create ${tree.nodes.length} page(s) under ${options.targetPath} and deploy them to ${aemUrl}?`
      : `Build components with agents, author ${tree.nodes.length} page(s) under ${options.targetPath} and deploy them to ${aemUrl}?`;
    if (await confirm(question)) approvedBy = 'prompt';
  }
  if (!approvedBy) {
    end(phase, 'BLOCKED', confirm ? 'not approved; nothing was written' : 'no terminal to ask; pass --yes to continue without a prompt');
    return result('BLOCKED', { inventory, tree });
  }
  writeJson(reviewPath, {
    inventory_fingerprint: inventory.fingerprint, mode, approved_by: approvedBy, approved_at: new Date().toISOString(),
  });
  end(phase, 'PASS', `approved by ${approvedBy}`);

  // 3. Capture: the frozen evidence and the full content of every page, reused where already taken.
  phase = start('capture');
  const reportCapture = (entry) => {
    const pathOnly = new URL(entry.url).pathname;
    print(`    ${entry.id}  ${entry.status.padEnd(5)} ${String(entry.blocks).padStart(3)} blocks  ${pathOnly}`
      + `${entry.reused ? '  (reused)' : ''}${entry.failures.length ? `  ${entry.failures[0]}` : ''}`);
    return entry;
  };
  const capturePage = async (page) => {
    const pageDir = path.join(evidenceDir, 'pages', page.id);
    const discoveryDir = path.join(pageDir, 'discovery');
    const discoveryPath = path.join(discoveryDir, 'discovery.json');
    const contentPath = path.join(pageDir, 'content.json');
    const summary = (discovery, content, reused) => ({
      id: page.id,
      url: page.url,
      status: !discovery ? 'ERROR' : discovery.status === 'PASS' && content?.status === 'PASS' ? 'PASS' : 'FAIL',
      reused,
      blocks: discovery?.instances?.length ?? 0,
      discovery: discovery?.status ?? null,
      content: content?.status ?? null,
      failures: [...(discovery?.failures || []), ...(content?.failures || [])].slice(0, 5),
    });

    if (resumed) {
      const discovery = readJson(discoveryPath);
      const content = readJson(contentPath);
      const current = discovery?.status === 'PASS' && discovery.source?.requested_url === page.url
        && JSON.stringify(discovery.breakpoints) === JSON.stringify(options.breakpoints)
        && content?.status === 'PASS' && content.source?.source_fingerprint === discovery.source_fingerprint;
      if (current) return reportCapture(summary(discovery, content, true));
    }

    // Evidence from an earlier attempt must never pass for this one's.
    fs.rmSync(discoveryPath, { force: true });
    fs.rmSync(contentPath, { force: true });
    await runTool('discover', [
      tool('discover'), '--url', page.url, '--out', discoveryDir, '--breakpoints', options.breakpoints.join(','),
      '--settle-ms', String(options.settleMs), '--run-id', runId,
    ], { log: path.join(pageDir, 'discover.log') });
    const discovery = readJson(discoveryPath);
    let content = null;
    if (discovery) {
      await runTool('extract', [
        tool('extract'), '--discovery', discoveryPath, '--out', pageDir, '--settle-ms', String(options.settleMs), '--run-id', runId,
      ], { log: path.join(pageDir, 'extract.log') });
      content = readJson(contentPath);
      const invalid = content ? validate(content, contentSchema) : [];
      if (invalid.length) content = { ...content, status: 'FAIL', failures: [`content.json does not match its schema: ${invalid[0]}`] };
    }
    return reportCapture(summary(discovery, content, false));
  };
  const captures = await pool(inventory.pages, CAPTURE_PARALLEL, capturePage);
  writeJson(path.join(evidenceDir, 'capture.json'), captures);
  const uncaptured = captures.filter((entry) => entry.status !== 'PASS');
  const reusedCaptures = captures.filter((entry) => entry.reused).length;
  // Pages are still written and deployed: they do not depend on the capture, later milestones do.
  end(phase, uncaptured.length ? 'FAIL' : 'PASS', `${captures.length - uncaptured.length}/${captures.length} pages captured`
    + `${reusedCaptures ? `, ${reusedCaptures} reused` : ''}`);

  if (!options.pagesOnly) {
    // Agents can stay quiet for minutes; the heartbeat shows the run is alive, and must always stop.
    renderer.startHeartbeat?.();
    try {
      return await buildSite(options, {
        renderer,
        runId,
        evidenceDir,
        repoRoot,
        print,
        execFn,
        fetchFn,
        spawnFn,
        copilot,
        runTool,
        inventory,
        tree,
        captures,
        start,
        end,
        result,
        aemUrl,
        relative,
        phases,
      });
    } finally {
      renderer.stopHeartbeat?.();
    }
  }

  // 4. Pages: one empty page per tree node, the filter root that deploys them, and the link map.
  phase = start('pages');
  let template;
  try {
    template = resolveTemplate({ repoRoot, siteRoot: options.targetPath, template: options.template });
  } catch (error) {
    end(phase, 'FAIL', error.message);
    return result('FAIL', { inventory, tree, captures });
  }
  const pages = writeSitePages({
    repoRoot, tree, inventory, template,
  });
  const filterAdded = ensureFilterRoot({ repoRoot, filterPath: CONTENT_FILTER, jcrPath: options.targetPath });
  const linkFiles = writeLinkMap(evidenceDir, linkMap(inventory, tree));
  writeJson(path.join(evidenceDir, 'pages.json'), {
    template: template.path,
    content_container: template.container,
    written: pages.written,
    removed: pages.removed,
    filter_added: Boolean(filterAdded),
  });
  for (const removed of pages.removed) print(`    removed ${removed}: no longer in the inventory`);
  const validation = await runValidation({
    workspaceRoot: repoRoot,
    steps: validationPlan([...pages.written, ...(filterAdded ? [CONTENT_FILTER] : [])]),
    execFn,
  });
  if (validation.status !== 'PASS') {
    end(phase, 'FAIL', `the pages do not validate (${validation.label}): ${validation.detail.split('\n')[0]}`);
    return result('FAIL', { inventory, tree, captures });
  }
  end(phase, 'PASS', `${pages.written.length} page(s) from ${template.path}${pages.removed.length ? `, ${pages.removed.length} removed` : ''}`
    + `${filterAdded ? `, filter root added for ${options.targetPath}` : ''}`);

  // 5. Deploy: the same whole-reactor install a page run uses, then ask AEM what actually started.
  phase = start('deploy');
  const deployment = await runDeployment({
    repoRoot,
    steps: planDeployment(options.aemPort),
    renderer,
    execFn,
    logPath: path.join(evidenceDir, 'deploy.log'),
    writeLog: fs.appendFileSync,
  });
  writeJson(path.join(evidenceDir, 'deployment.json'), deployment);
  if (deployment.status !== 'PASS') {
    end(phase, 'FAIL', `${deployment.failure.step} exited ${deployment.failure.exit_code}; see ${relative(path.join(evidenceDir, 'deploy.log'))}`);
    return result('FAIL', { inventory, tree, captures });
  }
  const bundles = await verifyBundles({
    aemUrl, username: options.aemUser, password: process.env.AEM_PASSWORD, fetchFn,
  });
  if (bundles.status === 'FAIL') {
    print(describeBrokenBundles(bundles.broken));
    end(phase, 'FAIL', `${bundles.broken.length} bundle(s) did not start`);
    return result('FAIL', { inventory, tree, captures });
  }
  if (bundles.status === 'UNKNOWN') renderer.note(`bundle check skipped: ${bundles.reason}`);
  end(phase, 'PASS', `${deployment.executed.length} step(s)${bundles.status === 'PASS' ? `, ${bundles.total} bundles active` : ''}`);

  // 6. Verify: every page answers in AEM, with its source title.
  phase = start('verify');
  const verification = await verifyPages({
    aemUrl, tree, inventory, username: options.aemUser, password: process.env.AEM_PASSWORD, fetchFn,
  });
  writeJson(path.join(evidenceDir, 'verify.json'), verification);
  for (const entry of verification.results.filter((check) => !check.ok)) print(`    ${entry.aem_path}: ${entry.detail}`);
  end(phase, verification.status, `${verification.checked - verification.failed}/${verification.checked} pages answer with their title`);

  print('');
  print(`  link map   ${relative(linkFiles.json)} and ${path.basename(linkFiles.csv)}`);
  print(`  captures   ${relative(path.join(evidenceDir, 'pages'))}`);
  if (uncaptured.length) {
    print(`  ${uncaptured.length} page(s) still need a capture: rerun with --resume ${runId} to retry only those`);
  }
  const status = uncaptured.length || verification.status !== 'PASS' ? 'FAIL' : 'PASS';
  return result(status, {
    inventory, tree, captures, verification,
  });
}
