/*
 *************************************************************************
 * Copyright (C) 2026 Futit Services S.L.
 * Licensed under the Openbravo Public License version 1.1.
 * You may obtain a copy of the License at
 * http://www.openbravo.com/legal/license.html
 ************************************************************************
 */

/*
 * Etendo Modern Skin - side navigation.
 *
 * Moves the application menu out of the "Application" dropdown in the navigation bar and into a
 * permanent panel on the left, the way Etendo's React skin presents it. Controlled by the
 * ETSKIN_Navigation preference; anything other than 'sidebar' leaves the stock navigation alone.
 *
 * Nothing here needs a server round trip. OB.Application.menu is already the complete menu tree,
 * emitted per session by application-menu.js.ftl, and OBApplicationMenuTree#itemClick is already
 * the logic that turns one of its nodes into an open view - windows, classic windows, process
 * definitions, reports, forms, external links and recents all behave differently and that function
 * is where core encodes the differences. This file renders the tree and delegates every click to a
 * hidden instance of that class rather than restating any of it.
 *
 * The panel is one isc.Canvas containing plain HTML rather than a TreeGrid or a tree of Canvases.
 * SmartClient positions every canvas absolutely from measurements it takes itself, so a menu of
 * 277 nodes would be 277 absolutely positioned widgets to lay out and to fight for control of. One
 * canvas of markup styled from the stylesheet costs one layout pass, is scrolled by the browser,
 * and lets the panel look like the reference instead of like a grid.
 *
 * Same constraints as etendo-skin.js: concatenated into the global bundle and minified with
 * Crockford's JSMin, so conservative ES5 only - no let/const, no arrow functions, no template
 * literals, no trailing commas.
 */

