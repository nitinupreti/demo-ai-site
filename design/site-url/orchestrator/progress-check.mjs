import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { detectComponent, formatDuration } from './console.mjs';
import { applyProgress, createRunState, markRunStarted, readRunState, summarize, touchComponent } from './state.mjs';

const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

expect(detectComponent('create: ui.apps/.../components/story-cta-band/story-cta-band.html') === 'story-cta-band',
  'component id should be detected from an apps component path');
expect(detectComponent('edit: ui.frontend/src/main/webpack/components/_site-header.scss') === 'site-header',
  'component id should be detected from a partial SCSS name');
expect(detectComponent('create: core/src/main/java/com/demo/core/models/story/TestimonialQuoteModel.java') === 'testimonial-quote',
  'component id should be derived from a Sling Model class name');
expect(detectComponent('powershell: mvn -pl core clean test') === null,
  'unrelated commands should not invent a component');
expect(formatDuration(95) === '01:35' && formatDuration(3725) === '1:02:05',
  'durations should format as mm:ss and h:mm:ss');

// Genericity: ids from the accepted plan win, whatever a project calls its components.
const planIds = ['global-masthead', 'zzz-arbitrary-block', 'promo'];
expect(detectComponent('edit: ui.apps/.../apps/anyproject/components/global-masthead/masthead.html', planIds) === 'global-masthead',
  'a plan id should be detected regardless of naming convention');
expect(detectComponent('create: core/src/main/java/com/acme/models/ZzzArbitraryBlockModel.java', planIds) === 'zzz-arbitrary-block',
  'a plan id should win over the class-name heuristic');
expect(detectComponent('edit: ui.frontend/src/main/webpack/components/_promo.scss', planIds) === 'promo',
  'single-word plan ids should be detected');
expect(detectComponent('edit: content/experience-fragments/acme/de/de/site/masthead/master/.content.xml') === 'masthead',
  'any experience fragment should resolve to its own variation folder, not a fixed name');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'component-progress-'));
const statePath = path.join(dir, 'run-state.json');
createRunState(statePath, {
  runId: 'r1',
  launcher: { name: 'test', version: '2.1.0' },
  inputs: { SITE_URL: 'https://example.com', BREAKPOINTS: [1440], EVIDENCE_DIR: 'x' },
  stageIds: ['02-component-authoring'],
});
markRunStarted(statePath);
applyProgress(statePath, { stage: '02-component-authoring', status: 'STARTED' });
applyProgress(statePath, { stage: '02-component-authoring', component: 'site-header', status: 'STARTED', message: 'building' });
touchComponent(statePath, 'site-header', '02-component-authoring');
touchComponent(statePath, 'site-header', '02-component-authoring');
applyProgress(statePath, { stage: '02-component-authoring', component: 'site-header', status: 'PASS' });
touchComponent(statePath, 'story-cta-band', '02-component-authoring');

const state = readRunState(statePath);
const header = state.components.find((entry) => entry.id === 'site-header');
const band = state.components.find((entry) => entry.id === 'story-cta-band');
expect(header?.status === 'PASS', `declared component should reach PASS, got ${header?.status}`);
expect(header?.activity === 2, `observed activity should be counted, got ${header?.activity}`);
expect(typeof header?.duration_seconds === 'number', 'component duration should be stamped by the launcher');
expect(band?.status === 'STARTED', 'a component seen only through file activity should still be tracked');
expect(summarize(state).components.length === 2, 'summary should list every tracked component');

if (failures.length) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  process.exitCode = 1;
} else {
  console.log('component progress assertions: all passed');
}
