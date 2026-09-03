/*
 *************************************************************************
 * Copyright (C) 2026 Futit Services S.L.
 * Licensed under the Openbravo Public License version 1.1.
 * You may obtain a copy of the License at
 * http://www.openbravo.com/legal/license.html
 ************************************************************************
 */

/*
 * Etendo Modern Skin - point of sale, embedded. A MOCKUP.
 *
 * What this is: a till screen that opens as a tab inside the application, next to the Workspace
 * and any window, rather than as a separate web application on its own URL. It is here to settle
 * the shape of the thing - what is on screen, where the ticket lives, how a line is added, what
 * the keypad is for - before any of it is wired to the server.
 *
 * What this is not: it reads nothing and writes nothing. The catalogue below is a literal, the
 * three customers are literals, the tax rate is a constant and no order, ticket or payment ever
 * leaves the browser. Reloading the tab starts a fresh ticket. The header says so on screen, in a
 * badge, on purpose: a mockup that cannot be told apart from the real thing gets demonstrated as
 * the real thing.
 *
 * How it is embedded. OB.Layout.ViewManager.openView(name, params) instantiates isc[name] and puts
 * it in a tab, and it does not care whether that class came from the server or was defined here -
 * so a view class defined in this file is a first class tab: it has a title, it can be closed, it
 * is added to the recents, and getBookMarkParams puts it in the URL, which means a browser reload
 * brings the tab back. That is the whole of the integration. No window, no tab, no AD record and
 * no menu entry are needed to reach it, which is what makes it a viable mockup: nothing has to be
 * installed for someone to look at it.
 *
 * The screen is one isc.Canvas of markup, for the reason the navigation panel is: thirty product
 * tiles as thirty Canvases would be thirty absolutely positioned widgets for SmartClient to
 * measure, and none of them would lay out as a wrapping grid. One canvas of HTML is one layout
 * pass and it is styled from the stylesheet like the rest of the skin.
 *
 * Same constraints as the other bundles: concatenated into the global static resource and
 * minified with Crockford's JSMin, so conservative ES5 only - no let/const, no arrow functions,
 * no template literals, no trailing commas.
 */

