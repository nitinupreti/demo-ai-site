import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { planSummary, validatePlan } from './plan.mjs';
import { collectChanges, createWorkspace, mergeChanges, snapshotTree } from './workspaces.mjs';

const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };
const hasError = (result, fragment) => result.errors.some((error) => error.includes(fragment));

const discovery = {
  source_fingerprint: 'sha256:abc',
  instances: [{ id: 'inst-001', label: 'hero' }, { id: 'inst-002', label: 'nav' }],
};

function basePlan(overrides = {}) {
  return {
    run_id: 'r1',
    source_fingerprint: 'sha256:abc',
    breakpoints: [375, 768, 1440],
    components: [
      {
        id: 'customer-story-hero',
        tier: 4,
        role: 'content',
        instances: ['inst-001'],
        owned_paths: ['ui.apps/src/main/content/jcr_root/apps/demo/components/customer-story-hero'],
        contribution: { kind: 'page-fragment', path: '/content/demo/us/en/page', order_index: 1 },
        parity_targets: [{ instance: 'inst-001', source: { css: 'section.hero' }, target: { css: '.cmp-hero' } }],
        depends_on: [],
      },
      {
        id: 'site-header',
        tier: 4,
        role: 'chrome',
        instances: ['inst-002'],
        owned_paths: ['ui.apps/src/main/content/jcr_root/apps/demo/components/site-header'],
        contribution: { kind: 'experience-fragment', path: '/content/experience-fragments/demo/us/en/site/header/master' },
        parity_targets: [{ instance: 'inst-002', source: { css: 'nav' }, target: { css: '.cmp-header' } }],
        depends_on: ['customer-story-hero'],
      },
    ],
    ...overrides,
  };
}

let result = validatePlan(basePlan(), { discovery, runId: 'r1' });
expect(result.valid, `valid plan should pass, got: ${result.errors.join('; ')}`);
expect(JSON.stringify(result.waves) === JSON.stringify([['customer-story-hero'], ['site-header']]),
  `waves should follow dependencies, got ${JSON.stringify(result.waves)}`);
expect(planSummary(basePlan(), result.waves).chrome.join() === 'site-header', 'summary should list chrome components');

const unclaimed = basePlan();
unclaimed.components[1].instances = ['inst-002'];
unclaimed.components[0].instances = [];
result = validatePlan(unclaimed, { discovery, runId: 'r1' });
expect(!result.valid, 'a plan with an empty instance list should fail schema validation');

const doubleClaim = basePlan();
doubleClaim.components[1].instances = ['inst-001', 'inst-002'];
result = validatePlan(doubleClaim, { discovery, runId: 'r1' });
expect(hasError(result, 'is claimed by'), 'double-claimed instances must be rejected');

const missingInstance = basePlan();
missingInstance.components[1].instances = ['inst-003'];
missingInstance.components[1].parity_targets = [{ instance: 'inst-003', source: {}, target: {} }];
result = validatePlan(missingInstance, { discovery, runId: 'r1' });
expect(hasError(result, 'inst-002') && hasError(result, 'not present in discovery.json'),
  'unclaimed and unknown instances must both be reported');

const overlapping = basePlan();
overlapping.components[1].owned_paths = ['ui.apps/src/main/content/jcr_root/apps/demo/components/customer-story-hero/sub'];
result = validatePlan(overlapping, { discovery, runId: 'r1' });
expect(hasError(result, 'both own'), 'overlapping ownership must be rejected');

const sharedOwner = basePlan();
sharedOwner.components[0].owned_paths = ['ui.content/src/main/content/jcr_root/conf/demo/settings/wcm/templates/x'];
result = validatePlan(sharedOwner, { discovery, runId: 'r1' });
expect(hasError(result, 'may not own shared path'), 'shared infrastructure must stay out of worker scopes');

const chromeOnPage = basePlan();
chromeOnPage.components[1].contribution = { kind: 'page-fragment', path: '/content/demo/us/en/page' };
result = validatePlan(chromeOnPage, { discovery, runId: 'r1' });
expect(hasError(result, 'must contribute an experience-fragment'), 'chrome authored on a page must be rejected');

const cyclic = basePlan();
cyclic.components[0].depends_on = ['site-header'];
result = validatePlan(cyclic, { discovery, runId: 'r1' });
expect(hasError(result, 'dependency cycle'), 'cycles must be rejected');

const staleFingerprint = basePlan({ source_fingerprint: 'sha256:other' });
result = validatePlan(staleFingerprint, { discovery, runId: 'r1' });
expect(hasError(result, 'stale evidence'), 'a plan built from stale discovery must be rejected');

// Genericity: the gates must key off plan data, never off a component's name.
const renamed = basePlan();
renamed.components[0].id = 'zzz-arbitrary-block';
renamed.components[0].owned_paths = ['ui.apps/src/main/content/jcr_root/apps/anyproject/components/zzz-arbitrary-block'];
renamed.components[1].id = 'global-masthead';
renamed.components[1].owned_paths = ['ui.apps/src/main/content/jcr_root/apps/anyproject/components/global-masthead'];
renamed.components[1].depends_on = ['zzz-arbitrary-block'];
result = validatePlan(renamed, { discovery, runId: 'r1' });
expect(result.valid, `arbitrary component names must be accepted: ${result.errors.join('; ')}`);