(function () {
  'use strict';

  var NAV_WIDTH = 260;
  var RAIL_WIDTH = 52;
  var COLLAPSE_KEY = 'etskin.nav.collapsed';
  var RECENT_LIST = 'UINAVBA_MenuRecentList';

  var sidebar = null; // the isc.Canvas
  var menuDelegate = null; // an OBApplicationMenuTree, used only for itemClick
  var menuData = null;
  // The index path of the node whose window is open, kept because the row it names is not always
  // the row that carries the mark; see applyCurrent.
  var currentPath = null;
  var syncTimer = null; // debounce handle for the tab-bar observer, see watchTabBar

  // ------------------------------------------------------------------ gates

  function properties() {
    return (typeof OB !== 'undefined' && OB && OB.Properties) || {};
  }

  function wanted() {
    // etendo-skin.js publishes OB.ETSkin only when it decided the skin is on, so this follows the
    // ETSKIN_Enabled and SKINLEG_LegacySkin decisions without repeating them.
    if (typeof OB === 'undefined' || !OB || !OB.ETSkin) {
      return false;
    }
    // Portal users get a navigation bar of their own and no application menu, so there would be
    // nothing to put in the panel.
    if (OB.User && OB.User.isPortal) {
      return false;
    }
    // A popup is a window the application opened for one process, one classic form or one help
    // page. It carries its own layout and the user cannot navigate away from it, so a navigation
    // panel there is dead weight that steals half the width of a deliberately small window.
    if (isPopupDocument()) {
      return false;
    }
    var mode = properties().ETSKIN_Navigation;
    return !mode || mode === 'sidebar';
  }

  /*
   * Three independent marks, because the core opens popups in three shapes and no single one of
   * them covers all three: ob-classic-window.js, ob-classic-help.js and ob-classic-popup.js append
   * hideMenu=true to the url they load; OB.Utilities.openProcessPopup names the window it opens
   * PROCESS; and any window.open leaves an opener behind, which a plain tab does not, since
   * browsers give target=_blank links no opener by default. Reading top can throw when the
   * document is framed by another origin, hence the try.
   */
  function isPopupDocument() {
    try {
      if (String(window.location.search || '').indexOf('hideMenu=true') !== -1) {
        return true;
      }
      if (window.name === 'PROCESS' || (window.top && window.top.name === 'PROCESS')) {
        return true;
      }
      if (window.opener) {
        return true;
      }
    } catch (ignored) {
      // Cross-origin top: nothing to read, and the shapes above already answered for our own frames.
    }
    return false;
  }

  // ------------------------------------------------------------------- html

  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .split('&')
      .join('&amp;')
      .split('<')
      .join('&lt;')
      .split('>')
      .join('&gt;')
      .split('"')
      .join('&quot;');
  }

  /*
   * Optional per section artwork, as {"<top level title>": "<data uri or url>"}. Nothing publishes
   * it yet, so every section falls back to its monogram; the shape is fixed here so that when the
   * icons do arrive nothing in the rendering has to change.
   *
   * The key is the title because a folder node in OB.Application.menu carries nothing else - no
   * id, no value, no window. Top level titles are unique, and a provider that emits this map
   * server side sees the same translations the menu was built with, so the key holds in every
   * language. See the README for how such a provider is wired without touching core.
   */
  function navIcons() {
    return (OB.ETSkin && OB.ETSkin.navIcons) || null;
  }

  function artworkFor(node) {
    var icons = navIcons();
    var src = icons && node && node.title ? icons[node.title] : null;
    return typeof src === 'string' && src ? src : null;
  }

  // The menu carries more types than there are useful shapes; several collapse onto one icon.
  function iconFor(node) {
    var type = node.type;
    if (type === 'folder') {
      return 'folder';
    }
    if (type === 'report') {
      return 'report';
    }
    if (type === 'form') {
      return 'form';
    }
    if (type === 'view') {
      return 'view';
    }
    if (type === 'external') {
      return 'external';
    }
    if (
      type === 'process' ||
      type === 'processManual' ||
      type === 'processDefinition'
    ) {
      return 'process';
    }
    return 'window';
  }

  /*
   * Distinct glyphs for the top level sections.
   *
   * A folder node in OB.Application.menu carries a translated title and nothing else - no id, no
   * value, no window - so there is no stable key to hang a shipped drawing on, and any installed
   * module may add a section of its own. Two passes cover both halves of that: the title is matched
   * against a small table of the words the standard sections are named with, in English and in
   * Spanish, and whatever is left over takes the next unused glyph from the pool. So the usual
   * sections get the glyph that means them, an unknown section still gets one of its own, and no
   * two sections in a menu ever share one - which is the whole job the rail needs done.
   *
   * This replaces the monogram the rail used to draw. A monogram is always available and always
   * distinct, but "GS MD PM WM PM MR SM PS FM" down a 52px strip is a column of initials, not an
   * index: two of them were even the same. Artwork from a provider still wins over all of this.
   */
  var SECTION_POOL = [
    'sliders', 'layers', 'inbound', 'package', 'factory', 'clipboard', 'trend',
    'briefcase', 'card', 'star', 'tag', 'flag', 'compass', 'grid', 'bolt'
  ];

  // Matched as substrings of the lowercased title, in the order written here: 'setup' is looked for
  // before 'general' so that "General Setup" is read as a setup section rather than a general one.
  var SECTION_WORDS = [
    ['master data', 'layers'],
    ['datos maestros', 'layers'],
    ['procurement', 'inbound'],
    ['compras', 'inbound'],
    ['warehouse', 'package'],
    ['almac', 'package'],
    ['production', 'factory'],
    ['producci', 'factory'],
    ['requirement', 'clipboard'],
    ['planificaci', 'clipboard'],
    ['sales', 'trend'],
    ['ventas', 'trend'],
    ['project', 'briefcase'],
    ['proyecto', 'briefcase'],
    ['financial', 'card'],
    ['financiera', 'card'],
    ['finanzas', 'card'],
    ['setup', 'sliders'],
    ['configuraci', 'sliders'],
    ['general', 'sliders']
  ];

  var sectionGlyphs = null;

  function computeSectionGlyphs() {
    var used = {};
    var out = [];
    var i, j, title, glyph;

    for (i = 0; i < menuData.length; i++) {
      title = String(menuData[i].title || '').toLowerCase();
      glyph = null;
      for (j = 0; j < SECTION_WORDS.length; j++) {
        if (title.indexOf(SECTION_WORDS[j][0]) !== -1 && !used[SECTION_WORDS[j][1]]) {
          glyph = SECTION_WORDS[j][1];
          break;
        }
      }
      if (glyph) {
        used[glyph] = true;
      }
      out.push(glyph);
    }

    for (i = 0; i < out.length; i++) {
      if (out[i]) {
        continue;
      }
      for (j = 0; j < SECTION_POOL.length; j++) {
        if (!used[SECTION_POOL[j]]) {
          out[i] = SECTION_POOL[j];
          used[SECTION_POOL[j]] = true;
          break;
        }
      }
      // A menu with more sections than the pool has glyphs: the tail repeats rather than going
      // blank, because a glyph shared with a section eight rows away still tells this one from its
      // neighbours.
      if (!out[i]) {
        out[i] = SECTION_POOL[i % SECTION_POOL.length];
      }
    }
    return out;
  }

  function sectionGlyph(index) {
    if (!sectionGlyphs) {
      sectionGlyphs = computeSectionGlyphs();
    }
    return sectionGlyphs[index] || SECTION_POOL[0];
  }

  function iconMarkup(node, depth, index) {
    // Artwork is a section level idea, so it is only consulted for the top of the tree. Deeper
    // nodes keep the masked glyph that says what kind of thing they open.
    var art = depth === 0 ? artworkFor(node) : null;
    if (art) {
      return '<img class="etskin-nav-art" src="' + esc(art) + '" alt="">';
    }
    if (depth === 0) {
      return '<span class="etskin-nav-icon etskin-nav-icon-sec-' + sectionGlyph(index) + '"></span>';
    }
    return '<span class="etskin-nav-icon etskin-nav-icon-' + iconFor(node) + '"></span>';
  }

  // Nodes are addressed by their index path into OB.Application.menu ("0.4.2") rather than by id:
  // folders have no id at all, and the path is what makes the lookup on click a walk of three
  // array indexes instead of a search of the whole tree.
  function nodeAt(path) {
    var parts = path.split('.');
    var list = menuData;
    var node = null;
    var i;
    for (i = 0; i < parts.length; i++) {
      if (!list) {
        return null;
      }
      node = list[Number(parts[i])];
      if (!node) {
        return null;
      }
      list = node.submenu;
    }
    return node;
  }

  function renderNodes(list, prefix, depth) {
    var html = [];
    var i, node, path, isFolder;

    for (i = 0; i < list.length; i++) {
      node = list[i];
      path = prefix === '' ? String(i) : prefix + '.' + i;
      isFolder = !!(node.submenu && node.submenu.length);

      html.push('<div class="etskin-nav-group">');
      html.push(
        '<button type="button" class="etskin-nav-row' +
          (depth === 0 ? ' etskin-nav-row-top' : '') +
          (isFolder ? ' etskin-nav-row-folder' : '') +
          '" data-p="' +
          path +
          '" style="--d:' +
          depth +
          '"' +
          (isFolder ? ' aria-expanded="false"' : '') +
          '>'
      );
      html.push(iconMarkup(node, depth, i));
      html.push('<span class="etskin-nav-label">' + esc(node.title) + '</span>');
      if (isFolder) {
        html.push('<span class="etskin-nav-chevron"></span>');
      }
      html.push('</button>');
      if (isFolder) {
        html.push('<div class="etskin-nav-sub">');
        html.push(renderNodes(node.submenu, path, depth + 1));
        html.push('</div>');
      }
      html.push('</div>');
    }
    return html.join('');
  }

  /*
   * The section title is carried on every tile as text as well as on its tooltip. The stylesheet
   * takes it out of the picture but leaves it in the accessibility tree, so the rail is nine named
   * buttons to a screen reader and nine glyphs to everyone else - which a tooltip alone would not
   * have managed, since a tooltip is not an accessible name.
   */
  function renderRail() {
    var html = [];
    var i, node, art;

    for (i = 0; i < menuData.length; i++) {
      node = menuData[i];
      art = artworkFor(node);
      html.push(
        '<button type="button" class="etskin-nav-tile' +
          (art ? '' : ' etskin-nav-icon-sec-' + sectionGlyph(i)) +
          '" data-p="' +
          i +
          '" title="' +
          esc(node.title) +
          '">' +
          (art ? '<img class="etskin-nav-art" src="' + esc(art) + '" alt="">' : '') +
          '<span class="etskin-nav-tile-name">' +
          esc(node.title) +
          '</span>' +
          '</button>'
      );
    }
    return html.join('');
  }

  function recentEntries() {
    if (!OB.RecentUtilities || !OB.RecentUtilities.getRecentValue) {
      return [];
    }
    var recent = OB.RecentUtilities.getRecentValue(RECENT_LIST);
    return recent && recent.length ? recent : [];
  }

  function renderRecents() {
    var recent = recentEntries();
    var html = [];
    var i, title;

    if (!recent.length) {
      return '';
    }
    html.push('<div class="etskin-nav-recents">');
    html.push(
      '<div class="etskin-nav-recents-title">' +
        esc(label('OBKMO_RecentViews', 'Recent Views')) +
        '</div>'
    );
    html.push('<div class="etskin-nav-chips">');
    for (i = 0; i < recent.length && i < 6; i++) {
      title = recent[i].tabTitle || recent[i].title;
      if (!title) {
        continue;
      }
      html.push(
        '<button type="button" class="etskin-nav-chip" data-r="' +
          i +
          '" title="' +
          esc(title) +
          '">' +
          esc(title) +
          '</button>'
      );
    }
    html.push('</div></div>');
    return html.join('');
  }

  // Only labels core already ships are used. The panel deliberately has no strings of its own: a
  // new AD_MESSAGE would mean the module has to be reinstalled before the text appears, and an
  // English literal in a Spanish installation is worse than an icon with no caption.
  function label(key, fallback) {
    if (OB.I18N && OB.I18N.labels && OB.I18N.labels[key]) {
      return OB.I18N.labels[key];
    }
    return fallback;
  }

  function renderPanel() {
    var menuLabel = label('UINAVBA_APPLICATION_MENU', 'Application');
    /*
     * The box narrows the tree down to what matches, which is filtering rather than searching, and
     * "Filter" is a label core already ships translated. The panel deliberately has no strings of
     * its own; see label() below for why.
     */
    var filterLabel = label('OBUIAPP_CalWidget_Filter', 'Filter');
    return (
      '<div class="etskin-nav" role="navigation" aria-label="' +
      esc(menuLabel) +
      '">' +
      '<div class="etskin-nav-head">' +
      '<div class="etskin-nav-search">' +
      '<span class="etskin-nav-search-icon"></span>' +
      '<input type="text" class="etskin-nav-search-input" autocomplete="off" spellcheck="false" placeholder="' +
      esc(filterLabel) +
      '" aria-label="' +
      esc(menuLabel) +
      '">' +
      '</div>' +
      '<button type="button" class="etskin-nav-toggle" aria-label="' +
      esc(menuLabel) +
      '"></button>' +
      '</div>' +
      '<div class="etskin-nav-rail">' +
      renderRail() +
      '</div>' +
      '<div class="etskin-nav-body">' +
      '<div class="etskin-nav-recents-slot">' +
      renderRecents() +
      '</div>' +
      '<div class="etskin-nav-tree">' +
      renderNodes(menuData, '', 0) +
      '</div>' +
      '</div>' +
      '</div>'
    );
  }

  // --------------------------------------------------------------- dom help

  function hasClass(el, name) {
    return (
      el.className && (' ' + el.className + ' ').indexOf(' ' + name + ' ') !== -1
    );
  }

  function closestWithClass(el, name) {
    var node = el;
    while (node && node.nodeType === 1) {
      if (hasClass(node, name)) {
        return node;
      }
      node = node.parentNode;
    }
    return null;
  }

  function panel() {
    return document.querySelector('.etskin-nav');
  }

  // --------------------------------------------------------------- actions

  function toggleFolder(row) {
    var group = row.parentNode;
    var open = hasClass(group, 'etskin-nav-open');
    setClass(group, 'etskin-nav-open', !open);
    row.setAttribute('aria-expanded', open ? 'false' : 'true');
    // Opening or closing a folder changes which rows are on screen, and the mark is only ever put
    // on a row the user can see.
    applyCurrent(currentPath);
  }

  function setClass(el, name, on) {
    if (!el || on === hasClass(el, name)) {
      return;
    }
    if (on) {
      el.className = el.className ? el.className + ' ' + name : name;
    } else {
      el.className = trim(
        (' ' + el.className + ' ').split(' ' + name + ' ').join(' ')
      );
    }
  }

  function trim(value) {
    var out = String(value === null || value === undefined ? '' : value);
    while (out.charAt(0) === ' ') {
      out = out.substring(1);
    }
    while (out.length && out.charAt(out.length - 1) === ' ') {
      out = out.substring(0, out.length - 1);
    }
    return out;
  }

  /*
   * The rail's whole point: collapsed, it still says which section you are in. Without this the
   * 52px strip would be decoration, and hiding the tree would cost the user their bearings.
   */
  function updateRail(path) {
    var root = panel();
    if (!root) {
      return;
    }
    var section = path ? String(path).split('.')[0] : null;
    var tiles = root.querySelectorAll('.etskin-nav-tile');
    var i;
    for (i = 0; i < tiles.length; i++) {
      setClass(
        tiles[i],
        'etskin-nav-tile-current',
        section !== null && tiles[i].getAttribute('data-p') === section
      );
    }
  }

  /*
   * Fills exactly one row, and the rail tile for the section that row belongs to.
   *
   * The row that was opened is usually inside a folder that is closed - the tree starts closed and
   * a window opened from a recent chip or a bookmark never opened one - so it is in the markup but
   * not on the screen, and marking it would leave the expanded panel saying less about where the
   * user is than the 52px rail beside it does. When that happens the mark moves up to the section
   * the row belongs to, which is the section the rail fills, so the two never disagree. It comes
   * back down to the row itself as soon as the folder is opened, because every gesture that changes
   * which rows are visible calls this again.
   */
  function applyCurrent(path) {
    var root = panel();
    if (!root) {
      return;
    }
    var target = path
      ? root.querySelector('.etskin-nav-row[data-p="' + path + '"]')
      : null;
    if (target && target.offsetParent === null) {
      target = root.querySelector(
        '.etskin-nav-row[data-p="' + String(path).split('.')[0] + '"]'
      );
    }
    var rows = root.querySelectorAll('.etskin-nav-row');
    var i;
    for (i = 0; i < rows.length; i++) {
      setClass(rows[i], 'etskin-nav-current', rows[i] === target);
    }
    updateRail(path);
  }

  function markCurrent(row) {
    currentPath = row ? row.getAttribute('data-p') : null;
    applyCurrent(currentPath);
  }

  // The path of the first menu node that opens the given window, wherever in the tree it sits.
  function pathOfWindow(list, prefix, windowId) {
    var i, node, path, found;
    for (i = 0; i < list.length; i++) {
      node = list[i];
      path = prefix === '' ? String(i) : prefix + '.' + i;
      if (node.windowId && String(node.windowId) === windowId) {
        return path;
      }
      if (node.submenu && node.submenu.length) {
        found = pathOfWindow(node.submenu, path, windowId);
        if (found) {
          return found;
        }
      }
    }
    return null;
  }

  /*
   * Keeps the panel in step with the tab strip, so closing a tab or switching to one opened from
   * somewhere else does not leave the highlight behind.
   *
   * The window the tab holds is what identifies it, not the label on it. A tab is renamed the
   * moment a record is selected in it - "Sales Invoice" becomes "Sales Invoice - 1000367 - 03-0..."
   * complete with the ellipsis the strip needs to fit it - and matching that against menu titles
   * found nothing, so the panel and the rail both went blank on exactly the screens a user spends
   * their day on. The title is still the fallback, for a tab that is not a window: the workspace,
   * and whatever a process definition opens.
   */
  /*
   * tabSet.tabSelected covers exactly one of the ways the active window tab changes, and this
   * skin's own users have found the other two: closing the active tab hands the highlight to
   * whichever tab SmartClient promotes next without calling tabSelected at all, and a tab opened
   * from a drill-down or a recent chip can become selected through a code path this file never
   * had a hook for. Patching each one by name means finding every such path first.
   *
   * The tab bar itself does not have that problem: whichever way the active tab changed, core
   * still has to mark it - the "Selected" class the stylesheet already keys off of is right there
   * in the DOM, on the same OBTabBarButtonMainTop element every time. Watching that class instead
   * of the API that moves it covers every path through one observer, including ones core adds
   * later.
   */
  function watchTabBar() {
    var bar = document.querySelector('.OBTabBarMain');
    if (!bar || typeof MutationObserver === 'undefined') {
      return;
    }
    var scheduleSync = function () {
      if (syncTimer) {
        clearTimeout(syncTimer);
      }
      syncTimer = setTimeout(function () {
        syncTimer = null;
        syncCurrent();
        // The pane's windowId is not always set yet on the tick the tab becomes current - a
        // freshly opened window fills it in once its view has loaded. One more pass shortly after
        // catches that without polling for it.
        setTimeout(syncCurrent, 400);
      }, 60);
    };
    var observer = new MutationObserver(function (mutations) {
      var i;
      for (i = 0; i < mutations.length; i++) {
        if (mutations[i].attributeName === 'class') {
          scheduleSync();
          return;
        }
      }
    });
    observer.observe(bar, {
      attributes: true,
      attributeFilter: ['class'],
      subtree: true,
      childList: true
    });
  }

  function syncCurrent() {
    var root = panel();
    if (!root || !OB.MainView || !OB.MainView.TabSet) {
      return;
    }
    var tab = OB.MainView.TabSet.getSelectedTab
      ? OB.MainView.TabSet.getSelectedTab()
      : null;
    var pane = tab && tab.pane;
    var windowId = pane && pane.windowId ? String(pane.windowId) : null;
    var title = (pane && pane.tabTitle) || (tab && (tab.title || tab.tabTitle));
    var rows = root.querySelectorAll('.etskin-nav-row');
    var i, labelEl;
    currentPath = null;
    if (windowId && menuData) {
      currentPath = pathOfWindow(menuData, '', windowId);
    }
    for (i = 0; !currentPath && title && i < rows.length; i++) {
      labelEl = rows[i].querySelector('.etskin-nav-label');
      if (labelEl && labelEl.textContent === title) {
        currentPath = rows[i].getAttribute('data-p');
        break;
      }
    }
    applyCurrent(currentPath);
  }

  function refreshRecents() {
    var root = panel();
    if (!root) {
      return;
    }
    var slot = root.querySelector('.etskin-nav-recents-slot');
    if (slot) {
      slot.innerHTML = renderRecents();
    }
  }

  /*
   * Every open goes through the core menu tree, which is the only code that knows how to turn a
   * menu node into a view, but it is called after clearing loadedWindowClassName on the view
   * manager. That global is written by the generated script of a window that is in development and
   * is never cleared again; ob-view-manager.js reads it in fetchViewCallback and lets it override
   * the name of the view it just fetched, so the first open of any other view - the one that has
   * to fetch, the second finds the class already defined - renders the last development window
   * instead. Clearing it here is safe: a fetch that really is a development window sets it again
   * from its own response.
   */
  function delegateClick(node) {
    try {
      if (OB.Layout && OB.Layout.ViewManager) {
        OB.Layout.ViewManager.loadedWindowClassName = null;
      }
    } catch (ignored) {
      // No view manager yet: nothing stale to clear.
    }
    menuDelegate.itemClick(node, 0);
  }

  function openNode(node, row) {
    if (!node) {
      return;
    }
    markCurrent(row);
    delegateClick(node);
    refreshRecents();
  }

  // ---------------------------------------------------------------- search

  /*
   * Filtering is a class on the root plus a class on every group that contains no match. Every
   * subtree is open while filtering, so a hit four levels down is visible without the user having
   * to expand anything, and the moment the box is cleared the panel is back to whatever was open
   * before - the open state lives in classes on the groups and is never thrown away.
   */
  function filter(query) {
    var root = panel();
    if (!root) {
      return;
    }
    var q = trim(query).toLowerCase();
    var rows = root.querySelectorAll('.etskin-nav-row');
    var groups = root.querySelectorAll('.etskin-nav-group');
    var i, labelEl, hit;

    setClass(root, 'etskin-nav-filtering', q !== '');

    if (q === '') {
      for (i = 0; i < rows.length; i++) {
        setClass(rows[i], 'etskin-nav-hit', false);
      }
      for (i = 0; i < groups.length; i++) {
        setClass(groups[i], 'etskin-nav-off', false);
      }
      return;
    }

    for (i = 0; i < rows.length; i++) {
      labelEl = rows[i].querySelector('.etskin-nav-label');
      hit =
        !!labelEl && labelEl.textContent.toLowerCase().indexOf(q) !== -1;
      setClass(rows[i], 'etskin-nav-hit', hit);
    }

    // A group survives if it or anything under it matched. querySelector searches descendants and
    // the group's own row is one, so no separate bottom-up pass is needed.
    for (i = 0; i < groups.length; i++) {
      setClass(
        groups[i],
        'etskin-nav-off',
        !groups[i].querySelector('.etskin-nav-hit')
      );
    }
  }

  // -------------------------------------------------------------- collapse

  function collapsed() {
    try {
      return window.localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch (e) {
      return false;
    }
  }

  function rememberCollapsed(value) {
    try {
      window.localStorage.setItem(COLLAPSE_KEY, value ? '1' : '0');
    } catch (e) {
      // Private browsing, or site data turned off. The panel still works, it just forgets.
    }
  }

  function applyCollapsed(isCollapsed, focusSearch) {
    var root = panel();
    if (!sidebar) {
      return;
    }
    sidebar.setWidth(isCollapsed ? RAIL_WIDTH : NAV_WIDTH);
    if (root) {
      setClass(root, 'etskin-nav-collapsed', isCollapsed);
      applyCurrent(currentPath);
      if (!isCollapsed && focusSearch) {
        var input = root.querySelector('.etskin-nav-search-input');
        if (input) {
          input.focus();
        }
      }
    }
  }

  // --------------------------------------------------------------- events

  function onClick(event) {
    var target = event.target || event.srcElement;
    if (!closestWithClass(target, 'etskin-nav')) {
      return;
    }

    var toggle = closestWithClass(target, 'etskin-nav-toggle');
    if (toggle) {
      var next = !collapsed();
      rememberCollapsed(next);
      applyCollapsed(next, false);
      return;
    }

    var search = closestWithClass(target, 'etskin-nav-search');
    if (search && collapsed()) {
      rememberCollapsed(false);
      applyCollapsed(false, true);
      return;
    }

    /*
     * A tile is a way back into the tree, not a second way to open a window: it expands the panel
     * and opens that section, which lands the user exactly where the tile pointed. Collapsed mode
     * therefore navigates rather than merely taking up less room.
     */
    var tile = closestWithClass(target, 'etskin-nav-tile');
    if (tile) {
      rememberCollapsed(false);
      applyCollapsed(false, false);
      var section = panel().querySelector(
        '.etskin-nav-row[data-p="' + tile.getAttribute('data-p') + '"]'
      );
      if (section) {
        setClass(section.parentNode, 'etskin-nav-open', true);
        section.setAttribute('aria-expanded', 'true');
        section.scrollIntoView({ block: 'nearest' });
      }
      applyCurrent(currentPath);
      return;
    }

    var chip = closestWithClass(target, 'etskin-nav-chip');
    if (chip) {
      var recent = recentEntries()[Number(chip.getAttribute('data-r'))];
      if (recent) {
        markCurrent(null);
        delegateClick({ recentObject: recent, title: recent.tabTitle });
        refreshRecents();
      }
      return;
    }

    var row = closestWithClass(target, 'etskin-nav-row');
    if (!row) {
      return;
    }
    if (hasClass(row, 'etskin-nav-row-folder')) {
      toggleFolder(row);
      return;
    }
    openNode(nodeAt(row.getAttribute('data-p')), row);
  }

  function onInput(event) {
    var target = event.target || event.srcElement;
    if (!target || !hasClass(target, 'etskin-nav-search-input')) {
      return;
    }
    filter(target.value);
  }

  /*
   * SmartClient's event handler takes focus away from anything it does not know about on mousedown,
   * which is every native input inside a canvas. Stopping the event at the input is what lets the
   * search box keep the caret.
   */
  function onMouseDown(event) {
    var target = event.target || event.srcElement;
    if (target && hasClass(target, 'etskin-nav-search-input')) {
      event.stopPropagation();
    }
  }

  // --------------------------------------------------------------- install

  function hideApplicationMenuButton() {
    if (!OB.NavBar || !OB.NavBar.getMembers) {
      return;
    }
    var members = OB.NavBar.getMembers();
    var i, inner;
    for (i = 0; i < members.length; i++) {
      inner = members[i].getMembers && members[i].getMembers()[0];
      if (inner && inner.getClassName() === 'OBApplicationMenuButton') {
        members[i].hide();
        return;
      }
    }
  }

  function install() {
    var tabSet = OB.MainView && OB.MainView.TabSet;
    if (!tabSet || !OB.Application || !OB.Application.menu) {
      return;
    }

    menuData = OB.Application.menu;
    menuDelegate = isc.OBApplicationMenuTree.create({ autoDraw: false });

    sidebar = isc.Canvas.create({
      width: collapsed() ? RAIL_WIDTH : NAV_WIDTH,
      height: '100%',
      overflow: 'hidden',
      canFocus: false,
      // The panel's open folders, scroll position and search text live in the DOM. A redraw would
      // rebuild the markup from `contents` and lose all three, and SmartClient redraws on every
      // resize unless told otherwise.
      redrawOnResize: false,
      styleName: 'etskinNavCanvas',
      contents: renderPanel()
    });

    var row = isc.HLayout.create({ width: '100%', height: '100%' });
    OB.MainView.removeMember(tabSet);
    OB.MainView.addMember(row);
    row.addMember(sidebar);
    row.addMember(tabSet);

    /*
     * The tab set was sized for a VLayout, where its width was the breadth axis and '100%' meant
     * "as wide as the parent". In an HLayout width is the length axis, so '100%' would make it as
     * wide as the whole row and push it off the right edge by exactly the width of the panel.
     * SmartClient's star means "whatever is left", which is the intent, and height '100%' is now
     * the breadth axis and does stretch.
     */
    tabSet.setWidth('*');
    tabSet.setHeight('100%');

    // Capture, because SmartClient stops a good deal of what happens inside its own canvases.
    document.addEventListener('click', onClick, true);
    document.addEventListener('input', onInput, true);
    document.addEventListener('mousedown', onMouseDown, true);

    // Kept alongside watchTabBar as a second, redundant trigger: cheap, and it still fires first
    // on the one path it does cover, which means one less mutation for the observer to chase.
    var previousTabSelected = tabSet.tabSelected;
    tabSet.tabSelected = function () {
      var result;
      if (previousTabSelected) {
        result = previousTabSelected.apply(this, arguments);
      }
      syncCurrent();
      return result;
    };
    watchTabBar();

    hideApplicationMenuButton();
    applyCollapsed(collapsed(), false);

    OB.ETSkin.nav = {
      canvas: sidebar,
      refreshRecents: refreshRecents,
      syncCurrent: syncCurrent
    };
  }

  // ------------------------------------------------------------------ main

  try {
    if (wanted() && OB.Layout && OB.Layout.initialize) {
      var originalInitialize = OB.Layout.initialize;
      OB.Layout.initialize = function () {
        var result = originalInitialize.apply(this, arguments);
        try {
          install();
        } catch (e) {
          // A panel that fails to build must not cost the user the application. The stock
          // Application menu is still in the navigation bar at this point, because hiding it is
          // the last thing install does.
          if (typeof console !== 'undefined' && console.warn) {
            console.warn('Etendo Modern Skin could not build the side navigation', e);
          }
        }
        return result;
      };
    }
  } catch (e) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('Etendo Modern Skin side navigation is unavailable', e);
    }
  }
})();
