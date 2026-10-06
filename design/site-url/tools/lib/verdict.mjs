/**
 * Plain-language verdict for a parity artefact: which component differs from the live site, at
 * which device width, how visually similar it is and why. Every figure is read from parity.json.
 * Visual similarity is shown the same way at every breakpoint; a row whose crop sizes differ beyond
 * the tolerance shows it but always fails on its size, and a row with nothing to compare is
 * reported with its reason, never as a percentage.
 */
import { DIMENSION_TOLERANCE, GEOMETRY_TOLERANCE } from './contracts.mjs';

// The usual CSS breakpoints: below 768px is a phone, below 1024px a tablet.
const TABLET_MIN_PX = 768;
const DESKTOP_MIN_PX = 1024;

export function deviceName(width) {
  const value = Number.parseInt(width, 10);
  if (value < TABLET_MIN_PX) return 'mobile';
  if (value < DESKTOP_MIN_PX) return 'tablet';
  return 'desktop';
}

/** Takes a width or a `<width>-<mode>` key; the width is always shown, so the name never misleads. */
export function breakpointLabel(width) {
  const value = Number.parseInt(width, 10);
  return Number.isFinite(value) ? `${deviceName(value)} ${value}px` : `breakpoint ${width}`;
}

function joinList(items) {
  if (items.length < 2) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function px(value) {
  return `${Number(Math.abs(value).toFixed(2))}px`;
}

function signedPx(value) {
  return `${Number(Number(value).toFixed(2))}px`;
}

function barText(threshold) {
  return `${Number((threshold * 100).toFixed(2))}%`;
}

/** Adds decimals until rounding no longer prints a score on the wrong side of the bar. */
function percent(ratio, threshold) {
  let digits = 2;
  let shown = (ratio * 100).toFixed(digits);
  if (typeof threshold === 'number' && ratio !== threshold) {
    const bar = threshold * 100;
    while (digits < 6 && (ratio > threshold ? Number(shown) <= bar : Number(shown) >= bar)) {
      digits += 1;
      shown = (ratio * 100).toFixed(digits);
    }
  }
  return `${shown}%`;
}

function quote(selector) {
  const text = String(selector || '').trim();
  if (!text) return 'its selector';
  return `\`${text.length > 60 ? `${text.slice(0, 57)}...` : text}\``;
}

/** parity.mjs calls the two sides source and target; a reader knows them as the live site and AEM. */
function plainReason(reason) {
  return String(reason || '')
    .split('; ')
    .map((part) => part
      .replace(/^environment: /, '')
      .replace(/^the target page\b/, 'the AEM page')
      .replace(/^the target navigated\b/, 'the AEM page navigated')
      .replace(/^target\b/, 'AEM')
      .replace(/^source\b/, 'live site')
      .replace(/: source (\S+), target (\S+)$/, ': live site $1, AEM $2'))
    .join('; ');
}

const isEnvironmentRow = (row) => row.status === 'WITHHELD' && row.owning_layer_hint === 'environment';
const isFontsPendingRow = (row) => row.status === 'WITHHELD'
  && /^target fonts never finished loading/.test(row.withheld_reason || '');
const isSizeMismatch = (row) => row.visual_status === 'WITHHELD' && Boolean(row.deltas?.dimension_mismatch);

/**
 * The union pixel measure parity.mjs takes for every crop pair. Where the sizes differ beyond the
 * tolerance it is stored as `progress_ratio`, and that row fails on its size whatever this value is.
 */
export function similarityOf(row) {
  if (Number.isFinite(row?.visual_match_ratio)) return row.visual_match_ratio;
  return Number.isFinite(row?.progress_ratio) ? row.progress_ratio : null;
}

/** Mirrors parity.mjs: the absolute floor or the proportional share, whichever is more forgiving. */
function boxDifference(delta, source, tolerances) {
  const allowed = (extent, floor) => Math.max(floor, Math.abs(extent) * tolerances.ratio);
  const changes = [];
  const limits = [];
  const widthAllowed = allowed(source.w, tolerances.px.width);
  const heightAllowed = allowed(source.h, tolerances.px.height);
  if (Math.abs(delta.w) > widthAllowed) {
    changes.push(`${px(delta.w)} ${delta.w > 0 ? 'wider' : 'narrower'}`);
    limits.push(px(widthAllowed));
  }
  if (Math.abs(delta.h) > heightAllowed) {
    changes.push(`${px(delta.h)} ${delta.h > 0 ? 'taller' : 'shorter'}`);
    limits.push(px(heightAllowed));
  }
  const parts = [];
  if (changes.length) parts.push(`its box is ${joinList(changes)} than on the live site (tolerance ${joinList(limits)})`);
  const xAllowed = allowed(source.w, tolerances.px.x);
  if (typeof delta.x === 'number' && Math.abs(delta.x) > xAllowed) {
    parts.push(`it sits ${px(delta.x)} further ${delta.x > 0 ? 'right' : 'left'} than on the live site (tolerance ${px(xAllowed)})`);
  }
  return parts;
}

function geometryProblem(row, tolerances) {
  const delta = row.deltas?.rect;
  const source = row.source?.rect;
  if (!delta || !source) return 'its box size or position differs from the live site beyond tolerance';
  return boxDifference(delta, source, tolerances).join('; ')
    || `its box differs from the live site (x ${signedPx(delta.x)}, width ${signedPx(delta.w)}, height ${signedPx(delta.h)})`;
}

function sizeProblem(row, tolerances) {
  const { source, target } = row.deltas.dimension_mismatch;
  if (!source || !target) return 'its box size differs from the live site beyond tolerance';
  return boxDifference({ w: target.w - source.w, h: target.h - source.h }, source, tolerances).join('; ')
    || `its box is ${target.w}x${target.h}px on AEM but ${source.w}x${source.h}px on the live site`;
}

function fontProblem(row) {
  const entry = row.deltas?.rendered_fonts?.[0];
  if (!entry) return 'its rendered fonts differ from the live site';
  const names = (list) => (list?.length ? list.join(', ') : 'none');
  return `its fonts differ (live site: ${names(entry.source)}; AEM: ${names(entry.target)})`;
}

function playbackProblem(row) {
  const deltas = row.deltas?.playback || [];
  const count = deltas.find((delta) => delta.property === 'video_count');
  if (count) return `it has ${count.source} video(s) on the live site but ${count.target} on AEM`;
  if (!deltas.length) return 'its video behaves differently from the live site';
  const shown = deltas.slice(0, 3).map((delta) => `${delta.property}: live site ${delta.source}, AEM ${delta.target}`);
  return `its video behaves differently (${shown.join('; ')}${deltas.length > 3 ? `; ${deltas.length - 3} more` : ''})`;
}

function notScored(row) {
  const reason = row.withheld_reason || '';
  if (!reason) return 'parity.json records neither a score nor a reason';
  const missing = [];
  if (/(^|; )target selector matched 0 elements/.test(reason)) {
    missing.push(`missing on the AEM page (${quote(row.target?.selector)} matched nothing)`);
  }
  if (/(^|; )source selector matched 0 elements/.test(reason)) {
    missing.push(`missing on the live site (${quote(row.source?.selector)} matched nothing)`);
  }
  if (missing.length) return missing.join('; ');
  const signature = reason.match(/signature mismatch \(expected "(.*)"\)/);
  if (signature) {
    return `the AEM element at ${quote(row.target?.selector)} shows different text from the live one (expected "${signature[1]}")`;
  }
  const text = plainReason(reason);
  return row.owning_layer_hint === 'source-capture' ? `${text}; a live-site problem no AEM change can fix` : text;
}

function describeRow(row, context) {
  const { threshold, bar, tolerances } = context;
  const similarity = similarityOf(row);
  if (row.status === 'PASS') return similarity === null ? 'passes' : `passes, visual similarity ${percent(similarity, threshold)}`;
  if (similarity === null) return `not scored: ${notScored(row)}`;
  const score = `visual similarity ${percent(similarity, threshold)}`;
  const reasons = [
    isSizeMismatch(row) ? sizeProblem(row, tolerances) : null,
    !isSizeMismatch(row) && row.geometry_status === 'FAIL' ? geometryProblem(row, tolerances) : null,
    row.gates?.rendered_fonts === 'FAIL' ? fontProblem(row) : null,
    row.gates?.playback === 'FAIL' ? playbackProblem(row) : null,
  ].filter(Boolean);
  if (threshold !== null && similarity <= threshold) return [`${score}, needs more than ${bar}`, ...reasons].join('; ');
  if (reasons.length) return `${score}, but ${reasons.join('; ')}`;
  return `${score}, but parity.json marks it ${row.status} without a recorded reason`;
}

function describeComposite(entry, context) {
  const { threshold, bar } = context;
  if (!Number.isFinite(entry.ratio)) {
    return `not compared: ${plainReason(entry.withheld_reason) || 'parity.json records no page comparison'}`;
  }
  // The page ratio is taken over the overlap only, which a size difference does not enter.
  const score = `visual similarity ${percent(entry.ratio, threshold)} where both pages overlap`;
  if (entry.status === 'PASS') return `passes, ${score}`;
  const problems = [];
  if (threshold !== null && entry.ratio <= threshold) problems.push(`${score}, needs more than ${bar}`);
  if (entry.width_delta) {
    problems.push(`the AEM page is ${px(entry.width_delta)} ${entry.width_delta > 0 ? 'wider' : 'narrower'} `
      + 'than the live page (widths must be equal)');
  }
  if (entry.height_delta) {
    const allowance = typeof entry.height_allowance_px === 'number' ? entry.height_allowance_px : null;
    if (allowance === null || Math.abs(entry.height_delta) > allowance) {
      problems.push(`the AEM page is ${px(entry.height_delta)} ${entry.height_delta > 0 ? 'taller' : 'shorter'} `
        + `than the live page${allowance === null ? '' : ` (tolerance ${px(allowance)})`}`);
    }
  }
  const gaps = (entry.inter_component_gaps || []).filter((gap) => gap.status === 'FAIL');
  for (const gap of gaps.slice(0, 3)) {
    problems.push(`the space between ${gap.after} and ${gap.before} is ${signedPx(gap.target_gap)} on AEM `
      + `but ${signedPx(gap.source_gap)} on the live site`
      + `${typeof entry.gap_tolerance_px === 'number' ? ` (tolerance ${px(entry.gap_tolerance_px)})` : ''}`);
  }
  if (gaps.length > 3) problems.push(`${gaps.length - 3} more gap(s) between components differ`);
  if (!problems.length) problems.push('fails without a reason parity.json records');
  if (threshold === null || entry.ratio > threshold) problems.push(score);
  return problems.join('; ');
}

const byWidth = (left, right) => Number.parseInt(left, 10) - Number.parseInt(right, 10);

/**
 * Returns `{ status, headline, summary, lines, lowest, page }`. `headline` is one line, `summary` is
 * the same without its prefix, `lines` hold the per-component and per-breakpoint details (empty on
 * a pass) and `page` says where the page as a whole fails, or is null.
 */
export function explainParity(parity) {
  const results = (Array.isArray(parity?.results) ? parity.results : []).filter((row) => row && row.component_id);
  const threshold = Number.isFinite(parity?.threshold) ? parity.threshold : null;
  const context = {
    threshold,
    bar: threshold === null ? null : barText(threshold),
    tolerances: {
      ratio: parity?.tolerances?.dimension_ratio ?? DIMENSION_TOLERANCE,
      px: { ...GEOMETRY_TOLERANCE, ...(parity?.tolerances?.geometry_px || {}) },
    },
  };
  const composites = Object.entries(parity?.page_composite || {})
    .filter(([, entry]) => entry && typeof entry === 'object')
    .sort(([left], [right]) => byWidth(left, right));
  const modes = new Set([
    ...results.map((row) => row.mode),
    ...composites.map(([key]) => key.slice(key.indexOf('-') + 1)),
  ].filter(Boolean));
  const label = (breakpoint, mode) => `${breakpointLabel(breakpoint)}${modes.size > 1 && mode ? ` ${mode}` : ''}`;

  // Problems that stopped every row at a breakpoint belong to the page, not to each component.
  const capture = new Map();
  const captureAt = (breakpoint, mode) => {
    const key = `${breakpoint}-${mode}`;
    if (!capture.has(key)) capture.set(key, { key, label: label(breakpoint, mode), environment: false, reasons: new Set() });
    return capture.get(key);
  };
  for (const check of Array.isArray(parity?.preflight?.checks) ? parity.preflight.checks : []) {
    if (!Array.isArray(check?.environment_failures) || !check.environment_failures.length) continue;
    const entry = captureAt(check.breakpoint, check.mode);
    entry.environment = true;
    check.environment_failures.forEach((reason) => entry.reasons.add(plainReason(reason)));
  }
  for (const row of results) {
    if (isEnvironmentRow(row)) {
      const entry = captureAt(row.breakpoint, row.mode);
      entry.environment = true;
      if (!entry.reasons.size) entry.reasons.add(plainReason(row.withheld_reason));
    } else if (isFontsPendingRow(row)) {
      captureAt(row.breakpoint, row.mode).reasons.add('AEM web fonts never finished loading, so no component was scored');
    }
  }
  const captureEntries = [...capture.values()].sort((left, right) => byWidth(left.key, right.key));

  const listed = (Array.isArray(parity?.components) ? parity.components : []).map((entry) => entry?.component_id);
  const order = [...new Set([...listed, ...results.map((row) => row.component_id)].filter(Boolean))];
  const rowsOf = new Map(order.map((id) => [id, []]));
  for (const row of results) {
    if (!isEnvironmentRow(row) && !isFontsPendingRow(row)) rowsOf.get(row.component_id).push(row);
  }
  const failing = order.filter((id) => rowsOf.get(id).some((row) => row.status !== 'PASS'));
  // A component that was only ever withheld has no measurement, so it is not called a mismatch.
  const mismatched = failing.filter((id) => rowsOf.get(id).some((row) => row.status === 'FAIL'));
  const unscorable = failing.filter((id) => !mismatched.includes(id));
  const neverScored = order.filter((id) => !results.some((row) => row.component_id === id));
  // A page the environment kept from loading was not compared, whatever its screenshot shows.
  const pages = composites.filter(([key]) => !capture.get(key)?.environment);
  const pageFailures = pages.filter(([, entry]) => entry.status !== 'PASS');
  const pageLabel = ([key]) => label(key, key.slice(key.indexOf('-') + 1));
  // A page comparison that was withheld measured nothing, so it is not said to differ.
  const pageDiffers = pageFailures.filter(([, entry]) => entry.status === 'FAIL').map(pageLabel);
  const pageUncompared = pageFailures.filter(([, entry]) => entry.status !== 'FAIL').map(pageLabel);
  const pageClause = [
    pageDiffers.length ? `differs from the live site at ${joinList(pageDiffers)}` : null,
    pageUncompared.length ? `could not be compared at ${joinList(pageUncompared)}` : null,
  ].filter(Boolean).join(' and ') || null;

  const measured = results.filter((row) => similarityOf(row) !== null);
  const lowestRow = measured.reduce((low, row) => (!low || similarityOf(row) < similarityOf(low) ? row : low), null);
  const lowest = lowestRow ? {
    ratio: similarityOf(lowestRow),
    component_id: lowestRow.component_id,
    breakpoint: lowestRow.breakpoint,
    mode: lowestRow.mode,
    label: label(lowestRow.breakpoint, lowestRow.mode),
  } : null;

  const total = order.length;
  const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
  const passed = parity?.status === 'PASS';
  let summary;
  if (passed) {
    const scoredCount = total - neverScored.length;
    const widths = Array.isArray(parity?.breakpoints) && parity.breakpoints.length
      ? parity.breakpoints
      : [...new Set(results.map((row) => row.breakpoint))].sort((left, right) => left - right);
    summary = `${scoredCount === total ? `all ${plural(total, 'component')}` : `${scoredCount} of ${plural(total, 'component')}`}`
      + ` match the live site${context.bar ? ` with visual similarity above ${context.bar}` : ''}`
      // A component hidden or pinned at some widths was compared only where it appears.
      + `${widths.length ? ` (checked at ${joinList(widths.map((width) => breakpointLabel(width)))})` : ''}`
      + `${lowest ? `; lowest visual similarity ${percent(lowest.ratio, threshold)} (${lowest.component_id} at ${lowest.label})` : ''}`
      + `${neverScored.length ? `; not scored at any breakpoint: ${neverScored.join(', ')}` : ''}`;
  } else {
    const clauses = [];
    const blocked = captureEntries.filter((entry) => entry.environment);
    const fontsOnly = captureEntries.filter((entry) => !entry.environment);
    if (blocked.length) {
      clauses.push(`AEM could not be compared with the live site at ${joinList(blocked.map((entry) => entry.label))}`
        + ` (${[...new Set(blocked.flatMap((entry) => [...entry.reasons]))].join('; ')}); no component change can fix that`);
    }
    if (fontsOnly.length) {
      clauses.push(`AEM web fonts never finished loading at ${joinList(fontsOnly.map((entry) => entry.label))}, so no component was scored there`);
    }
    if (mismatched.length) {
      clauses.push(`${mismatched.length} of ${plural(total, 'component')} ${mismatched.length === 1 ? 'does' : 'do'} not match the live site`
        + `${context.bar ? ` (pass: visual similarity above ${context.bar} at every breakpoint)` : ''}`);
    }
    if (unscorable.length) {
      clauses.push(`${mismatched.length ? unscorable.length : `${unscorable.length} of ${plural(total, 'component')}`}`
        + ` could not be scored (${unscorable.join(', ')})`);
    }
    if (pageClause) {
      clauses.push(failing.length || captureEntries.length
        ? `the page as a whole also ${pageClause}`
        : `every scored component passes, but the page as a whole ${pageClause}`);
    }
    if (!clauses.length) {
      clauses.push('parity.json marks the run FAIL without a failing component, page or capture problem; see its preflight block');
    }
    summary = clauses.join('; ');
  }
  const headline = `Visual parity ${passed ? 'PASSED' : 'FAILED'}: ${summary}`;
  if (passed) {
    return {
      status: 'PASS', headline, summary, lines: [], lowest, page: null,
    };
  }

  const sections = [];
  if (captureEntries.length) {
    sections.push({ heading: 'page capture', rows: captureEntries.map((entry) => [entry.label, [...entry.reasons].join('; ')]) });
  }
  for (const id of failing) {
    const rows = [...rowsOf.get(id)].sort((left, right) => left.breakpoint - right.breakpoint
      || String(left.mode).localeCompare(String(right.mode)));
    const seen = new Map();
    const shared = (row) => rows.filter((other) => other.breakpoint === row.breakpoint && other.mode === row.mode).length > 1;
    sections.push({
      heading: id,
      rows: rows.map((row) => {
        const base = label(row.breakpoint, row.mode);
        const index = (seen.get(base) || 0) + 1;
        seen.set(base, index);
        return [shared(row) ? `${base} [${row.instance || `#${index}`}]` : base, describeRow(row, context)];
      }),
    });
  }
  if (pageFailures.length) {
    sections.push({
      heading: 'page as a whole',
      rows: pages.map((page) => [pageLabel(page), describeComposite(page[1], context)]),
    });
  }

  const width = Math.max(0, ...sections.flatMap((section) => section.rows.map(([rowLabel]) => rowLabel.length)));
  const lines = [];
  for (const section of sections) {
    lines.push(section.heading);
    for (const [rowLabel, text] of section.rows) lines.push(`  ${rowLabel.padEnd(width)}  ${text}`);
  }
  if (neverScored.length) lines.push(`not scored at any breakpoint: ${neverScored.join(', ')}`);
  if (lines.some((line) => line.includes('visual similarity '))) {
    lines.push('visual similarity = share of pixels that match the live site; area only one side has counts as not matching');
  }
  return {
    status: 'FAIL', headline, summary, lines, lowest, page: pageClause,
  };
}