(function () {
  'use strict';

  var VIEW = 'ETSkinPOS';

  /*
   * Prices below include tax, the way a price on a shelf does, so the tax figure on the ticket is
   * extracted from the total rather than added to it. A real terminal takes both the rate and the
   * price list from the organization; this is a constant because it is a mockup.
   */
  var TAX_RATE = 0.21;
  var CURRENCY = 'EUR';

  var CATEGORIES = [
    { key: 'bev', name: 'Beverages' },
    { key: 'beer', name: 'Beer and wine' },
    { key: 'coffee', name: 'Coffee' },
    { key: 'food', name: 'Food' },
    { key: 'snack', name: 'Snacks' }
  ];

  // The demo database is a food and beverage distributor, so the catalogue is one too. Anything
  // recognisable would do; what matters for the mockup is the count, because how a wall of tiles
  // reads at thirty products is the question the screen has to answer.
  var PRODUCTS = [
    { id: 'p01', name: 'Plain Water 50cl', category: 'bev', price: 0.9 },
    { id: 'p02', name: 'Sparkling Water 50cl', category: 'bev', price: 1.1 },
    { id: 'p03', name: 'Cola 33cl', category: 'bev', price: 1.6 },
    { id: 'p04', name: 'Lemonade 33cl', category: 'bev', price: 1.5 },
    { id: 'p05', name: 'Orange Juice 25cl', category: 'bev', price: 2.2 },
    { id: 'p06', name: 'Energy Drink 25cl', category: 'bev', price: 2.4 },
    { id: 'p07', name: 'Iced Tea 33cl', category: 'bev', price: 1.8 },
    { id: 'p08', name: 'Lager 33cl', category: 'beer', price: 2.5 },
    { id: 'p09', name: 'Pale Ale 33cl', category: 'beer', price: 2.8 },
    { id: 'p10', name: 'Alcohol Free Beer', category: 'beer', price: 2.2 },
    { id: 'p11', name: 'Red Wine, glass', category: 'beer', price: 3.6 },
    { id: 'p12', name: 'White Wine, glass', category: 'beer', price: 3.4 },
    { id: 'p13', name: 'Rose Wine, glass', category: 'beer', price: 3.4 },
    { id: 'p14', name: 'Cava, glass', category: 'beer', price: 4.2 },
    { id: 'p15', name: 'Espresso', category: 'coffee', price: 1.2 },
    { id: 'p16', name: 'Cortado', category: 'coffee', price: 1.4 },
    { id: 'p17', name: 'Latte', category: 'coffee', price: 2.1 },
    { id: 'p18', name: 'Cappuccino', category: 'coffee', price: 2.2 },
    { id: 'p19', name: 'Tea', category: 'coffee', price: 1.6 },
    { id: 'p20', name: 'Hot Chocolate', category: 'coffee', price: 2.4 },
    { id: 'p21', name: 'Ham Sandwich', category: 'food', price: 4.5 },
    { id: 'p22', name: 'Cheese Toast', category: 'food', price: 3.9 },
    { id: 'p23', name: 'Tortilla Slice', category: 'food', price: 3.2 },
    { id: 'p24', name: 'Croissant', category: 'food', price: 1.9 },
    { id: 'p25', name: 'Blueberry Muffin', category: 'food', price: 2.3 },
    { id: 'p26', name: 'Green Salad', category: 'food', price: 5.4 },
    { id: 'p27', name: 'Crisps 45g', category: 'snack', price: 1.7 },
    { id: 'p28', name: 'Olives 100g', category: 'snack', price: 2.6 },
    { id: 'p29', name: 'Salted Peanuts', category: 'snack', price: 1.8 },
    { id: 'p30', name: 'Chocolate Bar', category: 'snack', price: 1.5 }
  ];

  var CUSTOMERS = [
    { name: 'Walk-in customer', note: 'No account' },
    { name: 'Hoteles Buenas Noches, S.A.', note: 'Account, 30 days' },
    { name: 'Alimentos y Supermercados, S.A', note: 'Account, price list B' }
  ];

  var state = {
    canvas: null,
    bound: false,
    lines: [], // { id, name, price, qty }
    category: 'all',
    query: '',
    customer: 0,
    // What the keypad has typed, as a string of digits read as cents: "2050" is 20.50, which is
    // how a card terminal and a cash drawer both behave.
    tendered: '',
    settled: null, // { method, total, tendered, change } once the ticket is paid
    notice: ''
  };

  // ------------------------------------------------------------------ gates

  function wanted() {
    return typeof OB !== 'undefined' && !!OB && !!OB.ETSkin && !!OB.User && !OB.User.isPortal &&
      typeof isc !== 'undefined' && !!isc && !!OB.Layout && !!OB.Layout.ViewManager;
  }

  // ---------------------------------------------------------------- strings

  function skinLabel(name, fallback) {
    var labels = OB.ETSkin && OB.ETSkin.labels;
    return labels && labels[name] ? String(labels[name]) : fallback;
  }

  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .split('&').join('&amp;')
      .split('<').join('&lt;')
      .split('>').join('&gt;')
      .split('"').join('&quot;');
  }

  // Amounts follow the user's own mask, so a price here is punctuated the way the same number is
  // in a grid: 1.234,56 for a Spanish session and 1,234.56 for an English one.
  function money(value) {
    var format = OB.Format;
    if (typeof value !== 'number' || isNaN(value)) {
      return '0';
    }
    return OB.Utilities.Number.JSToOBMasked(
      value,
      format.formats.euroInform || format.defaultNumericMask,
      format.defaultDecimalSymbol,
      format.defaultGroupingSymbol,
      format.defaultGroupingSize
    );
  }

  function categoryName(key) {
    var i;
    for (i = 0; i < CATEGORIES.length; i++) {
      if (CATEGORIES[i].key === key) {
        return CATEGORIES[i].name;
      }
    }
    return '';
  }

  function categoryIndex(key) {
    var i;
    for (i = 0; i < CATEGORIES.length; i++) {
      if (CATEGORIES[i].key === key) {
        return i + 1;
      }
    }
    return 1;
  }

  // A tile carries no product image, because a mockup that promises photography promises an
  // upload pipeline with it. Two letters of the name, tinted by category, tell the tiles apart at
  // a glance, which is all the image was doing.
  function monogram(name) {
    var words = String(name).split(' ');
    if (words.length > 1 && words[1].charAt(0)) {
      return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
    }
    return String(name).substring(0, 2).toUpperCase();
  }

  // ----------------------------------------------------------------- ticket

  function productById(id) {
    var i;
    for (i = 0; i < PRODUCTS.length; i++) {
      if (PRODUCTS[i].id === id) {
        return PRODUCTS[i];
      }
    }
    return null;
  }

  function lineIndexOf(id) {
    var i;
    for (i = 0; i < state.lines.length; i++) {
      if (state.lines[i].id === id) {
        return i;
      }
    }
    return -1;
  }

  function totals() {
    var units = 0;
    var gross = 0;
    var net;
    var i;
    for (i = 0; i < state.lines.length; i++) {
      units += state.lines[i].qty;
      gross += state.lines[i].qty * state.lines[i].price;
    }
    net = gross / (1 + TAX_RATE);
    return { units: units, net: net, tax: gross - net, total: gross };
  }

  function tendered() {
    return state.tendered === '' ? 0 : Number(state.tendered) / 100;
  }

  function filtered() {
    var query = state.query.toLowerCase();
    var list = [];
    var i, product;
    for (i = 0; i < PRODUCTS.length; i++) {
      product = PRODUCTS[i];
      if (state.category !== 'all' && product.category !== state.category) {
        continue;
      }
      if (query && product.name.toLowerCase().indexOf(query) === -1) {
        continue;
      }
      list.push(product);
    }
    return list;
  }

  // -------------------------------------------------------------- rendering

  function chipsHtml() {
    var html = [];
    var all = state.category === 'all';
    var i, active;

    html.push('<button type="button" class="etskin-pos-chip' +
      (all ? ' etskin-pos-chip-on' : '') + '" data-act="cat" data-cat="all"' +
      (all ? ' aria-pressed="true"' : ' aria-pressed="false"') + '>' +
      esc(skinLabel('posAll', 'All')) + '</button>');

    for (i = 0; i < CATEGORIES.length; i++) {
      active = state.category === CATEGORIES[i].key;
      html.push('<button type="button" class="etskin-pos-chip etskin-pos-cat-' + (i + 1) +
        (active ? ' etskin-pos-chip-on' : '') +
        '" data-act="cat" data-cat="' + esc(CATEGORIES[i].key) + '"' +
        (active ? ' aria-pressed="true"' : ' aria-pressed="false"') + '>' +
        esc(CATEGORIES[i].name) + '</button>');
    }
    return html.join('');
  }

  function tilesHtml() {
    var list = filtered();
    var html = [];
    var i, product;

    if (!list.length) {
      return '<p class="etskin-pos-empty">' +
        esc(skinLabel('posNoMatch', 'No product matches that.')) + '</p>';
    }
    for (i = 0; i < list.length; i++) {
      product = list[i];
      html.push('<button type="button" class="etskin-pos-tile etskin-pos-cat-' +
        categoryIndex(product.category) + '" data-act="tile" data-id="' + esc(product.id) + '">' +
        '<span class="etskin-pos-tile-mark">' + esc(monogram(product.name)) + '</span>' +
        '<span class="etskin-pos-tile-name">' + esc(product.name) + '</span>' +
        '<span class="etskin-pos-tile-price">' + esc(money(product.price)) + '</span>' +
        '</button>');
    }
    return html.join('');
  }

  function linesHtml() {
    var html = [];
    var i, line;

    if (!state.lines.length) {
      return '<p class="etskin-pos-empty etskin-pos-empty-ticket">' +
        esc(skinLabel('posEmptyTicket', 'Pick a product to start the ticket.')) + '</p>';
    }
    for (i = 0; i < state.lines.length; i++) {
      line = state.lines[i];
      html.push('<div class="etskin-pos-line">' +
        '<div class="etskin-pos-line-main">' +
        '<span class="etskin-pos-line-name">' + esc(line.name) + '</span>' +
        '<span class="etskin-pos-line-unit">' + esc(money(line.price)) + ' ' +
        esc(skinLabel('posEach', 'each')) + '</span>' +
        '</div>' +
        '<div class="etskin-pos-step">' +
        '<button type="button" class="etskin-pos-step-btn" data-act="minus" data-line="' + i +
        '" aria-label="' + esc(skinLabel('posLess', 'One less')) + '">&minus;</button>' +
        '<span class="etskin-pos-step-qty">' + line.qty + '</span>' +
        '<button type="button" class="etskin-pos-step-btn" data-act="plus" data-line="' + i +
        '" aria-label="' + esc(skinLabel('posMore', 'One more')) + '">+</button>' +
        '</div>' +
        '<span class="etskin-pos-line-total">' + esc(money(line.qty * line.price)) + '</span>' +
        '<button type="button" class="etskin-pos-line-drop" data-act="drop" data-line="' + i +
        '" aria-label="' + esc(skinLabel('posRemove', 'Remove line')) + '">&times;</button>' +
        '</div>');
    }
    return html.join('');
  }

  function keypadHtml() {
    var keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', 'C'];
    var html = [];
    var i;
    for (i = 0; i < keys.length; i++) {
      html.push('<button type="button" class="etskin-pos-key' +
        (keys[i] === 'C' ? ' etskin-pos-key-clear' : '') +
        '" data-act="pad" data-key="' + esc(keys[i]) + '">' + esc(keys[i]) + '</button>');
    }
    return html.join('');
  }

  function payHtml() {
    var sum = totals();
    var cash = tendered();
    var short = cash > 0 && cash < sum.total;
    var enough = state.lines.length > 0;

    return '<div class="etskin-pos-tender">' +
      '<div class="etskin-pos-tender-row">' +
      '<span>' + esc(skinLabel('posTendered', 'Cash tendered')) + '</span>' +
      '<span class="etskin-pos-tender-value' + (short ? ' etskin-pos-short' : '') + '">' +
      esc(state.tendered === '' ? '—' : money(cash)) + '</span>' +
      '</div>' +
      '<button type="button" class="etskin-pos-exact" data-act="exact"' +
      (enough ? '' : ' disabled') + '>' +
      esc(skinLabel('posExact', 'Exact amount')) + '</button>' +
      '</div>' +
      '<div class="etskin-pos-pad">' + keypadHtml() + '</div>' +
      (state.notice
        ? '<p class="etskin-pos-notice">' + esc(state.notice) + '</p>'
        : '') +
      '<div class="etskin-pos-pay">' +
      '<button type="button" class="etskin-pos-btn etskin-pos-btn-cash" data-act="cash"' +
      (enough ? '' : ' disabled') + '>' +
      esc(skinLabel('posCash', 'Cash')) + '</button>' +
      '<button type="button" class="etskin-pos-btn etskin-pos-btn-card" data-act="card"' +
      (enough ? '' : ' disabled') + '>' +
      esc(skinLabel('posCard', 'Card')) + '</button>' +
      '</div>';
  }

  // The receipt replaces the ticket rather than covering it: the till is either taking an order or
  // finishing one, and a modal over a screen this size hides the very thing being confirmed.
  function receiptHtml() {
    var done = state.settled;
    return '<div class="etskin-pos-receipt">' +
      '<div class="etskin-pos-receipt-mark"></div>' +
      '<h3 class="etskin-pos-receipt-title">' +
      esc(skinLabel('posPaid', 'Paid')) + '</h3>' +
      '<p class="etskin-pos-receipt-sum">' + esc(money(done.total)) + ' ' +
      '<span class="etskin-pos-cur">' + esc(CURRENCY) + '</span></p>' +
      '<dl class="etskin-pos-receipt-list">' +
      '<dt>' + esc(skinLabel('posMethod', 'Method')) + '</dt><dd>' + esc(done.method) + '</dd>' +
      '<dt>' + esc(skinLabel('posTendered', 'Cash tendered')) + '</dt><dd>' +
      esc(money(done.tendered)) + '</dd>' +
      '<dt>' + esc(skinLabel('posChange', 'Change')) + '</dt><dd>' +
      esc(money(done.change)) + '</dd>' +
      '</dl>' +
      '<button type="button" class="etskin-pos-btn etskin-pos-btn-cash" data-act="new">' +
      esc(skinLabel('posNewTicket', 'New ticket')) + '</button>' +
      '<p class="etskin-pos-receipt-note">' +
      esc(skinLabel('posNothingSaved', 'Nothing was saved: this screen is a mockup.')) +
      '</p>' +
      '</div>';
  }

  function ticketInnerHtml() {
    var sum = totals();
    var customer = CUSTOMERS[state.customer];

    if (state.settled) {
      return receiptHtml();
    }

    return '<header class="etskin-pos-ticket-head">' +
      '<div class="etskin-pos-customer">' +
      '<span class="etskin-pos-customer-name">' + esc(customer.name) + '</span>' +
      '<span class="etskin-pos-customer-note">' + esc(customer.note) + '</span>' +
      '</div>' +
      '<button type="button" class="etskin-pos-link" data-act="customer">' +
      esc(skinLabel('posChange2', 'Change')) + '</button>' +
      '</header>' +
      '<div class="etskin-pos-lines">' + linesHtml() + '</div>' +
      '<div class="etskin-pos-sums">' +
      '<div class="etskin-pos-sum">' +
      '<span>' + esc(skinLabel('posNet', 'Net')) + '</span>' +
      '<span>' + esc(money(sum.net)) + '</span></div>' +
      '<div class="etskin-pos-sum">' +
      '<span>' + esc(skinLabel('posTax', 'Tax')) + ' ' +
      esc(Math.round(TAX_RATE * 100)) + '%</span>' +
      '<span>' + esc(money(sum.tax)) + '</span></div>' +
      '<div class="etskin-pos-sum etskin-pos-sum-total">' +
      '<span>' + esc(skinLabel('posTotal', 'Total')) +
      '<span class="etskin-pos-units">' +
      esc(sum.units) + ' ' + esc(skinLabel('posUnits', 'units')) + '</span></span>' +
      '<span>' + esc(money(sum.total)) +
      ' <span class="etskin-pos-cur">' + esc(CURRENCY) + '</span></span></div>' +
      '</div>' +
      payHtml();
  }

  function shellHtml() {
    var terminal = skinLabel('posTerminal', 'Terminal 01');
    var store = OB.User.organizationName || '';
    var cashier = OB.User.firstName || OB.User.name || '';

    return '<div class="etskin-pos">' +
      '<header class="etskin-pos-head">' +
      '<div class="etskin-pos-id">' +
      '<h1 class="etskin-pos-title">' + esc(skinLabel('posTitle', 'Point of Sale')) + '</h1>' +
      '<span class="etskin-pos-badge">' + esc(skinLabel('posMockup', 'Mockup')) + '</span>' +
      '</div>' +
      '<div class="etskin-pos-meta">' +
      esc([store, terminal, cashier].join(' · ')) +
      '</div>' +
      '<div class="etskin-pos-head-acts">' +
      '<button type="button" class="etskin-pos-link" data-act="clear">' +
      esc(skinLabel('posVoid', 'Void ticket')) + '</button>' +
      '</div>' +
      '</header>' +
      '<div class="etskin-pos-body">' +
      '<section class="etskin-pos-catalogue">' +
      '<div class="etskin-pos-tools">' +
      '<div class="etskin-pos-search">' +
      '<span class="etskin-pos-search-icon"></span>' +
      '<input type="text" class="etskin-pos-search-input" autocomplete="off" spellcheck="false"' +
      ' value="' + esc(state.query) + '"' +
      ' placeholder="' + esc(skinLabel('posSearch', 'Search the catalogue')) + '"' +
      ' aria-label="' + esc(skinLabel('posSearch', 'Search the catalogue')) + '">' +
      '</div>' +
      '<div class="etskin-pos-chips" data-pos-chips>' + chipsHtml() + '</div>' +
      '</div>' +
      '<div class="etskin-pos-tiles" data-pos-tiles>' + tilesHtml() + '</div>' +
      '</section>' +
      '<aside class="etskin-pos-ticket" data-pos-ticket>' + ticketInnerHtml() + '</aside>' +
      '</div>' +
      '</div>';
  }

  // --------------------------------------------------------------- dom help

  function root() {
    if (!state.canvas || !state.canvas.isDrawn || !state.canvas.isDrawn()) {
      return null;
    }
    return state.canvas.getHandle().querySelector('.etskin-pos');
  }

  function slot(selector) {
    var element = root();
    return element ? element.querySelector(selector) : null;
  }

  /*
   * A canvas redraws itself from the contents string it was given, not from the DOM as it stands:
   * one resize of the window and every patch made below would be thrown away and the shell would
   * come back empty, mid-ticket. So each paint also restates the contents - assigned rather than
   * set, because setContents would redraw, and a redraw on every keystroke would take the caret
   * out of the search box. The DOM is what the cashier sees; the string is what survives a redraw.
   */
  function sync() {
    if (state.canvas) {
      state.canvas.contents = shellHtml();
    }
  }

  function paintTiles() {
    var tiles = slot('[data-pos-tiles]');
    var chips = slot('[data-pos-chips]');
    if (tiles) {
      tiles.innerHTML = tilesHtml();
    }
    if (chips) {
      chips.innerHTML = chipsHtml();
    }
    sync();
  }

  // The ticket is repainted whole on every change. It is at most a few dozen nodes, and the
  // alternative - patching the one line that moved - is where a mockup starts growing a rendering
  // framework it does not need.
  function paintTicket() {
    var ticket = slot('[data-pos-ticket]');
    if (ticket) {
      ticket.innerHTML = ticketInnerHtml();
    }
    sync();
  }

  function closestWithAttribute(element, name) {
    var node = element;
    while (node && node.getAttribute) {
      if (node.getAttribute(name) !== null) {
        return node;
      }
      node = node.parentNode;
    }
    return null;
  }

  function closestWithClass(element, name) {
    var node = element;
    while (node) {
      if (node.className && (' ' + node.className + ' ').indexOf(' ' + name + ' ') !== -1) {
        return node;
      }
      node = node.parentNode;
    }
    return null;
  }

  // ---------------------------------------------------------------- actions

  function addProduct(id) {
    var product = productById(id);
    var at;
    if (!product) {
      return;
    }
    if (state.settled) {
      newTicket();
    }
    at = lineIndexOf(id);
    if (at === -1) {
      state.lines.push({ id: product.id, name: product.name, price: product.price, qty: 1 });
    } else {
      state.lines[at].qty += 1;
    }
    state.notice = '';
    paintTicket();
  }

  function bump(index, delta) {
    var line = state.lines[index];
    if (!line) {
      return;
    }
    line.qty += delta;
    if (line.qty < 1) {
      state.lines.splice(index, 1);
    }
    state.notice = '';
    paintTicket();
  }

  function drop(index) {
    if (state.lines[index]) {
      state.lines.splice(index, 1);
      state.notice = '';
      paintTicket();
    }
  }

  function newTicket() {
    state.lines = [];
    state.tendered = '';
    state.settled = null;
    state.notice = '';
    paintTicket();
  }

  function pad(key) {
    if (key === 'C') {
      state.tendered = '';
    } else if (state.tendered.length < 8) {
      state.tendered = (state.tendered + key).replace(/^0+(?=\d)/, '');
    }
    state.notice = '';
    paintTicket();
  }

  function settle(method, cash) {
    var sum = totals();
    state.settled = {
      method: method,
      total: sum.total,
      tendered: cash,
      change: cash - sum.total
    };
    state.tendered = '';
    state.notice = '';
    paintTicket();
  }

  function payCash() {
    var sum = totals();
    var cash = tendered();
    if (!state.lines.length) {
      return;
    }
    // Nothing typed is read as the exact amount, which is what a till does when the cashier takes
    // the note that matches. Too little is a mistake, and it is said where the keypad is.
    if (cash === 0) {
      settle(skinLabel('posCash', 'Cash'), sum.total);
      return;
    }
    if (cash < sum.total) {
      state.notice = skinLabel('posShort', 'That is less than the total.');
      paintTicket();
      return;
    }
    settle(skinLabel('posCash', 'Cash'), cash);
  }

  function payCard() {
    var sum = totals();
    if (!state.lines.length) {
      return;
    }
    settle(skinLabel('posCard', 'Card'), sum.total);
  }

  function cycleCustomer() {
    state.customer = (state.customer + 1) % CUSTOMERS.length;
    paintTicket();
  }

  function onClick(event) {
    var target = event.target || event.srcElement;
    var action, name, line;

    if (!closestWithClass(target, 'etskin-pos')) {
      return;
    }
    action = closestWithAttribute(target, 'data-act');
    if (!action || action.disabled) {
      return;
    }
    name = action.getAttribute('data-act');
    line = Number(action.getAttribute('data-line'));

    switch (name) {
    case 'cat':
      state.category = action.getAttribute('data-cat');
      state.query = '';
      paintTiles();
      break;
    case 'tile':
      addProduct(action.getAttribute('data-id'));
      break;
    case 'plus':
      bump(line, 1);
      break;
    case 'minus':
      bump(line, -1);
      break;
    case 'drop':
      drop(line);
      break;
    case 'clear':
      newTicket();
      break;
    case 'customer':
      cycleCustomer();
      break;
    case 'pad':
      pad(action.getAttribute('data-key'));
      break;
    case 'exact':
      state.tendered = String(Math.round(totals().total * 100));
      state.notice = '';
      paintTicket();
      break;
    case 'cash':
      payCash();
      break;
    case 'card':
      payCard();
      break;
    case 'new':
      newTicket();
      break;
    default:
      break;
    }
  }

  function onInput(event) {
    var target = event.target || event.srcElement;
    if (!target || !closestWithClass(target, 'etskin-pos-search')) {
      return;
    }
    state.query = target.value || '';
    paintTiles();
  }

  function bind() {
    if (state.bound) {
      return;
    }
    document.addEventListener('click', onClick, true);
    document.addEventListener('input', onInput, true);
    state.bound = true;
  }

  // ------------------------------------------------------------------- view

  /*
   * The class is defined at load time rather than on first use, because restoreState looks for
   * isc[viewId] when it replays a bookmarked URL: a POS tab that was open when the browser was
   * reloaded has to find its class already there, or the tab comes back empty.
   */
  function defineView() {
    if (isc[VIEW]) {
      return;
    }
    isc.defineClass(VIEW, isc.Canvas).addProperties({
      tabTitle: skinLabel('posTitle', 'Point of Sale'),
      width: '100%',
      height: '100%',
      overflow: 'hidden',
      redrawOnResize: false,
      styleName: 'etskinPOSCanvas',

      // One till per session: asking for the POS while it is open focuses the tab that is there
      // instead of opening a second one, which is what isSameTab is asked for.
      isSameTab: function (viewName) {
        return viewName === VIEW;
      },

      getBookMarkParams: function () {
        return { viewId: VIEW, tabTitle: this.tabTitle };
      },

      initWidget: function () {
        this.Super('initWidget', arguments);
        state.canvas = this;
        state.settled = null;
        state.notice = '';
        this.setContents(shellHtml());
        bind();
      },

      destroy: function () {
        if (state.canvas === this) {
          state.canvas = null;
        }
        return this.Super('destroy', arguments);
      }
    });
  }

  // ------------------------------------------------------------------- main

  try {
    if (wanted()) {
      defineView();
      OB.ETSkin.openPOS = function () {
        OB.Layout.ViewManager.openView(VIEW, {
          viewId: VIEW,
          tabTitle: skinLabel('posTitle', 'Point of Sale')
        });
      };
    }
  } catch (e) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('Etendo Modern Skin could not install the point of sale', e);
    }
  }
})();
