/**
 * Site build: everything after the capture that turns empty pages into authored ones. A catalog of
 * every block on every page, a site plan of shared components, the shared design layer, the DAM,
 * one worker per component, composed pages and fragments, a deploy, and a check that every page
 * renders. Agents do judgement work only; every verdict, path and file placement is decided here.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runAgentRole } from './agent.mjs';
import { acquireAssets, ensureFilterRoot } from './assets.mjs';
import { buildCatalog, splitUnitId } from './catalog.mjs';
import { validateContribution } from './contributions.mjs';
import {
  describeBrokenBundles, focusedTestPlan, planDeployment, runDeployment, runValidation, validationPlan, verifyBundles,
} from './deploy.mjs';
import { runFanout } from './fanout.mjs';
import {
  CONTENT_FILTER, linkMap, resolveTemplate, verifyPages, writeLinkMap,
} from './pages.mjs';
import { composeSite, contentIndex } from './site-compose.mjs';
import { checkSiteContribution, expandSitePlan, validateSitePlan } from './site-plan.mjs';
import { siteNames, writeScaffold } from './site-scaffold.mjs';
import { snapshotTree } from './workspaces.mjs';

const siteUrlDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const readPrompt = (name) => fs.readFileSync(path.join(siteUrlDir, 'prompts', name), 'utf8');
const PLAN_REPAIRS = 2;
const FOUNDATIONS_ATTEMPTS = 3;
// A source that blocks most captures is not a site to plan from; it is a crawl to look into.
const MAX_UNCAPTURED_SHARE = 0.5;
// A few dead images should not stop a site; most of them failing points at the source or the network.
const MAX_ASSET_FAILURE_SHARE = 0.2;
const RENDER_ERROR = /SightlyException|ScriptEvaluationException|Error during include|org\.apache\.sling\.api\.SlingException/;

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

const sha = (value) => `sha256:${crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;

/** The custom properties foundations declared, so workers can use tokens without opening ui.frontend. */
export function readTokens(repoRoot) {
  const dir = path.join(repoRoot, 'ui.frontend', 'src', 'main', 'webpack', 'site');
  const tokens = {};
  const walk = (folder) => {
    if (!fs.existsSync(folder)) return;
    for (const entry of fs.readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith('.scss')) {
        const text = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
        for (const [, name, value] of text.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)) {
          if (!(name in tokens)) tokens[name] = value.trim();
        }
      }
    }
  };
  walk(dir);
  return tokens;
}

/** What a worker was asked to build; a banked result is reused only while this is unchanged. */
export function componentFingerprint(component) {
  const {
    id, tier, role, reuse_target: reuse, resource_type: type, instances, owned_paths: owned, notes,
  } = component;
  return sha({
    id, tier, role, reuse, type, instances, owned, notes,
  });
}

/** Every page whose capture passed, with its evidence loaded, in tree order. */
export function loadCapturedPages({ evidenceDir, tree, inventory, captures }) {
  const passed = new Set(captures.filter((entry) => entry.status === 'PASS').map((entry) => entry.id));
  const titles = new Map(inventory.pages.map((page) => [page.id, page.title]));
  return tree.nodes.filter((node) => node.page_id && passed.has(node.page_id)).map((node) => {
    const pageDir = path.join(evidenceDir, 'pages', node.page_id);
    return {
      id: node.page_id,
      url: node.url,
      aem_path: node.aem_path,
      title: titles.get(node.page_id) || null,
      discovery_path: path.join(pageDir, 'discovery', 'discovery.json'),
      content_path: path.join(pageDir, 'content.json'),
      discovery: readJson(path.join(pageDir, 'discovery', 'discovery.json')),
      content: readJson(path.join(pageDir, 'content.json')),
    };
  });
}

/**
 * One DAM for the whole site: every image any page shows, downloaded once however many pages use
 * it, recorded against every unit that shows it. Discovery's media and the extracted content's
 * images, backgrounds and posters are both read, so nothing a worker may author is missing.
 */
export async function acquireSiteAssets({
  repoRoot, pages, damRoot, damPath, fetchFn,
}) {
  const instances = [];
  for (const page of pages) {
    const base = page.discovery?.source?.final_url || page.url;
    const absolute = (value) => {
      if (!value) return null;
      try {
        return new URL(value, base).toString();
      } catch {
        return null;
      }
    };
    const contentById = new Map((page.content?.instances || []).map((entry) => [entry.id, entry]));
    for (const instance of page.discovery?.instances || []) {
      const media = Object.values(instance.media || {}).flat()
        .filter((entry) => entry?.tag !== 'iframe')
        .map((entry) => ({ ...entry, src: absolute(entry.src), poster: absolute(entry.poster) }));
      const walk = (items) => {
        for (const item of items || []) {
          if (item.type === 'image') {
            media.push({
              tag: 'img', src: absolute(item.src || item.lazy_src), alt: item.alt, intrinsic: { width: item.width, height: item.height },
            });
          }
          if (item.type === 'background') media.push({ tag: 'img', src: absolute(item.src) });
          if (item.type === 'video' && item.poster) media.push({ tag: 'img', src: absolute(item.poster) });
          if (item.type === 'link' && item.image) {
            media.push({
              tag: 'img', src: absolute(item.image.src || item.image.lazy_src), alt: item.image.alt, intrinsic: { width: item.image.width, height: item.image.height },
            });
          }
        }
      };
      walk(contentById.get(instance.id)?.items);
      instances.push({ id: `${page.id}/${instance.id}`, media: { site: media.filter((entry) => entry.src) } });
    }
  }
  const outcome = await acquireAssets({
    repoRoot,
    discovery: { source: { final_url: pages[0]?.url }, instances },
    damRoot,
    damPath,
    fetchFn,
  });
  const total = outcome.manifest.length + outcome.failures.length;
  const tolerated = outcome.failures.length <= Math.floor(total * MAX_ASSET_FAILURE_SHARE);
  return { ...outcome, status: outcome.failures.length && !tolerated ? 'FAIL' : 'PASS', tolerated_failures: tolerated ? outcome.failures.length : 0 };
}

