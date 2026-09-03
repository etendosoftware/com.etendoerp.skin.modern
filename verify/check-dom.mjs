/*
 *************************************************************************
 * Copyright (C) 2026 Futit Services S.L.
 * Licensed under the Openbravo Public License version 1.1.
 * You may obtain a copy of the License at
 * http://www.openbravo.com/legal/license.html
 ************************************************************************
 */

/*
 * Decides whether the design feedback in feedback.md was actually resolved, by asserting against
 * measurements the browser took of the running application (recordings/after-*.json, written by
 * capture.js). It never looks at the source: a rule that a stylesheet declares but the browser does
 * not apply fails here, which is the whole point of measuring rather than grepping.
 *
 * Every recording carries the SHA-256 of the bundles that were deployed when it was taken. Those
 * are re-hashed here against the working copies, so a recording that outlived the files it was
 * taken from is rejected instead of passing on stale evidence.
 */

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODULE = join(HERE, '..');
const WEB = join(MODULE, 'web', 'com.etendoerp.skin.modern');

const criteria = JSON.parse(readFileSync(join(HERE, 'criteria.json'), 'utf8'));
const T = criteria.thresholds;

const SCREENS = ['grid', 'form', 'new', 'rail', 'login'];

const results = [];
let currentFinding = null;

function finding(id, title) {
  currentFinding = { id, title, checks: [] };
  results.push(currentFinding);
}

function check(name, ok, detail) {
  currentFinding.checks.push({ name, ok: !!ok, detail });
}

