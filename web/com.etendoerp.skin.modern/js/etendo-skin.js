/*
 *************************************************************************
 * Copyright (C) 2026 Futit Services S.L.
 * Licensed under the Openbravo Public License version 1.1.
 * You may obtain a copy of the License at
 * http://www.openbravo.com/legal/license.html
 ************************************************************************
 */

/*
 * Etendo Modern Skin - runtime theming.
 *
 * This file is concatenated into the global OB3 script bundle, minified with Crockford's JSMin
 * (see JSCompressor.java) and served as a single <script>. A syntax error here takes the whole
 * application down, so the code below sticks to conservative ES5: no let/const, no arrow
 * functions, no template literals, no trailing commas.
 *
 * The stylesheet bundle is cached globally, not per client, so the palette cannot be baked into
 * the CSS. Instead the CSS is authored against custom properties and this script resolves them
 * per session from OB.Properties, which the kernel populates from the AD preferences applicable
 * to the current client, organization, role and user.
 */

(function () {
  'use strict';

  var ROOT_CLASS = 'etskin-on';
  var VAR_PREFIX = '--sk-';

  // ---------------------------------------------------------------- presets

  // Every preset is a complete token set. A preference only needs to carry the keys it wants to
  // override; anything missing falls back to the preset, and an unknown preset name falls back to
  // 'etendoNext'.
  var PRESETS = {
    // Etendo's own next generation look, restated for Classic: a periwinkle desk with the windows
    // as white sheets laid on it, a near black primary action and the familiar yellow kept for the
    // focus marker. This is the default.
    etendoNext: {
      primary: '#2563eb',
      accent: '#1e293b',
      marker: '#f5c518',
      danger: '#dc2626',
      surface: '#ffffff',
      canvas: '#c6d3ff',
      canvasTint: '#f5f6fa',
      text: '#101828',
      radius: '8px',
      density: 'comfortable'
    },

    indigo: {
      primary: '#4f46e5',
      accent: '#f59e0b',
      marker: '#f59e0b',
      danger: '#dc2626',
      surface: '#ffffff',
      canvas: '#eef0f6',
      canvasTint: '#f7f8fa',
      text: '#1a1d29',
      radius: '8px',
      density: 'comfortable'
    },

    // The stock Etendo look, restated as tokens. Useful as a low-risk rollout step: modern
    // geometry and typography, familiar colors.
    etendo: {
      primary: '#202452',
      accent: '#fad614',
      marker: '#fad614',
      danger: '#dc2626',
      surface: '#ffffff',
      canvas: '#e7e9f6',
      canvasTint: '#f4f5f9',
      text: '#1a1d29',
      radius: '7px',
      density: 'comfortable'
    },

    slate: {
      primary: '#334155',
      accent: '#0ea5e9',
      marker: '#0ea5e9',
      danger: '#dc2626',
      surface: '#ffffff',
      canvas: '#e8edf3',
      canvasTint: '#f8fafc',
      text: '#0f172a',
      radius: '6px',
      density: 'compact'
    },

    emerald: {
      primary: '#047857',
      accent: '#f59e0b',
      marker: '#f59e0b',
      danger: '#dc2626',
      surface: '#ffffff',
      canvas: '#d9ece4',
      canvasTint: '#f6f9f7',
      text: '#14211c',
      radius: '10px',
      density: 'comfortable'
    }
  };

  var DENSITIES = {
    compact: { cellHeight: 30, fieldHeight: 28, tabBar: 38 },
    comfortable: { cellHeight: 36, fieldHeight: 32, tabBar: 44 },
    spacious: { cellHeight: 42, fieldHeight: 36, tabBar: 48 }
  };

  var DEFAULT_FONT =
    '"Inter", "Inter var", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

  // ------------------------------------------------------------ preferences

  function properties() {
    return (typeof OB !== 'undefined' && OB && OB.Properties) || {};
  }

  function preference(name) {
    var props = properties();
    return Object.prototype.hasOwnProperty.call(props, name) ? props[name] : null;
  }

  function isEnabled() {
    // The stock 3.0 skin and the Legacy skin are mutually exclusive; index.jsp swaps the whole
    // bundle when Legacy is on, so staying out of the way is the only sane behaviour.
    if (preference('SKINLEG_LegacySkin') === 'Y') {
      return false;
    }
    // Opt-out rather than opt-in: the module ships with ETSKIN_Enabled = Y at system level.
    return preference('ETSKIN_Enabled') !== 'N';
  }

  // PropertiesComponent parses values that look like JSON into real objects, but falls back to the
  // raw string when the admin saved something malformed. Tolerate both.
  function themeOverrides() {
    var raw = preference('ETSKIN_Theme');
    if (!raw) {
      return {};
    }
    if (typeof raw === 'object') {
      return raw;
    }
    try {
      var parsed = JSON.parse(String(raw));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function resolveTokens() {
    var overrides = themeOverrides();
    var preset = PRESETS[overrides.preset] || PRESETS.etendoNext;
    var tokens = {};
    var key;

    for (key in preset) {
      if (Object.prototype.hasOwnProperty.call(preset, key)) {
        tokens[key] = preset[key];
      }
    }
    for (key in overrides) {
      if (Object.prototype.hasOwnProperty.call(overrides, key) && key !== 'preset') {
        if (overrides[key]) {
          tokens[key] = overrides[key];
        }
      }
    }

    if (!tokens.font) {
      tokens.font = DEFAULT_FONT;
    }
    if (!DENSITIES[tokens.density]) {
      tokens.density = 'comfortable';
    }
    return tokens;
  }

  // ----------------------------------------------------------------- colour

  // Contrast is derived, never configured: an admin who picks a light primary should not have to
  // know that the label on top of it has to flip to black.
  function parseHex(value) {
    var hex = String(value || '').replace('#', '');
    if (hex.length === 3) {
      hex = hex.charAt(0) + hex.charAt(0) + hex.charAt(1) + hex.charAt(1) + hex.charAt(2) + hex.charAt(2);
    }
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
      return null;
    }
    return [
      parseInt(hex.substring(0, 2), 16),
      parseInt(hex.substring(2, 4), 16),
      parseInt(hex.substring(4, 6), 16)
    ];
  }

  function relativeLuminance(rgb) {
    var channels = [];
    var i, c;
    for (i = 0; i < 3; i++) {
      c = rgb[i] / 255;
      channels.push(c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    }
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  }

  function readableOn(color) {
    var rgb = parseHex(color);
    if (!rgb) {
      return '#ffffff';
    }
    return relativeLuminance(rgb) > 0.45 ? '#101322' : '#ffffff';
  }

  // ------------------------------------------------------------------ apply

  function applyTokens(tokens) {
    var root = document.documentElement;
    var style = root.style;
    var density = DENSITIES[tokens.density];

    function set(name, value) {
      if (value !== null && value !== undefined && value !== '') {
        style.setProperty(VAR_PREFIX + name, String(value));
      }
    }

    set('primary', tokens.primary);
    set('accent', tokens.accent);
    set('danger', tokens.danger);
    set('marker', tokens.marker);
    set('surface', tokens.surface);
    set('canvas', tokens.canvas);
    set('canvas-tint', tokens.canvasTint);
    set('text', tokens.text);
    set('radius', tokens.radius);
    set('font', tokens.font);

    set('on-primary', readableOn(tokens.primary));
    set('on-accent', readableOn(tokens.accent));
    set('on-danger', readableOn(tokens.danger));

    // Sizes are mirrored into CSS so that padding and line-height track the JS row heights.
    set('cell-height', density.cellHeight + 'px');
    set('field-height', density.fieldHeight + 'px');
    set('tabbar-height', density.tabBar + 'px');

    if (root.className.indexOf(ROOT_CLASS) === -1) {
      root.className = root.className ? root.className + ' ' + ROOT_CLASS : ROOT_CLASS;
    }
  }

  // --------------------------------------------------------- status badges

  /*
   * A document status read as a coloured badge rather than as a word in a column of words, which
   * is how the React client shows it. Two things make that safe to do generically.
   *
   * The first is that this applies to the document status and to nothing else. Ten columns in the
   * dictionary are named Document Status and they use two references between them, whose values
   * overlap almost entirely - the map below is the union of both. Twenty-two further columns are
   * named merely Status, over ten unrelated references: a period is O, C or P, an alert is a
   * different set again, and colouring those from this map would state something false in a
   * confident colour. So the grid asks for a badge by property name, and that name is
   * documentStatus.
   *
   * The second is that a tone is not a colour. Five tones, each one a token pair, and the same
   * five the order board uses for its columns - a status that is blue on the board cannot be green
   * in the grid behind it. Booked is the working state and takes the primary tone; closed is the
   * finished one and takes the success tone, which is why green is not on the active document.
   * Anything the map does not know is neutral, because an unknown status must read as unknown and
   * not as fine.
   */
  var STATUS_TONES = {
    // Not started, or not a state anybody acts on.
    'DR': 'neutral', 'TMP': 'neutral', 'TEMP': 'neutral', 'IN': 'neutral', 'CH': 'neutral',
    'PR': 'neutral', 'NC': 'neutral', '??': 'neutral', 'XX': 'neutral',
    // Under way: booked, posted, transferred, being evaluated.
    'CO': 'active', 'IP': 'active', 'PO': 'active', 'TR': 'active', 'AP': 'active',
    'UE': 'active', 'ME': 'active', 'AE': 'active',
    // Finished.
    'CL': 'done', 'CA': 'done',
    // Wants attention but is not a failure.
    'RE': 'warn', 'WP': 'warn',
    // Voided, rejected, refused or in error.
    'VO': 'bad', 'NA': 'bad', 'CJ': 'bad', 'PE': 'bad', 'TE': 'bad'
  };

  function escaped(value) {
    return String(value === null || value === undefined ? '' : value)
      .split('&').join('&amp;')
      .split('<').join('&lt;')
      .split('>').join('&gt;')
      .split('"').join('&quot;');
  }

  /*
   * The label is plain text and is escaped here, so a caller never has to think about it and can
   * never hand markup through by accident. Callers pass the value's own translated name - the one
   * out of the field's value map or off the record - not a rendered cell.
   */
  function statusBadge(value, label) {
    var key = value === null || value === undefined ? '' : String(value);
    var tone = STATUS_TONES[key] || 'neutral';
    return '<span class="etskin-status etskin-status-' + tone + '" title="' + escaped(label) +
      '">' + escaped(label) + '</span>';
  }

  // ------------------------------------------------------ SmartClient sizes

  // A large part of the stock look lives in JS class properties rather than CSS: row heights,
  // field heights and the custom scrollbar images. None of that responds to a class on <html>,
  // so it has to be overridden here. This runs before OB.Layout.draw(), because the kernel
  // registers its session properties as a dynamic resource and every static resource after it is
  // emitted inside the $LAB .wait() callback.
  var TEXT_ITEMS = [
    'OBTextItem',
    'OBFKFilterTextItem',
    'OBEncryptedItem',
    'OBClientClassCanvasItem',
    'OBSpinnerItem',
    'OBNumberItem',
    'OBTimeItem',
    'OBDateItem',
    'OBDateTimeItem'
  ];

  var PICKER_ITEMS = ['OBListItem', 'OBFKItem', 'OBYesNoItem', 'OBSearchItem', 'OBLinkItem'];

  function addProperties(className, props) {
    if (typeof isc === 'undefined' || !isc || !isc[className] || !isc[className].addProperties) {
      return;
    }
    try {
      isc[className].addProperties(props);
    } catch (e) {
      // A single unknown class must not cost us the rest of the skin.
    }
  }

  function applySmartClient(tokens) {
    var density = DENSITIES[tokens.density];
    var i;

    if (typeof isc === 'undefined' || !isc) {
      return;
    }

    // Default/smartclient/load_skin.js turns custom scrollbars on in its useCSS3 === false branch,
    // which is the branch Etendo takes. Those are PNG-drawn scrollbars and they are the single
    // most dated element on screen. Native ones also scroll better.
    addProperties('Canvas', { showCustomScrollbars: false });

    addProperties('OBViewGrid', {
      cellHeight: density.cellHeight,
      recordComponentHeight: density.cellHeight - 7
    });

    addProperties('OBTabSetMain', { tabBarThickness: density.tabBar });

    for (i = 0; i < TEXT_ITEMS.length; i++) {
      addProperties(TEXT_ITEMS[i], { height: density.fieldHeight });
    }

    for (i = 0; i < PICKER_ITEMS.length; i++) {
      addProperties(PICKER_ITEMS[i], {
        height: density.fieldHeight,
        pickerIconWidth: density.fieldHeight,
        pickerIconHeight: density.fieldHeight,
        pickListCellHeight: density.fieldHeight
      });
    }

    addProperties('OBFormButton', { height: density.fieldHeight + 4 });
  }

  // ------------------------------------------------------------------- main

  try {
    if (isEnabled()) {
      var tokens = resolveTokens();
      applyTokens(tokens);
      applySmartClient(tokens);
      if (typeof OB !== 'undefined' && OB) {
        OB.ETSkin = { tokens: tokens, statusBadge: statusBadge };
      }
    }
  } catch (e) {
    // Never let theming break the application.
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('Etendo Modern Skin could not be applied', e);
    }
  }
})();