const renamedChromeOnPage = basePlan();
renamedChromeOnPage.components[1].id = 'global-masthead';
renamedChromeOnPage.components[1].depends_on = [];
renamedChromeOnPage.components[1].contribution = { kind: 'page-fragment', path: '/content/x' };
result = validatePlan(renamedChromeOnPage, { discovery, runId: 'r1' });
expect(hasError(result, 'must contribute an experience-fragment'),
  'the chrome rule must follow role, not a name like site-header');

// Genericity: a project with different module names can protect its own paths.
const customLayout = basePlan();
customLayout.shared = { protected_paths: ['apps-module/src/shared/**'] };
customLayout.components[0].owned_paths = ['apps-module/src/shared/tokens.scss'];
result = validatePlan(customLayout, { discovery, runId: 'r1' });
expect(hasError(result, 'may not own shared path'), 'configured protected paths must be enforced');

// Regex-form protected paths are supported too.
const regexLayout = basePlan();
regexLayout.shared = { protected_paths: ['/^custom\\/design-system\\//'] };
regexLayout.components[0].owned_paths = ['custom/design-system/base.css'];
result = validatePlan(regexLayout, { discovery, runId: 'r1' });
expect(hasError(result, 'may not own shared path'), 'regex protected paths must be enforced');

// The archetype defaults still protect the files every AEM project shares.
for (const shared of [
  'ui.content/src/main/content/META-INF/vault/filter.xml',
  'ui.apps/src/main/content/jcr_root/apps/anyproject/clientlibs/clientlib-site/css.txt',
  'ui.apps/src/main/content/jcr_root/apps/anyproject/components/page/customheaderlibs.html',
  'core/pom.xml',
]) {
  const attempt = basePlan();
  attempt.components[0].owned_paths = [shared];
  result = validatePlan(attempt, { discovery, runId: 'r1' });
  expect(hasError(result, 'may not own shared path'), `default protection missing for ${shared}`);
}

// Worker isolation, ownership guard, and merge.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-check-'));
const repoRoot = path.join(sandbox, 'repo');
fs.mkdirSync(path.join(repoRoot, 'ui.apps', 'components', 'hero'), { recursive: true });
fs.mkdirSync(path.join(repoRoot, 'ui.apps', 'components', 'footer'), { recursive: true });
fs.mkdirSync(path.join(repoRoot, 'node_modules', 'junk'), { recursive: true });
fs.writeFileSync(path.join(repoRoot, 'ui.apps', 'components', 'hero', 'hero.html'), 'original');
fs.writeFileSync(path.join(repoRoot, 'ui.apps', 'components', 'footer', 'footer.html'), 'original');
fs.writeFileSync(path.join(repoRoot, 'node_modules', 'junk', 'big.bin'), 'x'.repeat(1000));

const owned = ['ui.apps/components/hero'];
const workspace = createWorkspace(repoRoot, path.join(sandbox, 'w-hero'));
workspace.id = 'hero';
expect(!fs.existsSync(path.join(workspace.root, 'node_modules')), 'node_modules must not be copied into a worker');

fs.writeFileSync(path.join(workspace.root, 'ui.apps', 'components', 'hero', 'hero.html'), 'updated');
fs.writeFileSync(path.join(workspace.root, 'ui.apps', 'components', 'hero', 'hero.css'), 'new');
let changes = collectChanges(workspace, owned);
expect(changes.valid, `in-scope changes should be accepted, violations: ${changes.violations.join(', ')}`);
expect(changes.modified.includes('ui.apps/components/hero/hero.html'), 'modified file should be detected');
expect(changes.added.includes('ui.apps/components/hero/hero.css'), 'added file should be detected');

const claimed = new Map();
const merge = mergeChanges(workspace, repoRoot, changes, claimed);
expect(merge.conflicts.length === 0 && merge.applied.length === 2, 'clean merge should apply both files');
expect(fs.readFileSync(path.join(repoRoot, 'ui.apps', 'components', 'hero', 'hero.html'), 'utf8') === 'updated',
  'merge should write through to the shared tree');

// A worker writing outside its scope is rejected, including deletions.
const rogue = createWorkspace(repoRoot, path.join(sandbox, 'w-rogue'));
rogue.id = 'rogue';
fs.writeFileSync(path.join(rogue.root, 'ui.apps', 'components', 'footer', 'footer.html'), 'hijacked');
changes = collectChanges(rogue, owned);
expect(!changes.valid && changes.violations.includes('ui.apps/components/footer/footer.html'),
  'out-of-scope writes must be reported as violations');

const deleter = createWorkspace(repoRoot, path.join(sandbox, 'w-del'));
deleter.id = 'deleter';
fs.rmSync(path.join(deleter.root, 'ui.apps', 'components', 'footer', 'footer.html'));
changes = collectChanges(deleter, owned);
expect(!changes.valid && changes.violations.includes('ui.apps/components/footer/footer.html'),
  'deleting an unowned file must be a violation');

