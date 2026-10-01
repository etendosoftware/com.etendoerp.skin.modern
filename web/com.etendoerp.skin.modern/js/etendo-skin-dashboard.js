/*
 *************************************************************************
 * Copyright (C) 2026 Futit Services S.L.
 * Licensed under the Openbravo Public License version 1.1.
 * You may obtain a copy of the License at
 * http://www.openbravo.com/legal/license.html
 ************************************************************************
 */

/*
 * Etendo Modern Skin - workspace dashboard.
 *
 * The Workspace is the first screen of every session and in a stock instance it is empty: the
 * widget framework is there, thirty widget classes are installed, and obkmo_widget_instance has
 * no rows, so the portal area shows nothing at all. What is left is the inherited left column,
 * which opens with Recent Views - the very list this skin's side navigation already carries at
 * the top of every screen. The home screen therefore says nothing about the business and repeats
 * the one thing it does say.
 *
 * This file makes it a dashboard instead:
 *
 *   - Four figures across the top, each one query: what is waiting to be collected, what is
 *     waiting to be paid, how many confirmed sales orders are still undelivered and how many
 *     orders are sitting in draft. Amounts are the client's own currency, which is stated on the
 *     card, because an instance that invoices in three currencies cannot have them added up.
 *   - Three lists below: invoices pending payment, orders awaiting delivery and the recent
 *     documents the inherited column used to hold. A row opens that record; a figure opens its
 *     window.
 *   - The inherited column loses its two recent lists and keeps its widget management, moved to a
 *     panel behind a Manage button. Refresh and Add widget are promoted to the header, so the
 *     stock actions are all still reachable and no user who has widgets loses them: the portal
 *     stays underneath the dashboard and appears as soon as it has something to show.
 *
 * Which cards appear is decided by the role's own menu, not by this file: a figure is dropped
 * unless the window it points at is in OB.Application.menu, which is where window access already
 * lives. The queries go to the standard datasource, so every client and organization rule is
 * applied on the server exactly as it is for a grid.
 *
 * Same constraints as the other bundles: concatenated into the global static resource and
 * minified with Crockford's JSMin, so conservative ES5 only - no let/const, no arrow functions,
 * no template literals, no trailing commas.
 */

