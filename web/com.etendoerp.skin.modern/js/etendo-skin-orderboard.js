/*
 *************************************************************************
 * Copyright (C) 2026 Futit Services S.L.
 * Licensed under the Openbravo Public License version 1.1.
 * You may obtain a copy of the License at
 * http://www.openbravo.com/legal/license.html
 ************************************************************************
 */

/*
 * Etendo Modern Skin - sales order board.
 *
 * A sales order window arranged by status instead of by row: one column per document status, the
 * orders of that status in it, and a card that can be dragged from one column to another. It opens
 * as its own tab, like the point of sale, so no window, tab or menu record is needed for it.
 *
 * The orders are real. Every column is one fetch against the standard Order datasource, which
 * means the client filter, the organization filter and the role's own access rules are applied on
 * the server exactly as they are for the grid - this file has no privilege of its own and asks for
 * nothing the user could not open in a window. Cards page: a column states how many orders it
 * holds and loads them a page at a time, because a booked column in a working instance holds
 * hundreds and a board that tried to draw all of them would draw nothing else.
 *
 * The drop is staged, not written, and the board says so on screen. That is the one thing about
 * this view worth reading before changing it: documentStatus is not a field a user edits. Booking
 * an order runs C_Order_Post, which reserves stock, writes the accounting and stamps the lines;
 * closing and voiding are the same kind of transition through the same process. Setting the column
 * directly would move the card and leave the order behind - booked in the eyes of every report and
 * unreserved, unposted and unstamped everywhere else. So a drop moves the card, records the
 * intended move, and stops there, and persistMove below is the single seam where the processes
 * would be called once that is what is wanted.
 *
 * The dragging is done with mouse events rather than the HTML5 drag and drop API. A canvas is not
 * a plain document: SmartClient's event handler sits over the whole page and a native dragstart
 * does not reliably survive it, and a drag implemented here can be driven by a test, which the
 * native one cannot. The cost is this file carrying its own threshold, ghost and hit test; they
 * are all in the drag section and nowhere else.
 *
 * Same constraints as the other bundles: concatenated into the global static resource and minified
 * with Crockford's JSMin, so conservative ES5 only - no let/const, no arrow functions, no template
 * literals, no trailing commas.
 */