// Two workers touching the same file must conflict rather than silently overwrite.
const second = createWorkspace(repoRoot, path.join(sandbox, 'w-second'));
second.id = 'second';
fs.writeFileSync(path.join(second.root, 'ui.apps', 'components', 'hero', 'hero.html'), 'other');
const secondChanges = collectChanges(second, owned);
const secondMerge = mergeChanges(second, repoRoot, secondChanges, claimed);
expect(secondMerge.conflicts.length === 1 && secondMerge.applied.length === 0,
  'a second writer to the same path must be refused');

expect(snapshotTree(repoRoot).has('ui.apps/components/hero/hero.css'), 'snapshot should see merged files');

// Large binary trees a worker can never own are not duplicated into its checkout.
const damRelative = 'ui.content/src/main/content/jcr_root/content/dam/project';
fs.mkdirSync(path.join(repoRoot, damRelative, 'video.mp4', '_jcr_content', 'renditions'), { recursive: true });
fs.writeFileSync(path.join(repoRoot, damRelative, 'video.mp4', '_jcr_content', 'renditions', 'original'), Buffer.alloc(64 * 1024, 1));
fs.writeFileSync(path.join(repoRoot, 'ui.apps', 'components', 'hero', 'large-owned.txt'), Buffer.alloc(6 * 1024 * 1024, 1));

const lean = createWorkspace(repoRoot, path.join(sandbox, 'w-lean'));
lean.id = 'lean';
expect(!fs.existsSync(path.join(lean.root, damRelative)), 'the DAM tree must not be copied into a worker');
// Size must never decide: an owned file stays owned however large it is.
expect(fs.existsSync(path.join(lean.root, 'ui.apps', 'components', 'hero', 'large-owned.txt')),
  'a large file inside the worker scope must still be copied');
expect(collectChanges(lean, owned).changed.length === 0,
  'excluded files must not appear as phantom deletions in the diff');

// Projects with a different layout can supply their own exclusions, and opt into a size cap.
const custom = createWorkspace(repoRoot, path.join(sandbox, 'w-custom'), {
  excludePatterns: [/(^|\/)ui\.apps\//],
});
custom.id = 'custom';
expect(!fs.existsSync(path.join(custom.root, 'ui.apps')), 'configured exclude patterns must apply');
expect(fs.existsSync(path.join(custom.root, damRelative)),
  'replacing the default patterns must include previously skipped trees');

const capped = createWorkspace(repoRoot, path.join(sandbox, 'w-capped'), { maxFileBytes: 1024 });
capped.id = 'capped';
expect(!fs.existsSync(path.join(capped.root, 'ui.apps', 'components', 'hero', 'large-owned.txt')),
  'an explicitly configured size cap must apply');
expect(collectChanges(capped, owned).changed.length === 0,
  'a configured cap must not create phantom deletions either');

// A component that owns Java sources must be given somewhere to write its unit test.
const javaNoTest = basePlan();
javaNoTest.components[0].owned_paths = [
  'ui.apps/src/main/content/jcr_root/apps/demo/components/customer-story-hero',
  'core/src/main/java/com/demo/core/models/CustomerStoryHeroModel.java',
];
result = validatePlan(javaNoTest, { discovery, runId: 'r1' });
expect(hasError(result, 'nowhere to write the unit test'),
  'Java sources without a test path must be rejected');

const javaWithTest = basePlan();
javaWithTest.components[0].owned_paths = [
  'ui.apps/src/main/content/jcr_root/apps/demo/components/customer-story-hero',
  'core/src/main/java/com/demo/core/models/CustomerStoryHeroModel.java',
  'core/src/test/java/com/demo/core/models/CustomerStoryHeroModelTest.java',
];
result = validatePlan(javaWithTest, { discovery, runId: 'r1' });
expect(result.valid, `a component owning its test path must be accepted: ${result.errors.join('; ')}`);

// Two components sharing one test class is the collision this rule exists to avoid.
const sharedTest = basePlan();
sharedTest.components[0].owned_paths = [
  'ui.apps/src/main/content/jcr_root/apps/demo/components/customer-story-hero',
  'core/src/main/java/com/demo/core/models/CustomerStoryHeroModel.java',
  'core/src/test/java/com/demo/core/models/StoryModelsTest.java',
];
sharedTest.components[1].owned_paths = [
  'ui.apps/src/main/content/jcr_root/apps/demo/components/site-header',
  'core/src/main/java/com/demo/core/models/SiteHeaderModel.java',
  'core/src/test/java/com/demo/core/models/StoryModelsTest.java',
];
result = validatePlan(sharedTest, { discovery, runId: 'r1' });
expect(hasError(result, 'both own'), 'two components claiming one test class must be rejected');

// Components with no Java at all are unaffected.
result = validatePlan(basePlan(), { discovery, runId: 'r1' });
expect(result.valid, 'a plan without Java ownership must remain valid');

if (failures.length) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  console.log(`\n${failures.length} assertion(s) failed.`);
  process.exitCode = 1;
} else {
  console.log('plan + workspace assertions: all passed');
}
fs.rmSync(sandbox, { recursive: true, force: true });
