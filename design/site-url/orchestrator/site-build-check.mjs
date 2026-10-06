/**
 * End-to-end check of the site build. Crawl, capture, agents, Maven, parity and AEM are all fakes, so
 * the catalog, the site-plan gate and its repair, the scaffold, foundations, assets, the fan-out with a
 * rejected attempt, compose with link rewriting, deploy, verify, per-page parity with one remediation
 * round, the report and resume are all exercised without a browser, a model, a build or an instance.
 */
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { createRenderer } from './console.mjs';
import { parseJcrXml } from './jcr-xml.mjs';
import { CONTENT_FILTER, CONTENT_ROOT } from './pages.mjs';
import { SITE_PHASES, orchestrateSite } from './site.mjs';

const NS = 'xmlns:sling="http://sling.apache.org/jcr/sling/1.0" xmlns:cq="http://www.day.com/jcr/cq/1.0" xmlns:jcr="http://www.jcp.org/jcr/1.0" xmlns:nt="http://www.jcp.org/jcr/nt/1.0"';
const SOURCE = 'https://www.example.test';
const SITE = '/content/demo/site';
const TEMPLATE = '/conf/demo/settings/wcm/templates/page';
const APPS = 'ui.apps/src/main/content/jcr_root/apps/demo';

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
};
const argument = (args, flag) => args[args.indexOf(flag) + 1];

function makeRepo(repoRoot) {
  const write = (relativePath, text) => {
    const file = path.join(repoRoot, relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text, 'utf8');
  };
  write(`${APPS}/components/text/.content.xml`, `<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:cq="http://www.day.com/jcr/cq/1.0" xmlns:jcr="http://www.jcp.org/jcr/1.0" jcr:primaryType="cq:Component" componentGroup="Demo - Content"/>
`);
  for (const [file, kind] of [['customheaderlibs.html', 'css'], ['customfooterlibs.html', 'js']]) {
    write(`${APPS}/components/page/${file}`, `<sly data-sly-use.clientlib="core/wcm/components/commons/v1/templates/clientlib.html">
    <sly data-sly-call="\${clientlib.${kind} @ categories='demo.base'}"/>
</sly>
`);
  }
  write('core/src/main/java/com/demo/core/models/package-info.java', '@Version("1.0")\npackage com.demo.core.models;\n');
  write(`${CONTENT_ROOT}/content/demo/.content.xml`, `<?xml version="1.0" encoding="UTF-8"?>
<jcr:root ${NS} jcr:primaryType="cq:Page">
    <jcr:content cq:template="${TEMPLATE}" jcr:primaryType="cq:PageContent" sling:resourceType="demo/components/page"/>
</jcr:root>
`);
  write(`${CONTENT_ROOT}${TEMPLATE}/.content.xml`, `<?xml version="1.0" encoding="UTF-8"?>
<jcr:root ${NS} jcr:primaryType="cq:Template">
    <jcr:content jcr:primaryType="cq:PageContent" jcr:title="Content Page" status="enabled"/>
</jcr:root>
`);
  const page = (structure) => `<?xml version="1.0" encoding="UTF-8"?>
<jcr:root ${NS} jcr:primaryType="cq:Page">
    <jcr:content cq:template="${TEMPLATE}" jcr:primaryType="cq:PageContent" sling:resourceType="demo/components/page">
        <root jcr:primaryType="nt:unstructured" sling:resourceType="demo/components/container" layout="responsiveGrid">
${structure ? '            <experiencefragment-header jcr:primaryType="nt:unstructured" sling:resourceType="demo/components/experiencefragment" fragmentVariationPath="/content/experience-fragments/demo/us/en/site/header/master"/>\n' : ''}            <container jcr:primaryType="nt:unstructured" sling:resourceType="demo/components/container" layout="responsiveGrid">
                <title jcr:primaryType="nt:unstructured" sling:resourceType="demo/components/title"${structure ? ' editable="{Boolean}true"' : ''}/>
                <container jcr:primaryType="nt:unstructured" sling:resourceType="demo/components/container"${structure ? ' editable="{Boolean}true"' : ''} layout="responsiveGrid"/>
            </container>
        </root>
    </jcr:content>
</jcr:root>
`;
  write(`${CONTENT_ROOT}${TEMPLATE}/structure/.content.xml`, page(true));
  write(`${CONTENT_ROOT}${TEMPLATE}/initial/.content.xml`, page(false));
  write(`${CONTENT_ROOT}/conf/demo/settings/wcm/policies/.content.xml`, `<?xml version="1.0" encoding="UTF-8"?>
<jcr:root ${NS} jcr:primaryType="cq:Page"/>
`);
  write(CONTENT_FILTER, `<?xml version="1.0" encoding="UTF-8"?>
<workspaceFilter version="1.0">
    <filter root="/conf/demo" mode="merge"/>
    <filter root="/content/demo" mode="merge"/>
    <filter root="/content/dam/demo" mode="merge"/>
    <filter root="/content/experience-fragments/demo" mode="merge"/>
</workspaceFilter>
`);
  write('ui.frontend/src/main/webpack/site/main.scss', "@import 'base';\n");
  write('ui.frontend/node_modules/.keep', '');
}

