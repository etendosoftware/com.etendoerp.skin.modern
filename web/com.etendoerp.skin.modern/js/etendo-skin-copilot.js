/*
 *************************************************************************
 * Copyright (C) 2026 Futit Services S.L.
 * Licensed under the Openbravo Public License version 1.1.
 * You may obtain a copy of the License at
 * http://www.openbravo.com/legal/license.html
 ************************************************************************
 */

/*
 * Copilot, docked into the application instead of floating in an iframe.
 *
 * The stock client is a toolbar button that opens a 425x650 isc.Window holding an iframe with a
 * React application inside it. Everything the user sees there is drawn by that application from
 * the `copilot/*` REST service; the iframe exists only because the chat was written as a separate
 * bundle. This file keeps the same entry point and the same service, and replaces the iframe with
 * a panel that is a member of the application row, so the tab set shrinks to make room for it and
 * the chat scrolls, resizes and inherits the skin like any other part of the window.
 *
 * The whole file is inert unless Copilot is installed. The skin does not depend on the module and
 * must not fetch from it, name its tables or leave a button behind on an instance that never
 * installed it, so the single condition below - the module's own toolbar button, registered by the
 * module's own script - gates the panel, the listeners and every request. Nothing else in the skin
 * knows this file exists.
 */
(function () {
  'use strict';

  // The module's toolbar button id, and so the answer to "is Copilot installed".
  var BUTTON_ID = 'etcop';

  var SERVICE = 'copilot/';

  var NARROW_WIDTH = 420;
  var WIDE_WIDTH = 760;
  var MIN_WIDTH = 320;

  var OPEN_KEY = 'etskin.copilot.open';
  var WIDE_KEY = 'etskin.copilot.wide';

  /*
   * Above this the module caches the question server side and the streaming request is sent
   * without it, because the question travels as a query parameter and a long one would not
   * survive the URL. The threshold is the stock client's, measured the same way.
   */
  var CACHE_ABOVE = 7000;

  var ROLE_USER = 'user';
  var ROLE_BOT = 'bot';
  var ROLE_TOOL = 'tool';
  var ROLE_NODE = 'node';
  var ROLE_WAIT = 'wait';
  var ROLE_ERROR = 'error';

  var state = {
    canvas: null,
    tabSet: null,
    pill: null,
    pending: null,
    open: false,
    wide: false,
    sideOpen: false,
    bound: false,

    ready: false,
    labels: {},
    assistants: [],
    featuredOnly: true,
    assistant: null,

    conversations: [],
    archived: [],
    unread: {},
    archiveOpen: false,
    conversationId: null,
    search: '',
    renaming: null,

    messages: [],
    busy: false,
    stream: null,
    loading: false,

    context: null,
    contextTitle: null,
    contextView: null,

    files: [],
    fileIds: [],
    uploading: false,
    notice: '',

    draft: '',
    caret: null
  };

  // ------------------------------------------------------------------ gates

  function wanted() {
    return typeof OB !== 'undefined' && !!OB && !!OB.ETSkin && typeof isc !== 'undefined' && !!isc;
  }

  /*
   * Copilot's client entry is a toolbar button it registers itself. Reading the registry answers
   * both questions at once - whether the module is installed and whether its client code reached
   * this browser - without the skin naming a Copilot class, table or preference.
   */
  function definition() {
    var defs = OB.ToolbarRegistry && OB.ToolbarRegistry.buttonDefinitions;
    var i;
    if (!defs || !defs.length) {
      return null;
    }
    for (i = 0; i < defs.length; i++) {
      if (defs[i] && defs[i].buttonId === BUTTON_ID) {
        return defs[i];
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- storage

  function readFlag(key, fallback) {
    try {
      var raw = window.localStorage.getItem(key);
      if (raw === 'true') {
        return true;
      }
      if (raw === 'false') {
        return false;
      }
    } catch (e) {
      // Private browsing and storage-blocking policies both throw here. The panel opens anyway.
    }
    return fallback;
  }

  function writeFlag(key, value) {
    try {
      window.localStorage.setItem(key, value ? 'true' : 'false');
    } catch (e) {
      // Not remembering the panel across reloads is the whole cost of a refused write.
    }
  }

  // ----------------------------------------------------------------- markup

  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /*
   * Everything below the escape is applied to text that can no longer contain markup, so an
   * assistant cannot reach the page with an answer: the renderer only ever adds tags of its own,
   * and the one attribute it fills - a link target - is restricted to http, https and mailto and
   * carries rel="noopener noreferrer". A model that returns a script tag gets a script tag drawn
   * as words, which is what the user asked to see.
   */
  var LINK = /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+)\)|(https?:\/\/[^\s]+|mailto:[^\s]+)/g;

  function anchor(href, text) {
    var trimmed = String(href).replace(/[.,;:!?]+$/, '');
    if (!/^(https?:\/\/|mailto:)/.test(trimmed)) {
      return esc(text);
    }
    return '<a class="etskin-cop-link" href="' + trimmed + '" target="_blank" rel="noopener noreferrer">' +
      text + '</a>';
  }

  function inline(text) {
    return esc(text)
      .replace(LINK, function (match, label, url, bare) {
        return anchor(url || bare, label || String(url || bare).replace(/[.,;:!?]+$/, ''));
      })
      .replace(/`([^`\n]+)`/g, '<code class="etskin-cop-code">$1</code>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])_([^_\n]+)_/g, '$1<em>$2</em>');
  }

  function prose(chunk) {
    var lines = String(chunk).split('\n');
    var html = '';
    var listing = false;
    var i, line, bare;
    for (i = 0; i < lines.length; i++) {
      line = lines[i];
      bare = line.replace(/^\s+/, '');
      if (/^[-*+]\s+/.test(bare)) {
        if (!listing) {
          html += '<ul class="etskin-cop-list">';
          listing = true;
        }
        html += '<li>' + inline(bare.replace(/^[-*+]\s+/, '')) + '</li>';
        continue;
      }
      if (listing) {
        html += '</ul>';
        listing = false;
      }
      if (bare === '') {
        continue;
      }
      if (/^#{1,6}\s+/.test(bare)) {
        html += '<p class="etskin-cop-heading">' + inline(bare.replace(/^#{1,6}\s+/, '')) + '</p>';
        continue;
      }
      html += '<p>' + inline(line) + '</p>';
    }
    if (listing) {
      html += '</ul>';
    }
    return html;
  }

  /*
   * Fenced blocks are split off before anything else so that code is never read as emphasis. The
   * copy button takes its text from the rendered block rather than from an attribute, so the code
   * exists in the page exactly once.
   */
  function fence(chunk) {
    var body = String(chunk);
    var head = '';
    var cut = body.indexOf('\n');
    if (cut > -1 && /^[A-Za-z0-9_+#.-]*$/.test(body.slice(0, cut))) {
      head = body.slice(0, cut);
      body = body.slice(cut + 1);
    }
    return '<div class="etskin-cop-block">' +
      '<div class="etskin-cop-block-head">' +
      '<span>' + esc(head || 'code') + '</span>' +
      '<button type="button" class="etskin-cop-block-copy" data-act="copy">' +
      esc(label('ETCOP_Copy', 'Copy')) + '</button>' +
      '</div><pre><code>' + esc(body.replace(/\n$/, '')) + '</code></pre></div>';
  }

  function rich(text) {
    var source = String(text === null || text === undefined ? '' : text);
    var parts = source.split('```');
    var html = '';
    var i;
    for (i = 0; i < parts.length; i++) {
      html += i % 2 === 1 ? fence(parts[i]) : prose(parts[i]);
    }
    return html;
  }

  // ------------------------------------------------------------------ rest

  function label(key, fallback) {
    var value = state.labels && state.labels[key];
    return value ? String(value) : fallback;
  }

  function serviceUrl(path) {
    return OB.Utilities.applicationUrl(SERVICE + path);
  }

  function request(method, path, body, done) {
    var xhr = new XMLHttpRequest();
    xhr.open(method, serviceUrl(path), true);
    if (body !== null && body !== undefined) {
      xhr.setRequestHeader('Content-Type', 'application/json;charset=UTF-8');
    }
    xhr.onreadystatechange = function () {
      var payload = null;
      if (xhr.readyState !== 4) {
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          payload = xhr.responseText ? JSON.parse(xhr.responseText) : null;
        } catch (e) {
          payload = null;
        }
      }
      done(payload, xhr.status);
    };
    xhr.send(body === null || body === undefined ? null : JSON.stringify(body));
  }

  function get(path, done) {
    request('GET', path, null, done);
  }

  function post(path, body, done) {
    request('POST', path, body || {}, done);
  }

  function upload(files, done) {
    var form = new FormData();
    var xhr = new XMLHttpRequest();
    var i;
    for (i = 0; i < files.length; i++) {
      // The service answers with an object keyed by field name, so the file name keeps the ids
      // apart when several files travel together.
      form.append(files[i].name, files[i]);
    }
    xhr.open('POST', serviceUrl('file'), true);
    xhr.onreadystatechange = function () {
      var payload = null;
      if (xhr.readyState !== 4) {
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          payload = xhr.responseText ? JSON.parse(xhr.responseText) : null;
        } catch (e) {
          payload = null;
        }
      }
      done(payload);
    };
    xhr.send(form);
  }

  // ---------------------------------------------------------------- context

  /*
   * The context is rebuilt here rather than read from the stock button, which posted it into the
   * iframe and kept nothing. Only strings, numbers and booleans travel: the grid's records carry
   * back-references to the view and the datasource, and a question is not the place to serialise
   * the application.
   */
  function plain(record) {
    var out = {};
    var key, value;
    for (key in record) {
      if (Object.prototype.hasOwnProperty.call(record, key)) {
        value = record[key];
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          out[key] = value;
        }
      }
    }
    return out;
  }

  function sortedPlain(values) {
    var keys = [];
    var out = {};
    var key, i;
    for (key in values) {
      if (Object.prototype.hasOwnProperty.call(values, key)) {
        keys.push(key);
      }
    }
    keys.sort();
    for (i = 0; i < keys.length; i++) {
      if (typeof values[keys[i]] === 'string' || typeof values[keys[i]] === 'number') {
        out[keys[i]] = values[keys[i]];
      }
    }
    return out;
  }

  function viewContext(view) {
    var grid = view && view.viewGrid;
    var selected = grid && grid.getSelectedRecords ? grid.getSelectedRecords() : [];
    var editing = !!(view && view.isShowingForm);
    var records = [];
    var info, i;
    for (i = 0; i < selected.length; i++) {
      records.push(plain(selected[i]));
    }
    info = {
      windowId: view.windowId,
      tabId: view.tabId,
      tabTitle: view.tabTitle,
      selectedRecords: records,
      isFormEditing: editing
    };
    if (editing && view.viewForm && view.viewForm.values) {
      info.formValues = sortedPlain(view.viewForm.values);
    }
    return info;
  }

  function contextTitle(info) {
    var count = info.selectedRecords ? info.selectedRecords.length : 0;
    if (count === 1) {
      return info.tabTitle + ' - ' + (info.selectedRecords[0]._identifier || info.tabTitle);
    }
    if (count >= 2) {
      return info.tabTitle + ' - ' + count + ' ' + label('ETCOP_Selected', 'selected');
    }
    return info.tabTitle;
  }

  function useContext(view) {
    state.contextView = view;
    state.context = viewContext(view);
    state.contextTitle = contextTitle(state.context);
  }

  // ------------------------------------------------------------------- data

  function assistantName() {
    return state.assistant ? state.assistant.name : label('ETCOP_NoAssistant', 'Copilot');
  }

  /*
   * Featured assistants first, and the filter starts on so that an instance with a hundred
   * assistants opens on the handful meant to be used. An instance that marked none featured would
   * otherwise open on an empty list, so the filter stands down when it would hide everything.
   */
  function featured() {
    var out = [];
    var i;
    for (i = 0; i < state.assistants.length; i++) {
      if (state.assistants[i].featured === 'Y') {
        out.push(state.assistants[i]);
      }
    }
    return out;
  }

  function visibleAssistants() {
    var only = featured();
    if (state.featuredOnly && only.length) {
      return only;
    }
    return state.assistants;
  }

  function sortAssistants(list) {
    var head = [];
    var tail = [];
    var i;
    for (i = 0; i < list.length; i++) {
      if (list[i] && list[i].featured === 'Y') {
        head.push(list[i]);
      } else if (list[i]) {
        tail.push(list[i]);
      }
    }
    return head.concat(tail);
  }

  function toList(payload) {
    var out = [];
    var i;
    if (!payload || !payload.length) {
      return out;
    }
    for (i = 0; i < payload.length; i++) {
      out.push(payload[i]);
    }
    return out;
  }

  function loadLabels(next) {
    get('labels', function (payload) {
      if (payload) {
        state.labels = payload;
      }
      next();
    });
  }

  function loadAssistants(next) {
    get('assistants', function (payload) {
      state.assistants = sortAssistants(toList(payload));
      state.assistant = state.assistants.length ? visibleAssistants()[0] : null;
      next();
    });
  }

  function loadConversations() {
    if (!state.assistant) {
      state.conversations = [];
      paint();
      return;
    }
    get('conversations?app_id=' + encodeURIComponent(state.assistant.app_id), function (payload) {
      state.conversations = toList(payload);
      paint();
    });
  }

  function loadArchived() {
    if (!state.assistant) {
      state.archived = [];
      paint();
      return;
    }
    get('archivedConversations?app_id=' + encodeURIComponent(state.assistant.app_id), function (payload) {
      state.archived = toList(payload);
      paint();
    });
  }

  /*
   * A user turn was stored with the context wrapped around it. The wrapper is the machine's half
   * of the message and is unwrapped on the way back in, so re-opening a conversation shows what
   * the user typed with the context named beside it, exactly as it looked when it was sent.
   */
  function unwrap(content) {
    var text = String(content === null || content === undefined ? '' : content);
    var open = text.indexOf('<Context>');
    var close = text.indexOf('</Context>');
    var question, title, parsed;
    if (open !== 0 || close < 0) {
      return { text: text, context: null };
    }
    question = text.slice(close + 10).replace(/^\s*<Question>/, '').replace(/<\/Question>\s*$/, '');
    try {
      parsed = JSON.parse(text.slice(9, close));
      title = parsed ? contextTitle(parsed) : null;
    } catch (e) {
      title = null;
    }
    return { text: question, context: title };
  }

  function loadMessages(id) {
    state.loading = true;
    paint();
    get('conversationMessages?conversation_id=' + encodeURIComponent(id), function (payload) {
      var rows = toList(payload);
      var out = [];
      var i, row, user, parts;
      for (i = 0; i < rows.length; i++) {
        row = rows[i];
        user = String(row.role || '').toLowerCase() === ROLE_USER;
        parts = user ? unwrap(row.content) : { text: row.content, context: null };
        out.push({
          role: user ? ROLE_USER : ROLE_BOT,
          text: parts.text,
          context: parts.context,
          time: row.timestamp ? String(row.timestamp).slice(11, 16) : ''
        });
      }
      state.messages = out;
      state.loading = false;
      paint();
      scrollLog();
    });
  }

  // --------------------------------------------------------------- messages

  function now() {
    var date = new Date();
    var hours = date.getHours();
    var minutes = date.getMinutes();
    return (hours < 10 ? '0' : '') + hours + ':' + (minutes < 10 ? '0' : '') + minutes;
  }

  var PREFIX = {};
  PREFIX[ROLE_WAIT] = '⏳ ';
  PREFIX[ROLE_TOOL] = '🛠️ ';
  PREFIX[ROLE_NODE] = '🤖 ';

  /*
   * The transient roles - the wait line, a tool call, a graph node - are one line that keeps being
   * rewritten while the assistant works, so a new one of the same kind replaces the last instead
   * of stacking, and the answer replaces whatever line was last showing progress. Anything else
   * appends. This is the stock client's rule, kept because the assistants are written against it.
   */
  function pushMessage(role, text, files) {
    var body = text;
    var last = state.messages.length ? state.messages[state.messages.length - 1] : null;
    var transient_ = last && (last.role === ROLE_TOOL || last.role === ROLE_NODE || last.role === ROLE_WAIT);
    var message;
    if (body && typeof body === 'object') {
      body = JSON.stringify(body, null, 2);
    }
    message = {
      role: role,
      text: (PREFIX[role] || '') + String(body === null || body === undefined ? '' : body),
      context: role === ROLE_USER ? state.contextTitle : null,
      files: files || null,
      time: now()
    };
    if (transient_ && (role === last.role || role === ROLE_BOT || last.role === ROLE_WAIT)) {
      state.messages[state.messages.length - 1] = message;
    } else {
      state.messages.push(message);
    }
    paint();
    scrollLog();
  }

  function conversationTitle(id) {
    var i;
    for (i = 0; i < state.conversations.length; i++) {
      if (state.conversations[i].id === id) {
        return state.conversations[i].title || '';
      }
    }
    return '';
  }

  /*
   * The module names conversations by asking an assistant for a title once there is enough of a
   * conversation to name. Six messages is the stock threshold.
   */
  function maybeTitle() {
    var id = state.conversationId;
    if (!id || state.messages.length < 6 || conversationTitle(id)) {
      return;
    }
    post('generateTitleConversation', { conversation_id: id }, function () {
      loadConversations();
    });
  }

  function stopStream() {
    if (state.stream) {
      try {
        state.stream.close();
      } catch (e) {
        // A stream that is already gone needs no closing.
      }
      state.stream = null;
    }
  }

  function params(question, cached) {
    var list = [];
    var i;
    if (!cached) {
      list.push('question=' + encodeURIComponent(question));
    }
    list.push('app_id=' + encodeURIComponent(state.assistant.app_id));
    if (state.conversationId) {
      list.push('conversation_id=' + encodeURIComponent(state.conversationId));
    }
    for (i = 0; i < state.fileIds.length; i++) {
      list.push('file=' + encodeURIComponent(state.fileIds[i]));
    }
    return list.join('&');
  }

  function stream(question, cached) {
    var source;
    try {
      source = new EventSource(serviceUrl('aquestion') + '?' + params(question, cached));
    } catch (e) {
      state.busy = false;
      pushMessage(ROLE_ERROR, label('ETCOP_CheckSettings', 'Copilot is not reachable.'));
      return;
    }
    state.stream = source;
    state.fileIds = [];

    source.onmessage = function (event) {
      var data, answer;
      try {
        data = JSON.parse(event.data);
      } catch (e) {
        return;
      }
      answer = data && data.answer;
      if (!answer) {
        return;
      }
      if (answer.conversation_id && !state.conversationId) {
        state.conversationId = answer.conversation_id;
        state.conversations.unshift({ id: answer.conversation_id, title: '' });
      }
      if (answer.role === 'debug' || !answer.response) {
        return;
      }
      if (answer.conversation_id && answer.conversation_id !== state.conversationId) {
        // The answer belongs to a conversation the panel is not showing: the list marks it.
        state.unread[answer.conversation_id] = true;
        paint();
        return;
      }
      pushMessage(answer.role || ROLE_BOT, answer.response);
    };

    /*
     * The service ends a finished answer by closing the response, which reaches the browser as an
     * error. Closing here is what keeps EventSource from reconnecting and asking the assistant the
     * same question again.
     */
    source.onerror = function () {
      stopStream();
      state.busy = false;
      paint();
      maybeTitle();
    };
  }

  function send() {
    var question = String(state.draft || '').trim();
    var wrapped = question;
    var names = [];
    var i;
    if (!question || state.busy || !state.assistant) {
      return;
    }
    if (state.context) {
      wrapped = '<Context>' + JSON.stringify(state.context, null, 2) + '</Context>\n<Question>' +
        question + '</Question>';
    }
    for (i = 0; i < state.files.length; i++) {
      names.push(state.files[i].name);
    }
    state.busy = true;
    state.notice = '';
    state.draft = '';
    state.caret = null;
    pushMessage(ROLE_USER, question, names.length ? names : null);
    state.context = null;
    state.contextTitle = null;
    state.files = [];
    pushMessage(ROLE_WAIT, label('ETCOP_Processing', 'Processing...'));

    if (encodeURIComponent(wrapped).length > CACHE_ABOVE) {
      post('cacheQuestion', { question: wrapped }, function () {
        stream(wrapped, true);
      });
      return;
    }
    stream(wrapped, false);
  }

  // ----------------------------------------------------------------- render

  // The types the module's own client offers, so the file dialog is no more permissive here.
  var ACCEPT = [
    'text/plain', 'text/csv', 'application/csv', 'text/markdown', 'text/html', 'text/css',
    'text/javascript', 'application/json', 'application/xml', 'text/xml', 'application/pdf',
    'application/zip', 'application/x-tar', 'application/typescript',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'image/png', 'image/jpeg', 'image/gif',
    'text/x-c', 'text/x-c++', 'text/x-java', 'text/x-php', 'text/x-python', 'text/x-ruby',
    'text/x-tex'
  ].join(',');

  /*
   * The glyph is a child rather than a mask on the button itself, so the button keeps a background
   * of its own to show that it is under the pointer.
   */
  function iconButton(act, icon, title, id, extra) {
    return '<button type="button" class="etskin-cop-icon' + (extra ? ' ' + extra : '') +
      '" data-act="' + act + '"' + (id ? ' data-id="' + esc(id) + '"' : '') +
      ' title="' + esc(title) + '" aria-label="' + esc(title) + '">' +
      '<span class="' + icon + '"></span></button>';
  }

  function renderAssistants() {
    var list = visibleAssistants();
    var only = featured();
    var html = '<div class="etskin-cop-side-head">' +
      '<span class="etskin-cop-side-title">' + esc(label('ETCOP_Message_AssistantHeader', 'Assistant')) + '</span>';
    var i, item, on;
    if (only.length && only.length !== state.assistants.length) {
      html += '<button type="button" class="etskin-cop-toggle' +
        (state.featuredOnly ? ' etskin-cop-toggle-on' : '') + '" data-act="featured">' +
        esc(label('ETCOP_Featured', 'Featured')) + '</button>';
    }
    html += '</div>';

    if (!list.length) {
      return html + '<p class="etskin-cop-empty">' +
        esc(label('ETCOP_NoAssistant', 'No assistant is available for this role.')) + '</p>';
    }
    html += '<div class="etskin-cop-assistants">';
    for (i = 0; i < list.length; i++) {
      item = list[i];
      on = state.assistant && state.assistant.app_id === item.app_id;
      html += '<button type="button" class="etskin-cop-assistant' +
        (on ? ' etskin-cop-assistant-on' : '') + '" data-act="assistant" data-id="' +
        esc(item.app_id) + '" title="' + esc(item.description || item.name) + '">' +
        '<span class="etskin-cop-assistant-name">' + esc(item.name) + '</span>' +
        (item.featured === 'Y' ? '<span class="etskin-cop-star"></span>' : '') +
        '</button>';
    }
    return html + '</div>';
  }

  function matches(conversation) {
    var needle = String(state.search || '').toLowerCase();
    if (!needle) {
      return true;
    }
    return String(conversation.title || '').toLowerCase().indexOf(needle) > -1;
  }

  function renderConversation(conversation) {
    var on = conversation.id === state.conversationId;
    var title = conversation.title || label('ETCOP_Untitled', 'Untitled conversation');
    if (state.renaming === conversation.id) {
      return '<div class="etskin-cop-conv etskin-cop-conv-editing">' +
        '<input class="etskin-cop-rename" type="text" data-id="' + esc(conversation.id) +
        '" value="' + esc(conversation.title || '') + '" />' +
        iconButton('rename-ok', 'etskin-cop-i-check', label('ETCOP_Rename', 'Rename'), conversation.id) +
        '</div>';
    }
    return '<div class="etskin-cop-conv' + (on ? ' etskin-cop-conv-on' : '') +
      '" data-act="conv" data-id="' + esc(conversation.id) + '">' +
      (state.unread[conversation.id] ? '<span class="etskin-cop-dot"></span>' : '') +
      '<span class="etskin-cop-conv-title">' + esc(title) + '</span>' +
      '<span class="etskin-cop-conv-tools">' +
      iconButton('rename', 'etskin-cop-i-pencil', label('ETCOP_Rename', 'Rename'), conversation.id) +
      iconButton('delete', 'etskin-cop-i-archive', label('ETCOP_Delete', 'Delete'), conversation.id) +
      '</span></div>';
  }

  function renderConversations() {
    var html = '';
    var shown = 0;
    var i;
    for (i = 0; i < state.conversations.length; i++) {
      if (matches(state.conversations[i])) {
        html += renderConversation(state.conversations[i]);
        shown++;
      }
    }
    if (!shown) {
      html = '<p class="etskin-cop-empty">' +
        esc(label('ETCOP_NoConversations', 'No conversations yet.')) + '</p>';
    }
    return html;
  }

  function renderArchived() {
    var html = '<button type="button" class="etskin-cop-arch-head' +
      (state.archiveOpen ? ' etskin-cop-arch-open' : '') + '" data-act="archive-toggle">' +
      '<span class="etskin-cop-caret"></span>' + esc(label('ETCOP_Archived', 'Archived')) + '</button>';
    var i, conversation;
    if (!state.archiveOpen) {
      return html;
    }
    if (!state.archived.length) {
      return html + '<p class="etskin-cop-empty">' +
        esc(label('ETCOP_NoConversations', 'No conversations yet.')) + '</p>';
    }
    for (i = 0; i < state.archived.length; i++) {
      conversation = state.archived[i];
      html += '<div class="etskin-cop-conv etskin-cop-conv-archived">' +
        '<span class="etskin-cop-conv-title">' +
        esc(conversation.title || label('ETCOP_Untitled', 'Untitled conversation')) + '</span>' +
        '<span class="etskin-cop-conv-tools">' +
        iconButton('restore', 'etskin-cop-i-restore', label('ETCOP_Restore', 'Restore'), conversation.id) +
        iconButton('purge', 'etskin-cop-i-trash', label('ETCOP_PermanentDelete', 'Delete permanently'),
          conversation.id) +
        '</span></div>';
    }
    return html;
  }

  function renderSide() {
    return '<div class="etskin-cop-side">' +
      renderAssistants() +
      '<button type="button" class="etskin-cop-new" data-act="new">' +
      '<span class="etskin-cop-i-plus"></span>' +
      esc(label('ETCOP_NewConversation', 'New conversation')) + '</button>' +
      '<div class="etskin-cop-search">' +
      '<span class="etskin-cop-i-search"></span>' +
      '<input class="etskin-cop-search-input" type="text" value="' + esc(state.search) +
      '" placeholder="' + esc(label('ETCOP_SearchConversations', 'Search conversations')) + '" />' +
      '</div>' +
      '<div class="etskin-cop-convs">' + renderConversations() + '</div>' +
      '<div class="etskin-cop-arch">' + renderArchived() + '</div>' +
      '</div>';
  }

  function renderMessage(message) {
    var role = message.role;
    var meta = '<span class="etskin-cop-time">' + esc(message.time) + '</span>';
    var files = '';
    var i;
    if (role === ROLE_WAIT || role === ROLE_TOOL || role === ROLE_NODE) {
      return '<div class="etskin-cop-status">' + esc(message.text) + '</div>';
    }
    if (role === ROLE_ERROR) {
      return '<div class="etskin-cop-msg etskin-cop-msg-error">' +
        '<div class="etskin-cop-bubble">' + rich(message.text) + '</div>' + meta + '</div>';
    }
    if (role === ROLE_USER) {
      if (message.files) {
        for (i = 0; i < message.files.length; i++) {
          files += '<span class="etskin-cop-file-chip">' + esc(message.files[i]) + '</span>';
        }
      }
      return '<div class="etskin-cop-msg etskin-cop-msg-user">' +
        (message.context ? '<span class="etskin-cop-ctx-tag">' + esc(message.context) + '</span>' : '') +
        '<div class="etskin-cop-bubble">' + rich(message.text) + '</div>' +
        (files ? '<div class="etskin-cop-msg-files">' + files + '</div>' : '') + meta + '</div>';
    }
    return '<div class="etskin-cop-msg etskin-cop-msg-bot">' +
      '<div class="etskin-cop-bubble">' + rich(message.text) + '</div>' + meta + '</div>';
  }

  function renderLog() {
    var html = '';
    var i;
    if (state.loading) {
      return '<div class="etskin-cop-log"><p class="etskin-cop-empty">' +
        esc(label('ETCOP_LoadingConversations', 'Loading...')) + '</p></div>';
    }
    if (!state.messages.length) {
      return '<div class="etskin-cop-log"><div class="etskin-cop-welcome">' +
        '<span class="etskin-cop-welcome-mark"></span>' +
        '<p class="etskin-cop-welcome-title">' +
        esc(label('ETCOP_Welcome_Greeting', 'Hello')) + '</p>' +
        '<p class="etskin-cop-welcome-text">' +
        esc(label('ETCOP_Welcome_Message', 'Ask me about the record you are looking at.')) +
        '</p></div></div>';
    }
    for (i = 0; i < state.messages.length; i++) {
      html += renderMessage(state.messages[i]);
    }
    return '<div class="etskin-cop-log">' + html + '</div>';
  }

  function renderFoot() {
    var chips = '';
    var i;
    if (state.contextTitle) {
      chips += '<span class="etskin-cop-ctx">' +
        '<span class="etskin-cop-i-record"></span>' + esc(state.contextTitle) +
        iconButton('ctx-clear', 'etskin-cop-i-close', label('ETCOP_Delete', 'Remove'), null,
          'etskin-cop-ctx-clear') + '</span>';
    }
    for (i = 0; i < state.files.length; i++) {
      chips += '<span class="etskin-cop-file-chip">' + esc(state.files[i].name) +
        iconButton('file-clear', 'etskin-cop-i-close', label('ETCOP_Delete', 'Remove'), String(i)) + '</span>';
    }
    if (state.uploading) {
      chips += '<span class="etskin-cop-file-chip">' + esc(label('ETCOP_Processing', 'Processing...')) +
        '</span>';
    }
    return '<div class="etskin-cop-foot">' +
      (chips ? '<div class="etskin-cop-chips">' + chips + '</div>' : '') +
      (state.notice ? '<p class="etskin-cop-notice">' + esc(state.notice) + '</p>' : '') +
      '<div class="etskin-cop-compose">' +
      '<textarea class="etskin-cop-input" rows="1" placeholder="' +
      esc(label('ETCOP_Message_Placeholder', 'Write a message')) + '">' + esc(state.draft) +
      '</textarea>' +
      '<input class="etskin-cop-fileinput" type="file" multiple accept="' + ACCEPT + '" />' +
      iconButton('attach', 'etskin-cop-i-attach', label('ETCOP_UniqueAttachment', 'Attach a file')) +
      iconButton('send', 'etskin-cop-i-send', label('ETCOP_Send', 'Send'), null,
        'etskin-cop-send' + (state.busy ? ' etskin-cop-send-busy' : '')) +
      '</div></div>';
  }

  function renderMain() {
    var title = state.conversationId
      ? (conversationTitle(state.conversationId) || label('ETCOP_CurrentConversation', 'Current conversation'))
      : label('ETCOP_NewConversation', 'New conversation');
    return '<div class="etskin-cop-main">' +
      '<div class="etskin-cop-head">' +
      iconButton('side', 'etskin-cop-i-menu', label('ETCOP_CurrentConversation', 'Conversations')) +
      '<span class="etskin-cop-head-text">' +
      '<span class="etskin-cop-head-title">' + esc(assistantName()) + '</span>' +
      '<span class="etskin-cop-head-sub">' + esc(title) + '</span>' +
      '</span>' +
      iconButton('new', 'etskin-cop-i-plus', label('ETCOP_NewConversation', 'New conversation')) +
      iconButton('wide', state.wide ? 'etskin-cop-i-narrow' : 'etskin-cop-i-wide',
        label('ETCOP_Expand', 'Expand')) +
      iconButton('close', 'etskin-cop-i-close', label('ETCOP_Close', 'Close')) +
      '</div>' +
      renderLog() +
      renderFoot() +
      '</div>';
  }

  function rootClass() {
    return 'etskin-cop-root' + (state.wide ? ' etskin-cop-wide' : '') +
      (state.sideOpen ? ' etskin-cop-side-shown' : '');
  }

  function body() {
    return renderSide() + '<div class="etskin-cop-scrim" data-act="side-close"></div>' + renderMain();
  }

  // ------------------------------------------------------------------ paint

  function hasClass(element, name) {
    return !!element && !!element.className && typeof element.className === 'string' &&
      (' ' + element.className + ' ').indexOf(' ' + name + ' ') > -1;
  }

  function panel() {
    return document.querySelector('.etskin-cop-root');
  }

  function logElement() {
    var root = panel();
    return root ? root.querySelector('.etskin-cop-log') : null;
  }

  function scrollLog() {
    var log = logElement();
    if (log) {
      log.scrollTop = log.scrollHeight;
    }
  }

  function grow(input) {
    input.style.height = 'auto';
    input.style.height = Math.min(160, Math.max(38, input.scrollHeight)) + 'px';
  }

  /*
   * The panel is drawn from state on every change, so the two things the user holds in the DOM -
   * the caret in the composer and the scroll position of the log - are read back afterwards.
   * SmartClient rebuilds a canvas from its `contents` string whenever it redraws, so the same
   * markup is stored there too; without that a redraw would show whatever the panel looked like
   * when it was created.
   */
  function paint() {
    var markup = body();
    var root = panel();
    var log = logElement();
    var scroll = log ? log.scrollTop : null;
    var focused = hasClass(document.activeElement, 'etskin-cop-input');
    var input, renaming;
    if (!state.canvas) {
      return;
    }
    state.canvas.contents = shell(markup);
    if (!root) {
      return;
    }
    root.className = rootClass();
    root.innerHTML = markup;

    input = root.querySelector('.etskin-cop-input');
    if (input) {
      input.value = state.draft;
      grow(input);
      if (focused) {
        input.focus();
        try {
          input.selectionStart = state.caret === null ? state.draft.length : state.caret;
          input.selectionEnd = input.selectionStart;
        } catch (e) {
          // Some browsers refuse a selection on an element that is not laid out yet.
        }
      }
    }
    renaming = root.querySelector('.etskin-cop-rename');
    if (renaming) {
      renaming.focus();
    }
    log = logElement();
    if (log && scroll !== null) {
      log.scrollTop = scroll;
    }
  }

  function shell(markup) {
    return '<div class="' + rootClass() + '">' +
      (markup === undefined ? body() : markup) + '</div>';
  }

  function refreshConversations() {
    var root = panel();
    var box = root ? root.querySelector('.etskin-cop-convs') : null;
    if (box) {
      box.innerHTML = renderConversations();
    }
  }

  // ------------------------------------------------------------------- dock

  /*
   * The panel is as wide as it asks to be, unless that would leave the window it is docked beside
   * with less room than a form needs. The tab set is the point of the screen, not the chat.
   */
  function width() {
    var room = isc.Page.getWidth() - 480;
    var want = state.wide ? WIDE_WIDTH : NARROW_WIDTH;
    return Math.max(MIN_WIDTH, Math.min(want, Math.max(MIN_WIDTH, room)));
  }

  function applyWidth() {
    if (state.canvas) {
      state.canvas.setWidth(width());
    }
  }

  /*
   * The side navigation, when it is there, has already replaced the application's vertical stack
   * with a row holding the panel and the tab set. Docking into that row is what makes the chat a
   * member of the application rather than something floating over it: the tab set keeps the star
   * width it was given and gives up exactly the width the chat takes. When the navigation is not
   * there the same row is built here, for the same reason.
   */
  function dock() {
    var tabSet = OB.MainView && OB.MainView.TabSet;
    var parent = tabSet && tabSet.getParentCanvas ? tabSet.getParentCanvas() : null;
    var row;
    if (!tabSet) {
      return false;
    }
    if (parent && parent.vertical === false) {
      row = parent;
    } else {
      row = isc.HLayout.create({ width: '100%', height: '100%' });
      OB.MainView.removeMember(tabSet);
      OB.MainView.addMember(row);
      row.addMember(tabSet);
      tabSet.setWidth('*');
      tabSet.setHeight('100%');
    }
    row.addMember(state.canvas);
    state.tabSet = tabSet;
    return true;
  }

  function ensureData() {
    if (state.ready) {
      return;
    }
    state.ready = true;
    loadLabels(function () {
      loadAssistants(function () {
        paint();
        loadConversations();
        runPending();
      });
    });
  }

  function ensureCanvas() {
    if (state.canvas) {
      return true;
    }
    state.canvas = isc.Canvas.create({
      width: width(),
      height: '100%',
      overflow: 'hidden',
      canFocus: false,
      // Everything the user is holding - caret, scroll, open menus - lives in the DOM this canvas
      // owns, and SmartClient redraws on resize unless told not to.
      redrawOnResize: false,
      styleName: 'etskinCopCanvas',
      contents: shell()
    });
    if (!dock()) {
      state.canvas.destroy();
      state.canvas = null;
      return false;
    }
    return true;
  }

  function openDock() {
    if (!ensureCanvas()) {
      return;
    }
    state.open = true;
    writeFlag(OPEN_KEY, true);
    state.canvas.show();
    applyWidth();
    markPill(true);
    ensureData();
    paint();
  }

  function closeDock() {
    state.open = false;
    writeFlag(OPEN_KEY, false);
    stopStream();
    state.busy = false;
    markPill(false);
    if (state.canvas) {
      state.canvas.hide();
    }
  }

  // ---------------------------------------------------------------- actions

  function commitRename(input) {
    var id = input.getAttribute('data-id');
    var title = String(input.value || '').trim();
    var i;
    state.renaming = null;
    if (!id || !title) {
      paint();
      return;
    }
    for (i = 0; i < state.conversations.length; i++) {
      if (state.conversations[i].id === id) {
        state.conversations[i].title = title;
      }
    }
    paint();
    post('renameConversation', { conversation_id: id, title: title }, function () {
      loadConversations();
    });
  }

  function selectAssistant(id) {
    var i;
    for (i = 0; i < state.assistants.length; i++) {
      if (state.assistants[i].app_id === id) {
        state.assistant = state.assistants[i];
      }
    }
    stopStream();
    state.busy = false;
    state.conversationId = null;
    state.messages = [];
    state.archived = [];
    paint();
    loadConversations();
    if (state.archiveOpen) {
      loadArchived();
    }
  }

  function newConversation() {
    stopStream();
    state.busy = false;
    state.conversationId = null;
    state.messages = [];
    state.renaming = null;
    state.sideOpen = false;
    paint();
  }

  function openConversation(id) {
    stopStream();
    state.busy = false;
    state.conversationId = id;
    state.sideOpen = false;
    if (state.unread[id]) {
      delete state.unread[id];
    }
    loadMessages(id);
  }

  function archive(id) {
    post('deleteConversation', { conversation_id: id }, function () {
      if (state.conversationId === id) {
        state.conversationId = null;
        state.messages = [];
      }
      loadConversations();
      if (state.archiveOpen) {
        loadArchived();
      }
    });
  }

  function copyBlock(button) {
    var block = button.parentNode ? button.parentNode.parentNode : null;
    var code = block ? block.querySelector('code') : null;
    var range, selection;
    if (!code) {
      return;
    }
    /*
     * The clipboard is written from the block that is already on the screen, so the code exists in
     * the page once. The selection route is the fallback for the browsers that refuse the
     * clipboard API outside a secure context, which is every local http instance.
     */
    if (window.navigator && window.navigator.clipboard && window.navigator.clipboard.writeText) {
      window.navigator.clipboard.writeText(code.textContent);
      return;
    }
    try {
      range = document.createRange();
      range.selectNodeContents(code);
      selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand('copy');
      selection.removeAllRanges();
    } catch (e) {
      // Nothing to do: the code is on the screen and can be selected by hand.
    }
  }

  function act(name, element) {
    var id = element.getAttribute('data-id');
    var root = panel();
    var input;
    if (name === 'side') {
      state.sideOpen = !state.sideOpen;
      paint();
    } else if (name === 'side-close') {
      state.sideOpen = false;
      paint();
    } else if (name === 'wide') {
      state.wide = !state.wide;
      writeFlag(WIDE_KEY, state.wide);
      applyWidth();
      paint();
    } else if (name === 'close') {
      closeDock();
    } else if (name === 'new') {
      newConversation();
    } else if (name === 'assistant') {
      selectAssistant(id);
    } else if (name === 'featured') {
      state.featuredOnly = !state.featuredOnly;
      paint();
    } else if (name === 'conv') {
      openConversation(id);
    } else if (name === 'rename') {
      state.renaming = id;
      paint();
    } else if (name === 'rename-ok') {
      input = root ? root.querySelector('.etskin-cop-rename') : null;
      if (input) {
        commitRename(input);
      }
    } else if (name === 'delete') {
      archive(id);
    } else if (name === 'archive-toggle') {
      state.archiveOpen = !state.archiveOpen;
      paint();
      if (state.archiveOpen) {
        loadArchived();
      }
    } else if (name === 'restore') {
      post('restoreConversation', { conversation_id: id }, function () {
        loadArchived();
        loadConversations();
      });
    } else if (name === 'purge') {
      isc.ask(label('ETCOP_PermanentDelete', 'Delete permanently') + '?', function (ok) {
        if (ok) {
          post('permanentDeleteConversation', { conversation_id: id }, function () {
            loadArchived();
          });
        }
      });
    } else if (name === 'attach') {
      input = root ? root.querySelector('.etskin-cop-fileinput') : null;
      if (input) {
        input.click();
      }
    } else if (name === 'send') {
      send();
    } else if (name === 'ctx-clear') {
      state.context = null;
      state.contextTitle = null;
      paint();
    } else if (name === 'file-clear') {
      state.files.splice(Number(id), 1);
      state.fileIds.splice(Number(id), 1);
      paint();
    } else if (name === 'copy') {
      copyBlock(element);
    }
  }

  // ----------------------------------------------------------------- events

  function actionOf(node) {
    var element = node;
    while (element && element.getAttribute) {
      if (element.getAttribute('data-act')) {
        return element;
      }
      if (hasClass(element, 'etskin-cop-root')) {
        return null;
      }
      element = element.parentNode;
    }
    return null;
  }

  function onClick(event) {
    var root = panel();
    var target = event.target || event.srcElement;
    var element;
    if (!root || !target || !root.contains(target)) {
      return;
    }
    element = actionOf(target);
    if (!element) {
      return;
    }
    event.stopPropagation();
    act(element.getAttribute('data-act'), element);
  }

  function onInput(event) {
    var target = event.target || event.srcElement;
    if (hasClass(target, 'etskin-cop-input')) {
      state.draft = target.value;
      state.caret = target.selectionStart;
      grow(target);
      return;
    }
    if (hasClass(target, 'etskin-cop-search-input')) {
      state.search = target.value;
      // Only the list is redrawn: a full repaint would take the caret out of the search box.
      refreshConversations();
    }
  }

  function onKeyDown(event) {
    var target = event.target || event.srcElement;
    if (hasClass(target, 'etskin-cop-input')) {
      event.stopPropagation();
      if (event.keyCode === 13 && !event.shiftKey) {
        event.preventDefault();
        state.draft = target.value;
        send();
      }
      return;
    }
    if (hasClass(target, 'etskin-cop-rename')) {
      event.stopPropagation();
      if (event.keyCode === 13) {
        commitRename(target);
      } else if (event.keyCode === 27) {
        state.renaming = null;
        paint();
      }
      return;
    }
    if (hasClass(target, 'etskin-cop-search-input')) {
      event.stopPropagation();
    }
  }

  /*
   * SmartClient takes focus away from anything it does not know about on mousedown, which is every
   * native field inside a canvas. Stopping the event at the field is what lets the composer keep
   * the caret.
   */
  function onMouseDown(event) {
    var target = event.target || event.srcElement;
    if (hasClass(target, 'etskin-cop-input') || hasClass(target, 'etskin-cop-search-input') ||
      hasClass(target, 'etskin-cop-rename')) {
      event.stopPropagation();
    }
  }

  function onChange(event) {
    var target = event.target || event.srcElement;
    var chosen = target && target.files;
    var i;
    if (!hasClass(target, 'etskin-cop-fileinput') || !chosen || !chosen.length) {
      return;
    }
    state.files = [];
    for (i = 0; i < chosen.length; i++) {
      state.files.push({ name: chosen[i].name });
    }
    state.uploading = true;
    state.notice = '';
    paint();
    upload(chosen, function (payload) {
      var key;
      state.uploading = false;
      state.fileIds = [];
      if (!payload) {
        state.files = [];
        state.notice = label('ETCOP_ErrorSavingFile', 'The file could not be attached.');
      } else {
        for (key in payload) {
          if (Object.prototype.hasOwnProperty.call(payload, key)) {
            state.fileIds.push(payload[key]);
          }
        }
      }
      paint();
    });
  }

  function bind() {
    if (state.bound) {
      return;
    }
    state.bound = true;
    // Capture, because SmartClient stops a good deal of what happens inside its own canvases.
    document.addEventListener('click', onClick, true);
    document.addEventListener('input', onInput, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('change', onChange, true);
  }

  // ------------------------------------------------------------------ context

  /*
   * The window the user is looking at. The toolbar button carries its own view, but the navigation
   * bar button belongs to no window, and a question asked from elsewhere in the application comes
   * with no view either, so the tab set is asked rather than the panel opening with no context.
   */
  function activeView(view) {
    var tab, pane;
    if (view) {
      return view;
    }
    try {
      tab = OB.MainView && OB.MainView.TabSet && OB.MainView.TabSet.getSelectedTab();
      pane = tab && tab.pane;
      return (pane && (pane.activeView || pane.view)) || null;
    } catch (e) {
      return null;
    }
  }

  // ---------------------------------------------------------------- install

  /*
   * The module's other entry points can arrive with the question already written - the navigation
   * bar button's open(q, assistantId) is called that way by a process that wants Copilot asked
   * about something - and the first time the panel opens the assistants have not been fetched yet.
   * So the request waits for the list, which is what the iframe did too: its query string was read
   * by the React app after it had loaded its own assistants.
   */
  function runPending() {
    var ask = state.pending;
    if (!ask) {
      return;
    }
    state.pending = null;
    if (ask.assistantId) {
      selectAssistant(ask.assistantId);
    }
    if (ask.question) {
      state.draft = ask.question;
      paint();
      send();
    }
  }

  function openWith(question, assistantId) {
    var text = question === null || question === undefined ? '' : String(question);
    // The same check the module makes on its own parameter, for the same reason: the id is about
    // to be sent as one.
    var id = /^[A-Fa-f0-9]{32}$/.test(String(assistantId || '')) ? String(assistantId) : '';
    if (text || id) {
      state.pending = { question: text, assistantId: id };
    }
    openFrom(null);
    if (state.assistants.length) {
      runPending();
    }
  }

  /*
   * The module also puts a button in the navigation bar, and it stays exactly where it is, with
   * its own label and its own colours - what changes is where it leads. It is built from a
   * template, as an anonymous button with no id to look it up by, so it is recognised by the two
   * marks that template leaves on it: the style it paints itself with and the handler that both
   * its click and its open() go through. Replacing that handler is also what makes a question
   * asked from elsewhere in the application - open(question, assistantId) - land in the panel.
   */
  function navButton() {
    var members = OB.NavBar && OB.NavBar.getMembers ? (OB.NavBar.getMembers() || []) : [];
    var i, inner;
    for (i = 0; i < members.length; i++) {
      inner = members[i].getMembers ? (members[i].getMembers() || [])[0] : null;
      if (inner && inner.baseStyle === 'navBarButton' && typeof inner._handleClick === 'function') {
        return { wrapper: members[i], button: inner };
      }
    }
    return null;
  }

  function patchNav() {
    var found = navButton();
    if (!found) {
      return;
    }
    found.button._handleClick = function (question, assistantId) {
      /*
       * Pressed with nothing to ask while the panel is open, it closes it. The stock button did
       * nothing in that case, because the floating window was already in front of the user; a
       * docked panel is a piece of the screen, and the button that opened it is where one expects
       * to get the screen back.
       */
      if (!question && !assistantId && state.open) {
        closeDock();
        return;
      }
      openWith(question, assistantId);
    };

    /*
     * And it joins the tray as one of its chips rather than as the one word in it. The tray leaves
     * a button from a module it knows nothing about at its own width, which is right - the word may
     * be the whole control - but this one is Copilot's, and this file only exists when Copilot is
     * installed, so it can say that a chat glyph and a tooltip say it better. It moves to the head
     * of the row because identity and the way out belong at the right edge.
     */
    if (topBar() && topBar().chip && topBar().chip(found.wrapper, 'copilot', state.open)) {
      state.pill = found.wrapper;
      if (topBar().first) {
        topBar().first(found.wrapper);
      }
    }
  }

  function topBar() {
    return (OB.ETSkin && OB.ETSkin.topBar) || null;
  }

  // The chip is filled while the panel is open, so the tray says whether it is on screen - the one
  // thing the stock button could not say, because what it opened floated over everything.
  function markPill(on) {
    if (!state.pill || !topBar() || !topBar().chip) {
      return;
    }
    topBar().chip(state.pill, 'copilot', !!on);
  }

  function openFrom(source) {
    var view = activeView(source);
    var grid = view && view.viewGrid;
    if (view) {
      useContext(view);
    }
    openDock();
    /*
     * The stock button re-posted the context into the iframe whenever the selection changed. The
     * panel does the same, so a question asked after picking a different row is asked about that
     * row, and the chip under the composer says which one.
     */
    if (grid && grid.addDataUpdatedHandler && !grid.etskinCopilotBound) {
      grid.etskinCopilotBound = true;
      grid.addDataUpdatedHandler(function () {
        if (!state.open || state.contextView !== view) {
          return;
        }
        useContext(view);
        paint();
      });
    }
  }

  /*
   * The module's button is left exactly where it is - same icon, same place in every toolbar, same
   * tooltip - and only what it does is replaced. The registry hands each toolbar a clone of these
   * properties when it builds it, so replacing the action before any window opens replaces it
   * everywhere, and the closure that opened the floating window is never reached again.
   */
  function patch(def) {
    def.properties = def.properties || {};
    def.properties.action = function () {
      openFrom(this.view);
    };
  }

  function install() {
    var def = definition();
    if (!def) {
      // Copilot is not installed on this instance: no panel, no listeners, no requests, nothing.
      return;
    }
    patch(def);
    bind();
    patchNav();
    state.wide = readFlag(WIDE_KEY, false);
    if (readFlag(OPEN_KEY, false)) {
      openDock();
    }
    OB.ETSkin.copilot = {
      open: openFrom,
      ask: openWith,
      close: closeDock,
      state: state
    };
  }

  // ------------------------------------------------------------------- main

  try {
    if (wanted() && OB.Layout && OB.Layout.initialize) {
      var originalInitialize = OB.Layout.initialize;
      OB.Layout.initialize = function () {
        var result = originalInitialize.apply(this, arguments);
        try {
          install();
        } catch (e) {
          // A chat that fails to dock must not cost the user the application, and Copilot's own
          // button is still registered at this point - it just still opens the stock window.
          if (typeof console !== 'undefined' && console.warn) {
            console.warn('Etendo Modern Skin could not dock Copilot', e);
          }
        }
        return result;
      };
    }
  } catch (e) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('Etendo Modern Skin Copilot panel is unavailable', e);
    }
  }
})();