const STYLE_FIELDS = ['selector', 'rect', 'visibility_by_bp', 'signature', 'styles', 'media', 'repeated_children', 'class_chain'];

/** One evidence file per worker: its units' full content, and the full discovery of its examples. */
export function writeSlices({
  evidenceDir, plan, pages, assets,
}) {
  const byPage = new Map(pages.map((page) => [page.id, page]));
  const slicesDir = path.join(evidenceDir, 'slices');
  const files = new Map();
  for (const component of plan.components.filter((entry) => entry.authoring === 'worker')) {
    const chrome = component.role === 'chrome';
    const units = chrome ? component.chrome_entries.map((entry) => entry.representative) : component.instances;
    const records = units.map((unit) => {
      const { page: pageId, instance } = splitUnitId(unit);
      const page = byPage.get(pageId);
      const discovered = page?.discovery?.instances?.find((entry) => entry.id === instance) || {};
      const content = page?.content?.instances?.find((entry) => entry.id === instance);
      const example = chrome || component.examples.includes(unit);
      return {
        unit,
        example,
        page: {
          id: pageId, url: page?.url, aem_path: page?.aem_path, title: page?.title,
        },
        label: discovered.label || '',
        order: discovered.order ?? null,
        content: content?.found ? {
          text: content.text, items: content.items, links: content.links, ...(example ? { html: content.html } : {}),
        } : null,
        discovery: Object.fromEntries((example ? STYLE_FIELDS : ['rect', 'visibility_by_bp', 'signature'])
          .filter((field) => discovered[field] !== undefined)
          .map((field) => [field, discovered[field]])),
        assets: (assets?.manifest || []).filter((entry) => entry.instances.includes(unit))
          .map(({ source_url, dam_path, mime, alt, width, height }) => ({
            source_url, dam_path, mime, alt, width, height,
          })),
      };
    });
    const file = writeJson(path.join(slicesDir, `${component.id}.json`), {
      component_id: component.id,
      breakpoints: plan.breakpoints,
      ...(chrome ? { chrome_pages: component.instances.length } : {}),
      units: records,
    });
    files.set(component.id, file);
  }
  return files;
}

function siteTaskBlock({
  component, plan, names, slicePath, resultPath, assets, tokens,
}) {
  const units = component.role === 'chrome'
    ? component.chrome_entries.map((entry) => entry.representative)
    : component.instances;
  return [
    readPrompt('_contract.md'), '', readPrompt('component.md'), '',
    '## Site mode', '',
    `This component renders blocks from **several pages of one site**. Each block is a unit named`,
    '`<page>/<instance>` (`p-004/inst-003`). Your slice file holds every unit you render: its page, its',
    'full content (text, items, links, images) and, for the examples, its full discovery evidence.',
    '',
    component.role === 'chrome'
      ? '- You are site chrome. Declare one `experience_fragment_node` per unit in `units` below, tagged with that unit as `instance`; it is authored once into the site\'s fragment and shown on every page. Never declare `page_node`.'
      : '- Declare `page_node` as a **list with exactly one node per unit in `units` below**, each tagged with that unit as `instance` and authored with that unit\'s own content. The orchestrator places each node on its own page, in reading order. A unit without a node leaves a hole in its page.',
    '- Author links exactly as captured (absolute source URLs). After you finish, the orchestrator',
    '  rewrites every link to a migrated page: a link field becomes the bare AEM page path, and an',
    '  `href` inside rich text becomes `<path>.html`. Render link fields through a model getter that',
    '  appends `.html` to a path starting with `/content/` and leaves every other URL as it is.',
    `- Set \`componentGroup="${names.componentGroup}"\` on your component so authors can add it to pages.`,
    component.java_package
      ? `- Put your Java in package \`${component.java_package}\`, inside your owned directory, with a \`package-info.java\` annotated \`@org.osgi.annotation.versioning.Version("1.0")\`: HTL can only load a model from an exported package.`
      : '- You need no Java.',
    `- Your CSS goes in \`css/${component.id}.css\` and your JS in \`js/${component.id}.js\` of the component clientlib (category \`${names.clientlibCategory}\`, already loaded on every page); declare them through \`clientlib_entries\` and \`js_entries\`.`,
    '- The site\'s design tokens are listed below as `design_tokens`, defined on `:root` by the site stylesheet. Use them as `var(--name)`; a value the list does not cover belongs in your own CSS as a component-scoped custom property.',
    '- The page template has no page-title component: a heading in your units is yours to render.',
    '',
    '## Task', '',
    '```json',
    JSON.stringify({
      component: {
        id: component.id,
        title: component.title,
        tier: component.tier,
        role: component.role,
        reuse_target: component.reuse_target,
        resource_type: component.resource_type,
        owned_paths: component.owned_paths,
        java_package: component.java_package,
        notes: component.notes,
        units,
        examples: component.examples,
      },
      site: {
        app: names.app, site_root: names.siteRoot, component_group: names.componentGroup, clientlib_category: names.clientlibCategory,
      },
      breakpoints: plan.breakpoints,
      design_tokens: tokens,
      evidence_slice: slicePath,
      assets: (assets?.manifest || []).filter((entry) => entry.instances.some((unit) => component.instances.includes(unit)))
        .map(({ source_url, dam_path, mime, alt, width, height }) => ({
          source_url, dam_path, mime, alt, width, height,
        })),
      result_path: resultPath,
    }, null, 2),
    '```',
  ].join('\n');
}

