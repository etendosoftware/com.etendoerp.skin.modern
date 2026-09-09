/*
 *************************************************************************
 * Copyright (C) 2026 Futit Services S.L.
 * Licensed under the Openbravo Public License version 1.1.
 * You may obtain a copy of the License at
 * http://www.openbravo.com/legal/license.html
 ************************************************************************
 */

/*
 * Asserts what the navigation panel opens, against a running instance.
 *
 * Two behaviours live here because neither is visible in the source and neither survives a static
 * check. The first is that one click opens the entry the user clicked: the core view manager lets
 * loadedWindowClassName - written by a window that is in development and never cleared again -
 * override the name of the view it has just fetched, so before the panel started clearing it, the
 * first open of a view (the one that has to fetch; the second finds the class defined) rendered the
 * last development window's grid under the right tab title. The second is that a popup draws no
 * panel.
 *
 * The entries are read out of OB.Application.menu rather than named here, so this runs against any
 * installation and in any language. The first assertion can only fail where the instance actually
 * has a window in development - which is precisely where the defect was reachable.
 *
 * Usage:
 *   node verify/check-nav.mjs --playwright <path to playwright> [--base http://localhost:8080/etendo]
 * Credentials come from ETSKIN_USER / ETSKIN_PASSWORD, and default to admin / admin.
 */

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const BASE = arg('base', 'http://localhost:8080/etendo').replace(/\/$/, '');
const PLAYWRIGHT = arg('playwright', 'playwright');
const USER = process.env.ETSKIN_USER || 'admin';
const PASSWORD = process.env.ETSKIN_PASSWORD || 'admin';
const SETTLE = Number(arg('settle', '9000'));

const { chromium } = await import(PLAYWRIGHT);

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`   ${ok ? '  ok' : 'FAIL'}  ${name}: ${detail}`);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

