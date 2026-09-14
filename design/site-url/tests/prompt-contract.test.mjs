import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// Offline structural regression checks, NOT proof that an LLM executed a migration.
const root = fileURLToPath(new URL('../', import.meta.url));
const stages = [
  '01-source-discovery',
  '02-component-authoring',
  '03-assets-runtime',
  '04-visual-parity',
  '05-completion-output',
];
const runtimeFiles = [
  'prompt_new.md',
  ...stages.map((stage) => `${stage}.md`),
  'references/capture-gates.md',
  'references/project-facts.md',
  'references/skill-routing.md',
];
const documents = Object.fromEntries(runtimeFiles.map((file) => [
  file, fs.readFileSync(path.join(root, file), 'utf8'),
]));
const router = documents['prompt_new.md'];
const capture = documents['references/capture-gates.md'];
const parity = documents['04-visual-parity.md'];
const words = (text) => (text.match(/\S+/g) || []).length;
const metrics = (files) => files.reduce((total, file) => ({
  words: total.words + words(documents[file]),
  bytes: total.bytes + Buffer.byteLength(documents[file], 'utf8'),
}), { words: 0, bytes: 0 });

function assertMarkers(text, markers) {
  for (const marker of markers) assert.ok(text.includes(marker), `Missing contract marker: ${marker}`);
}

function localMarkdownTargets(text) {
  return [...text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)]
    .map((match) => match[1].split('#')[0])
    .filter((target) => !/^[a-z]+:/i.test(target));
}

function assertCanonicalContract(text) {
  assert.match(text, /^required_breakpoints: \[375, 768, 1440\]/m);
  assert.match(text, /^visual_pass_ratio: "> 0\.90"/m);
  assert.match(text, /^geometry_tolerance_css_px: 1\b/m);
  assert.match(text, /^max_attempts_per_component: 4$/m);
  assert.match(text, /^round_1_attempts: 3$/m);
  assert.match(text, /^round_2_attempts: 1$/m);
  assert.match(text, /completion_requires: \[stage_01_pass, stage_02_pass, stage_03_pass, stage_04_pass, no_residual_gaps\]/);
}

const exhaustiveExecutionMarkers = [
  'Run all five stages exhaustively without asking whether to continue',
  'prioritize required work, or approve the full scope',
  'Discovery, component development, DAM assets, deployment, and visual validation are already authorized',
  'Required safety/credential/cost approvals still apply',
  'Missing components or clientlib-only stubs require implementation, not deferral',
  'never replace required media, layouts, or interactions with text-only approximations',
  'Workload, elapsed time, and session/context limits never justify reduced scope',
  'Persist checkpoints and resume the same run after interruption',
  'never reset retries or declare completion prematurely',
  'Stop only for an explicit user pause/cancel, an evidenced external blocker requiring user action, or exhausted canonical retries',
  'Ask only for the specific unblocker, never scope consent; follow FAIL/BLOCKED routing',
  'never authorize silently substituting a smaller scope',
  'must not self-authorize reduced scope under any framing',
  'halt and disclose the specific blocker BEFORE proceeding',
  'never as an after-the-fact footnote in a completion report',
  'A shortcut disclosed only after delivery is a contract violation, not transparency',
  'Skipping any stage means the run is FAIL or BLOCKED, never a partial success',
  'Completion is machine-verified, not self-asserted',
  'node design/site-url/verify-run.mjs <EVIDENCE_DIR>',
  'exit code 0 is REQUIRED before any COMPLETE claim',
  'Never edit the verifier, its tests, or `run-state.json` to make the gate pass',
];