/** Each page as a visitor sees it: it answers, renders without a script error, and shows its blocks. */
export async function verifyRendering({
  aemUrl, coverage, username, password, fetchFn, concurrency = 4,
}) {
  const headers = { authorization: `Basic ${Buffer.from(`${username}:${password ?? ''}`).toString('base64')}` };
  const results = new Array(coverage.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, coverage.length) }, async () => {
    while (cursor < coverage.length) {
      const index = cursor;
      cursor += 1;
      const entry = coverage[index];
      try {
        const response = await fetchFn(`${aemUrl}${entry.aem_path}.html?wcmmode=disabled`, { headers, redirect: 'manual' });
        const body = response.status === 200 ? await response.text() : '';
        const error = RENDER_ERROR.exec(body)?.[0];
        results[index] = {
          page: entry.page,
          aem_path: entry.aem_path,
          ok: response.status === 200 && !error,
          status: response.status,
          ...(error ? { detail: `renders a script error (${error})` } : response.status === 200 ? {} : { detail: `HTTP ${response.status}` }),
        };
      } catch (error) {
        results[index] = { page: entry.page, aem_path: entry.aem_path, ok: false, detail: `unreachable: ${error.message}` };
      }
    }
  }));
  const failed = results.filter((entry) => !entry.ok).length;
  return { status: failed ? 'FAIL' : 'PASS', checked: results.length, failed, results };
}

export function siteReport({
  runId, options, catalog, plan, workerResults, composed, deployment, verification, rendering, phases, captures, assets,
}) {
  const workers = new Map(workerResults.map((entry) => [entry.component_id, entry]));
  const components = (plan?.components || []).map((component) => ({
    id: component.id,
    tier: component.tier,
    role: component.role,
    authoring: component.authoring,
    units: component.instances.length,
    pages: new Set(component.instances.map((unit) => splitUnitId(unit).page)).size,
    status: component.authoring === 'mapped' ? 'MAPPED' : workers.get(component.id)?.status || 'NOT BUILT',
    attempts: workers.get(component.id)?.attempts ?? null,
    error: workers.get(component.id)?.status === 'PASS' ? null : workers.get(component.id)?.error || null,
  }));
  const pages = (composed?.coverage || []).map((entry) => ({
    ...entry,
    rendered: rendering?.results?.find((check) => check.page === entry.page)?.ok ?? null,
  }));
  const failedComponents = components.filter((entry) => !['PASS', 'MAPPED'].includes(entry.status));
  const incomplete = pages.filter((entry) => entry.missing.length || entry.rendered === false);
  const uncaptured = (captures || []).filter((entry) => entry.status !== 'PASS');
  const status = phases.every((phase) => phase.status === 'PASS') && !failedComponents.length && !incomplete.length && !uncaptured.length
    ? 'COMPLETE' : 'INCOMPLETE';
  return {
    run_id: runId,
    status,
    source: options.siteUrl,
    site_root: options.targetPath,
    totals: {
      pages: catalog?.totals.pages ?? 0,
      units: catalog?.totals.units ?? 0,
      components: components.length,
      components_built: components.filter((entry) => entry.status === 'PASS').length,
      components_mapped: components.filter((entry) => entry.status === 'MAPPED').length,
      units_authored: pages.reduce((total, entry) => total + entry.authored, 0),
      units_missing: pages.reduce((total, entry) => total + entry.missing.length, 0),
      assets: assets?.manifest?.length ?? 0,
    },
    phases: phases.map(({ name, status: phaseStatus, duration_seconds: seconds }) => ({ name, status: phaseStatus, duration_seconds: seconds })),
    components,
    pages,
    uncaptured: uncaptured.map((entry) => ({ id: entry.id, url: entry.url, failures: entry.failures })),
    links: composed?.links || null,
    asset_failures: assets?.failures || [],
    deployment: deployment ? { status: deployment.status, steps: deployment.executed?.length ?? 0 } : null,
    verification: verification ? { status: verification.status, failed: verification.failed } : null,
  };
}