function rgbOf(value) {
  const m = String(value || '').match(/-?[\d.]+/g);
  if (!m) { return null; }
  const scale = /^color\(/.test(String(value)) ? 255 : 1;
  return [Math.round(m[0] * scale), Math.round(m[1] * scale), Math.round(m[2] * scale), m.length > 3 ? Number(m[3]) : 1];
}

function hexOf(value) {
  const c = rgbOf(value);
  if (!c) { return null; }
  return '#' + c.slice(0, 3).map((n) => n.toString(16).padStart(2, '0')).join('');
}

function normAlign(a) {
  return String(a || '').replace('-webkit-', '').replace('start', 'left').replace('end', 'right');
}

// --------------------------------------------------------------- recordings

const rec = {};
for (const screen of SCREENS) {
  const path = join(HERE, 'recordings', `after-${screen}.json`);
  if (!existsSync(path)) {
    console.error(`[ux-dom] missing recording: verify/recordings/after-${screen}.json`);
    console.error('[ux-dom] record it with capture.js against the running application before checking.');
    process.exit(1);
  }
  rec[screen] = JSON.parse(readFileSync(path, 'utf8'));
}

finding('P', 'Provenance: every recording was taken from the files as they stand now');
for (const screen of SCREENS) {
  const sources = rec[screen].sources || {};
  for (const [rel, recorded] of Object.entries(sources)) {
    const path = join(WEB, rel);
    const present = existsSync(path);
    const actual = present ? createHash('sha256').update(readFileSync(path)).digest('hex') : null;
    check(`${screen} / ${rel}`, recorded === actual,
      recorded === actual ? 'matches'
        : `recorded ${recorded ? recorded.slice(0, 12) : 'absent'}, on disk ${actual ? actual.slice(0, 12) : 'absent'}`);
  }
}

// ---------------------------------------------------------------- F1 toolbar

finding('F1', 'The toolbar has a hierarchy and nothing is clipped off-screen');
for (const screen of ['grid', 'form', 'new']) {
  const tb = rec[screen].toolbar;
  const left = tb.icons.filter((i) => i.group !== 'right');
  check(`${screen}: glyphs left of the right-anchored group`, left.length <= T.F1.maxIconsBeforeRightGroup,
    `${left.length} (max ${T.F1.maxIconsBeforeRightGroup})`);
  check(`${screen}: exactly one filled primary`, tb.primary.length === T.F1.exactPrimaryButtons,
    `${tb.primary.length} marked .etskin-tb-primary`);
  check(`${screen}: nothing past the right edge`, tb.rightMost !== null && tb.rightMost <= T.F1.maxRightEdge,
    `rightmost control ends at ${tb.rightMost} (max ${T.F1.maxRightEdge}, viewport ${rec[screen].viewport.w})`);
  check(`${screen}: groups are separated`, tb.dividers >= T.F1.minDividers,
    `${tb.dividers} dividers (min ${T.F1.minDividers})`);

  const byGroup = {};
  for (const icon of tb.icons) {
    const key = icon.group || 'ungrouped';
    (byGroup[key] = byGroup[key] || []).push(icon);
  }
  let worst = 0;
  let worstGroup = null;
  for (const [key, icons] of Object.entries(byGroup)) {
    const xs = icons.map((i) => i.box.x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) {
      const pitch = xs[i] - xs[i - 1];
      if (pitch > worst) { worst = pitch; worstGroup = key; }
    }
  }
  check(`${screen}: intra-group pitch`, worst <= T.F1.maxIntraGroupPitch,
    `widest pitch ${Math.round(worst)}px in "${worstGroup}" (max ${T.F1.maxIntraGroupPitch})`);
}

// ------------------------------------------------------------------- F2 form

finding('F2', 'Form fields are readable rather than decorated');
{
  const f = rec.form.form;
  const boxed = f.inputs.filter((i) => i.borderLeft > T.F2.maxInputBorderLeft);
  check('no left bar on inputs', boxed.length === 0, `${boxed.length} of ${f.inputs.length} inputs still have one`);

  const short = f.inputs.filter((i) => i.height < T.F2.minInputHeight);
  check('input height', short.length === 0,
    `${short.length} below ${T.F2.minInputHeight}px (smallest ${Math.min(...f.inputs.map((i) => i.height))})`);

  const xs = f.columns.map((c) => c.x);
  const pitches = xs.slice(1).map((x, i) => x - xs[i]);
  const spread = pitches.length ? Math.max(...pitches) - Math.min(...pitches) : 0;
  check('columns are evenly spaced', pitches.length >= 2 && spread <= T.F2.columnPitchTolerance * 2,
    `pitches ${pitches.map(Math.round).join(', ')} (spread ${Math.round(spread)}, max ${T.F2.columnPitchTolerance * 2})`);

  check('required marker exists', f.required.length > 0 && f.unwrappedAsterisks === 0,
    `${f.required.length} wrapped, ${f.unwrappedAsterisks} bare asterisks left in labels`);
  const [loHue, hiHue] = T.F2.requiredHueRange;
  const offHue = f.required.filter((r) => r.hue === null || r.hue < loHue || r.hue > hiHue);
  check('required marker is red', f.required.length > 0 && offHue.length === 0,
    `${offHue.length} outside hue ${loHue}-${hiHue}`);

  check('link glyph hidden at rest', f.linkGlyphOpacity === T.F2.linkGlyphRestOpacity,
    `opacity ${f.linkGlyphOpacity} across ${f.linkGlyphs} glyphs (want ${T.F2.linkGlyphRestOpacity})`);

  const busiest = f.decorations.length ? Math.max(...f.decorations) : 0;
  check('decorations per field at rest', busiest <= T.F2.maxDecorationsPerFieldAtRest,
    `busiest field carries ${busiest} (max ${T.F2.maxDecorationsPerFieldAtRest})`);
}

// -------------------------------------------------------------- F3 lavender

finding('F3', 'Lavender is a band, not a field');
for (const screen of ['grid', 'form', 'new']) {
  const p = rec[screen].paint;
  const region = p.largestColouredRegion;
  check(`${screen}: largest single-colour non-white region`,
    !region || region.share < T.F3.maxLargestNonWhiteRegionShare,
    `${region ? region.share : 0}% of the content area (max ${T.F3.maxLargestNonWhiteRegionShare}%)`);
}

// ------------------------------------------------------------------ F4 grid

finding('F4', 'The grid reads as data, not as a form');
{
  const g = rec.grid.grid;
  const misaligned = [];
  g.headerCells.forEach((h, i) => {
    const cell = g.cellSample[i];
    if (!cell) { return; }
    if (normAlign(h.align) !== normAlign(cell.align)) { misaligned.push(`${h.text}: ${normAlign(h.align)} over ${normAlign(cell.align)}`); }
  });
  check('headers follow their column alignment', misaligned.length === 0, misaligned.slice(0, 4).join('; ') || 'all aligned');

  const heavy = g.headerCells.filter((h) => Number(h.weight) > T.F4.maxHeaderWeight);
  check('header weight', heavy.length === 0, `${heavy.length} above ${T.F4.maxHeaderWeight}`);

  const cellWeights = g.cellSample.map((c) => Number(c.weight) || 400);
  const headerWeights = g.headerCells.map((h) => Number(h.weight) || 400);
  const maxHeader = Math.max(...headerWeights);
  const maxCell = Math.max(...cellWeights);
  check('header is not heavier than data', maxHeader <= maxCell + 100, `header ${maxHeader} vs data ${maxCell}`);

  check('row height', g.rowHeight >= T.F4.minRowHeight, `${g.rowHeight}px (min ${T.F4.minRowHeight})`);
  check('non-data left columns', g.frozenWidth !== null && g.frozenWidth <= T.F4.maxNonDataLeftColumnsWidth,
    `${g.frozenWidth}px (max ${T.F4.maxNonDataLeftColumnsWidth})`);
  check('row separator is a hairline',
    g.rowSeparator && g.rowSeparator.width <= T.F4.maxSeparatorWidth && g.rowSeparator.alpha <= T.F4.maxSeparatorAlpha,
    g.rowSeparator ? `${g.rowSeparator.width}px at alpha ${g.rowSeparator.alpha}` : 'none');
}

// ---------------------------------------------------------------- F5 banner

finding('F5', 'The transactional-filter notice stops shouting');
{
  const g = rec.grid.grid;
  if (!g.banner) {
    const badge = g.filterBadge;
    check('banner replaced by a badge', !!badge && badge.width <= T.F5.maxFilterBadgeSize && badge.height <= T.F5.maxFilterBadgeSize,
      badge ? `${badge.width}x${badge.height}px badge` : 'no banner and no badge on the filter button');
  } else {
    check('banner height', g.banner.height <= T.F5.maxBannerHeight, `${g.banner.height}px (max ${T.F5.maxBannerHeight})`);
    check('banner weight', Number(g.banner.weight) <= T.F5.maxBannerWeight, `${g.banner.weight} (max ${T.F5.maxBannerWeight})`);
  }
}

// ----------------------------------------------------------------- F6 panes

finding('F6', 'An unsaved record gets the room, not its empty child pane');
{
  const p = rec.new.panes;
  const total = (p.form ? p.form.h : 0) + (p.childPane ? p.childPane.h : 0);
  const share = total ? ((p.form ? p.form.h : 0) / total) * 100 : 0;
  check('form pane share while unsaved', share >= T.F6.minFormPaneShareUnsaved,
    `${share.toFixed(1)}% (min ${T.F6.minFormPaneShareUnsaved}%)`);
  check('child pane collapsed while unsaved', p.childPane && p.childPane.h <= T.F6.maxChildPaneHeightUnsaved,
    `${p.childPane ? p.childPane.h : 0}px (max ${T.F6.maxChildPaneHeightUnsaved})`);

  const s = rec.form.panes;
  const savedTotal = (s.form ? s.form.h : 0) + (s.childPane ? s.childPane.h : 0);
  const savedShare = savedTotal ? ((s.childPane ? s.childPane.h : 0) / savedTotal) * 100 : 0;
  check('child pane returns once the record exists', savedShare >= T.F6.minChildPaneShareAfterSave,
    `${savedShare.toFixed(1)}% (min ${T.F6.minChildPaneShareAfterSave}%)`);
}

// -------------------------------------------------------- F7 title, branding

finding('F7', 'The record outranks the branding');
for (const screen of ['grid', 'form']) {
  const t = rec[screen].topBar;
  const biggest = t.texts.reduce((m, x) => Math.max(m, x.size), 0);
  check(`${screen}: top-bar text size`, biggest <= T.F7.maxTopBarTextSize, `${biggest}px (max ${T.F7.maxTopBarTextSize})`);
  check(`${screen}: top-bar height`, t.height <= T.F7.maxTopBarHeight, `${t.height}px (max ${T.F7.maxTopBarHeight})`);
  const logo = t.imageHeights && t.imageHeights.length ? Math.max(...t.imageHeights) : (t.logoHeight || 0);
  check(`${screen}: logo height`, logo <= T.F7.maxLogoHeight, `${logo}px (max ${T.F7.maxLogoHeight})`);
}
{
  const sb = rec.form.statusBar;
  check('the open record is titled', sb && sb.title && sb.title.size >= T.F7.minRecordTitleSize,
    sb && sb.title ? `"${sb.title.text}" at ${sb.title.size}px (min ${T.F7.minRecordTitleSize})` : 'no .etskin-record-title in the status bar');
  check('the title is the largest thing on that bar',
    sb && sb.title && sb.largestText && sb.title.size >= sb.largestText.size,
    sb && sb.largestText ? `largest is "${sb.largestText.text}" at ${sb.largestText.size}px` : 'nothing measured');
}

// ------------------------------------------------------------------- F8 nav

finding('F8', 'Navigation sections are told apart by their icons');
{
  const nav = rec.grid.nav;
  const nonFolder = nav.topLevel.filter((t) => !/folder/.test(t.iconClass || ''));
  check('sections carry their own icon', nonFolder.length >= T.F8.minDistinctSectionIcons,
    `${nonFolder.length} of ${nav.topLevel.length} (min ${T.F8.minDistinctSectionIcons})`);
  check('item height', nav.itemHeight >= T.F8.minItemHeight, `${nav.itemHeight}px (min ${T.F8.minItemHeight})`);
  check('search field is labelled', !T.F8.requireSearchPlaceholder || !!nav.searchPlaceholder,
    `placeholder ${JSON.stringify(nav.searchPlaceholder)}`);
  const current = nav.topLevel.find((t) => t.current);
  const filled = current && rgbOf(current.background) && rgbOf(current.background)[3] > 0.5;
  check('active section is filled when expanded', !!filled,
    current ? `background ${current.background}` : 'no current section');
}
{
  const tiles = rec.rail.nav.tiles;
  const labels = new Set(tiles.map((t) => t.label));
  const icons = new Set(tiles.map((t) => t.icon));
  check('rail tiles are distinguishable',
    !T.F8.requireDistinctRailTiles || (labels.size === tiles.length && icons.size === tiles.length),
    `${tiles.length} tiles, ${labels.size} distinct labels, ${icons.size} distinct icons`);
  const current = tiles.find((t) => t.current);
  const filled = current && rgbOf(current.background) && rgbOf(current.background)[3] > 0.5;
  check('active tile is filled in the rail', !!filled, current ? `background ${current.background}` : 'no current tile');
}

// -------------------------------------------------------------- F9 sections

finding('F9', 'Form sections are bands, not floating headings');
{
  const sections = rec.form.form.sections;
  const flat = sections.filter((s) => {
    const c = rgbOf(s.background);
    return !c || c[3] < 0.5 || (c[0] > 250 && c[1] > 250 && c[2] > 250);
  });
  check('band is painted', sections.length > 0 && flat.length === 0,
    `${flat.length} of ${sections.length} sections still transparent or white`);
  const short = sections.filter((s) => s.height < T.F9.minSectionBandHeight);
  check('band height', short.length === 0, `${short.length} below ${T.F9.minSectionBandHeight}px`);
  const noChevron = sections.filter((s) => s.chevronRight === null);
  const farChevron = sections.filter((s) => s.chevronRight !== null && s.right - s.chevronRight > T.F9.maxChevronInsetFromCardEdge);
  check('chevron sits at the card edge', noChevron.length === 0 && farChevron.length === 0,
    `${noChevron.length} without a chevron, ${farChevron.length} further than ${T.F9.maxChevronInsetFromCardEdge}px in`);
}

// -------------------------------------------------------------- F10 type

finding('F10', 'Typography has steps');
for (const screen of ['grid', 'form']) {
  const t = rec[screen].typography;
  check(`${screen}: distinct font sizes`, t.sizes.length <= T.F10.maxDistinctFontSizes,
    `${t.sizes.length} sizes: ${t.sizes.join(', ')} (max ${T.F10.maxDistinctFontSizes})`);
  check(`${screen}: no shouted labels`, t.uppercase.length === 0,
    t.uppercase.slice(0, 3).join(', ') || 'none');
  check(`${screen}: bold is reserved`, t.weight700.length === 0,
    t.weight700.slice(0, 4).join(', ') || 'none');
}

// -------------------------------------------------------------- F11 tray

finding('F11', 'The top-right cluster is a row of buttons, not a box of boxes');
{
  const c = rec.grid.topBar.cluster;
  const bg = rgbOf(c.background);
  check('no enclosing container', c.borderWidth === 0 && (!bg || bg[3] < 0.02),
    `border ${c.borderWidth}px, background ${c.background}`);
  check('button count', c.buttons <= T.F11.maxTrayButtons, `${c.buttons} (max ${T.F11.maxTrayButtons})`);
  const off = c.sizes.filter(([w, h]) =>
    Math.abs(w - T.F11.trayButtonSize) > T.F11.trayButtonSizeTolerance ||
    Math.abs(h - T.F11.trayButtonSize) > T.F11.trayButtonSizeTolerance);
  check('button size', off.length === 0,
    `${off.length} outside ${T.F11.trayButtonSize}±${T.F11.trayButtonSizeTolerance}px: ${off.map((s) => s.join('x')).join(', ')}`);
  const tight = c.gaps.filter((g) => g < T.F11.minTrayGap);
  check('gap between buttons', tight.length === 0, `gaps ${c.gaps.join(', ')} (min ${T.F11.minTrayGap})`);
}

// -------------------------------------------------------------- F12 accent

finding('F12', 'The yellow marker means one thing everywhere');
for (const screen of ['grid', 'form', 'new']) {
  const accents = rec[screen].accents;
  const wrong = accents.filter((a) => a.w !== T.F12.consistentActiveMarkerWidth);
  check(`${screen}: marker width`, accents.length > 0 && wrong.length === 0,
    accents.length === 0 ? 'no marker found'
      : `${wrong.length} of ${accents.length} not ${T.F12.consistentActiveMarkerWidth}px: ${wrong.map((a) => `${a.cls}@${a.w}x${a.h}`).slice(0, 3).join(', ')}`);
}

// --------------------------------------------------------------- F13 login

finding('F13', 'The login page belongs to the same product');
{
  const l = rec.login.login;
  const appPrimary = rec.grid.tokens.primary.toLowerCase();
  const loginPrimary = hexOf(l.primary);
  check('primary matches the application token',
    !T.F13.requirePrimaryMatchesAppToken || loginPrimary === appPrimary,
    `login ${loginPrimary} vs application ${appPrimary}`);
  check('the panel says something', l.panel.contentElements >= T.F13.minPanelContentElements,
    `${l.panel.contentElements} elements: ${l.panel.contentText.slice(0, 3).join(' | ') || 'nothing'}`);
  check('panel is not a gradient wash', l.panel.gradientStops <= T.F13.maxPanelGradientStops,
    `${l.panel.gradientStops} colour stops (max ${T.F13.maxPanelGradientStops})`);
  check('panel is not blurred', T.F13.allowPanelBlur || !l.panel.blurred, `blurred: ${l.panel.blurred}`);
  check('copyright is fine print', l.footer && l.footer.size <= T.F13.maxFooterSize,
    l.footer ? `${l.footer.size}px (max ${T.F13.maxFooterSize})` : 'no footer');
}

// ---------------------------------------------------------------- reporting

let failed = 0;
let total = 0;
for (const f of results) {
  const bad = f.checks.filter((c) => !c.ok);
  failed += bad.length;
  total += f.checks.length;
  const mark = bad.length === 0 ? 'PASS' : 'FAIL';
  console.log(`\n[${mark}] ${f.id} — ${f.title}`);
  for (const c of f.checks) {
    console.log(`   ${c.ok ? '  ok' : 'FAIL'}  ${c.name}: ${c.detail}`);
  }
}
console.log(`\n[ux-dom] ${total - failed}/${total} assertions hold across ${SCREENS.length} recorded screens.`);
process.exit(failed === 0 ? 0 : 1);