(function () {
  'use strict';

  // The widget panel is only opened to add or administer widgets, so it is a drawer rather than a
  // column: wide enough for the stock dialogs it hosts, and closed until asked for.
  var SIDE_WIDTH = 300;
  var LIST_ROWS = 6;
  // Air under the last widget, and the room a drop needs when the portal is opened empty.
  var PORTAL_PAD = 24;
  var PORTAL_MIN = 200;

  var state = { view: null, canvas: null, stack: null, currency: null, bound: false };

  // ------------------------------------------------------------------ gates

  function wanted() {
    return typeof OB !== 'undefined' && !!OB && !!OB.ETSkin && !!OB.User && !OB.User.isPortal &&
      typeof isc !== 'undefined' && !!isc;
  }

  // ---------------------------------------------------------------- strings

  function skinLabel(name, fallback) {
    var labels = OB.ETSkin && OB.ETSkin.labels;
    return labels && labels[name] ? String(labels[name]) : fallback;
  }

  // The stock labels are already translated for every language the instance carries, so the
  // actions this file moves out of the left column keep the words they had there.
  function label(key, fallback) {
    var value = OB.I18N && OB.I18N.labels ? OB.I18N.labels[key] : null;
    return value ? String(value) : fallback;
  }

  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .split('&').join('&amp;')
      .split('<').join('&lt;')
      .split('>').join('&gt;')
      .split('"').join('&quot;');
  }

  function fill(template, value) {
    return String(template).split('{0}').join(value);
  }

  // ---------------------------------------------------------------- numbers

  function money(value) {
    var format = OB.Format;
    if (typeof value !== 'number' || isNaN(value)) {
      return '—';
    }
    return OB.Utilities.Number.JSToOBMasked(
      value,
      format.formats.euroInform || format.defaultNumericMask,
      format.defaultDecimalSymbol,
      format.defaultGroupingSymbol,
      format.defaultGroupingSize
    );
  }

  // Counts are grouped with the user's own separator but never given decimals: "1,438", not
  // "1,438.00", which is what the amount mask would produce.
  function whole(value) {
    var separator = OB.Format.defaultGroupingSymbol || ',';
    if (typeof value !== 'number' || isNaN(value)) {
      return '—';
    }
    return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, separator);
  }

  // The datasource sends dates as yyyy-MM-dd whatever the user's mask is; the dashboard shows them
  // in the mask, so a date here reads the same as the same date in a grid.
  function dateText(value) {
    var parts;
    if (!value) {
      return '';
    }
    parts = String(value).substring(0, 10).split('-');
    if (parts.length !== 3) {
      return String(value);
    }
    return OB.Utilities.Date.JSToOB(
      new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])),
      OB.Format.date
    );
  }

  // ------------------------------------------------------------------- data

  function dsUrl(entity, params) {
    var query = [];
    var key;
    for (key in params) {
      if (Object.prototype.hasOwnProperty.call(params, key)) {
        query.push(encodeURIComponent(key) + '=' + encodeURIComponent(params[key]));
      }
    }
    return OB.Utilities.applicationUrl('org.openbravo.service.datasource/' + entity) +
      '?' + query.join('&');
  }

  /*
   * A card that cannot load says so and nothing else: the dashboard is the first screen of the
   * session and a failed query here must not raise a dialog over it, so every failure arrives at
   * the callback as null and is rendered as a dash.
   */
  function request(entity, params, done) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', dsUrl(entity, params), true);
    xhr.onreadystatechange = function () {
      var payload = null;
      var response;
      if (xhr.readyState !== 4) {
        return;
      }
      try {
        payload = JSON.parse(xhr.responseText);
      } catch (e) {
        payload = null;
      }
      response = payload && payload.response;
      if (xhr.status !== 200 || !response || response.status !== 0 || !response.data) {
        done(null);
        return;
      }
      done(response.data);
    };
    xhr.send();
  }

  /*
   * One request per figure. The summary settings become HQL select functions, so the sum and the
   * count of the same filtered set arrive together - and totalRows cannot be used for the count,
   * because a summary request always reports one row.
   *
   * The criteria parameter is the one parameter of the datasource protocol that carries no leading
   * underscore: DataSourceServlet hands the request parameters through untouched and JsonUtils
   * reads 'criteria'. A misnamed one is not an error, it is simply never read - the request
   * succeeds and answers for the whole table. An earlier version of this file sent '_criteria' and
   * every figure on the dashboard was the unfiltered population.
   */
  function summary(entity, criteria, fields, done) {
    request(entity, {
      _operationType: 'fetch',
      _startRow: 0,
      _endRow: 1,
      _selectedProperties: 'id',
      criteria: JSON.stringify(criteria),
      _summary: JSON.stringify(fields)
    }, function (data) {
      done(data && data[0] ? data[0] : null);
    });
  }

  function list(entity, criteria, properties, sortBy, done) {
    request(entity, {
      _operationType: 'fetch',
      _startRow: 0,
      _endRow: LIST_ROWS,
      _selectedProperties: properties,
      _sortBy: sortBy,
      criteria: JSON.stringify(criteria)
    }, function (data) {
      done(data ? data.slice(0, LIST_ROWS) : null);
    });
  }

  // The client's currency, which is what the figures are stated in. Resolved once per session and
  // before any figure is asked for, because it is part of every one of their filters.
  function resolveCurrency(done) {
    request('ADClient', {
      _operationType: 'fetch',
      _startRow: 0,
      _endRow: 1,
      _selectedProperties: 'id,currency',
      criteria: JSON.stringify({ fieldName: 'id', operator: 'equals', value: OB.User.clientId })
    }, function (data) {
      var row = data && data[0];
      if (row && row.currency) {
        state.currency = { id: row.currency, iso: row['currency$_identifier'] || '' };
      }
      done();
    });
  }

  // ------------------------------------------------------------------ menus

  /*
   * The role's menu is the access rule this file obeys. It also carries the window's translated
   * title and its first tab, which is what openView needs, so nothing about a target window has
   * to be restated here beyond its id.
   */
  function menuEntry(windowId) {
    var found = null;

    function walk(nodes) {
      var i, node;
      for (i = 0; i < nodes.length && !found; i++) {
        node = nodes[i];
        if (node.type === 'window' && node.windowId === windowId) {
          found = { title: node.title, tabId: node.tabId };
          return;
        }
        if (node.submenu) {
          walk(node.submenu);
        }
      }
    }

    if (!OB.Application || !OB.Application.menu) {
      return null;
    }
    walk(OB.Application.menu);
    return found;
  }

  // ------------------------------------------------------------------ cards

  function salesInvoicesOpen() {
    return [
      { fieldName: 'salesTransaction', operator: 'equals', value: true },
      { fieldName: 'processed', operator: 'equals', value: true },
      { fieldName: 'paymentComplete', operator: 'equals', value: false },
      { fieldName: 'documentStatus', operator: 'notEqual', value: 'VO' }
    ];
  }

  function purchaseInvoicesOpen() {
    return [
      { fieldName: 'salesTransaction', operator: 'equals', value: false },
      { fieldName: 'processed', operator: 'equals', value: true },
      { fieldName: 'paymentComplete', operator: 'equals', value: false },
      { fieldName: 'documentStatus', operator: 'notEqual', value: 'VO' }
    ];
  }

  function ordersUndelivered() {
    return [
      { fieldName: 'salesTransaction', operator: 'equals', value: true },
      { fieldName: 'documentStatus', operator: 'equals', value: 'CO' },
      { fieldName: 'delivered', operator: 'equals', value: false }
    ];
  }

  function ordersDraft() {
    return [
      { fieldName: 'salesTransaction', operator: 'equals', value: true },
      { fieldName: 'documentStatus', operator: 'equals', value: 'DR' }
    ];
  }

  /*
   * Only real columns are read. outstandingAmount, dueAmount and daysTillDue are computed columns:
   * they aggregate correctly in HQL but come back as zero on a row, so a list that showed them
   * would show a column of zeros. The figures therefore state the value of the open documents,
   * which is the same number the rows underneath add up to.
   */
  function figures() {
    return [
      {
        key: 'receivable',
        windowId: '167',
        label: skinLabel('dashReceivable', 'To collect'),
        note: skinLabel('dashReceivableNote', 'Sales invoices completed and unpaid'),
        entity: 'Invoice',
        criteria: salesInvoicesOpen(),
        headline: 'amount',
        unit: skinLabel('dashInvoices', '{0} invoices'),
        tone: 'accent'
      },
      {
        key: 'payable',
        windowId: '183',
        label: skinLabel('dashPayable', 'To pay'),
        note: skinLabel('dashPayableNote', 'Purchase invoices completed and unpaid'),
        entity: 'Invoice',
        criteria: purchaseInvoicesOpen(),
        headline: 'amount',
        unit: skinLabel('dashInvoices', '{0} invoices'),
        tone: 'plain'
      },
      {
        key: 'deliver',
        windowId: '143',
        label: skinLabel('dashDeliver', 'To deliver'),
        note: skinLabel('dashDeliverNote', 'Confirmed sales orders not delivered yet'),
        entity: 'Order',
        criteria: ordersUndelivered(),
        headline: 'count',
        tone: 'plain'
      },
      {
        key: 'draft',
        windowId: '143',
        label: skinLabel('dashDraft', 'Draft orders'),
        note: skinLabel('dashDraftNote', 'Sales orders never completed'),
        entity: 'Order',
        criteria: ordersDraft(),
        headline: 'count',
        tone: 'plain'
      }
    ];
  }

  function panels() {
    return [
      {
        key: 'invoices',
        windowId: '167',
        title: skinLabel('dashPendingInvoices', 'Invoices pending payment'),
        entity: 'Invoice',
        criteria: salesInvoicesOpen(),
        properties: 'id,documentNo,invoiceDate,grandTotalAmount,businessPartner,currency',
        sortBy: '-invoiceDate',
        row: function (record) {
          return {
            id: record.id,
            title: record.documentNo,
            sub: record['businessPartner$_identifier'],
            meta: dateText(record.invoiceDate),
            value: money(record.grandTotalAmount),
            unit: record['currency$_identifier']
          };
        }
      },
      {
        key: 'orders',
        windowId: '143',
        title: skinLabel('dashPendingOrders', 'Orders awaiting delivery'),
        entity: 'Order',
        criteria: ordersUndelivered(),
        properties:
          'id,documentNo,scheduledDeliveryDate,grandTotalAmount,businessPartner,currency',
        sortBy: 'scheduledDeliveryDate',
        row: function (record) {
          return {
            id: record.id,
            title: record.documentNo,
            sub: record['businessPartner$_identifier'],
            meta: dateText(record.scheduledDeliveryDate),
            value: money(record.grandTotalAmount),
            unit: record['currency$_identifier']
          };
        }
      },
      {
        key: 'recents',
        source: 'recents',
        title: label('OBKMO_RecentDocuments', 'Recent documents')
      }
    ];
  }

  // The list the inherited column kept, read from the same place it read it.
  function recentDocuments() {
    var manager = OB.Layout && OB.Layout.ViewManager && OB.Layout.ViewManager.recentManager;
    var recents = manager ? manager.getRecentValue('OBUIAPP_RecentDocumentsList') : null;
    return recents ? recents.slice(0, LIST_ROWS) : [];
  }

  // -------------------------------------------------------------- rendering

  function skeleton() {
    return '<span class="etskin-dash-skel"></span>';
  }

  function headHtml() {
    var name = OB.User.firstName || OB.User.name || '';
    var meta = [OB.User.clientName, OB.User.organizationName,
      OB.Utilities.Date.JSToOB(new Date(), OB.Format.date)];
    var parts = [];
    var i;
    for (i = 0; i < meta.length; i++) {
      if (meta[i]) {
        parts.push(esc(meta[i]));
      }
    }
    return '<div class="etskin-dash-head">' +
      '<div class="etskin-dash-id">' +
      '<h1 class="etskin-dash-hello">' +
      esc(fill(skinLabel('dashGreeting', 'Welcome back, {0}'), name)) +
      '</h1>' +
      '<div class="etskin-dash-meta">' + parts.join(' &middot; ') + '</div>' +
      '</div>' +
      /*
       * The till and the order board used to open from here, because they had no menu entry to be
       * reached from. They have one now - OKR, POS and Kanban all hang off the menu - so the
       * header is back to acting on the dashboard itself.
       */
      '<div class="etskin-dash-acts">' +
      '<button type="button" class="etskin-dash-act" data-act="refresh">' +
      esc(label('OBKMO_WMO_Refresh', 'Refresh')) + '</button>' +
      '<button type="button" class="etskin-dash-act" data-act="add">' +
      esc(label('OBKMO_AddWidget', 'Add widget')) + '</button>' +
      '<button type="button" class="etskin-dash-act etskin-dash-act-quiet" data-act="manage">' +
      esc(label('OBKMO_Manage_MyOpenbravo', 'Manage workspace')) + '</button>' +
      '</div></div>';
  }

  /*
   * The currency is stated in the caption of a money figure rather than beside its value, and the
   * span is emitted empty: the shell is built before the client's currency has been answered for,
   * so fillFigure is what puts the ISO code in it.
   */
  function figureHtml(figure, entry) {
    var caption = esc(figure.label) +
      (figure.headline === 'amount'
        ? ' <span class="etskin-dash-cur" data-kpi-cur="' + esc(figure.key) + '"></span>'
        : '');
    return '<div class="etskin-dash-kpi etskin-dash-kpi-' + figure.tone + '"' +
      ' data-window="' + esc(figure.windowId) + '"' +
      ' data-tab="' + esc(entry.tabId) + '"' +
      ' data-title="' + esc(entry.title) + '"' +
      ' role="button" tabindex="0"' +
      ' title="' + esc(figure.note) + '">' +
      '<div class="etskin-dash-kpi-label">' + caption + '</div>' +
      '<div class="etskin-dash-kpi-value" data-kpi="' + esc(figure.key) + '">' +
      skeleton() + '</div>' +
      '<div class="etskin-dash-kpi-foot" data-kpi-foot="' + esc(figure.key) + '">' +
      esc(entry.title) + '</div>' +
      '</div>';
  }

  function panelHtml(panel, entry) {
    var attributes = entry
      ? ' data-window="' + esc(panel.windowId) + '" data-tab="' + esc(entry.tabId) +
        '" data-title="' + esc(entry.title) + '"'
      : '';
    var open = entry
      ? '<button type="button" class="etskin-dash-more" data-act="open"' + attributes + '>' +
        esc(skinLabel('dashOpen', 'Open window')) + '</button>'
      : '';
    return '<section class="etskin-dash-card etskin-dash-card-' + esc(panel.key) + '"' +
      attributes + '>' +
      '<header class="etskin-dash-card-head">' +
      '<h2 class="etskin-dash-card-title">' + esc(panel.title) + '</h2>' + open +
      '</header>' +
      '<div class="etskin-dash-rows" data-list="' + esc(panel.key) + '">' +
      '<div class="etskin-dash-row etskin-dash-row-quiet">' + skeleton() + '</div>' +
      '</div></section>';
  }

  function rowHtml(row) {
    return '<div class="etskin-dash-row" data-id="' + esc(row.id) + '" role="button" tabindex="0">' +
      '<div class="etskin-dash-row-main">' +
      '<span class="etskin-dash-row-title">' + esc(row.title) + '</span>' +
      '<span class="etskin-dash-row-sub">' + esc(row.sub) + '</span>' +
      '</div>' +
      '<div class="etskin-dash-row-side">' +
      '<span class="etskin-dash-row-value">' + esc(row.value) +
      (row.unit ? ' <span class="etskin-dash-cur">' + esc(row.unit) + '</span>' : '') +
      '</span>' +
      '<span class="etskin-dash-row-meta">' + esc(row.meta) + '</span>' +
      '</div></div>';
  }

  function recentRowHtml(recent, index) {
    return '<div class="etskin-dash-row" data-recent="' + index + '" role="button" tabindex="0">' +
      '<div class="etskin-dash-row-main">' +
      '<span class="etskin-dash-row-title">' + esc(recent.recentTitle) + '</span>' +
      '<span class="etskin-dash-row-sub">' + esc(recent.tabTitle) + '</span>' +
      '</div></div>';
  }

  function emptyHtml(text) {
    return '<div class="etskin-dash-row etskin-dash-row-quiet">' + esc(text) + '</div>';
  }

  function shellHtml() {
    var kpis = figures();
    var cards = panels();
    var html = '<div class="etskin-dash">' + headHtml();
    var entry, i;

    html += '<div class="etskin-dash-kpis">';
    for (i = 0; i < kpis.length; i++) {
      entry = menuEntry(kpis[i].windowId);
      if (entry) {
        html += figureHtml(kpis[i], entry);
      }
    }
    html += '</div>';

    html += '<div class="etskin-dash-cards">';
    for (i = 0; i < cards.length; i++) {
      entry = cards[i].windowId ? menuEntry(cards[i].windowId) : null;
      if (entry || cards[i].source) {
        html += panelHtml(cards[i], entry);
      }
    }
    html += '</div>';

    return html + '</div>';
  }

  // ---------------------------------------------------------------- filling

  function root() {
    return document.querySelector('.etskin-dash');
  }

  /*
   * The canvas is as tall as the HTML inside it, and that HTML grows twice: once when the shell is
   * written and again as each query answers and a card fills with rows. SmartClient measures a
   * canvas when it draws it, not when its markup changes, so the height is restated here after
   * every answer - otherwise the cards are drawn over by the widgets underneath them.
   */
  function measure() {
    var element = root();
    var height;
    if (!state.canvas || !element) {
      return;
    }
    height = element.scrollHeight;
    if (height > 0 && Math.abs(height - state.canvas.getHeight()) > 1) {
      state.canvas.setHeight(height);
      syncPortal();
    }
  }

  function slot(selector) {
    var element = root();
    return element ? element.querySelector(selector) : null;
  }

  // A money figure with no currency to state has nothing true to say, so it says nothing.
  function blankFigure(figure) {
    var value = slot('[data-kpi="' + figure.key + '"]');
    var foot = slot('[data-kpi-foot="' + figure.key + '"]');
    if (value) {
      value.innerHTML = '&mdash;';
    }
    if (foot) {
      foot.innerHTML = esc(skinLabel('dashNoCurrency', 'No currency set for this client'));
    }
    measure();
  }

  /*
   * A money figure is asked for in one currency and says which: amounts in different currencies
   * cannot be added, so the filter and the caption go together and a figure without a resolved
   * currency states no amount at all. A count figure is currency blind on purpose - an order is
   * one order whatever it is priced in - so it asks for no sum, and its second line is the
   * sentence that describes the set instead.
   */
  function fillFigure(figure) {
    var criteria = figure.criteria.slice(0);
    var amounts = figure.headline === 'amount';
    var iso = slot('[data-kpi-cur="' + figure.key + '"]');
    var fields = { id: 'count' };

    if (amounts) {
      if (!state.currency) {
        blankFigure(figure);
        return;
      }
      criteria.push({ fieldName: 'currency', operator: 'equals', value: state.currency.id });
      fields.grandTotalAmount = 'sum';
      if (iso) {
        iso.innerHTML = esc(state.currency.iso);
      }
    }

    summary(figure.entity, criteria, fields, function (row) {
      var value = slot('[data-kpi="' + figure.key + '"]');
      var foot = slot('[data-kpi-foot="' + figure.key + '"]');
      var count = row ? row.id : null;
      if (!value || !foot) {
        return;
      }
      if (amounts) {
        value.innerHTML = esc(money(row ? row.grandTotalAmount || 0 : 0));
        foot.innerHTML = esc(fill(figure.unit, whole(count || 0)));
      } else {
        value.innerHTML = esc(whole(count || 0));
        foot.innerHTML = esc(figure.note);
      }
      measure();
    });
  }

  function fillPanel(panel) {
    var container = slot('[data-list="' + panel.key + '"]');
    var html = '';
    var recents, i;

    if (!container) {
      return;
    }

    if (panel.source === 'recents') {
      recents = recentDocuments();
      for (i = 0; i < recents.length; i++) {
        html += recentRowHtml(recents[i], i);
      }
      container.innerHTML = html ||
        emptyHtml(skinLabel('dashNoRecents', 'Documents you open will be listed here'));
      measure();
      return;
    }

    list(panel.entity, panel.criteria, panel.properties, panel.sortBy, function (records) {
      var rows = '';
      var j;
      if (!records) {
        container.innerHTML = emptyHtml(skinLabel('dashFailed', 'This list could not be loaded'));
        measure();
        return;
      }
      for (j = 0; j < records.length; j++) {
        rows += rowHtml(panel.row(records[j]));
      }
      container.innerHTML = rows ||
        emptyHtml(skinLabel('dashNothing', 'Nothing pending here'));
      measure();
    });
  }

  function load() {
    var kpis = figures();
    var cards = panels();
    var i;
    for (i = 0; i < kpis.length; i++) {
      if (menuEntry(kpis[i].windowId)) {
        fillFigure(kpis[i]);
      }
    }
    for (i = 0; i < cards.length; i++) {
      if (cards[i].source || menuEntry(cards[i].windowId)) {
        fillPanel(cards[i]);
      }
    }
  }

  // ---------------------------------------------------------------- actions

  function hasClass(el, name) {
    return el.className && (' ' + el.className + ' ').indexOf(' ' + name + ' ') !== -1;
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

  function closestWithAttribute(el, name) {
    var node = el;
    while (node && node.nodeType === 1) {
      if (node.getAttribute && node.getAttribute(name) !== null) {
        return node;
      }
      node = node.parentNode;
    }
    return null;
  }

  function openWindow(element, recordId) {
    var windowId = element.getAttribute('data-window');
    var tabId = element.getAttribute('data-tab');
    if (!windowId) {
      return;
    }
    OB.Utilities.openView(windowId, tabId, element.getAttribute('data-title'), recordId || null);
  }

  function side() {
    return state.view && state.view.leftColumnLayout;
  }

  function toggleSide(force) {
    var panel = side();
    var open;
    if (!panel) {
      return;
    }
    open = force === undefined ? !panel.isVisible() : force;
    if (open) {
      panel.show();
    } else {
      panel.hide();
    }
    syncPortal();
  }

  /*
   * Add widget is the stock link, called where it stands. Reimplementing it would mean
   * reimplementing the widget selector, the drag source it registers and the admin publishing
   * flow behind it; opening the drawer and clicking the link the framework already built keeps
   * every one of those working.
   */
  function addWidget() {
    var panel = side();
    var link = panel && panel.addWidgetLayout ? panel.addWidgetLayout.getMember(0) : null;
    toggleSide(true);
    if (link && link.action && !link.isOpened()) {
      link.action();
    }
  }

  function refresh() {
    load();
    if (state.view && state.view.reloadWidgets) {
      state.view.reloadWidgets();
    }
    schedulePortalSync();
  }

  function onClick(event) {
    var target = event.target || event.srcElement;
    var container = closestWithClass(target, 'etskin-dash');
    var action, row, recent, kpi, more;

    if (!container) {
      return;
    }

    action = closestWithAttribute(target, 'data-act');
    if (action) {
      switch (action.getAttribute('data-act')) {
      case 'refresh':
        refresh();
        return;
      case 'add':
        addWidget();
        return;
      case 'manage':
        toggleSide();
        return;
      case 'open':
        openWindow(action);
        return;
      default:
        return;
      }
    }

    row = closestWithClass(target, 'etskin-dash-row');
    if (row) {
      recent = row.getAttribute('data-recent');
      if (recent !== null) {
        openRecent(Number(recent));
        return;
      }
      if (row.getAttribute('data-id')) {
        openWindow(closestWithClass(row, 'etskin-dash-card'), row.getAttribute('data-id'));
      }
      return;
    }

    kpi = closestWithClass(target, 'etskin-dash-kpi');
    if (kpi) {
      openWindow(kpi);
      return;
    }

    more = closestWithClass(target, 'etskin-dash-card');
    if (more && more.getAttribute('data-window')) {
      openWindow(more);
    }
  }

  // Recent documents are bookmarks the framework wrote, so they are opened the way the framework
  // opens them: on the record, in its own tab, through the view the entry names.
  function openRecent(index) {
    var recents = recentDocuments();
    var recent = recents[index];
    if (!recent) {
      return;
    }
    recent.id = recent.targetTabId;
    recent.command = 'DEFAULT';
    OB.Layout.ViewManager.openView(recent.viewId, recent, null, true);
  }

  function onKeyDown(event) {
    var target = event.target || event.srcElement;
    var key = event.key || event.keyName;
    if (key !== 'Enter' && key !== ' ' && key !== 'Spacebar') {
      return;
    }
    if (!closestWithClass(target, 'etskin-dash')) {
      return;
    }
    if (closestWithClass(target, 'etskin-dash-row') ||
        closestWithClass(target, 'etskin-dash-kpi')) {
      event.preventDefault();
      onClick(event);
    }
  }

  // ----------------------------------------------------------- the portal

  function widgetCount() {
    var portal = state.view && state.view.portalLayout;
    var columns = portal && portal.getMembers ? portal.getMembers() : [];
    var total = 0;
    var i, rows;
    for (i = 0; i < columns.length; i++) {
      rows = columns[i].getMembers ? columns[i].getMembers() : [];
      total += rows.length;
    }
    return total;
  }

  /*
   * The portal is moved under the cards, and it does not always go on the first attempt: asked for
   * inside initWidget, while the workspace is still being built, the move is accepted and then not
   * kept - the portal is left drawn with the view as its parent and no place in the layout, which
   * puts a hundred pixel wide column of widgets over the dashboard. Reasserting it is cheap and it
   * is what makes the move stick, so every sync checks the parent and fixes it.
   *
   * The width has to be restated too. The portal was built for a horizontal layout, where 'width:
   * *' filled the row; under the cards it has to be told to fill instead.
   */
  function mountPortal() {
    var portal = state.view && state.view.portalLayout;
    if (!portal || !state.stack) {
      return true;
    }
    if (portal.parentElement !== state.stack) {
      state.stack.addMember(portal);
      portal.setWidth('100%');
      // It is the column that scrolls, not the portal inside it.
      portal.setOverflow('visible');
    }
    return portal.parentElement === state.stack;
  }

  /*
   * An empty portal is 45% of the first screen of the session spent on a drop target nobody asked
   * for, so it is only on screen once it holds something - or while the drawer is open, which is
   * the one moment a user needs to see where a widget would land.
   */
  /*
   * The widgets are as tall as their content and the cards above them are as tall as theirs, so
   * neither can be given a share of the screen: the portal is measured - the taller of its two
   * columns, which is what the framework itself measures when it places a new widget - and the
   * whole column scrolls as one page. A percentage would either crop the widgets or leave a band
   * of empty portal under them.
   */
  function portalHeight() {
    var portal = state.view && state.view.portalLayout;
    var columns = portal && portal.getMembers ? portal.getMembers() : [];
    var tallest = 0;
    var i, height;
    for (i = 0; i < columns.length; i++) {
      height = columns[i].getTotalHeight ? columns[i].getTotalHeight() : 0;
      if (height > tallest) {
        tallest = height;
      }
    }
    return tallest;
  }

  /*
   * An empty portal is a drop target nobody asked for taking up the first screen of the session,
   * so it is only on screen once it holds something - or while the drawer is open, which is the
   * one moment a user needs to see where a widget would land.
   */
  function syncPortal() {
    var portal = state.view && state.view.portalLayout;
    var panel = side();
    var open = panel && panel.isVisible();
    var height;
    if (!portal) {
      return;
    }
    mountPortal();
    if (widgetCount() > 0 || open) {
      height = portalHeight();
      portal.setHeight(Math.max(height + PORTAL_PAD, open ? PORTAL_MIN : PORTAL_PAD));
      portal.show();
    } else {
      portal.hide();
    }
  }

  // Widgets arrive over RELOAD_WIDGETS, which answers whenever it answers; the portal is measured
  // again a little after every reload rather than guessed at.
  function schedulePortalSync() {
    isc.Timer.setTimeout(settle, 1200);
    isc.Timer.setTimeout(settle, 4000);
  }

  function settle() {
    measure();
    syncPortal();
  }

  // ------------------------------------------------------------- the layout

  /*
   * Recent Views is the list the side navigation carries on every screen, and Recent Documents is
   * now a card. Both are hidden rather than destroyed, because setAdminMode and setUserMode both
   * hide and show them by name; overriding show is what keeps them down when those run.
   */
  function retire(canvas) {
    if (!canvas || canvas.etskinRetired) {
      return;
    }
    canvas.etskinRetired = true;
    canvas.hide();
    canvas.show = function () {
      return this;
    };
  }

  function install(view) {
    var stack, current, i;

    if (!view.portalLayout || view.etskinDashboard) {
      return;
    }
    view.etskinDashboard = true;
    state.view = view;

    if (view.leftColumnLayout) {
      retire(view.leftColumnLayout.recentViewsLayout);
      retire(view.leftColumnLayout.recentDocumentsLayout);
      view.leftColumnLayout.setWidth(SIDE_WIDTH);
      view.leftColumnLayout.hide();
    }

    state.canvas = isc.Canvas.create({
      width: '100%',
      // Sized by its own content: the cards are HTML and however tall they come out is how tall
      // this is. The column around it is what scrolls, so nothing is cropped at a fixed share.
      height: 1,
      overflow: 'visible',
      canFocus: false,
      // The cards are HTML and their state - what has loaded, what a query answered - lives in the
      // DOM. A redraw would rebuild it from contents and lose every answer, and SmartClient
      // redraws on resize unless told not to.
      redrawOnResize: false,
      styleName: 'etskinDashCanvas',
      contents: shellHtml(),
      // A narrower canvas means taller cards; the height has to follow the reflow.
      resized: function () {
        isc.Timer.setTimeout(settle, 0);
      }
    });

    stack = isc.VLayout.create({ width: '*', height: '100%', membersMargin: 0, overflow: 'auto' });
    state.stack = stack;
    // A copy: removeMembers is given the array it is about to shorten otherwise.
    current = [];
    for (i = 0; i < view.getMembers().length; i++) {
      current.push(view.getMembers()[i]);
    }
    view.removeMembers(current);
    stack.addMember(state.canvas);
    view.addMember(stack);
    if (view.leftColumnLayout) {
      view.addMember(view.leftColumnLayout);
    }
    if (!mountPortal()) {
      isc.Timer.setTimeout(mountPortal, 0);
    }

    if (!state.bound) {
      state.bound = true;
      // Capture, because SmartClient stops a good deal of what happens inside its own canvases.
      document.addEventListener('click', onClick, true);
      document.addEventListener('keydown', onKeyDown, true);
    }

    resolveCurrency(load);
    syncPortal();
    schedulePortalSync();
  }

  function patch() {
    var proto = isc.OBMyOpenbravo && isc.OBMyOpenbravo.getPrototype
      ? isc.OBMyOpenbravo.getPrototype()
      : null;
    var originalInitWidget, originalLoadWidgets;

    if (!proto || proto.etskinPatched) {
      return;
    }

    originalInitWidget = proto.initWidget;
    originalLoadWidgets = proto.loadWidgets;

    isc.OBMyOpenbravo.addProperties({
      etskinPatched: true,

      initWidget: function (args) {
        originalInitWidget.call(this, args);
        try {
          install(this);
        } catch (e) {
          // A dashboard that fails to build must not cost the user the workspace: the portal and
          // the inherited column are both still there at this point.
          if (typeof console !== 'undefined' && console.warn) {
            console.warn('Etendo Modern Skin could not build the dashboard', e);
          }
        }
      },

      loadWidgets: function () {
        var result = originalLoadWidgets.apply(this, arguments);
        try {
          schedulePortalSync();
        } catch (e) {
          // Nothing to do: the portal keeps whatever size it had.
        }
        return result;
      }
    });
  }

  // ------------------------------------------------------------------- main

  try {
    if (wanted() && OB.Layout && OB.Layout.initialize) {
      var originalInitialize = OB.Layout.initialize;
      // Before the original, not after: the workspace is restored from the bookmark inside
      // initialize, so a class patched afterwards would arrive one instance too late.
      OB.Layout.initialize = function () {
        try {
          patch();
        } catch (e) {
          if (typeof console !== 'undefined' && console.warn) {
            console.warn('Etendo Modern Skin could not install the dashboard', e);
          }
        }
        return originalInitialize.apply(this, arguments);
      };
    }
  } catch (e) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('Etendo Modern Skin dashboard is unavailable', e);
    }
  }
})();