function reportMarkdown(report) {
  const lines = [
    `# Site migration ${report.status}`, '',
    `- Source: ${report.source}`,
    `- AEM site: ${report.site_root}`,
    `- Run: ${report.run_id}`,
    `- Pages: ${report.totals.pages}, blocks: ${report.totals.units}, authored: ${report.totals.units_authored}, missing: ${report.totals.units_missing}`,
    `- Components: ${report.totals.components} (${report.totals.components_built} built, ${report.totals.components_mapped} authored by code)`,
    `- Assets: ${report.totals.assets}${report.asset_failures.length ? `, ${report.asset_failures.length} could not be downloaded` : ''}`,
    '', '## Phases', '', '| Phase | Status | Seconds |', '|---|---|---|',
    ...report.phases.map((phase) => `| ${phase.name} | ${phase.status} | ${phase.duration_seconds ?? ''} |`),
    '', '## Components', '', '| Component | Tier | Role | Units | Pages | Status |', '|---|---|---|---|---|---|',
    ...report.components.map((entry) => `| ${entry.id} | ${entry.tier} | ${entry.role} | ${entry.units} | ${entry.pages} | ${entry.status}${entry.error ? `: ${entry.error.split('\n')[0].slice(0, 120)}` : ''} |`),
    '', '## Pages', '', '| Page | Authored | Missing | Renders |', '|---|---|---|---|',
    ...report.pages.map((entry) => `| ${entry.aem_path} | ${entry.authored} | ${entry.missing.length} | ${entry.rendered === null ? '' : entry.rendered ? 'yes' : 'NO'} |`),
  ];
  if (report.links) {
    lines.push('', '## Links', '', `- Rewritten to migrated pages: ${report.links.rewritten_to_pages}`);
    if (report.links.unmigrated_same_site.length) {
      lines.push(`- Same-site pages not migrated, kept as absolute links: ${report.links.unmigrated_same_site.length}`);
    }
    if (report.links.external_hosts.length) lines.push(`- External hosts, left as they are: ${report.links.external_hosts.join(', ')}`);
    if (report.links.unsafe_links_dropped) lines.push(`- Unsafe links dropped: ${report.links.unsafe_links_dropped}`);
  }
  if (report.uncaptured.length) {
    lines.push('', '## Not captured', '', ...report.uncaptured.map((entry) => `- ${entry.url}: ${entry.failures[0] || 'capture failed'}`));
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Runs the phases after the capture. `ctx` carries what the earlier phases produced and the run's
 * services. Returns the outcome in the same shape as the earlier phases do.
 */
export async function buildSite(options, ctx) {
  const {
    renderer, runId, evidenceDir, repoRoot, print, execFn, fetchFn, spawnFn, copilot,
    inventory, tree, captures, start, end, result, aemUrl, relative, phases,
  } = ctx;
  const tuning = { model: options.model || null, effort: options.effort || null };
  let catalog = null;
  let plan = null;
  let assets = null;
  let composed = null;
  let deployment = null;
  let verification = null;
  let rendering = null;
  const workerResults = [];
  const finish = (status, extra = {}) => {
    const report = siteReport({
      runId, options, catalog, plan, workerResults, composed, deployment, verification, rendering, phases, captures, assets,
    });
    writeJson(path.join(evidenceDir, 'site-report.json'), report);
    fs.writeFileSync(path.join(evidenceDir, 'site-report.md'), reportMarkdown(report), 'utf8');
    return result(status, {
      inventory, tree, captures, report, ...extra,
    });
  };

  // 4. Catalog: every captured block as a unit, the chrome, and groups of similar blocks.
  let phase = start('catalog');
  const pages = loadCapturedPages({ evidenceDir, tree, inventory, captures });
  const uncaptured = inventory.pages.length - pages.length;
  if (!pages.length || uncaptured > inventory.pages.length * MAX_UNCAPTURED_SHARE) {
    end(phase, 'FAIL', `${uncaptured} of ${inventory.pages.length} pages could not be captured; `
      + 'that points at bot blocking or the network, not at a site to plan from');
    return finish('FAIL');
  }
  catalog = buildCatalog(pages);
  const catalogPath = writeJson(path.join(evidenceDir, 'catalog.json'), catalog);
  for (const entry of catalog.chrome) print(`    ${entry.id}  ${entry.slot.padEnd(6)} on ${entry.members.length} page(s)  "${entry.label}"`);
  for (const group of catalog.groups.slice(0, 24)) {
    print(`    ${group.id}  ${String(group.count).padStart(3)} on ${String(group.pages.length).padStart(2)} page(s)  ${group.classes.join('.') || group.tag}  [${group.features.join(', ')}]`);
  }
  if (catalog.groups.length > 24) print(`    … and ${catalog.groups.length - 24} more groups`);
  end(phase, 'PASS', `${catalog.totals.units} blocks on ${catalog.totals.pages} page(s): ${catalog.chrome.length} chrome, ${catalog.groups.length} groups`);

  let names;
  try {
    names = siteNames({ repoRoot, targetPath: options.targetPath, template: options.template });
  } catch (error) {
    phase = start('plan');
    end(phase, 'FAIL', error.message);
    return finish('FAIL');
  }

  // 5. Plan: one site-planner agent decides components from groups; the gate decides if it holds.
  phase = start('plan');
  const sitePlanPath = path.join(evidenceDir, 'site-plan.json');
  const workersPath = path.join(evidenceDir, 'workers.json');
  const banked = readJson(workersPath) || [];
  const builtByRun = new Set(banked.filter((entry) => entry.status === 'PASS').map((entry) => entry.component_id));
  const gateOptions = {
    catalog, runId, app: names.app, repoRoot, siteUrl: options.siteUrl, builtByRun,
  };
  let sitePlan = null;
  let gate = null;
  let planReused = false;
  const previous = readJson(sitePlanPath);
  if (previous) {
    const check = validateSitePlan(previous, gateOptions);
    if (check.valid) {
      sitePlan = previous;
      gate = check;
      planReused = true;
    }
  }
  let feedback = '';
  // The planner is read-only, and anything it left in the tree would ship with the site.
  const baseline = sitePlan ? null : snapshotTree(repoRoot, options.workspace);
  for (let attempt = 1; attempt <= PLAN_REPAIRS + 1 && !sitePlan; attempt += 1) {
    const agentDir = path.join(evidenceDir, 'agents', `site-planner-${attempt}`);
    fs.rmSync(sitePlanPath, { force: true });
    const invocation = await runAgentRole({
      copilot,
      role: 'site-planner',
      id: `site-planner-${attempt}`,
      prompt: [
        readPrompt('_contract.md'), '', readPrompt('site-planner.md'), '',
        '## Task', '',
        `- run_id: \`${runId}\``,
        `- catalog: \`${catalogPath}\` (fingerprint \`${catalog.fingerprint}\`)`,
        `- evidence directory: \`${evidenceDir}\` (per-page evidence under \`pages/<page>/\`)`,
        `- application: \`${names.app}\`; existing components: \`${path.join(repoRoot, 'ui.apps', 'src', 'main', 'content', 'jcr_root', 'apps', names.app, 'components')}\``,
        `- site: ${options.siteUrl}, ${catalog.totals.pages} page(s), ${catalog.totals.units} block(s)`,
        `- write the plan to: \`${sitePlanPath}\``,
        `- write the result to: \`${path.join(agentDir, 'result.json')}\``,
        feedback,
      ].join('\n'),
      cwd: repoRoot,
      ...tuning,
      agentDir,
      renderer,
      spawnFn,
    });
    const candidate = readJson(sitePlanPath);
    const after = snapshotTree(repoRoot, options.workspace);
    const written = [...new Set([...baseline.keys(), ...after.keys()])].filter((file) => baseline.get(file) !== after.get(file));
    if (written.length) {
      feedback = `\n## Previous attempt rejected\n\nYou are read-only, but you changed ${written.slice(0, 8).join(', ')}. `
        + 'Put every one of those files back exactly as it was, and write nothing but the plan and your result.\n';
      continue;
    }
    if (invocation.status !== 'PASS' || !candidate) {
      feedback = `\n## Previous attempt rejected\n\n${invocation.error || 'no site-plan.json was written'}\n`;
      continue;
    }
    gate = validateSitePlan(candidate, gateOptions);
    if (gate.valid) sitePlan = candidate;
    else feedback = `\n## Previous plan rejected by the gate\n\n- ${gate.errors.join('\n- ')}\n`;
  }
  if (!sitePlan) {
    end(phase, 'FAIL', gate ? gate.errors.slice(0, 3).join('; ') : 'the site planner produced no valid plan');
    return finish('FAIL');
  }
  let template;
  try {
    template = resolveTemplate({ repoRoot, siteRoot: options.targetPath, template: names.sourceTemplate });
  } catch (error) {
    end(phase, 'FAIL', error.message);
    return finish('FAIL');
  }
  plan = expandSitePlan(sitePlan, {
    catalog,
    gate,
    app: names.app,
    javaRoot: names.javaRoot,
    siteRoot: options.targetPath,
    xfRoot: names.xfRoot,
    container: template.container,
    breakpoints: options.breakpoints,
    componentGroup: names.componentGroup,
  });
  writeJson(path.join(evidenceDir, 'plan.json'), plan);
  for (const component of plan.components) {
    print(`    ${component.id.padEnd(28)} tier ${component.tier}  ${component.role.padEnd(7)}  ${String(component.instances.length).padStart(3)} unit(s)`
      + `${component.authoring === 'mapped' ? '  authored by code' : ''}`);
  }
  renderer.setKnownComponents?.(plan.components.map((component) => component.id));
  end(phase, 'PASS', `${planReused ? 'reused, ' : ''}${plan.components.length} components, ${plan.waves.length} wave(s)`);

  // 6. Foundations: code writes the scaffold, one agent the tokens and base styles.
  phase = start('foundations');
  const siteTitle = inventory.pages.find((page) => page.id === tree.nodes[0]?.page_id)?.title?.split(/\s[|–-]\s/)[0] || names.siteName;
  const scaffold = writeScaffold({ repoRoot, names, siteTitle });
  try {
    template = resolveTemplate({ repoRoot, siteRoot: options.targetPath, template: names.templatePath });
  } catch (error) {
    end(phase, 'FAIL', error.message);
    return finish('FAIL');
  }
  const verdictPath = path.join(evidenceDir, 'foundations.json');
  const frontendStep = fs.existsSync(path.join(repoRoot, 'ui.frontend', 'node_modules'))
    ? { label: 'frontend build', module: 'ui.frontend', command: 'npm', args: ['run', 'prod'], cwd: 'ui.frontend' }
    : { label: 'frontend build', module: 'ui.frontend', command: 'mvn', args: ['-pl', 'ui.frontend', 'generate-resources'] };
  const allowed = [
    'ui.frontend/src/main/webpack/',
    // Build output the frontend check itself regenerates.
    `ui.apps/src/main/content/jcr_root/apps/${names.app}/clientlibs/clientlib-site/`,
    `ui.apps/src/main/content/jcr_root/apps/${names.app}/clientlibs/clientlib-dependencies/`,
  ];
  let foundationsReused = readJson(verdictPath)?.status === 'PASS';
  if (!foundationsReused) {
    writeJson(verdictPath, { status: 'RUNNING' });
    let verdict = null;
    let foundationsFeedback = '';
    const representative = pages.slice(0, 3).map((page) => page.discovery_path);
    const baseline = snapshotTree(repoRoot, options.workspace);
    for (let attempt = 1; attempt <= FOUNDATIONS_ATTEMPTS && verdict?.status !== 'PASS'; attempt += 1) {
      const id = attempt === 1 ? 'site-foundations' : `site-foundations-${attempt}`;
      const agentDir = path.join(evidenceDir, 'agents', id);
      const invocation = await runAgentRole({
        copilot,
        role: 'site-foundations',
        id,
        prompt: [
          readPrompt('_contract.md'), '', readPrompt('site-foundations.md'), '',
          '## Task', '',
          `- catalog (read \`style_stats\`): \`${catalogPath}\``,
          `- evidence: ${representative.map((file) => `\`${file}\``).join(', ')}`,
          `- the site's components read your tokens from the clientlib category \`${names.clientlibCategory}\``,
          `- write the result to: \`${path.join(agentDir, 'result.json')}\``,
          foundationsFeedback,
        ].join('\n'),
        cwd: repoRoot,
        ...tuning,
        agentDir,
        renderer,
        spawnFn,
      });
      const after = snapshotTree(repoRoot, options.workspace);
      const changed = [...new Set([...baseline.keys(), ...after.keys()])].filter((file) => baseline.get(file) !== after.get(file));
      const outside = changed.filter((file) => !allowed.some((prefix) => file.startsWith(prefix)));
      let rejection = null;
      if (outside.length) {
        rejection = `You wrote outside your scope: ${outside.slice(0, 8).join(', ')}. Put those files back exactly as they were; `
          + `you may only write under ${allowed[0]}.`;
      } else if (invocation.status !== 'PASS') {
        rejection = invocation.error || `your result reported ${invocation.status}`;
      } else {
        const validation = await runValidation({ workspaceRoot: repoRoot, steps: [frontendStep], execFn });
        if (validation.status !== 'PASS') rejection = `The frontend does not build (${validation.label}):\n${validation.detail}`;
      }
      verdict = rejection ? { status: 'FAIL', attempts: attempt, error: rejection } : { status: 'PASS', attempts: attempt, notes: invocation.result?.notes || null };
      if (rejection && attempt < FOUNDATIONS_ATTEMPTS) {
        renderer.warn(`site foundations attempt ${attempt}/${FOUNDATIONS_ATTEMPTS} rejected: ${rejection.split('\n')[0]}`);
        foundationsFeedback = [
          '', `## Attempt ${attempt} of ${FOUNDATIONS_ATTEMPTS} was rejected`, '', rejection, '',
          'Fix exactly this, then write your result again. The tree is not reset between attempts.',
        ].join('\n');
      }
    }
    writeJson(verdictPath, verdict);
    if (verdict.status !== 'PASS') {
      end(phase, 'FAIL', verdict.error.split('\n')[0]);
      return finish('FAIL');
    }
  }
  const scaffoldValidation = await runValidation({ workspaceRoot: repoRoot, steps: validationPlan(scaffold.written), execFn });
  if (scaffoldValidation.status !== 'PASS') {
    end(phase, 'FAIL', `the site scaffold does not validate (${scaffoldValidation.label}): ${scaffoldValidation.detail.split('\n')[0]}`);
    return finish('FAIL');
  }
  end(phase, 'PASS', `${foundationsReused ? 'tokens reused' : 'tokens and base styles ready'}; template ${names.templatePath}`
    + `${scaffold.filters.length ? `; filter roots for ${scaffold.filters.join(', ')}` : ''}`);

  // 7. Assets: one DAM folder for the site, every image downloaded once.
  phase = start('assets');
  const damRoot = `ui.content/src/main/content/jcr_root${names.damPath}`;
  const bankedAssets = readJson(path.join(evidenceDir, 'assets.json'));
  const assetsIntact = bankedAssets?.status === 'PASS' && bankedAssets.manifest
    ?.every((entry) => fs.existsSync(path.join(repoRoot, damRoot, path.basename(entry.dam_path), '_jcr_content', 'renditions', 'original')));
  assets = assetsIntact ? bankedAssets : await acquireSiteAssets({
    repoRoot, pages, damRoot, damPath: names.damPath, fetchFn,
  });
  writeJson(path.join(evidenceDir, 'assets.json'), assets);
  for (const failure of assets.failures.slice(0, 6)) print(`    could not download ${failure.url}: ${failure.reason}`);
  if (assets.status !== 'PASS') {
    end(phase, 'FAIL', `${assets.failures.length} of ${assets.failures.length + assets.manifest.length} assets could not be downloaded`);
    return finish('FAIL');
  }
  ensureFilterRoot({ repoRoot, filterPath: CONTENT_FILTER, jcrPath: names.damPath });
  end(phase, 'PASS', `${assetsIntact ? 'reused, ' : ''}${assets.manifest.length} assets in ${names.damPath}`
    + `${assets.failures.length ? `, ${assets.failures.length} unavailable` : ''}`);

  // 8. Fan-out: one worker per component that needs one, in dependency waves.
  phase = start('fanout');
  const workers = plan.components.filter((component) => component.authoring === 'worker');
  const slices = writeSlices({
    evidenceDir, plan, pages, assets,
  });
  const fingerprints = new Map(workers.map((component) => [component.id, componentFingerprint(component)]));
  const reusable = banked.filter((entry) => entry.status === 'PASS' && fingerprints.get(entry.component_id) === entry.fingerprint);
  workerResults.push(...reusable);
  const alreadyBuilt = new Set(reusable.map((entry) => entry.component_id));
  const claimed = new Map();
  for (const entry of reusable) for (const file of entry.applied || []) claimed.set(file, entry.component_id);
  const order = new Map(workers.map((component, index) => [component.id, index]));
  const persist = () => writeJson(workersPath, [...workerResults]
    .map((entry) => ({ ...entry, invocation: undefined, fingerprint: entry.fingerprint || fingerprints.get(entry.component_id) }))
    .sort((left, right) => (order.get(left.component_id) ?? 0) - (order.get(right.component_id) ?? 0)));
  const instanceOrder = new Map(catalog.pages.flatMap((page) => page.units).map((unit, index) => [unit, index]));
  const damPaths = assets.manifest.map((entry) => entry.dam_path);
  const tokens = readTokens(repoRoot);
  fs.rmSync(path.join(evidenceDir, 'workspaces'), { recursive: true, force: true });
  let fanoutStatus = 'PASS';
  if (alreadyBuilt.size < workers.length) {
    const { failed, edited } = await runFanout({
      components: workers,
      waves: plan.waves,
      alreadyBuilt,
      workerResults,
      claimed,
      persist,
      repoRoot,
      evidenceDir,
      copilot,
      renderer,
      spawnFn,
      execFn,
      maxParallel: options.maxParallel,
      componentAttempts: options.componentAttempts,
      workspaceOptions: options.workspace,
      ...tuning,
      continueOnFailure: true,
      taskPrompt: (component, { agentDir }) => siteTaskBlock({
        component, plan, names, slicePath: slices.get(component.id), resultPath: path.join(agentDir, 'result.json'), assets, tokens,
      }),
      checkContribution: (component, outcome, { writtenFiles }) => [
        ...validateContribution(component, outcome, { instanceOrder, writtenFiles, uniqueNames: false }),
        ...checkSiteContribution(component, outcome, { damPaths }),
      ],
    });
    persist();
    if (edited.length) {
      end(phase, 'FAIL', `${edited.length} file(s) changed in the repository while workers ran: ${edited.slice(0, 6).join(', ')}. `
        + `Nothing was merged over them; finish editing, then rerun with --resume ${runId}`);
      return finish('FAIL');
    }
    if (failed) fanoutStatus = 'FAIL';
  }
  const builtCount = workerResults.filter((entry) => entry.status === 'PASS').length;
  const brokenWorkers = workerResults.filter((entry) => entry.status !== 'PASS');
  // A failed component leaves holes in its pages, but every other page is still worth composing.
  end(phase, fanoutStatus, `${builtCount}/${workers.length} components built${alreadyBuilt.size ? `, ${alreadyBuilt.size} reused` : ''}`
    + `${brokenWorkers.length ? `; failed: ${brokenWorkers.map((entry) => entry.component_id).join(', ')}` : ''}`);

  // 9. Compose: every page and fragment, written from the declarations, links rewritten.
  phase = start('compose');
  const links = linkMap(inventory, tree);
  const linkFiles = writeLinkMap(evidenceDir, links);
  composed = composeSite({
    repoRoot,
    plan,
    catalog,
    tree,
    inventory,
    template,
    names,
    workerResults,
    contentByUnit: contentIndex(pages),
    assets,
    linkEntries: links,
    policiesFile: `ui.content/src/main/content/jcr_root/conf/${names.conf}/settings/wcm/policies/.content.xml`,
  });
  writeJson(path.join(evidenceDir, 'compose.json'), { ...composed, written: composed.written.length });
  if (composed.conflicts.length) {
    end(phase, 'FAIL', composed.conflicts.map((entry) => `${entry.kind} ${entry.target}#${entry.property}: ${entry.component} vs ${entry.other}`).join('; '));
    return finish('FAIL');
  }
  const composeValidation = await runValidation({
    workspaceRoot: repoRoot, steps: validationPlan([...composed.written, CONTENT_FILTER]), execFn,
  });
  if (composeValidation.status !== 'PASS') {
    end(phase, 'FAIL', `the composed content does not validate (${composeValidation.label}): ${composeValidation.detail.split('\n')[0]}`);
    return finish('FAIL');
  }
  const authored = composed.coverage.reduce((total, entry) => total + entry.authored, 0);
  for (const removed of composed.removed) print(`    removed ${removed}: no longer in the inventory`);
  end(phase, composed.missing_units.length || composed.missing_chrome.length ? 'FAIL' : 'PASS',
    `${authored} block(s) on ${composed.coverage.length} page(s), ${composed.missing_units.length} missing`
    + `${composed.missing_chrome.length ? `, ${composed.missing_chrome.length} chrome missing` : ''}; ${composed.links.rewritten_to_pages} link(s) now point at AEM pages`);

  // 10. Deploy: the whole reactor, once, then ask AEM what actually started.
  phase = start('deploy');
  deployment = await runDeployment({
    repoRoot,
    steps: [focusedTestPlan(workerResults.filter((entry) => entry.status === 'PASS')), ...planDeployment(options.aemPort)].filter(Boolean),
    renderer,
    execFn,
    logPath: path.join(evidenceDir, 'deploy.log'),
    writeLog: fs.appendFileSync,
  });
  writeJson(path.join(evidenceDir, 'deployment.json'), deployment);
  if (deployment.status !== 'PASS') {
    end(phase, 'FAIL', `${deployment.failure.step} exited ${deployment.failure.exit_code}; see ${relative(path.join(evidenceDir, 'deploy.log'))}`);
    return finish('FAIL');
  }
  const bundles = await verifyBundles({
    aemUrl, username: options.aemUser, password: process.env.AEM_PASSWORD, fetchFn,
  });
  if (bundles.status === 'FAIL') {
    print(describeBrokenBundles(bundles.broken));
    end(phase, 'FAIL', `${bundles.broken.length} bundle(s) did not start`);
    return finish('FAIL');
  }
  if (bundles.status === 'UNKNOWN') renderer.note(`bundle check skipped: ${bundles.reason}`);
  end(phase, 'PASS', `${deployment.executed.length} step(s)${bundles.status === 'PASS' ? `, ${bundles.total} bundles active` : ''}`);

  // 11. Verify: every page answers with its title and renders its blocks without a script error.
  phase = start('verify');
  verification = await verifyPages({
    aemUrl, tree, inventory, username: options.aemUser, password: process.env.AEM_PASSWORD, fetchFn,
  });
  rendering = await verifyRendering({
    aemUrl, coverage: composed.coverage, username: options.aemUser, password: process.env.AEM_PASSWORD, fetchFn,
  });
  writeJson(path.join(evidenceDir, 'verify.json'), { pages: verification, rendering });
  for (const entry of verification.results.filter((check) => !check.ok)) print(`    ${entry.aem_path}: ${entry.detail}`);
  for (const entry of rendering.results.filter((check) => !check.ok)) print(`    ${entry.aem_path}: ${entry.detail}`);
  const verifyStatus = verification.status === 'PASS' && rendering.status === 'PASS' ? 'PASS' : 'FAIL';
  end(phase, verifyStatus, `${verification.checked - verification.failed}/${verification.checked} pages answer, `
    + `${rendering.checked - rendering.failed}/${rendering.checked} render without errors`);

  // 12. Report.
  phase = start('report');
  end(phase, 'PASS', relative(path.join(evidenceDir, 'site-report.md')));
  const outcome = finish(phases.every((entry) => entry.status === 'PASS') ? 'PASS' : 'FAIL');
  print('');
  print(`  site report  ${relative(path.join(evidenceDir, 'site-report.md'))}`);
  print(`  link map     ${relative(linkFiles.json)}`);
  print(`  pages        ${aemUrl}/sites.html${options.targetPath}`);
  if (outcome.report.status !== 'COMPLETE') print(`  rerun with --resume ${runId} to retry what is missing; everything that passed is reused`);
  return outcome;
}