const PAGES = [
  { id: 'p-001', pathname: '/', title: 'Example | Home', hero: 'Welcome home' },
  { id: 'p-002', pathname: '/about/', title: 'About | Example', hero: 'About our team' },
  { id: 'p-003', pathname: '/contact/', title: 'Contact | Example', hero: 'Contact us today' },
];
const url = (pathname) => `${SOURCE}${pathname}`;
const inventory = {
  schema_version: 1,
  seed: { requested_url: SOURCE, final_url: url('/'), http_status: 200 },
  scope: {
    hosts: ['www.example.test', 'example.test'], canonical_origin: SOURCE, seed_path_prefix: '', max_pages: 50, max_depth: 5, keep_query: false,
    include: [], exclude: [], include_hosts: [],
  },
  pages: PAGES.map((entry, index) => ({
    id: entry.id,
    url: url(entry.pathname),
    key: url(entry.pathname.replace(/\/$/, '') || '/'),
    http_status: 200,
    depth: entry.pathname.split('/').filter(Boolean).length,
    sources: index ? ['link'] : ['seed'],
    sitemap_index: null,
    title: entry.title,
    lang: 'en',
  })),
  aliases: [],
  excluded: [],
  external_links: [],
  documents: [],
  link_order: [],
  coverage: { pages_from_sitemap: 0, pages_from_links: 3, sitemap_only: [], links_only: [] },
  fingerprint: 'sha256:build-inventory',
  status: 'PASS',
  failures: [],
};

const HERO_IMAGE = 'https://cdn.example.test/hero.png';
const block = (id, order, css, text, extra = {}) => ({
  id, order, label: text.slice(0, 40) || 'div', selector: { 1440: { css, match_index: 0 } }, rect: { 1440: { x: 0, y: order * 100, w: 1440, h: 100 } },
  visibility_by_bp: { 1440: true }, signature: { tag: css.split('.')[0], text }, class_chain: [css], ...extra,
});
function captureFor(pathname) {
  const page = PAGES.find((entry) => entry.pathname === pathname);
  const contact = pathname === '/contact/';
  const instances = [
    block('inst-001', 1, 'header.site-header', 'Home About Contact'),
    block('inst-002', 2, 'div.hero', page.hero, { media: { 1440: [{ tag: 'img', src: HERO_IMAGE, alt: 'Hero', intrinsic: { width: 20, height: 10 } }] } }),
    contact
      ? block('inst-003', 3, 'div.rawhtml', '', { media: { 1440: [{ tag: 'iframe', src: 'https://forms.example.net/1', title: 'Form' }] } })
      : block('inst-003', 3, 'div.text', `Body copy for ${page.hero}`),
    block('inst-004', 4, 'footer.site-footer', 'Copyright Example Inc'),
  ];
  const items = {
    'inst-001': [{ type: 'link', text: 'About', href: url('/about/') }, { type: 'link', text: 'Contact', href: url('/contact/') }],
    'inst-002': [{ type: 'heading', level: 1, text: page.hero, html: page.hero }, { type: 'image', src: HERO_IMAGE, alt: 'Hero' }],
    'inst-003': contact
      ? [{ type: 'embed', tag: 'iframe', src: 'https://forms.example.net/1', title: 'Form' }]
      : [{ type: 'text', tag: 'p', text: 'Body', html: `Body copy, <a href="${url('/contact/')}">contact</a> <a href="javascript:alert(1)">x</a>` }],
    'inst-004': [{ type: 'text', tag: 'p', text: 'Copyright Example Inc', html: 'Copyright Example Inc' }],
  };
  return {
    discovery: {
      schema_version: 1, source: { requested_url: url(pathname), final_url: url(pathname) }, source_fingerprint: `sha256:${pathname}`, breakpoints: [1440], instances, status: 'PASS', failures: [],
    },
    content: {
      schema_version: 1,
      source: { url: url(pathname), source_fingerprint: `sha256:${pathname}` },
      instances: instances.map((instance) => ({
        id: instance.id, found: true, breakpoint: 1440, text: instance.signature.text, items: items[instance.id], links: [], html: '<div></div>',
      })),
      status: 'PASS',
      failures: [],
    },
  };
}