function assertExhaustiveExecution(text) {
  const execution = text.split(/## Mandatory Full-Pipeline Execution\r?\n/)[1]?.split(/\r?\n## /)[0];
  assert.ok(execution, 'Missing mandatory full-pipeline execution section');
  assertMarkers(execution, exhaustiveExecutionMarkers);
}

test('router preserves canonical thresholds and ordered stage entrypoints', () => {
  assertCanonicalContract(router);
  const routedStages = localMarkdownTargets(router).filter((file) => /^0[1-5]-/.test(file));
  assert.deepEqual(routedStages, stages.map((stage) => `${stage}.md`));
  assertMarkers(router, ['Context Loading', 'After compaction', 'stage_results[stage]', 'result_id:', 'Stage 5 alone']);
});

test('full pipeline is authorized without optional-scope consent or partial completion', () => {
  assertExhaustiveExecution(router);
  assertMarkers(documents['02-component-authoring.md'], [
    'Missing implementations require development, not consent',
    'Never solicit block removal to avoid development',
  ]);
  assertMarkers(documents['05-completion-output.md'], [
    'Never label partial delivery "migration complete", even with disclosed gaps',
    'Record start/end/elapsed timing',
    'incomplete runs have stop times, not successful completion times',
    'zero exit from `node design/site-url/verify-run.mjs <EVIDENCE_DIR>`',
    'Non-zero exit forces FAIL/BLOCKED',
  ]);
});

test('the deterministic completion gate exists and is executable', () => {
  const verifier = path.join(root, 'verify-run.mjs');
  assert.ok(fs.existsSync(verifier), 'verify-run.mjs must exist: prose alone cannot enforce completion');
  const result = spawnSync(process.execPath, ['--check', verifier], { encoding: 'utf8', timeout: 10000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});

test('the gate and the stage prompts require exactly the same outputs and checks', async () => {
  const gate = await import('../verify-run.mjs');
  assert.deepEqual(gate.STAGES, stages);
  for (const stage of stages) {
    const text = documents[`${stage}.md`];
    for (const name of [...gate.REQUIRED_OUTPUTS[stage], ...gate.REQUIRED_CHECKS[stage]]) {
      assert.ok(text.includes(name), `${stage}.md does not declare "${name}" that the gate enforces`);
    }
  }
});

test('removing mandatory execution safeguards is rejected', () => {
  assertExhaustiveExecution(router);
  for (const marker of exhaustiveExecutionMarkers) {
    assert.throws(() => assertExhaustiveExecution(router.replace(marker, '')), undefined, marker);
  }
});

test('mandatory execution validation accepts LF and CRLF documents', () => {
  const lf = router.replaceAll('\r\n', '\n');
  assertExhaustiveExecution(lf);
  assertExhaustiveExecution(lf.replaceAll('\n', '\r\n'));
});

test('threshold mutations are rejected rather than silently weakening gates', () => {
  for (const [before, after] of [
    ['visual_pass_ratio: "> 0.90"', 'visual_pass_ratio: ">= 0.90"'],
    ['geometry_tolerance_css_px: 1', 'geometry_tolerance_css_px: 8'],
    ['max_attempts_per_component: 4', 'max_attempts_per_component: 5'],
    ['round_2_attempts: 1', 'round_2_attempts: 2'],
  ]) assert.throws(() => assertCanonicalContract(router.replace(before, after)));
});

test('runtime and maintainer links resolve without recursively loading skills', () => {
  const linkedDocuments = { ...documents, 'README.md': fs.readFileSync(path.join(root, 'README.md'), 'utf8') };
  for (const [file, text] of Object.entries(linkedDocuments)) {
    assert.equal((text.match(/^```/gm) || []).length % 2, 0, `${file}: unclosed fence`);
    for (const target of localMarkdownTargets(text)) {
      assert.ok(fs.existsSync(path.resolve(root, path.dirname(file), target)), `${file}: broken ${target}`);
      if (file !== 'README.md') {
        assert.ok(!target.endsWith('README.md'), `${file}: maintainer guide must not enter runtime loading`);
      }
    }
  }
});

test('result schema has one owner and each stage names all required outputs/checks', () => {
  assert.equal(Object.values(documents).join('\n').match(/^stage_result:$/gm)?.length, 1);
  const required = [
    ['readiness_report', 'score_manifest', 'coverage_report', 'ownership_map', 'source_selector_map',
      'inventory_audit', 'dom_state_media_manifests', 'frozen_denominators', 'all_breakpoints_ready',
      'all_discovery_signals_executed', 'inventory_audit_complete', 'cross_breakpoint_visibility_recorded',
      'every_instance_has_stable_source_selector', 'exactly_once_coverage', 'no_unclaimed_gap_20px'],
    ['design_facts', 'reuse_decisions', 'component_file_matrix', 'component_coverage_matrix',
      'target_selector_map', 'authorability_matrices', 'changed_files', 'demo_content_and_policy_map',
      'every_source_block_has_decision', 'every_block_file_row_complete', 'component_coverage_complete',
      'every_instance_has_target_selector', 'every_business_value_authorable', 'focused_implementation_tests'],
    ['asset_manifest', 'test_build_deploy_results', 'code_assessment_report', 'runtime_assertion_sweep',
      'repository_reconciliation', 'clientlib_and_media_report', 'assets_reachable_and_decoded',
      'focused_tests_and_required_builds', 'code_assessment_reviewed', 'packages_and_bundles_active',
      'disabled_and_author_runtime_valid', 'target_selectors_resolve_uniquely', 'live_repository_matches_intent'],
    ['readiness_matrix', 'geometry_property_interaction_tables', 'screenshot_and_diff_index',
      'per_instance_scores', 'full_page_scores', 'component_minima_and_page_composites', 'remediation_history', 'parity_runner',
      'all_source_blocks_mapped_once', 'all_geometry_and_properties_pass', 'all_live_and_aem_screenshot_pairs_valid',
      'all_screenshot_scores_above_90', 'all_full_page_pairs_valid', 'all_full_page_scores_above_90',
      'all_interactions_and_media_pass', 'all_final_minima_and_composites_above_90'],
    ['completion_report', 'pipeline_result_index', 'all_upstream_results_present_and_pass',
      'dependencies_same_run_and_current', 'coverage_files_assets_scores_reconcile', 'residual_gaps_consistent_with_status'],
  ];
  stages.forEach((stage, index) => {
    const text = documents[`${stage}.md`];
    assertMarkers(text, [`stage: ${stage}`, '**outputs:**', '**checks:**', '**next_stage:**', ...required[index]]);
  });
});

test('discovery retains eleven signals, full inventory, runtime widths, and frozen weights', () => {
  const text = documents['01-source-discovery.md'];
  const signals = text.split('## Exhaustive Block Discovery')[1].split('## No-Omission')[0];
  assert.deepEqual([...signals.matchAll(/^(\d+)\. /gm)].map((match) => Number(match[1])),
    Array.from({ length: 11 }, (_, index) => index + 1));
  const catalog = [
    'skip link', 'announcement / promo bar', 'ticker', 'sticky top nav', 'mega-menu overlay',
    'secondary utility bar', 'breadcrumb', 'search overlay', 'region/language selector',
    'primary hero', 'secondary hero', 'headless media band', 'background-video strip', 'animated background canvas',
    'intro / lead paragraph', 'two-column text section', 'feature grid', 'stat strip', 'quote / pull-quote',
    'media-with-caption', 'carousel / slider', 'tabs', 'accordion', 'comparison table', 'pricing grid', 'FAQ',
    'timeline', 'roadmap', 'logo strip / brand reel', 'customer story teaser', 'testimonial marquee',
    'review stars', 'awards / badges', 'inline CTA button strip', 'CTA band', 'newsletter signup',
    'contact / demo form', 'download panel', 'calendly / chili-piper widget', 'related articles',
    'related case studies', 'product carousel', '"also on this site" grid', 'pre-footer CTA',
    'footer quote/tagline', 'footer nav grid', 'secondary links row', 'copyright bar', 'social icons row',
    'legal links strip', 'cookie consent', 'GDPR banner', 'chat widget', 'back-to-top', 'floating CTA',
    'notification toast', 'video-lightbox trigger', 'gated-content modal', 'geo/redirect prompt',
    'mobile-only bottom nav', 'mobile CTA sticky bar', 'mobile mega-menu drawer', 'tablet-only sidebar',
  ];
  assertMarkers(text, [...catalog, 'zero visible/non-empty matches', 'replacement `BREAKPOINTS`',
    '[0, document.documentElement.scrollHeight]', '20 CSS px']);
  const weights = [...text.matchAll(/^- (?:Content|Typography|Color|Layout|Section order|Media\/interaction) (\d+)%:/gm)]
    .map((match) => Number(match[1]));
  assert.deepEqual(weights, [25, 25, 20, 15, 10, 5]);
  assert.equal(weights.reduce((sum, value) => sum + value, 0), 100);
});

test('capture contract preserves decoded video, playback, exact typography, and layout evidence', () => {
  assertMarkers(capture, [
    'requestVideoFrameCallback', 'requestAnimationFrame', 'loadedmetadata', 'loadeddata', 'canplay',
    'readyState >= 2', 'videoWidth > 0', 'videoHeight > 0', '0.01s', 'seeked', '0.5s',
    'paused === false', 'three times at least 500 ms', 'currentSrc', 'networkState', 'SHA-256',
    'pre-decode rectangle', 'post-decode samples', 'Hidden-tab', 'behavioral check unresolved',
    'SCORE WITHHELD — VIDEO NOT DECODED OR GEOMETRY UNSTABLE', 'media-with-caption',
    'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'word-spacing',
    'font-style', 'font-kerning', 'font-feature-settings', 'font-variation-settings', 'font-synthesis',
    'text-rendering', 'text-wrap', '-webkit-font-smoothing', 'text transform', 'color',
    'document.fonts.check', 'line-by-line', 'viewBox', 'Unicode glyphs', 'geometry_tolerance_css_px',
    'documentElement.clientWidth', 'scrollWidth', 'inter-component vertical gaps',
  ]);
});

test('authoring and runtime retain skill handoffs, exact colors, and scoped validation', () => {
  assertMarkers(documents['02-component-authoring.md'], [
    'EVERY Tier 2/3/4', 'component_coverage_matrix', 'instance_authoring_map', 'dialog_values',
    'ColorHex', 'other', '#RGB', '#RRGGBB', '#RRGGBBAA', 'styleToken', 'round trip',
    'Core Image', 'request-adaptable/exporter', '80%', 'data-sly-list', 'data-sly-repeat',
  ]);
  assertMarkers(documents['03-assets-runtime.md'], [
    'code-assessment', 'FileVault', '-PautoInstallBundle', '-PautoInstallPackage',
    '-Daem.port=<PORT>', '-Daem.host=<HOST>', 'No routine `mvn clean`',
    '_jcr_content.json', 'Sling POST', 'withhold visual scores',
  ]);
  assertMarkers(documents['references/skill-routing.md'], [
    'mandatory references', 'only when that feature/input/problem exists', 'approval', 'one-pattern-per-session',
    'local-only analyzer', 'report-first', 'never discard user work',
  ]);
});

test('parity and completion retain evidence withholding and bounded persisted remediation', () => {
  assertMarkers(parity, [
    'locator.screenshot()', 'pixelmatch', 'pngjs', 'sharp', 'SHA-256', 'dependency lockfile',
    'IDENTICAL pixel dimensions', 'Never resize, stretch, or pad', 'omit ALL numeric scores',
    'matchedPixels / totalPixels', 'source/target', 'side-by-side', 'diff mask',
    'BATCH_STARTED', 'BATCH_FINISHED', 'FAILED-ROUND-1', 'FAILED-FINAL', 'No Round 3',
    'Counters never reset', 'before attempt 3', 'regression-only', 'BOTH target modes',
    '`05-completion-output` for every terminal status',
  ]);
  assertMarkers(documents['05-completion-output.md'], [
    'COMPLETE requires', 'residual_gaps: []', 'omit', 'owning-layer trace', 'four attempts',
    'pipeline_results.process_status', 'PASSED', 'FAILED', 'BLOCKED',
  ]);
  const all = Object.values(documents).join('\n');
  assert.doesNotMatch(all, /height within 8 CSS px|mvn -pl core clean test|caps Content at 80/);
});

test('launcher syntax, fallback parsing, and help work offline without starting an agent', () => {
  const launcher = path.join(root, 'run-migration.mjs');
  for (const args of [['--check', launcher], [launcher, '--print-defaults'], [launcher, '--help']]) {
    const result = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 10000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    if (args.includes('--print-defaults')) {
      const url = router.match(/^SITE_URL: "([^"]+)"/m)?.[1];
      assert.ok(url);
      assert.match(result.stdout, /AEM_PORT=4502/);
      assert.ok(result.stdout.includes(`SITE_URL=${new URL(url).toString()}`));
    }
  }
  assertMarkers(fs.readFileSync(launcher, 'utf8'), ['Context Loading policy', 'never concatenate all prompts or skill trees']);
});

test('full-page pixels are an independent final gate for every mode and reasoning effort', () => {
  assertMarkers(router, [
    'Acceptance is model/effort-independent', '`low`, `medium`, `high`, or `xhigh`',
    'model-managed reasoning is also allowed', 'All choices use identical gates',
  ]);
  assertMarkers(parity, [
    'page.screenshot({ fullPage: true })', 'pixelmatch options', 'MODEL', 'THINKING_EFFORT',
    'Independent Full-Page Gate', 'EVERY breakpoint in BOTH modes', 'actual content-frame URL',
    'ALL page pixels', 'No component-average substitute', 'Unequal page heights withhold',
    'full-<bp>-side-by-side.png', 'full-<bp>-mask.png', 'full_page_scores',
    'fullPageVisualMatchRatio', 'strictly `> 0.90`', 'A new deployment invalidates',
    'never reset retries', 'all_full_page_pairs_valid', 'all_full_page_scores_above_90',
  ]);
  assertMarkers(documents['05-completion-output.md'], [
    'independent `full_page_scores`', 'minimum full-page pixel match', 'never as proof of parity',
  ]);
});

test('failure-only handoff reduces model input without skipping comparisons or scoring derivatives', () => {
  assertMarkers(parity, [
    'Failure-Only LLM Handoff', 'Run ALL required comparisons locally',
    'runner computes scores, never the LLM', 'Tool stdout returns compact JSON',
    'active-batch failure rows', 'valid ratio or withheld reason', 'retries remaining',
    'failing, withheld, or regressed', 'Passing images stay on disk',
    'validation uncertainty', 'Do not dump entire DOMs', 'diagnostic-only reduced overview',
    'original coordinates', 'NEVER score these derivatives', 'unchanged native originals',
    'filters LLM input, not coverage or acceptance',
  ]);
});

test('runtime prompt size is reported for maintainers, never enforced as a cap', () => {
  const total = metrics(runtimeFiles);
  // Size is observability only: contract rules must never be trimmed to satisfy a word budget.
  const baseline = { words: 9578, bytes: 73030, routerWords: 2523, routerBytes: 18829 };
  const stageLoads = Object.fromEntries(stages.map((stage, index) => {
    const files = ['prompt_new.md', `${stage}.md`];
    if ([0, 2, 3].includes(index)) files.push('references/capture-gates.md');
    if ([1, 2].includes(index)) files.push('references/project-facts.md', 'references/skill-routing.md');
    return [stage, metrics(files)];
  }));
  console.log(JSON.stringify({
    baseline,
    current: total,
    router: metrics(['prompt_new.md']),
    wordReductionPercent: Number((100 * (1 - total.words / baseline.words)).toFixed(2)),
    byteReductionPercent: Number((100 * (1 - total.bytes / baseline.bytes)).toFixed(2)),
    stageLoadsExcludingSkillsEvidenceAndHistory: stageLoads,
  }, null, 2));
});