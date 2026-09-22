import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { applyContributions, collectContributions } from './contributions.mjs';
import { getAttribute, parseJcrList, parseJcrXml, serializeJcrXml } from './jcr-xml.mjs';

const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'contributions-'));
const repoRoot = path.join(sandbox, 'repo');
const pageFile = 'ui.content/content/page/.content.xml';
const xfFile = 'ui.content/content/experience-fragments/site/header/master/.content.xml';
const policiesFile = 'ui.content/conf/policies/.content.xml';

// A policies file with existing archetype content that must survive the merge.
fs.mkdirSync(path.join(repoRoot, path.dirname(policiesFile)), { recursive: true });
fs.writeFileSync(path.join(repoRoot, policiesFile), `<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:sling="http://sling.apache.org/jcr/sling/1.0" xmlns:jcr="http://www.jcp.org/jcr/1.0"
    jcr:primaryType="cq:Page">
    <demo jcr:primaryType="nt:unstructured">
        <components jcr:primaryType="nt:unstructured">
            <image jcr:primaryType="nt:unstructured">
                <policy_existing
                    jcr:primaryType="nt:unstructured"
                    jcr:title="Content Image"
                    allowedRenditionWidths="[320,480]"/>
            </image>
            <container jcr:primaryType="nt:unstructured">
                <policy_main
                    jcr:primaryType="nt:unstructured"
                    components="[demo/components/text]"/>
            </container>
        </components>
    </demo>
</jcr:root>
`, 'utf8');

const plan = {
  run_id: 'r1',
  source_fingerprint: 'sha256:abc',
  breakpoints: [1440],
  shared: {
    policies_file: policiesFile,
    clientlib_index: 'ui.apps/clientlibs/clientlib-story/css.txt',
    clientlib_js_index: 'ui.apps/clientlibs/clientlib-story/js.txt',
    compose_targets: {
      '/content/demo/us/en/page': {
        file: pageFile,
        primary_type: 'cq:Page',
        resource_type: 'demo/components/page',
        properties: { 'jcr:title': 'Cursor', 'cq:template': '/conf/demo/settings/wcm/templates/story' },
        container: {
          name: 'root',
          resource_type: 'demo/components/container',
          layout: 'responsiveGrid',
          nested: [{ name: 'main', resource_type: 'demo/components/container', layout: 'responsiveGrid' }],
        },
      },
      '/content/experience-fragments/site/header/master': {
        file: xfFile,
        primary_type: 'cq:Page',
        resource_type: 'demo/components/xfpage',
        properties: { 'jcr:title': 'Header', 'cq:xfVariantType': 'web' },
        container: { name: 'root', resource_type: 'demo/components/container', layout: 'simple' },
      },
    },
  },
  components: [
    {
      id: 'customer-story-hero',
      tier: 4,
      role: 'content',
      instances: ['inst-001'],
      owned_paths: ['ui.apps/components/customer-story-hero'],
      contribution: { kind: 'page-fragment', path: '/content/demo/us/en/page', order_index: 1 },
      parity_targets: [{ instance: 'inst-001', source: {}, target: {} }],
    },
    {
      id: 'story-cta-band',
      tier: 4,
      role: 'content',
      instances: ['inst-002'],
      owned_paths: ['ui.apps/components/story-cta-band'],
      contribution: { kind: 'page-fragment', path: '/content/demo/us/en/page', order_index: 2 },
      parity_targets: [{ instance: 'inst-002', source: {}, target: {} }],
    },
    {
      id: 'site-header',
      tier: 4,
      role: 'chrome',
      instances: ['inst-003'],
      owned_paths: ['ui.apps/components/site-header'],
      contribution: { kind: 'experience-fragment', path: '/content/experience-fragments/site/header/master' },
      parity_targets: [{ instance: 'inst-003', source: {}, target: {} }],
    },
  ],
};

const heroResult = {
  component_id: 'customer-story-hero',
  contributions: {
    page_node: {
      name: 'hero',
      order_index: 1,
      resource_type: 'demo/components/customer-story-hero',
      properties: { headline: 'How the world\'s fastest-growing startup stays fast', showVideo: true, columns: 2 },
    },
    policies: [{ path: 'demo/components/customer-story-hero/policy_default', properties: { 'jcr:title': 'Hero' } }],
    policy_additions: [{ path: 'demo/components/container/policy_main', property: 'components', values: ['demo/components/customer-story-hero'] }],
    clientlib_entries: ['customer-story-hero.css'],
    js_entries: ['customer-story-hero.js'],
  },
};

const ctaResult = {
  component_id: 'story-cta-band',
  contributions: {
    page_node: {
      name: 'cta',
      order_index: 2,
      resource_type: 'demo/components/story-cta-band',
      properties: { heading: 'Build with less tool sprawl', ctaLabel: 'Request a demo' },
      children: [{ name: 'links', properties: {}, children: [{ name: 'item0', properties: { label: 'Demo', link: '/demo' } }] }],
    },
    policies: [{ path: 'demo/components/story-cta-band/policy_default', properties: { 'jcr:title': 'CTA band' } }],
    policy_additions: [{ path: 'demo/components/container/policy_main', property: 'components', values: ['demo/components/story-cta-band'] }],
    clientlib_entries: ['story-cta-band.css'],
    js_entries: ['story-cta-band.js'],
  },
};

