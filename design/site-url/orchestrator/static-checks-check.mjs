/** Static check assertions: token extraction, undeclared var() references and clientlib url() resolution. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import {
  cssUrls, extractTokens, readTokenManifest, staticRejection, stripComments, tokenManifest,
  undeclaredVars, unresolvedUrls, varReferences, declaredVocabulary,
} from './static-checks.mjs';

const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

const tokensScss = `
// A comment with a url("http://x/y") and a --fake: 1; that is not a token
@use 'sass:math';
$legacy: 4px;
:root {
  --color-text: #131313; /* block --also-fake: 2; */
  --space-2: #{$legacy * 2};
  --font-family-sans: "DM Sans", sans-serif;
  --img: url("//cdn.test/a.png");
}
@media (min-width: 768px) {
  :root { --space-2: 12px; }
}
`;

const stripped = stripComments(tokensScss);
expect(!stripped.includes('--fake') && !stripped.includes('--also-fake'), 'comments must not yield tokens');
expect(stripped.includes('url("//cdn.test/a.png")'), '`//` inside a url must survive comment stripping');
expect(stripped.split('\n').length === tokensScss.split('\n').length, 'stripping must keep line numbers');

const tokens = extractTokens(tokensScss);
expect(tokens.map((token) => token.name).sort().join(',') === '--color-text,--font-family-sans,--img,--space-2,--space-2',
  `every declaration must be extracted, got ${tokens.map((token) => token.name).join(',')}`);
const manifest = tokenManifest(tokensScss);
expect(manifest.tokens['--space-2'].value === '#{$legacy * 2}' && manifest.tokens['--space-2'].overrides[0]?.media === '(min-width: 768px)',
  `a breakpoint override must sit beside its base value, got ${JSON.stringify(manifest.tokens['--space-2'])}`);
expect(manifest.tokens['--font-family-sans'].value === '"DM Sans", sans-serif', 'values must be kept verbatim');

const references = varReferences('.a { color: var(--color-text); margin: var(--gap, 8px); padding: var( --space-unit ) }');
expect(references.map((reference) => `${reference.name}:${reference.fallback}`).join(',')
  === '--color-text:false,--gap:true,--space-unit:false', `references must note their fallbacks, got ${JSON.stringify(references)}`);

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'static-check-'));
const write = (relative, text) => {
  const absolute = path.join(sandbox, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, text);
  return relative;
};
write('ui.frontend/src/main/webpack/site/_tokens.scss', tokensScss);
write('ui.frontend/src/main/webpack/resources/fonts/face.woff2', 'font');
const componentCss = write('ui.apps/src/main/content/jcr_root/apps/demo/clientlibs/clientlib-components/css/card.css', `
.cmp-card { color: var(--color-text); padding: var(--space-unit); --cmp-card-gap: 4px; gap: var(--cmp-card-gap); }
.cmp-card__icon { background: url("../resources/icon.svg"); }
.cmp-card__logo { background: url('/content/dam/demo/logo.svg'); }
`);
const componentJava = write('core/src/main/java/demo/CardModel.java',
  'class CardModel { String style() { return "background: var(--color-surface);" + " --cmp-card-accent: red"; } }');

const declared = declaredVocabulary(sandbox, [componentCss, componentJava]);
expect(declared.has('--color-text') && declared.has('--cmp-card-gap'), 'tokens and a component\'s own properties are declared');
const undeclared = undeclaredVars({ root: sandbox, files: [componentCss, componentJava], declared });
expect(undeclared.map((problem) => problem.name).sort().join(',') === '--color-surface,--space-unit',
  `only properties nothing declares may be reported, got ${JSON.stringify(undeclared)}`);
expect(undeclared.find((problem) => problem.name === '--space-unit')?.line === 2, 'the line of the reference must be reported');

// The defect that left every source font on a fallback: compiled CSS lives in clientlib-site/css/.
const wrongFont = write('ui.frontend/src/main/webpack/site/_fonts.scss',
  '@font-face { font-family: "Face"; src: url("resources/fonts/face.woff2") format("woff2"); }');
let problems = unresolvedUrls({ root: sandbox, files: [wrongFont] });
expect(problems.length === 1 && problems[0].resolved === 'clientlib-site/css/resources/fonts/face.woff2'
  && problems[0].message.includes('url("../resources/fonts/face.woff2")'),
`a frontend url relative to the wrong folder must be caught with the fix named, got ${JSON.stringify(problems)}`);
write('ui.frontend/src/main/webpack/site/_fonts.scss',
  '@font-face { font-family: "Face"; src: url("../resources/fonts/face.woff2") format("woff2"); }');
expect(unresolvedUrls({ root: sandbox, files: [wrongFont] }).length === 0, 'the corrected url must resolve');

problems = unresolvedUrls({ root: sandbox, files: [componentCss] });
expect(problems.map((problem) => problem.url).sort().join(',') === '../resources/icon.svg,/content/dam/demo/logo.svg',
  `missing clientlib resources and DAM paths must be reported, got ${JSON.stringify(problems)}`);
write('ui.apps/src/main/content/jcr_root/apps/demo/clientlibs/clientlib-components/resources/icon.svg', '<svg/>');
fs.mkdirSync(path.join(sandbox, 'ui.content/src/main/content/jcr_root/content/dam/demo/logo.svg'), { recursive: true });
expect(unresolvedUrls({ root: sandbox, files: [componentCss] }).length === 0, 'existing resources must resolve');

expect(cssUrls('a{b:url(data:image/png;base64,xx)} c{d:url("https://x.test/a.png")} e{f:url(#g)}').length === 0,
  'data, absolute and fragment urls are not files to check');

const rejection = staticRejection({ root: sandbox, changedFiles: [componentCss, componentJava], ownedFiles: [componentCss] });
expect(rejection && rejection.text.includes('--space-unit') && rejection.text.includes('tokens.json'),
  `the rejection must name each undeclared property and where the vocabulary is, got ${rejection?.text}`);
expect(readTokenManifest(sandbox).count === 4, 'the manifest must read the tokens file from the tree');

fs.rmSync(sandbox, { recursive: true, force: true });

if (failures.length) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  process.exitCode = 1;
} else {
  console.log('static check assertions: all passed');
}