(function () {
  'use strict';

  var VIEW = 'ETSkinOrderBoard';

  // The Sales Order window. Used only to open a card in the window it belongs to, and only if the
  // role's own menu carries it - the board never invents access to a window the user has not got.
  var SALES_ORDER_WINDOW = '143';

  // The document status reference behind C_Order.DocStatus. Read to put the AD's own names on the
  // column headers instead of names restated here.
  var STATUS_REFERENCE = 'FF80818130217A350130218D802B0011';

  /*
   * The four statuses a sales order actually lives in. The other twenty-one values of the
   * reference belong to other documents or to states no sales order rests in, so they are not
   * columns; what they are instead is the Other column below, which appears only when the
   * instance has orders in one of them. A board that quietly dropped those orders would be
   * telling the user there are fewer orders than there are.
   */
  var COLUMNS = [
    { key: 'DR', fallback: 'Draft', accent: 'draft' },
    { key: 'CO', fallback: 'Booked', accent: 'booked' },
    { key: 'CL', fallback: 'Closed', accent: 'closed' },
    { key: 'VO', fallback: 'Voided', accent: 'voided' }
  ];

  var OTHER = '__other';
  var PAGE = 25;
  // Far enough that a click on a card is a click and not a one pixel drag.
  var DRAG_THRESHOLD = 4;

  var state = {
    canvas: null,
    bound: false,
    columns: [], // { key, name, accent, rows, total, loaded, loading, failed, droppable }
    statusNames: null,
    target: null, // the Sales Order window, if the role has it
    moves: [], // { id, documentNo, from, to }
    drag: null,
    suppressClick: false,
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

  function whole(value) {
    var separator = OB.Format.defaultGroupingSymbol || ',';
    if (typeof value !== 'number' || isNaN(value)) {
      return '—';
    }
    return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, separator);
  }

  // The datasource sends dates as yyyy-MM-dd whatever the session mask is; a date on a card reads
  // the same as the same date in a grid.
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

  function statusName(key, fallback) {
    if (state.statusNames && state.statusNames[key]) {
      return state.statusNames[key];
    }
    return fallback;
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
   * The whole response is handed on, not just the rows, because totalRows is what a column header
   * counts with: a page of twenty-five says nothing about how many orders are in the column, and
   * a separate counting request would be a second query for a number this one already carries.
   *
   * A column that cannot load says so in its own header. The board is a screen the user opened on
   * purpose and a failed fetch here must not raise a dialog over it, so every failure arrives at
   * the callback as null.
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
      done(response);
    };
    xhr.send();
  }

  var CARD_PROPERTIES = 'id,documentNo,orderDate,businessPartner,grandTotalAmount,currency,' +
    'documentStatus,delivered,salesTransaction';

  /*
   * _noCount=false is what makes a column header true. Left out, DefaultJsonDataService takes the
   * cheap path it takes for a grid: it never counts, and reports totalRows as the rows it happened
   * to return plus one if there might be more - so a booked column holding seven hundred orders
   * would head itself twenty-six. Sent as false, the count is a real count query. It costs one
   * extra query per column, which is what a grid pays the moment it needs to know how many rows
   * there are, and a board is nothing but that number five times over.
   *
   * The criteria parameter is the one parameter of the protocol with no leading underscore: a
   * misnamed one is not rejected, it is simply never read, and the request then answers for every
   * order in the instance. Every other parameter here does carry the underscore.
   */
  function fetchPage(criteria, startRow, endRow, done) {
    request('Order', {
      _operationType: 'fetch',
      _startRow: startRow,
      _endRow: endRow,
      _noCount: false,
      _selectedProperties: CARD_PROPERTIES,
      _sortBy: '-orderDate',
      criteria: JSON.stringify(criteria)
    }, done);
  }

  function salesOrder() {
    return { fieldName: 'salesTransaction', operator: 'equals', value: true };
  }

  function criteriaFor(key) {
    var out = [salesOrder()];
    var i;
    if (key !== OTHER) {
      out.push({ fieldName: 'documentStatus', operator: 'equals', value: key });
      return out;
    }
    // Everything the four lifecycle columns do not claim.
    for (i = 0; i < COLUMNS.length; i++) {
      out.push({ fieldName: 'documentStatus', operator: 'notEqual', value: COLUMNS[i].key });
    }
    return out;
  }

  function card(row) {
    return {
      id: row.id,
      documentNo: row.documentNo,
      date: row.orderDate,
      partner: row['businessPartner$_identifier'] || '',
      amount: typeof row.grandTotalAmount === 'number' ? row.grandTotalAmount : null,
      currency: row['currency$_identifier'] || '',
      status: row.documentStatus,
      delivered: row.delivered === true
    };
  }

  function loadColumn(column, append) {
    var start = append ? column.loaded : 0;
    if (column.loading) {
      return;
    }
    column.loading = true;
    paint();
    fetchPage(criteriaFor(column.key), start, start + PAGE - 1, function (response) {
      var rows, i;
      column.loading = false;
      if (!response) {
        column.failed = true;
        paint();
        return;
      }
      column.failed = false;
      rows = response.data || [];
      if (!append) {
        column.rows = [];
        column.loaded = 0;
      }
      for (i = 0; i < rows.length; i++) {
        column.rows.push(card(rows[i]));
      }
      column.loaded = column.loaded + rows.length;
      column.total = typeof response.totalRows === 'number' ? response.totalRows : column.loaded;
      paint();
    });
  }

  /*
   * The column names come from the AD's own reference list rather than from names written here, so
   * an instance whose session is in Spanish reads Borrador and Reservado on the headers instead of
   * Draft and Booked. If the request fails the fallbacks stand and the board still opens: a header
   * in the wrong language is a blemish, a board that will not open is a bug.
   */
  function resolveStatusNames(done) {
    request('ADList', {
      _operationType: 'fetch',
      _startRow: 0,
      _endRow: 50,
      _selectedProperties: 'id,searchKey,name',
      criteria: JSON.stringify({
        fieldName: 'reference', operator: 'equals', value: STATUS_REFERENCE
      })
    }, function (response) {
      var rows = response && response.data ? response.data : [];
      var names = {};
      var i, row;
      for (i = 0; i < rows.length; i++) {
        row = rows[i];
        if (row.searchKey && row.name) {
          names[row.searchKey] = row.name;
        }
      }
      state.statusNames = names;
      done();
    });
  }

  function buildColumns() {
    var out = [];
    var i;
    for (i = 0; i < COLUMNS.length; i++) {
      out.push({
        key: COLUMNS[i].key,
        name: statusName(COLUMNS[i].key, COLUMNS[i].fallback),
        accent: COLUMNS[i].accent,
        droppable: true,
        rows: [], total: 0, loaded: 0, loading: false, failed: false
      });
    }
    // The Other column is not a status, so nothing can be dropped into it: there would be no
    // status to record the move to.
    out.push({
      key: OTHER,
      name: skinLabel('boardOther', 'Other statuses'),
      accent: 'other',
      droppable: false,
      rows: [], total: 0, loaded: 0, loading: false, failed: false
    });
    return out;
  }

  function loadAll() {
    var i;
    state.columns = buildColumns();
    state.moves = [];
    paint();
    for (i = 0; i < state.columns.length; i++) {
      loadColumn(state.columns[i], false);
    }
  }

  function column(key) {
    var i;
    for (i = 0; i < state.columns.length; i++) {
      if (state.columns[i].key === key) {
        return state.columns[i];
      }
    }
    return null;
  }

  // ------------------------------------------------------------------ menus

  // The role's menu is the access rule. It also carries the window's translated title and its
  // first tab, which is everything openView needs.
  function resolveTarget() {
    var found = null;

    function walk(nodes) {
      var i, node;
      for (i = 0; i < nodes.length && !found; i++) {
        node = nodes[i];
        if (node.type === 'window' && node.windowId === SALES_ORDER_WINDOW) {
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

  function openOrder(id) {
    if (!state.target) {
      return;
    }
    OB.Utilities.openView(SALES_ORDER_WINDOW, state.target.tabId, state.target.title, id);
  }

  // ------------------------------------------------------------------ moves

  function moveFor(id) {
    var i;
    for (i = 0; i < state.moves.length; i++) {
      if (state.moves[i].id === id) {
        return state.moves[i];
      }
    }
    return null;
  }

  /*
   * The seam. A drop reaches this and this writes nothing, on purpose: see the note at the top of
   * the file. Wiring it means calling the process that owns the transition - C_Order_Post to book,
   * the close and void processes for the rest - and not writing documentStatus, whatever the name
   * of the column suggests.
   */
  function persistMove(move) {
    return move;
  }

  function moveCard(id, fromKey, toKey) {
    var from = column(fromKey);
    var to = column(toKey);
    var existing = moveFor(id);
    var moved = null;
    var i;
    if (!from || !to || from === to || !to.droppable) {
      return false;
    }
    for (i = 0; i < from.rows.length; i++) {
      if (from.rows[i].id === id) {
        moved = from.rows.splice(i, 1)[0];
        break;
      }
    }
    if (!moved) {
      return false;
    }
    from.loaded = from.loaded - 1;
    from.total = Math.max(0, from.total - 1);
    to.rows.unshift(moved);
    to.loaded = to.loaded + 1;
    to.total = to.total + 1;

    // A card dragged twice has moved once: from where it started to where it now is. And a card
    // dragged back to the column it came from has not moved at all.
    if (existing) {
      if (existing.from === toKey) {
        state.moves.splice(state.moves.indexOf(existing), 1);
      } else {
        existing.to = toKey;
        persistMove(existing);
      }
    } else {
      state.moves.push(persistMove({
        id: id, documentNo: moved.documentNo, from: fromKey, to: toKey
      }));
    }
    state.notice = '';
    paint();
    return true;
  }

  // -------------------------------------------------------------------- dom

  /*
   * Class names are compared whole, not searched for inside the attribute, because this board's
   * names nest: etskin-kb-col is a prefix of etskin-kb-col-list and etskin-kb-act of
   * etskin-kb-acts. A substring test would hand the list back as the column - so a drop on the
   * Other column would be accepted, having missed the data-nodrop the column carries and the list
   * does not, and the highlight would overwrite the list's own class.
   */
  function hasClass(node, className) {
    var names, i;
    if (!node || typeof node.className !== 'string') {
      return false;
    }
    names = node.className.split(/\s+/);
    for (i = 0; i < names.length; i++) {
      if (names[i] === className) {
        return true;
      }
    }
    return false;
  }

  function closestWithClass(node, className) {
    var current = node;
    while (current && current !== document) {
      if (hasClass(current, className)) {
        return current;
      }
      current = current.parentNode;
    }
    return null;
  }

  function root() {
    return document.querySelector('.etskin-kb');
  }

  // --------------------------------------------------------------- painting

  function cardHtml(row, columnKey) {
    var move = moveFor(row.id);
    var html = '<div class="etskin-kb-card' + (move ? ' etskin-kb-card-moved' : '') +
      '" data-id="' + esc(row.id) + '" data-from="' + esc(columnKey) + '">';
    html += '<div class="etskin-kb-card-top">' +
      '<span class="etskin-kb-doc">' + esc(row.documentNo) + '</span>' +
      '<span class="etskin-kb-amount">' + esc(money(row.amount)) +
      (row.currency ? ' <i>' + esc(row.currency) + '</i>' : '') + '</span></div>';
    html += '<div class="etskin-kb-partner">' + esc(row.partner) + '</div>';
    html += '<div class="etskin-kb-meta"><span>' + esc(dateText(row.date)) + '</span>';
    if (row.status === 'CO' && !row.delivered) {
      html += '<span class="etskin-kb-chip">' +
        esc(skinLabel('boardUndelivered', 'Not delivered')) + '</span>';
    }
    html += '</div>';
    if (move) {
      html += '<div class="etskin-kb-move">' +
        esc(statusName(move.from, move.from)) + ' → ' + esc(statusName(move.to, move.to)) +
        '</div>';
    }
    return html + '</div>';
  }

  function colHtml(col) {
    var i;
    var html = '<section class="etskin-kb-col" data-key="' + esc(col.key) + '" data-accent="' +
      esc(col.accent) + '"' + (col.droppable ? '' : ' data-nodrop="1"') + '>';
    html += '<header class="etskin-kb-col-head">' +
      '<span class="etskin-kb-col-name">' + esc(col.name) + '</span>' +
      '<span class="etskin-kb-col-count">' +
      (col.failed ? esc(skinLabel('boardFailed', 'not loaded')) : esc(whole(col.total))) +
      '</span></header>';
    html += '<div class="etskin-kb-col-list" data-key="' + esc(col.key) + '">';
    if (col.rows.length === 0 && !col.loading) {
      html += '<p class="etskin-kb-col-empty">' + esc(col.failed
        ? skinLabel('boardFailedLong', 'This column could not be loaded.')
        : skinLabel('boardEmpty', 'No orders here')) + '</p>';
    }
    for (i = 0; i < col.rows.length; i++) {
      html += cardHtml(col.rows[i], col.key);
    }
    if (col.loading) {
      html += '<p class="etskin-kb-col-empty">' + esc(skinLabel('boardLoading', 'Loading…')) +
        '</p>';
    }
    if (!col.loading && col.loaded < col.total) {
      html += '<button type="button" class="etskin-kb-more" data-act="more" data-key="' +
        esc(col.key) + '">' +
        esc(skinLabel('boardMore', 'Load more')) + ' (' + esc(whole(col.total - col.loaded)) +
        ')</button>';
    }
    return html + '</div></section>';
  }

  function headHtml() {
    return '<header class="etskin-kb-head">' +
      '<h2 class="etskin-kb-title">' + esc(skinLabel('boardTitle', 'Sales Order Board')) + '</h2>' +
      '<span class="etskin-kb-sub">' +
      esc(skinLabel('boardSub', 'Drag a card to another status')) + '</span>' +
      '<div class="etskin-kb-acts">' +
      '<button type="button" class="etskin-kb-act" data-act="refresh">' +
      esc(skinLabel('boardRefresh', 'Refresh')) + '</button>' +
      '</div></header>';
  }

  /*
   * The bar is the honest part of this screen. It is there before anything is dragged, saying that
   * a move is not written, and it counts the moves once there are any - so nobody can drag a
   * column of orders across this board and believe they have booked them.
   */
  function barHtml() {
    var count = state.moves.length;
    var text = count === 0
      ? skinLabel('boardStagedNone',
        'Nothing is written: a status change is a document process, so a drop only moves the card.')
      : (count === 1
        ? skinLabel('boardStagedOne', '1 move staged. Nothing has been written.')
        : String(count) + ' ' + skinLabel('boardStagedMany',
          'moves staged. Nothing has been written.'));
    return '<div class="etskin-kb-bar' + (count ? ' etskin-kb-bar-live' : '') + '">' +
      '<span class="etskin-kb-bar-text">' + esc(text) + '</span>' +
      (state.notice ? '<span class="etskin-kb-bar-notice">' + esc(state.notice) + '</span>' : '') +
      (count ? '<button type="button" class="etskin-kb-act" data-act="discard">' +
        esc(skinLabel('boardDiscard', 'Discard moves')) + '</button>' : '') +
      '</div>';
  }

  function innerHtml() {
    var html = headHtml() + barHtml() + '<div class="etskin-kb-body">';
    var i;
    for (i = 0; i < state.columns.length; i++) {
      // The Other column earns its place only by having something in it.
      if (state.columns[i].key === OTHER && state.columns[i].total === 0 &&
          !state.columns[i].loading && !state.columns[i].failed) {
        continue;
      }
      html += colHtml(state.columns[i]);
    }
    return html + '</div>';
  }

  function shellHtml() {
    return '<div class="etskin-kb">' + innerHtml() + '</div>';
  }

  /*
   * A canvas redraws from the contents string it was handed, not from the DOM as it stands, so a
   * board patched in place would come back empty on the first resize. Each paint therefore also
   * restates the string. Assigned rather than set: setContents redraws, and a redraw in the middle
   * of a drag would take the card out from under the pointer.
   */
  function sync() {
    if (state.canvas) {
      state.canvas.contents = shellHtml();
    }
  }

  // Column lists are scrolled independently and a repaint would otherwise send every one of them
  // back to the top - which is exactly what Load more must not do.
  function scrollTops() {
    var lists = document.querySelectorAll('.etskin-kb-col-list');
    var out = {};
    var i;
    for (i = 0; i < lists.length; i++) {
      out[lists[i].getAttribute('data-key')] = lists[i].scrollTop;
    }
    return out;
  }

  function restoreScroll(tops) {
    var lists = document.querySelectorAll('.etskin-kb-col-list');
    var i, key;
    for (i = 0; i < lists.length; i++) {
      key = lists[i].getAttribute('data-key');
      if (tops[key]) {
        lists[i].scrollTop = tops[key];
      }
    }
  }

  function paint() {
    var host = root();
    var tops;
    if (!host) {
      sync();
      return;
    }
    tops = scrollTops();
    host.innerHTML = innerHtml();
    restoreScroll(tops);
    sync();
  }

  // ------------------------------------------------------------------- drag
  /*
   * Threshold, ghost and hit test, in that order. The ghost is a clone on the body rather than the
   * card itself moved, so the column the card came from keeps its layout and the drop can be
   * abandoned by putting nothing anywhere. It carries pointer-events: none in the stylesheet,
   * which is what lets elementFromPoint below see the column under the pointer and not the ghost
   * over it.
   */

  function columnAt(x, y) {
    var element = document.elementFromPoint(x, y);
    var col = element ? closestWithClass(element, 'etskin-kb-col') : null;
    if (!col || col.getAttribute('data-nodrop')) {
      return null;
    }
    return col;
  }

  function highlight(col) {
    var cols = document.querySelectorAll('.etskin-kb-col');
    var i, on;
    for (i = 0; i < cols.length; i++) {
      on = cols[i] === col;
      cols[i].className = on
        ? 'etskin-kb-col etskin-kb-col-over'
        : 'etskin-kb-col';
    }
  }

  function lift(event) {
    var drag = state.drag;
    var rect = drag.card.getBoundingClientRect();
    var ghost = drag.card.cloneNode(true);
    ghost.className = 'etskin-kb-card etskin-kb-ghost';
    ghost.style.width = rect.width + 'px';
    document.body.appendChild(ghost);
    drag.ghost = ghost;
    drag.offsetX = drag.startX - rect.left;
    drag.offsetY = drag.startY - rect.top;
    drag.active = true;
    drag.card.className = 'etskin-kb-card etskin-kb-card-dragging';
    if (root()) {
      root().className = 'etskin-kb etskin-kb-dragging';
    }
    place(event);
  }

  function place(event) {
    var drag = state.drag;
    drag.ghost.style.left = (event.clientX - drag.offsetX) + 'px';
    drag.ghost.style.top = (event.clientY - drag.offsetY) + 'px';
  }

  function drop(event) {
    var drag = state.drag;
    var col = columnAt(event.clientX, event.clientY);
    var to = col ? col.getAttribute('data-key') : null;
    release();
    if (to && to !== drag.from) {
      moveCard(drag.id, drag.from, to);
    } else {
      paint();
    }
  }

  function release() {
    var drag = state.drag;
    if (drag && drag.ghost && drag.ghost.parentNode) {
      drag.ghost.parentNode.removeChild(drag.ghost);
    }
    if (root()) {
      root().className = 'etskin-kb';
    }
    state.drag = null;
  }

  function onMouseDown(event) {
    var card, host;
    if (event.button !== 0) {
      return;
    }
    host = root();
    if (!host) {
      return;
    }
    /*
     * Cleared here, before the press that follows it is over. The browser fires a click on the
     * card after the mouseup that ended a drag, and onClick swallows exactly that one - but a
     * drag let go outside the document window never produces it, and the flag would then be
     * sitting there waiting to eat somebody's next click. Clearing it on the way into the next
     * mousedown means the worst it can do is nothing.
     */
    state.suppressClick = false;
    card = closestWithClass(event.target || event.srcElement, 'etskin-kb-card');
    if (!card || !closestWithClass(card, 'etskin-kb-col')) {
      return;
    }
    state.drag = {
      id: card.getAttribute('data-id'),
      from: card.getAttribute('data-from'),
      card: card,
      ghost: null,
      startX: event.clientX,
      startY: event.clientY,
      active: false
    };
  }

  function onMouseMove(event) {
    var drag = state.drag;
    var far;
    if (!drag) {
      return;
    }
    if (!drag.active) {
      far = Math.abs(event.clientX - drag.startX) > DRAG_THRESHOLD ||
        Math.abs(event.clientY - drag.startY) > DRAG_THRESHOLD;
      if (!far) {
        return;
      }
      lift(event);
      state.suppressClick = true;
    } else {
      place(event);
    }
    highlight(columnAt(event.clientX, event.clientY));
    if (event.preventDefault) {
      event.preventDefault();
    }
  }

  function onMouseUp(event) {
    var drag = state.drag;
    if (!drag) {
      return;
    }
    if (drag.active) {
      drop(event);
    } else {
      state.drag = null;
    }
  }

  // A drag abandoned with the keyboard puts the card back, which is the only way out of a drag
  // that does not involve dropping it somewhere.
  function onKeyDown(event) {
    if (state.drag && state.drag.active && event.keyCode === 27) {
      release();
      paint();
    }
  }

  // ----------------------------------------------------------------- events

  function onClick(event) {
    var target = event.target || event.srcElement;
    var action, card;
    if (!root()) {
      return;
    }
    // The mouseup that ended a drag is followed by a click on the card underneath it; opening the
    // order then would open a window nobody asked for.
    if (state.suppressClick) {
      state.suppressClick = false;
      return;
    }
    action = closestWithClass(target, 'etskin-kb-act') || closestWithClass(target, 'etskin-kb-more');
    if (action) {
      switch (action.getAttribute('data-act')) {
      case 'refresh':
        loadAll();
        return;
      case 'discard':
        state.notice = skinLabel('boardDiscarded', 'The staged moves were discarded.');
        loadAll();
        return;
      case 'more':
        loadColumn(column(action.getAttribute('data-key')), true);
        return;
      default:
        return;
      }
    }
    card = closestWithClass(target, 'etskin-kb-card');
    if (card && closestWithClass(card, 'etskin-kb-col')) {
      openOrder(card.getAttribute('data-id'));
    }
  }

  function bind() {
    if (state.bound) {
      return;
    }
    document.addEventListener('click', onClick, true);
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('mouseup', onMouseUp, true);
    document.addEventListener('keydown', onKeyDown, true);
    state.bound = true;
  }

  // ------------------------------------------------------------------- view

  /*
   * Defined at load time rather than on first use, because restoreState looks for isc[viewId] when
   * it replays a bookmarked URL: a board that was open when the browser was reloaded has to find
   * its class already there, or the tab comes back empty.
   */
  function defineView() {
    if (isc[VIEW]) {
      return;
    }
    isc.defineClass(VIEW, isc.Canvas).addProperties({
      tabTitle: skinLabel('boardTitle', 'Sales Order Board'),
      width: '100%',
      height: '100%',
      overflow: 'hidden',
      redrawOnResize: false,
      styleName: 'etskinBoardCanvas',

      // One board per session: asking for it while it is open focuses the tab that is there.
      isSameTab: function (viewName) {
        return viewName === VIEW;
      },

      getBookMarkParams: function () {
        return { viewId: VIEW, tabTitle: this.tabTitle };
      },

      initWidget: function () {
        this.Super('initWidget', arguments);
        state.canvas = this;
        state.notice = '';
        state.target = resolveTarget();
        this.setContents(shellHtml());
        bind();
        if (state.statusNames) {
          loadAll();
        } else {
          resolveStatusNames(loadAll);
        }
      },

      destroy: function () {
        release();
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
      OB.ETSkin.openOrderBoard = function () {
        OB.Layout.ViewManager.openView(VIEW, {
          viewId: VIEW,
          tabTitle: skinLabel('boardTitle', 'Sales Order Board')
        });
      };
    }
  } catch (e) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('Etendo Modern Skin could not install the sales order board', e);
    }
  }
})();