const headerResult = {
  component_id: 'site-header',
  contributions: {
    experience_fragment_node: {
      name: 'site-header',
      resource_type: 'demo/components/site-header',
      properties: { brandLabel: 'Notion' },
    },
    clientlib_entries: ['site-header.css'],
  },
};

// Workers finishing out of order must not change the output.
const forward = applyContributions({ repoRoot, plan, results: [heroResult, ctaResult, headerResult] });
expect(forward.conflicts.length === 0, `clean run should not conflict: ${JSON.stringify(forward.conflicts)}`);
const pageForward = fs.readFileSync(path.join(repoRoot, pageFile), 'utf8');
const policiesForward = fs.readFileSync(path.join(repoRoot, policiesFile), 'utf8');
const clientlibForward = fs.readFileSync(path.join(repoRoot, 'ui.apps/clientlibs/clientlib-story/css.txt'), 'utf8');

const reversed = applyContributions({ repoRoot, plan, results: [headerResult, ctaResult, heroResult] });
expect(reversed.conflicts.length === 0, 'reversed order should also be clean');
expect(fs.readFileSync(path.join(repoRoot, pageFile), 'utf8') === pageForward,
  'page output must be identical regardless of the order workers finish in');
expect(fs.readFileSync(path.join(repoRoot, 'ui.apps/clientlibs/clientlib-story/css.txt'), 'utf8') === clientlibForward,
  'clientlib index must follow plan order, not completion order');

const jsIndex = fs.readFileSync(path.join(repoRoot, 'ui.apps/clientlibs/clientlib-story/js.txt'), 'utf8');
expect(jsIndex === '#base=js\ncustomer-story-hero.js\nstory-cta-band.js\n',
  `js index must follow plan order under its own header, got ${JSON.stringify(jsIndex)}`);

// Page structure and typed values.
const pageDocument = parseJcrXml(pageForward);
const main = pageDocument.root.children[0].children[0].children[0];
expect(main.name === 'main', `nested container should be built, got ${main.name}`);
expect(main.children.map((child) => child.name).join(',') === 'hero,cta',
  `nodes must be ordered by order_index, got ${main.children.map((child) => child.name).join(',')}`);
expect(getAttribute(main.children[0], 'showVideo') === '{Boolean}true', 'booleans should use JCR typing');
expect(getAttribute(main.children[0], 'columns') === '{Long}2', 'numbers should use JCR typing');
expect(getAttribute(main.children[0], 'headline').includes('&quot;') === false
  && getAttribute(main.children[0], 'headline').includes("world's"), 'apostrophes should survive escaping');
expect(main.children[1].children[0].children[0].name === 'item0', 'nested child nodes should be composed');

// A component claiming several instances places several nodes from one result.
const multiNode = applyContributions({
  repoRoot,
  plan,
  results: [{
    component_id: 'customer-story-hero',
    contributions: {
      page_node: [
        { name: 'intro', order_index: 1, resource_type: 'demo/components/customer-story-hero', properties: { headline: 'Intro' } },
        { name: 'outro', order_index: 3, resource_type: 'demo/components/customer-story-hero', properties: { headline: 'Outro' } },
      ],
    },
  }, ctaResult],
});
expect(multiNode.conflicts.length === 0, `a node list should compose cleanly: ${JSON.stringify(multiNode.conflicts)}`);
const multiMain = parseJcrXml(fs.readFileSync(path.join(repoRoot, pageFile), 'utf8'))
  .root.children[0].children[0].children[0];
expect(multiMain.children.map((child) => child.name).join(',') === 'intro,cta,outro',
  `listed nodes must interleave by order_index, got ${multiMain.children.map((child) => child.name).join(',')}`);

// Every node in a list needs its own name, or the orchestrator cannot place it.
const unnamed = applyContributions({
  repoRoot,
  plan,
  results: [{
    component_id: 'customer-story-hero',
    contributions: { page_node: [{ order_index: 1, properties: {} }] },
  }],
});
expect(unnamed.conflicts.some((entry) => entry.kind === 'unnamed-node'),
  'a node declared without a name must be reported, not silently written');

// Source order wins over any number an agent picked, so interleaved components cannot collide.
const instanceOrder = new Map([['inst-001', 1], ['inst-002', 2], ['inst-003', 3], ['inst-004', 4]]);
const interleaved = applyContributions({
  repoRoot,
  plan,
  instanceOrder,
  results: [{
    component_id: 'customer-story-hero',
    contributions: {
      page_node: [
        { name: 'article-a', instance: 'inst-001', order_index: 7, properties: {} },
        { name: 'article-b', instance: 'inst-003', order_index: 7, properties: {} },
      ],
    },
  }, {
    component_id: 'story-cta-band',
    contributions: { page_node: [{ name: 'quote', instance: 'inst-002', order_index: 7, properties: {} }] },
  }],
});
expect(interleaved.conflicts.length === 0, `instance order should resolve collisions: ${JSON.stringify(interleaved.conflicts)}`);
const interleavedMain = parseJcrXml(fs.readFileSync(path.join(repoRoot, pageFile), 'utf8'))
  .root.children[0].children[0].children[0];