try {
  await page.goto(`${BASE}/security/Login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[placeholder="User Name"]', USER);
  await page.fill('input[placeholder="Password"]', PASSWORD);
  await page.click('button:has-text("Continue")');
  await page.waitForFunction('!!window.OB && !!OB.MainView', { timeout: 120000 });
  await page.waitForTimeout(6000);

  console.log('\n[PANEL] The panel is there to be clicked');
  check('the panel is drawn', await page.evaluate('!!document.querySelector(".etskin-nav")'),
    'one .etskin-nav in the main window');

  /*
   * A window and the views: the window first, because it is what poisons the global, and then the
   * views, which are the openings that had nothing of their own to overwrite it with.
   */
  const menu = JSON.parse(await page.evaluate(`(function () {
    var windows = [], views = [];
    (function walk(list) {
      (list || []).forEach(function (node) {
        if (node.tabId && node.windowId) { windows.push({ title: node.title, expect: '_' + node.windowId }); }
        else if (node.type === 'view' && node.viewId) { views.push({ title: node.title, expect: node.viewId }); }
        if (node.submenu) { walk(node.submenu); }
      });
    })(OB.Application.menu);
    return JSON.stringify({ windows: windows, views: views });
  })()`));

  const selected = async () => JSON.parse(await page.evaluate(`(function () {
    var tabs = OB.MainView.TabSet, tab = tabs.getSelectedTab(), pane = tab && tab.pane;
    return JSON.stringify({
      title: tab ? String(tab.title || '').replace(/<[^>]*>/g, '') : null,
      // the class the view manager actually instantiated, which is the thing the defect changed -
      // pane.viewId is copied from the click parameters and stays right even when the class is wrong
      className: pane ? pane.getClassName() : null
    });
  })()`));

  const clickEntry = async (title) => {
    await page.fill('.etskin-nav-search-input', title);
    await page.waitForTimeout(700);
    const clicked = await page.evaluate(`(function () {
      var rows = [].slice.call(document.querySelectorAll('.etskin-nav-row'));
      var row = rows.filter(function (r) {
        var label = r.querySelector('.etskin-nav-label');
        return label && label.textContent === ${JSON.stringify(title)};
      })[0];
      if (!row) { return 'missing'; }
      row.scrollIntoView({ block: 'center' });
      row.click();
      return 'ok';
    })()`);
    await page.waitForTimeout(SETTLE);
    await page.fill('.etskin-nav-search-input', '');
    await page.waitForTimeout(300);
    return clicked;
  };

  // A window class carries a generated suffix while the window is in development, hence the prefix
  // match; a view class is the view id exactly.
  const matches = (className, expect) => className === expect || String(className).indexOf(expect + '_') === 0;

  console.log('\n[CLICK] One click opens the entry that was clicked');
  const opened = [];
  const first = menu.windows[0];
  if (first) {
    const clicked = await clickEntry(first.title);
    const state = await selected();
    opened.push(first);
    check(`a standard window opens on the first click`, clicked === 'ok' && matches(state.className, first.expect),
      `${first.expect} -> ${state.className}`);
  } else {
    check('a standard window opens on the first click', false, 'no window entry in this menu');
  }

  for (const view of menu.views.slice(0, 4)) {
    const clicked = await clickEntry(view.title);
    const state = await selected();
    opened.push(view);
    check(`a view opens on the first click, after a window`, clicked === 'ok' && matches(state.className, view.expect),
      `${view.expect} -> ${state.className}`);
  }

  console.log('\n[RECENTS] A recent chip opens what it names');
  const last = opened[opened.length - 1];
  const chip = last ? await page.evaluate(`(function () {
    var chips = [].slice.call(document.querySelectorAll('.etskin-nav-chip'));
    var target = chips.filter(function (c) { return c.textContent.trim() === ${JSON.stringify(last ? last.title : '')}; })[0];
    if (!target) { return 'missing'; }
    target.click();
    return 'ok';
  })()`) : 'missing';
  if (chip === 'ok') {
    await page.waitForTimeout(SETTLE);
    const state = await selected();
    check('a recent chip opens its own view', matches(state.className, last.expect), `${last.expect} -> ${state.className}`);
  } else {
    check('a recent chip opens its own view', false, 'no chip for the entry just opened');
  }

  console.log('\n[POPUP] A popup draws no panel');
  const classic = await context.newPage();
  await classic.goto(`${BASE}/security/Menu.html?Command=DEFAULT&noprefs=true&tabId=180&hideMenu=true`,
    { waitUntil: 'domcontentloaded' });
  await classic.waitForTimeout(8000);
  check('a document asking for hideMenu draws no panel',
    !(await classic.evaluate('!!document.querySelector(".etskin-nav")')), 'hideMenu=true');
  await classic.close();

  const [popup] = await Promise.all([
    context.waitForEvent('page'),
    page.evaluate(`(function () { window.open('${BASE}/', 'PROCESS', 'width=900,height=650'); return 'ok'; })()`)
  ]);
  await popup.waitForLoadState('domcontentloaded');
  await popup.waitForTimeout(18000);
  const inPopup = JSON.parse(await popup.evaluate(`JSON.stringify({
    nav: !!document.querySelector('.etskin-nav'),
    app: !!(window.OB && window.OB.MainView)
  })`));
  check('the application in a PROCESS popup draws no panel', !inPopup.nav && inPopup.app,
    `nav=${inPopup.nav} application=${inPopup.app}`);
  const frames = await Promise.all(popup.frames().map(async (frame) => {
    try { return await frame.evaluate('!!document.querySelector(".etskin-nav")'); } catch (ignored) { return null; }
  }));
  check('no frame of the popup draws the panel', frames.every((found) => found !== true), `${frames.length} frame(s)`);
  await popup.close();

  check('the main window still has its panel', await page.evaluate('!!document.querySelector(".etskin-nav")'),
    'the popup did not take it away');
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n[ux-nav] ${results.length - failed}/${results.length} assertions hold.`);
process.exit(failed === 0 ? 0 : 1);