const taskOf = (prompt) => {
  const start = prompt.lastIndexOf('```json\n');
  const end = prompt.indexOf('```', start + 8);
  return JSON.parse(prompt.slice(start + 8, end));
};

/** FileVault's jackrabbit-emptyelements rule under replace-mode roots: an ordering-only child needs its own folder. */
function orderingViolations(repoRoot, roots) {
  const violations = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name));
        continue;
      }
      if (entry.name !== '.content.xml') continue;
      for (const child of parseJcrXml(fs.readFileSync(path.join(dir, entry.name), 'utf8')).root.children) {
        if (child.attributes.length || child.children.length) continue;
        const folder = child.name.replace(/^([^:]+):/, '_$1_');
        if (!fs.existsSync(path.join(dir, folder, '.content.xml'))) violations.push(`${path.relative(repoRoot, dir)} <${child.name}/>`);
      }
    }
  };
  for (const root of roots) walk(path.join(repoRoot, CONTENT_ROOT, ...root.split('/').filter(Boolean)));
  return violations;
}

export async function checkSiteBuild() {
  const failures = [];
  const expect = (condition, message) => { if (!condition) failures.push(message); };
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'site-build-check-'));
  const repoRoot = path.join(sandbox, 'repo');
  const evidenceDir = path.join(sandbox, 'evidence');
  makeRepo(repoRoot);

  const toolCalls = [];
  const parityRuns = [];
  const heroCss = path.join(repoRoot, APPS, 'clientlibs/clientlib-components/css/hero.css');
  const runTool = async (name, args) => {
    toolCalls.push(name);
    if (name === 'crawl') {
      writeJson(path.join(argument(args, '--out'), 'inventory.json'), inventory);
    } else if (name === 'discover') {
      writeJson(path.join(argument(args, '--out'), 'discovery.json'), captureFor(new URL(argument(args, '--url')).pathname).discovery);
    } else if (name === 'parity') {
      // The hero scores below the gate until remediation fixes its stylesheet; everything else passes.
      const config = readJson(argument(args, '--config'));
      const cycle = Number(argument(args, '--cycle'));
      parityRuns.push({ cycle, config });
      const fixed = fs.readFileSync(heroCss, 'utf8').includes('fixed');
      const results = config.components.map((entry) => {
        const failing = entry.id === 'hero' && !fixed;
        return {
          component_id: entry.id,
          instance: entry.instance,
          breakpoint: entry.source.bp,
          mode: 'disabled',
          status: failing ? 'FAIL' : 'PASS',
          visual_match_ratio: failing ? 0.71 : 0.97,
          progress_ratio: null,
          owning_layer_hint: failing ? 'spacing' : null,
          side_by_side: `evidence/${entry.id}-${entry.instance}-side-by-side.png`,
          source: { selector: entry.source.css },
          target: { selector: entry.target.css },
        };
      });
      const passed = results.filter((row) => row.status === 'PASS').length;
      writeJson(path.join(argument(args, '--out'), 'parity.json'), {
        cycle,
        source_url: config.source_url,
        status: passed === results.length ? 'PASS' : 'FAIL',
        results,
        preflight: { status: 'PASS', environment_blocked: false, checks: [] },
        page_composite: { '1440-disabled': { status: 'PASS', ratio: 0.96, side_by_side: 'evidence/full-1440-disabled-side-by-side.png' } },
        summary: { components_passed: passed, components_total: results.length },
      });
    } else {
      const discovery = readJson(argument(args, '--discovery'));
      writeJson(path.join(argument(args, '--out'), 'content.json'), captureFor(new URL(discovery.source.final_url).pathname).content);
    }
    return { name, code: 0 };
  };

  const spawned = [];
  const plannerAttempts = [];
  const heroAttempts = [];
  const remediationTasks = [];
  const behaviour = ({ role, id, resultPath, prompt, cwd }) => {
    spawned.push(`${role}:${id}`);
    const envelope = (checks, extra = {}) => writeJson(resultPath, {
      role, status: 'PASS', checks: checks.map((name) => ({ name, status: 'PASS', evidence: 'fixture' })), ...extra,
    });
    if (role === 'site-planner') {
      const catalog = readJson(/- catalog: `([^`]+)`/.exec(prompt)[1]);
      const planPath = /- write the plan to: `([^`]+)`/.exec(prompt)[1];
      plannerAttempts.push(prompt);
      // The first attempt also leaves a stray file in the tree, which the second puts back.
      const stray = path.join(cwd, 'stray-notes.txt');
      if (plannerAttempts.length === 1) fs.writeFileSync(stray, 'scratch');
      if (plannerAttempts.length === 2) fs.rmSync(stray, { force: true });
      const chrome = (slot) => catalog.chrome.filter((entry) => entry.slot === slot).map((entry) => entry.id);
      const groups = (test) => catalog.groups.filter(test).map((group) => group.id);
      writeJson(planPath, {
        run_id: /- run_id: `([^`]+)`/.exec(prompt)[1],
        catalog_fingerprint: catalog.fingerprint,
        components: [
          { id: 'site-header', title: 'Header', role: 'chrome', tier: 4, groups: chrome('header'), java: false },
          { id: 'site-footer', title: 'Footer', role: 'chrome', tier: 4, groups: chrome('footer'), java: false },
          // The first two plans name a component after the site, which the gate must refuse.
          { id: plannerAttempts.length <= 2 ? 'example-hero' : 'hero', title: 'Hero', role: 'content', tier: 4, groups: groups((group) => group.features.includes('media')) },
          {
            id: 'body-text', title: 'Text', role: 'content', tier: 1, reuse_target: 'demo/components/text', authoring: 'mapped', groups: groups((group) => group.classes.includes('text')),
          },
          { id: 'form-embed', title: 'Form Embed', role: 'content', tier: 4, java: false, groups: groups((group) => group.features.some((feature) => feature.startsWith('embed:'))) },
        ],
      });
      envelope(['every_unit_assigned', 'names_generic', 'chrome_uses_experience_fragments']);
      return;
    }
    if (role === 'site-foundations') {
      const tokens = path.join(cwd, 'ui.frontend/src/main/webpack/site/_tokens.scss');
      fs.writeFileSync(tokens, ':root { --color-text: #333; }\n');
      envelope(['tokens_defined', 'base_styles_ready'], { notes: 'tokens from style_stats' });
      return;
    }
    if (role === 'remediation') {
      // Fixes the stylesheet and adds a script, which the clientlib must then load.
      const task = taskOf(prompt);
      remediationTasks.push({ id, task, prompt });
      const css = task.owned_paths.find((owned) => owned.endsWith('/css/hero.css'));
      const js = task.owned_paths.find((owned) => owned.endsWith('/js/hero.js'));
      fs.appendFileSync(path.join(cwd, css), '/* fixed: block padding */\n');
      fs.mkdirSync(path.dirname(path.join(cwd, js)), { recursive: true });
      fs.writeFileSync(path.join(cwd, js), '// equal heights\n');
      envelope(['diagnosis_recorded', 'hypothesis_applied'], { notes: 'hero padding off by 24px' });
      return;
    }
    const task = taskOf(prompt);
    const { component } = task;
    if (component.id === 'hero') heroAttempts.push(task);
    for (const owned of component.owned_paths) {
      if (owned.endsWith('.css')) {
        fs.mkdirSync(path.dirname(path.join(cwd, owned)), { recursive: true });
        fs.writeFileSync(path.join(cwd, owned), `.cmp-${component.id} {}\n`);
      } else if (owned.endsWith(`/components/${component.id}`)) {
        fs.mkdirSync(path.join(cwd, owned), { recursive: true });
        fs.writeFileSync(path.join(cwd, owned, '.content.xml'), '<jcr:root/>\n');
      }
    }
    const units = component.role === 'chrome' ? component.units : component.units.slice(0, component.id === 'hero' && heroAttempts.length === 1 ? -1 : undefined);
    const nodes = units.map((unit) => ({
      name: component.id.replace(/-/g, ''),
      instance: unit,
      resource_type: component.resource_type,
      properties: {
        link: url('/about/'),
        ...(component.id === 'hero' ? { fileReference: task.assets[0]?.dam_path } : {}),
      },
    }));
    envelope(['dialog_authorable', 'model_and_htl_complete', 'focused_test_declared', 'contributions_declared'], {
      contributions: {
        [component.role === 'chrome' ? 'experience_fragment_node' : 'page_node']: nodes,
        clientlib_entries: [`${component.id}.css`],
      },
    });
  };
  const spawnFn = (executable, args, spawnOptions) => {
    const emitter = new EventEmitter();
    emitter.stdout = new PassThrough();
    emitter.stderr = new PassThrough();
    const resultPath = spawnOptions.env.MIGRATION_RESULT_PATH;
    const prompt = fs.readFileSync(path.join(path.dirname(resultPath), 'prompt.md'), 'utf8');
    setImmediate(() => {
      behaviour({
        role: spawnOptions.env.MIGRATION_ROLE, id: spawnOptions.env.MIGRATION_AGENT_ID, resultPath, prompt, cwd: spawnOptions.cwd,
      });
      emitter.stdout.end();
      emitter.stderr.end();
      emitter.emit('close', 0);
    });
    return emitter;
  };

  const execCalls = [];
  const execFn = (command, args, execOptions) => {
    execCalls.push({ line: `${command} ${args.join(' ')}`, cwd: execOptions?.cwd });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const violations = args.includes('filevault-package:validate-files') && args.includes('ui.content')
      ? orderingViolations(repoRoot, [SITE, '/content/experience-fragments/demo/site', '/conf/demo/settings/wcm/templates/site-page'])
      : [];
    setImmediate(() => {
      child.stdout.end(violations.map((entry) => `[ERROR] ValidationViolation: Found empty node (used for ordering only) @ ${entry}\n`).join(''));
      child.stderr.end();
      child.emit('close', violations.length ? 1 : 0);
    });
    return child;
  };

  const titles = new Map(PAGES.map((entry) => [`${SITE}${entry.pathname.replace(/\/$/, '')}.html`, entry.title]));
  // The markup Core Components render around a page's blocks: the fragments and the generated container id.
  const containerId = (aemPath) => `container-${crypto.createHash('sha256').update(`${aemPath}/jcr:content/root/container/container`).digest('hex').slice(0, 10)}`;
  const pageHtml = (pathname, title) => `<html><head><title>${title}</title></head><body>`
    + '<div class="cmp-experiencefragment cmp-experiencefragment--header"><div class="cmp-container"></div></div>'
    + `<div id="${containerId(pathname.replace(/\.html$/, ''))}" class="cmp-container"></div>`
    + '<div class="cmp-experiencefragment cmp-experiencefragment--footer"><div class="cmp-container"></div></div></body></html>';
  const fetchFn = async (address) => {
    if (address === HERO_IMAGE) {
      return {
        ok: true, status: 200, headers: { get: () => 'image/png' }, arrayBuffer: async () => Buffer.from('png-bytes'),
      };
    }
    const { pathname } = new URL(address);
    if (pathname.startsWith('/system/console/bundles')) {
      return { ok: true, status: 200, json: async () => ({ data: [{ id: 1, symbolicName: 'demo.core', version: '1', state: 'Active' }] }) };
    }
    const title = titles.get(pathname);
    return { status: title ? 200 : 404, text: async () => (title ? pageHtml(pathname, title) : '') };
  };

  const options = {
    siteUrl: SOURCE,
    targetPath: SITE,
    aemHost: 'localhost',
    aemPort: 4502,
    aemUser: 'admin',
    breakpoints: [1440],
    settleMs: 0,
    maxPages: 50,
    maxDepth: 5,
    crawlDelayMs: 0,
    include: [],
    exclude: [],
    includeHosts: [],
    maxParallel: 2,
    componentAttempts: 3,
    model: 'fixture-model',
    effort: 'high',
    yes: true,
  };
  const lines = [];
  const services = (overrides = {}) => ({
    renderer: createRenderer({ stageIds: SITE_PHASES }),
    runId: 'build-check',
    evidenceDir,
    runTool,
    repoRoot,
    print: (line) => lines.push(line),
    execFn,
    fetchFn,
    spawnFn,
    copilot: { executable: 'fake-copilot' },
    ...overrides,
  });
  const phaseStatus = (outcome) => outcome.phases.map((phase) => `${phase.name}:${phase.status}`).join(' ');
  const content = (jcrPath, name = '.content.xml') => fs.readFileSync(path.join(repoRoot, CONTENT_ROOT, ...jcrPath.split('/').filter(Boolean), name), 'utf8');

  let outcome;
  try {
    outcome = await orchestrateSite(options, services());
  } catch (error) {
    failures.push(`the site build threw: ${error.stack}`);
    fs.rmSync(sandbox, { recursive: true, force: true });
    return failures;
  }
  // The first measurement fails the hero; remediation fixes it, so the run passes on the final one.
  const expected = SITE_PHASES.map((name) => `${name}:${name === 'parity' ? 'FAIL' : 'PASS'}`).join(' ');
  expect(phaseStatus(outcome) === expected, `every phase but the first measurement must pass, got ${phaseStatus(outcome)}`);
  expect(outcome.status === 'PASS' && outcome.report?.status === 'COMPLETE', `the run must be complete, got ${outcome.status}/${outcome.report?.status}`);

  // Plan: a planner that wrote into the tree was refused, then a branded name, and each repair said why.
  expect(plannerAttempts.length === 3 && plannerAttempts[1].includes('You are read-only') && plannerAttempts[1].includes('stray-notes.txt')
    && plannerAttempts[2].includes('carries the site\'s name "example"'),
    `the stray write and the branded plan must each be refused and repaired, got ${plannerAttempts.length} attempt(s)`);
  expect(!fs.existsSync(path.join(repoRoot, 'stray-notes.txt')), 'the stray file must be gone');
  const plan = readJson(path.join(evidenceDir, 'plan.json'));
  expect(plan.components.find((entry) => entry.id === 'body-text')?.authoring === 'mapped', 'the mapped component must be in the plan');
  expect(!spawned.some((entry) => entry.includes('body-text')), 'a mapped component gets no worker');

  // Fan-out: the hero's first attempt left a unit out, was refused with the unit named, then passed.
  expect(heroAttempts.length === 2, `the hero must take two attempts, took ${heroAttempts.length}`);
  const heroPrompt = fs.readFileSync(path.join(evidenceDir, 'agents', 'component-hero-attempt-2', 'prompt.md'), 'utf8');
  expect(heroPrompt.includes('have no page_node') && heroPrompt.includes('p-003/inst-002'), 'the rejection must name the missing unit');
  expect(heroAttempts[0].assets.some((entry) => entry.dam_path === '/content/dam/demo/site/hero.png'), 'the worker must be told the DAM path of its image');
  expect(heroAttempts[0].design_tokens?.['--color-text'] === '#333', 'the worker must be told the tokens foundations defined');
  const slice = readJson(heroAttempts[0].evidence_slice);
  expect(slice.units.length === 3 && slice.units.every((entry) => entry.content?.items?.length), 'the slice must hold every unit\'s content');

  // Scaffold: a template of the site's own, without the title, pointing at the site's fragments.
  const structure = content('/conf/demo/settings/wcm/templates/site-page/structure');
  expect(!structure.includes('demo/components/title') && structure.includes('/content/experience-fragments/demo/site/header/master')
    && structure.includes('/content/experience-fragments/demo/site/footer/master') && structure.includes('cq:template="/conf/demo/settings/wcm/templates/site-page"'),
  'the site template must drop the title and reference the site fragments');
  const filter = fs.readFileSync(path.join(repoRoot, CONTENT_FILTER), 'utf8');
  for (const [root, parent] of [
    [SITE, '/content/demo'], ['/conf/demo/settings/wcm/templates/site-page', '/conf/demo'],
    ['/content/experience-fragments/demo/site', '/content/experience-fragments/demo'], ['/content/dam/demo/site', '/content/dam/demo'],
  ]) {
    const own = filter.indexOf(`<filter root="${root}"/>`);
    expect(own >= 0 && own < filter.indexOf(`<filter root="${parent}" mode="merge"/>`), `${root} needs a replace-mode filter root ahead of ${parent}`);
  }
  const headerLibs = fs.readFileSync(path.join(repoRoot, APPS, 'components/page/customheaderlibs.html'), 'utf8');
  expect(headerLibs.includes("categories='demo.components'"), 'the component clientlib must be loaded on every page');
  expect(fs.readFileSync(path.join(repoRoot, APPS, 'clientlibs/clientlib-components/css.txt'), 'utf8').split('\n').includes('hero.css'),
    'css.txt must list the hero\'s stylesheet');
  expect(execCalls.some((call) => call.line === 'npm run prod' && String(call.cwd).endsWith('ui.frontend')), 'foundations must be checked by a frontend build');

  // Compose: pages carry their blocks in reading order, links point at AEM, rich text is safe.
  const home = content(SITE);
  const about = content(`${SITE}/about`);
  const contact = content(`${SITE}/about`.replace('/about', '/contact'));
  expect(home.indexOf('sling:resourceType="demo/components/hero"') > 0
    && home.indexOf('sling:resourceType="demo/components/hero"') < home.indexOf('sling:resourceType="demo/components/text"'), 'the home page must hold the hero, then the text');
  expect(!home.includes('demo/components/title') && home.includes('cq:template="/conf/demo/settings/wcm/templates/site-page"'), 'pages use the site template, without a title');
  expect(about.includes('link="/content/demo/site/about"') && about.includes('fileReference="/content/dam/demo/site/hero.png"'), 'authored links and assets must be rewritten and kept');
  expect(home.includes('/content/demo/site/contact.html') && !home.includes('javascript'), 'rich-text links must be rewritten and unsafe ones dropped');
  expect(contact.includes('sling:resourceType="demo/components/form-embed"'), 'the contact page must hold the form embed');
  const header = content('/content/experience-fragments/demo/site/header/master');
  expect(header.includes('sling:resourceType="demo/components/site-header"') && header.includes('link="/content/demo/site/about"'),
    'the header fragment must hold the header, links rewritten');
  expect(content('/content/experience-fragments/demo/site/footer/master').includes('demo/components/site-footer'), 'the footer fragment must hold the footer');
  expect(!home.includes('site-header') && !home.includes('site-footer'), 'chrome is never authored onto a page');

  // Deploy, verify and the report.
  expect(execCalls.some((call) => call.line.includes('-PautoInstallSinglePackage')), 'the site must be deployed');

  // Parity: one run per page, each block found by its place in AEM and compared where discovery saw it.
  const firstCycle = parityRuns.filter((entry) => entry.cycle === 0);
  expect(firstCycle.length === PAGES.length && parityRuns.filter((entry) => entry.cycle === 1).length === PAGES.length,
    `every page must be scored once per cycle, got ${parityRuns.map((entry) => entry.cycle).join(',')}`);
  const homeConfig = firstCycle.find((entry) => entry.config.targets[0].url === `http://localhost:4502${SITE}.html?wcmmode=disabled`)?.config;
  const homeRow = (id) => homeConfig?.components.find((entry) => entry.id === id);
  expect(homeConfig?.source_url === url('/') && homeConfig.auth.password_env === 'AEM_PASSWORD', 'the home page is compared with its own source');
  expect(homeRow('hero')?.target.css === `[id="${containerId(SITE)}"] > .aem-Grid > :nth-child(1)` && homeRow('hero').source.css === 'div.hero',
    `the hero is the container's first child, got ${homeRow('hero')?.target.css}`);
  expect(homeRow('body-text')?.target.css.endsWith(':nth-child(2)'), 'a mapped block is scored like any other');
  expect(homeRow('site-header')?.target.css === '.cmp-experiencefragment--header > .cmp-container > .aem-Grid > :nth-child(1)'
    && homeRow('site-footer')?.target.css.startsWith('.cmp-experiencefragment--footer'), 'chrome is found inside its fragment');

  // Remediation: one agent for the hero, told every failing block, and its fix merged, loaded and deployed.
  expect(remediationTasks.length === 1 && remediationTasks[0].id === 'fix-hero', `one remediation agent must fix the hero, got ${remediationTasks.map((entry) => entry.id).join(', ')}`);
  const fixTask = remediationTasks[0]?.task;
  expect(fixTask?.failing?.length === 3 && fixTask.failing.every((entry) => entry.unit.endsWith('/inst-002') && entry.ratio === 0.71)
    && fixTask.deltas[0].length === 3 && fixTask.owned_paths.some((entry) => entry.endsWith('/components/hero')),
  'the agent must see every failing block of its component and own its paths');
  expect(remediationTasks[0]?.prompt.includes('## Site mode') && fixTask?.deltas[0][0].side_by_side?.startsWith(evidenceDir),
    'the agent must be told it fixes a site, with evidence it can open');
  expect(fs.readFileSync(heroCss, 'utf8').includes('fixed') && fs.readFileSync(path.join(repoRoot, APPS, 'clientlibs/clientlib-components/js.txt'), 'utf8')
    .split('\n').includes('hero.js'), 'the fix must be merged and a new script listed in the clientlib');
  expect(execCalls.filter((call) => call.line.includes('-PautoInstallSinglePackage')).length === 2, 'the fix must be deployed before it is scored');
  const ledger = readJson(path.join(evidenceDir, 'remediation-ledger.json'));
  const heroEntry = ledger.components.find((entry) => entry.id === 'hero');
  expect(heroEntry?.status === 'PASS' && heroEntry.history.length === 1 && !ledger.components.some((entry) => entry.id === 'body-text'),
    'the hero passes after one attempt, and a mapped component is never given a budget');
  const siteParity = readJson(path.join(evidenceDir, 'parity', 'site-parity.json'));
  expect(siteParity.cycle === 1 && siteParity.status === 'PASS' && siteParity.summary.pages_passed === PAGES.length, 'the final measurement must be the passing one');

  const report = fs.readFileSync(path.join(evidenceDir, 'site-report.md'), 'utf8');
  expect(report.startsWith('# Site migration COMPLETE') && report.includes('| hero | 4 | content | 3 | 3 | PASS | PASS | 97.00% | 1 |')
    && report.includes('| body-text | 1 | content | 2 | 2 | MAPPED | PASS | 97.00% |  |'), 'the report must list every component with its parity');
  expect(report.includes('- Result: **PASS** after 1 remediation round(s): 3/3 pages') && report.includes(`| ${SITE}/about | 2 | 0 | yes | PASS |  |`),
    'the report must give the parity verdict for the site and for every page');
  expect(lines.some((line) => line.includes('p-001  FAIL') && line.includes('| hero fail')) && !lines.some((line) => /FAIL.*\bpage \d/.test(line)),
    'a failing page must name what failed, never just a percentage');

  // Resume: every verified phase is reused, the fix holds on the first measurement, and no agent runs again.
  spawned.length = 0;
  const callsBefore = toolCalls.length;
  const resumed = await orchestrateSite(options, services({ resumed: true }));
  expect(resumed.status === 'PASS' && phaseStatus(resumed) === SITE_PHASES.map((name) => `${name}:PASS`).join(' '),
    `the resumed run must pass every phase, got ${phaseStatus(resumed)}`);
  expect(spawned.length === 0, `a resume must spawn no agent, spawned ${spawned.join(', ')}`);
  const rerun = toolCalls.slice(callsBefore);
  expect(rerun.every((name) => name === 'parity') && rerun.length === PAGES.length, `a resume must only score again, ran ${rerun.join(', ')}`);
  expect(content(SITE) === home, 'composing again must write the same page');

  fs.rmSync(sandbox, { recursive: true, force: true });
  return failures;
}