expect(interleavedMain.children.map((child) => child.name).join(',') === 'article-a,quote,article-b',
  `nodes must follow source order, got ${interleavedMain.children.map((child) => child.name).join(',')}`);

// An instance that is not in the frozen evidence must be refused, not quietly reordered.
const invented = applyContributions({
  repoRoot,
  plan,
  instanceOrder,
  results: [{
    component_id: 'customer-story-hero',
    contributions: { page_node: [{ name: 'ghost', instance: 'inst-999', properties: {} }] },
  }],
});
expect(invented.conflicts.some((entry) => entry.kind === 'unknown-instance'),
  'an instance id absent from discovery must be reported');

// Restore the canonical page for the remaining assertions.
applyContributions({ repoRoot, plan, results: [heroResult, ctaResult, headerResult] });

// Chrome lands in the experience fragment, never on the page.
const xfDocument = parseJcrXml(fs.readFileSync(path.join(repoRoot, xfFile), 'utf8'));
expect(xfDocument.root.children[0].children[0].children[0].name === 'site-header',
  'chrome node should be written into the experience fragment');
expect(!pageForward.includes('site-header'), 'chrome must not appear in the page document');

// Existing policies survive; additions merge as a union.
expect(policiesForward.includes('policy_existing') && policiesForward.includes('allowedRenditionWidths="[320,480]"'),
  'existing archetype policies must be preserved');
const policyDocument = parseJcrXml(policiesForward);
const mainPolicy = policyDocument.root.children[0].children[0]
  .children.find((child) => child.name === 'container').children[0];
const allowed = parseJcrList(getAttribute(mainPolicy, 'components'));
expect(allowed.join() === 'demo/components/text,demo/components/customer-story-hero,demo/components/story-cta-band',
  `allowed components should be an ordered union, got ${allowed.join()}`);
expect(policiesForward.includes('policy_default'), 'new component policies should be created');

// Two workers disagreeing on the same policy property is a hard conflict.
const rogue = {
  component_id: 'story-cta-band',
  contributions: {
    policies: [{ path: 'demo/components/customer-story-hero/policy_default', properties: { 'jcr:title': 'Different' } }],
  },
};
const conflicted = collectContributions(plan, [heroResult, rogue]);
expect(conflicted.conflicts.some((entry) => entry.kind === 'policy-conflict' && entry.property === 'jcr:title'),
  'conflicting scalar policy values must be reported');

// Two workers claiming the same page slot is a hard conflict.
const collision = collectContributions(plan, [heroResult, {
  component_id: 'story-cta-band',
  contributions: { page_node: { name: 'other', order_index: 1, resource_type: 'x' } },
}]);
expect(collision.conflicts.some((entry) => entry.kind === 'node-collision'),
  'two components claiming one order_index must be reported');

// Round-trip fidelity of the minimal XML layer.
const sample = fs.readFileSync(path.join(repoRoot, policiesFile), 'utf8');
expect(serializeJcrXml(parseJcrXml(sample)) === sample, 'serialize(parse(x)) must be stable');

// Every real JCR file in this repository must survive a round trip without losing content.
function treeEquals(left, right) {
  if (left.name !== right.name) return false;
  const attributesOf = (node) => node.attributes.map(([name, value]) => `${name}=${value}`).sort().join('\u0000');
  if (attributesOf(left) !== attributesOf(right)) return false;
  if (left.children.length !== right.children.length) return false;
  return left.children.every((child, index) => treeEquals(child, right.children[index]));
}

const realFiles = [];
const collect = (directory) => {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!/node_modules|target/.test(child)) collect(child);
    } else if (entry.name === '.content.xml') {
      realFiles.push(child);
    }
  }
};
const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../../..');
collect(path.join(projectRoot, 'ui.content', 'src', 'main', 'content', 'jcr_root'));
collect(path.join(projectRoot, 'ui.apps', 'src', 'main', 'content', 'jcr_root'));

const lossy = [];
for (const file of realFiles) {
  const original = fs.readFileSync(file, 'utf8');
  try {
    if (!treeEquals(parseJcrXml(original).root, parseJcrXml(serializeJcrXml(parseJcrXml(original))).root)) {
      lossy.push(file);
    }
  } catch (error) {
    lossy.push(`${file} :: ${error.message}`);
  }
}
expect(realFiles.length > 50, `expected to scan the project's JCR files, found ${realFiles.length}`);
expect(lossy.length === 0, `round trip altered content in: ${lossy.slice(0, 3).join(', ')}`);
console.log(`  round-tripped ${realFiles.length} real JCR files with no content loss`);

if (failures.length) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  console.log(`\n${failures.length} assertion(s) failed. Sandbox: ${sandbox}`);
  process.exitCode = 1;
} else {
  console.log('contribution composer assertions: all passed');
  fs.rmSync(sandbox, { recursive: true, force: true });
}
