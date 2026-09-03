/*
 *************************************************************************
 * Copyright (C) 2026 Futit Services S.L.
 * Licensed under the Openbravo Public License version 1.1.
 * You may obtain a copy of the License at
 * http://www.openbravo.com/legal/license.html
 ************************************************************************
 */

/*
 * Runs inside the deployed application and returns the measurements that verify/check-dom.mjs
 * asserts on. It is a measuring tape, not a test: it never decides whether a number is good, it
 * only records what the browser actually laid out. Every threshold lives in verify/criteria.json,
 * so a finding can be re-argued by editing the criteria without re-recording the page.
 *
 * Injected verbatim through the devtools protocol, so it may use modern syntax - unlike the
 * shipped bundle, which JSMin minifies and which is therefore ES5.
 */
async function etskinCapture(screen) {
  var round = function (n) { return Math.round(n * 100) / 100; };

  function box(el) {
    var r = el.getBoundingClientRect();
    return { x: round(r.x), y: round(r.y), w: round(r.width), h: round(r.height) };
  }

  function laidOut(el) {
    if (!el || !el.getBoundingClientRect) { return false; }
    var r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) { return false; }
    if (r.bottom < 0 || r.top > window.innerHeight) { return false; }
    return getComputedStyle(el).display !== 'none';
  }

  /*
   * The skin hides stock artwork with visibility:hidden and paints a mask over the button, so a
   * toolbar icon is laid out and on screen while its own img is invisible. laidOut is what to ask
   * about a control; visible is what to ask about text.
   */
  function visible(el) {
    if (!laidOut(el)) { return false; }
    var cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && Number(cs.opacity) > 0.01;
  }

  function all(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  /*
   * A window keeps the DOM of every tab it has opened, so several nodes answer to the same class
   * and only one of them is the one on screen. querySelector returns the first in document order,
   * which is usually a stale one. The visible node with the largest area is the one being looked at.
   */
  function pick(selector, root) {
    var best = null;
    var bestArea = 0;
    all(selector, root).forEach(function (el) {
      if (!laidOut(el)) { return; }
      var r = el.getBoundingClientRect();
      var area = r.width * r.height;
      if (area > bestArea) { bestArea = area; best = el; }
    });
    return best;
  }

  function rgb(value) {
    var m = String(value || '').match(/-?[\d.]+/g);
    if (!m) { return null; }
    var a = m.length > 3 ? Number(m[3]) : 1;
    // color() notation reports 0-1 channels; rgb() reports 0-255.
    var scale = /^color\(/.test(String(value)) ? 255 : 1;
    return [Math.round(Number(m[0]) * scale), Math.round(Number(m[1]) * scale), Math.round(Number(m[2]) * scale), a];
  }

  function hue(c) {
    if (!c) { return null; }
    var r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    if (d === 0) { return 0; }
    var h;
    if (max === r) { h = ((g - b) / d) % 6; } else if (max === g) { h = (b - r) / d + 2; } else { h = (r - g) / d + 4; }
    h = Math.round(h * 60);
    return h < 0 ? h + 360 : h;
  }

  function textNodesIn(root) {
    var out = [];
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var node;
    while ((node = walker.nextNode())) {
      // SmartClient pads its table cells with non-breaking spaces, which trim() does not remove.
      if (!String(node.nodeValue || '').replace(/[\s\u00a0]+/g, '')) { continue; }
      var el = node.parentElement;
      if (!visible(el)) { continue; }
      var cs = getComputedStyle(el);
      out.push({
        text: String(node.nodeValue).replace(/[\s\u00a0]+/g, ' ').trim().slice(0, 40),
        size: round(parseFloat(cs.fontSize)),
        weight: Number(cs.fontWeight) || cs.fontWeight,
        transform: cs.textTransform,
        color: cs.color
      });
    }
    return out;
  }

  var token = function (name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  };

  // ------------------------------------------------------------------ shell

  function topBar() {
    var top = (typeof OB !== 'undefined' && OB.TopLayout) ? OB.TopLayout : null;
    /*
     * getID names the SmartClient instance, not the element: the DOM handle is what carries the
     * bar's markup, and getHandle is the only thing that returns it.
     */
    var el = (top && top.getHandle && top.getHandle()) || null;
    var logoHost = top && top.CompanyImageLogo && top.CompanyImageLogo.getParentCanvas
      ? document.getElementById(top.CompanyImageLogo.getParentCanvas().getID())
      : null;
    var logo = logoHost ? logoHost.querySelector('img') : document.querySelector('.OBNavBarComponent img');
    var cluster = document.querySelector('.OBNavBarToolStrip');
    var chips = all('.etskin-tray-item').filter(visible);
    var gaps = [];
    for (var i = 1; i < chips.length; i++) {
      gaps.push(round(chips[i].getBoundingClientRect().x - chips[i - 1].getBoundingClientRect().right));
    }
    return {
      height: top && top.getVisibleHeight ? round(top.getVisibleHeight()) : (el ? round(el.getBoundingClientRect().height) : null),
      // The wordmark is not inside the logo canvas, so the whole bar is what has to be measured.
      texts: el ? textNodesIn(el) : (logoHost ? textNodesIn(logoHost) : []),
      // The wordmark is artwork, not text, so branding weight is measured in image heights.
      logoHeight: logo ? round(logo.getBoundingClientRect().height) : null,
      imageHeights: el ? all('img', el).filter(laidOut).map(function (i) { return round(i.getBoundingClientRect().height); }) : [],
      cluster: cluster ? {
        borderWidth: round(parseFloat(getComputedStyle(cluster).borderTopWidth) || 0),
        background: getComputedStyle(cluster).backgroundColor,
        buttons: chips.length,
        sizes: chips.map(function (c) { return [round(c.getBoundingClientRect().width), round(c.getBoundingClientRect().height)]; }),
        gaps: gaps
      } : null
    };
  }

  // ---------------------------------------------------------------- toolbar

  function toolbar() {
    var strip = document.querySelector('.OBToolbar');
    if (!strip) { return null; }
    var icons = all('[class*="OBToolbarIconButton_icon_"]').filter(laidOut).map(function (el) {
      var name = (String(el.className).match(/OBToolbarIconButton_icon_([A-Za-z]+)/) || [])[1];
      var host = el.closest('.OBToolbarIconButton, [class^="OBToolbarIconButton"]') || el;
      var chip = el.closest('.etskin-tb-item') || host;
      return {
        name: name,
        box: box(chip),
        disabled: /Disabled/.test(String(host.className) + String(el.className)) || Number(getComputedStyle(el).opacity) < 0.9,
        group: (function () { var g = el.closest('[data-etskin-group]'); return g ? g.getAttribute('data-etskin-group') : null; }())
      };
    });
    var texts = all('.OBToolbarTextButton, [class^="OBToolbarTextButton"]').filter(laidOut).map(function (el) {
      return { label: (el.textContent || '').trim().slice(0, 30), box: box(el), background: getComputedStyle(el).backgroundColor };
    });
    var filled = all('.OBToolbar *').filter(function (el) {
      if (!visible(el)) { return false; }
      if (el.querySelector && el.querySelector('[class*="OBToolbarIconButton_icon_"]')) { return false; }
      if (/OBToolbarIconButton_icon_/.test(String(el.className))) { return false; }
      var cs0 = getComputedStyle(el);
      // A masked element paints its background only through the glyph: it is an icon, not a fill.
      if ((cs0.maskImage && cs0.maskImage !== 'none') || (cs0.webkitMaskImage && cs0.webkitMaskImage !== 'none')) { return false; }
      var c = rgb(getComputedStyle(el).backgroundColor);
      // A filled control: opaque, and far enough from the surface to read as a solid block.
      return c && c[3] > 0.9 && (c[0] + c[1] + c[2]) < 690 && el.getBoundingClientRect().height >= 24;
    }).map(function (el) { return { cls: String(el.className).slice(0, 60), box: box(el), background: getComputedStyle(el).backgroundColor }; });
    var dividers = all('.etskin-tb-divider').filter(laidOut).length;
    /*
     * "One primary" is a decision the skin makes, not something to infer from a colour: the marker
     * class is the claim, and this only records where it landed.
     */
    var primary = all('.etskin-tb-primary').filter(laidOut).map(function (el) {
      return { label: (el.textContent || '').trim().slice(0, 30), box: box(el), background: getComputedStyle(el).backgroundColor };
    });
    var right = icons.concat(texts.map(function (t) { return { name: 'text:' + t.label, box: t.box }; }));
    return {
      box: box(strip),
      icons: icons,
      texts: texts,
      filled: filled,
      primary: primary,
      dividers: dividers,
      rightMost: right.length ? round(Math.max.apply(null, right.map(function (i) { return i.box.x + i.box.w; }))) : null,
      overflow: all('.etskin-tb-overflow').filter(laidOut).length,
      viewGroup: all('.etskin-tb-view').filter(laidOut).map(function (el) { return box(el); })
    };
  }

  // ------------------------------------------------------------------- grid

  function grid() {
    var headerBar = pick('.OBGridHeaderBar');
    // The header cell and its title node share a box, so counting both double-counts every column.
    var titles = all('[class^="OBGridHeaderCellTitle"]', headerBar || document).filter(visible);
    var header = (titles.length ? titles : all('[class^="OBGridHeaderCell"]', headerBar || document).filter(visible))
      .filter(function (el) { return (el.textContent || '').trim().length > 0; });
    var body = pick('.OBViewGridBody, .OBGridBody');
    var rows = body ? all('tr', body).filter(visible) : [];
    var cells = body ? all('.OBGridCell, [class^="OBGridCell"]', body).filter(visible) : [];
    var banner = pick('.OBGridNotificationText, [class^="OBGridNotification"]');
    var bannerHost = banner ? (banner.closest('table') || banner.parentElement) : null;
    var firstData = cells.length ? round(Math.min.apply(null, cells.map(function (c) { return c.getBoundingClientRect().x; }))) : null;
    var gridLeft = body ? round(body.getBoundingClientRect().x) : null;
    // The separator is painted on the cell, not on the row: a tr has no border box of its own here.
    var sepEl = cells.length ? cells[0] : (rows.length ? rows[0] : null);
    var sepCS = sepEl ? getComputedStyle(sepEl) : null;
    var sep = sepCS ? sepCS.borderBottomColor : null;
    return {
      headerCells: header.slice(0, 12).map(function (el) {
        var cs = getComputedStyle(el);
        return {
          text: (el.textContent || '').trim().slice(0, 24),
          box: box(el),
          weight: Number(cs.fontWeight) || cs.fontWeight,
          size: round(parseFloat(cs.fontSize)),
          color: cs.color,
          align: cs.textAlign,
          transform: cs.textTransform
        };
      }),
      cellSample: cells.slice(0, 12).map(function (el) {
        var cs = getComputedStyle(el);
        return { text: (el.textContent || '').trim().slice(0, 24), box: box(el), align: cs.textAlign, color: cs.color, size: round(parseFloat(cs.fontSize)), weight: Number(cs.fontWeight) || cs.fontWeight };
      }),
      rowHeight: rows.length ? round(rows[0].getBoundingClientRect().height) : null,
      rowSeparator: sepCS ? { color: sep, width: round(parseFloat(sepCS.borderBottomWidth) || 0), alpha: rgb(sep) ? rgb(sep)[3] : null } : null,
      chromeLeftWidth: (firstData !== null && gridLeft !== null) ? round(firstData - gridLeft) : null,
      /*
       * The checkbox, document and edit columns live in their own frozen body to the left of the
       * data body, so their cost is that pane's width, not an offset inside the data pane.
       */
      frozenWidth: (function () {
        if (!body) { return null; }
        var top = body.getBoundingClientRect().top;
        var w = null;
        all('.OBViewGridBody, .OBGridBody').filter(laidOut).forEach(function (el) {
          var r = el.getBoundingClientRect();
          if (Math.abs(r.top - top) > 4 || el === body) { return; }
          if (r.right <= body.getBoundingClientRect().left + 4) { w = round(r.width); }
        });
        return w;
      }()),
      banner: bannerHost && visible(bannerHost) ? {
        height: round(bannerHost.getBoundingClientRect().height),
        weight: Number(getComputedStyle(banner).fontWeight) || getComputedStyle(banner).fontWeight,
        size: round(parseFloat(getComputedStyle(banner).fontSize))
      } : null,
      filterBadge: (function () {
        var f = document.querySelector('.etskin-toolbar-filtered');
        if (!f) { return null; }
        var cs = getComputedStyle(f, '::after');
        return { width: round(parseFloat(cs.width) || 0), height: round(parseFloat(cs.height) || 0) };
      }())
    };
  }

  // ------------------------------------------------------------------- form

  function form() {
    var host = pick('.OBViewForm');
    if (!host) { return null; }
    var inputs = all('.OBFormFieldInput, .OBFormFieldSelectInput, .OBFormFieldNumberInput, [class^="OBFormField"][class*="Input"]', host)
      .filter(visible)
      .filter(function (el) { return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'; });
    var labels = all('[class^="OBFormFieldLabel"]', host).filter(visible);
    /*
     * The "open in new tab" affordance is an <img> inside the label, not the .OBFormFieldLinkButton
     * span - that span is the whole clickable label. The arrow is what F2 is about.
     */
    var links = all('img[src*="ico-to-new-tab"]', host).filter(laidOut);
    var sections = all('[class^="OBSectionItemButton_Title"]', host).filter(visible);
    /*
     * Fields snap to a handful of x positions; anything within 20px is the same column. What the
     * criterion is about is the pitch between those positions, so the position is what is kept.
     */
    var cols = {};
    inputs.forEach(function (el) {
      var r = el.getBoundingClientRect();
      var key = Math.round(r.x / 20) * 20;
      if (!cols[key]) { cols[key] = { x: round(r.x), width: round(r.width), count: 0 }; }
      cols[key].width = Math.max(cols[key].width, round(r.width));
      cols[key].count += 1;
    });

    /*
     * A decoration is anything painted beside the value that is not the value: the picker button,
     * the link arrow, the combo caret. One is a control; several at rest is clutter.
     */
    var DECORATION = 'img[src*="ico-to-new-tab"], .OBFormFieldSelectPickerIcon, .OBFormFieldPickerIcon,'
      + ' [class*="PickerIcon"], .OBFormFieldComboBoxIcon, img[src*="picker"]';
    /*
     * Corrected 2026-09-03. This asked closest('tr') for the field, but a DynamicForm row is a <tr>
     * holding all four columns, so it counted a whole row of fields and reported four or five where
     * each field carried one. The field is the cell of the outermost row that contains the input;
     * for a foreign key the input sits in a nested table, so the walk climbs until it finds a cell
     * the form itself styled as a field. before-*.json was re-recorded with this version.
     */
    function fieldCell(el) {
      var row = el.closest('tr');
      while (row) {
        var kids = row.children;
        for (var k = 0; k < kids.length; k++) {
          if (kids[k].contains(el) && /^OBFormField/.test(kids[k].className || '')) { return kids[k]; }
        }
        row = row.parentElement ? row.parentElement.closest('tr') : null;
      }
      return el.parentElement;
    }

    /*
     * Two rules keep this counting controls rather than nodes.
     *
     * A picker is a <td> wrapping an <img>; both match DECORATION, so an element that contains
     * another match is dropped and only the innermost node of each control is counted.
     *
     * "At rest" is the criterion, and the field the browser has focused is not at rest: affordances
     * that are meant to appear on interaction are showing there precisely because the skin works.
     * That field is left out rather than blurred, because blurring a SmartClient item fires its
     * change handling and would alter the page the recording is meant to observe. The resting
     * visibility of the link arrow is not lost - linkGlyphOpacity below records it directly.
     */
    var decorations = inputs.slice(0, 16).map(function (el) {
      var cell = fieldCell(el);
      if (!cell || (document.activeElement && cell.contains(document.activeElement))) { return null; }
      var found = all(DECORATION, cell).filter(function (d) {
        return visible(d) && Number(getComputedStyle(d).opacity) > 0.05;
      });
      return found.filter(function (d) {
        return !found.some(function (other) { return other !== d && d.contains(other); });
      }).length;
    }).filter(function (n) { return n !== null; });
    /*
     * Stock markup puts the asterisk inside the bold label text, so there is nothing to colour. A
     * marker only exists once the skin has wrapped it, which is exactly what the criterion asks
     * for: an unwrapped asterisk records as no marker at all.
     */
    var required = all('.etskin-required, .OBFormFieldRequiredMark', host).filter(visible).map(function (mark) {
      var cs = getComputedStyle(mark);
      return { color: cs.color, hue: hue(rgb(cs.color)), size: round(parseFloat(cs.fontSize)) };
    });
    var asterisksInLabels = labels.filter(function (el) {
      return /\*/.test(el.textContent || '') && !el.querySelector('.etskin-required');
    }).length;
    return {
      box: box(host),
      inputs: inputs.slice(0, 16).map(function (el) {
        var cs = getComputedStyle(el);
        return {
          box: box(el),
          height: round(el.getBoundingClientRect().height),
          borderLeft: round(parseFloat(cs.borderLeftWidth) || 0),
          borderBottom: round(parseFloat(cs.borderBottomWidth) || 0),
          borderBottomStyle: cs.borderBottomStyle,
          background: cs.backgroundColor,
          size: round(parseFloat(cs.fontSize))
        };
      }),
      columns: Object.keys(cols).map(function (k) { return cols[k]; }).sort(function (a, b) { return a.x - b.x; }),
      decorations: decorations,
      required: required,
      unwrappedAsterisks: asterisksInLabels,
      linkGlyphs: links.length,
      linkGlyphOpacity: links.length ? round(Number(getComputedStyle(links[0]).opacity)) : null,
      sections: sections.map(function (el) {
        var band = el.closest('table') || el;
        var cs = getComputedStyle(band);
        var chevron = band.querySelector('.etskin-section-chevron, [class*="SectionItem"][class*="Icon"]');
        return {
          text: (el.textContent || '').trim().slice(0, 24),
          height: round(band.getBoundingClientRect().height),
          background: cs.backgroundColor,
          right: round(band.getBoundingClientRect().right),
          chevronRight: chevron && laidOut(chevron) ? round(chevron.getBoundingClientRect().right) : null
        };
      })
    };
  }

  // ------------------------------------------------------------- panes, nav

  function panes() {
    var formHost = pick('.OBViewForm');
    var gridHost = pick('.OBViewGridBody, .OBGridBody');
    var childStrip = pick('.OBTabBarChild');
    var childSet = childStrip ? childStrip.closest('.OBTabSetChildContainer') || childStrip.parentElement : null;
    return {
      form: formHost && visible(formHost) ? box(formHost) : null,
      grid: gridHost && visible(gridHost) ? box(gridHost) : null,
      childStrip: childStrip && visible(childStrip) ? box(childStrip) : null,
      childPane: childSet && visible(childSet) ? box(childSet) : null,
      viewportHeight: window.innerHeight
    };
  }

  function nav() {
    var root = document.querySelector('.etskin-nav');
    if (!root) { return null; }
    /*
     * Depth is carried by data-p ("0", "0.1", "0.1.2"), not by nesting depth in the DOM, so a
     * top-level section is a row whose path has no dot in it.
     */
    var top = all('.etskin-nav-row[data-p]', root).filter(function (el) {
      return !/\./.test(el.getAttribute('data-p'));
    }).filter(visible);
    var tiles = all('.etskin-nav-tile', root);
    function iconOf(el) {
      var cs = getComputedStyle(el, '::before');
      return (cs.maskImage && cs.maskImage !== 'none') ? cs.maskImage : (cs.webkitMaskImage || 'none');
    }
    return {
      collapsed: /etskin-nav-collapsed/.test(root.className),
      width: round(root.getBoundingClientRect().width),
      itemHeight: top.length ? round(top[0].getBoundingClientRect().height) : null,
      topLevel: top.map(function (el) {
        var icon = el.querySelector('.etskin-nav-icon') || el;
        var iconCls = String(icon.className).replace(/etskin-nav-icon\s*/, '').trim();
        var cs = getComputedStyle(el);
        return {
          text: (el.textContent || '').trim().slice(0, 32),
          icon: iconOf(icon).slice(0, 200),
          iconClass: iconCls,
          height: round(el.getBoundingClientRect().height),
          background: cs.backgroundColor,
          current: /etskin-nav-current/.test(el.className)
        };
      }),
      tiles: tiles.map(function (el) {
        return { label: (el.textContent || '').trim(), icon: iconOf(el).slice(0, 200), background: getComputedStyle(el).backgroundColor, current: /etskin-nav-tile-current/.test(el.className) };
      }),
      searchPlaceholder: (function () { var i = root.querySelector('input'); return i ? i.getAttribute('placeholder') : null; }())
    };
  }

  // ------------------------------------------------------- colour, type, misc

  /*
   * F3 asks how much of the content area the user actually sees as one flat block of colour.
   * Walking the DOM answers a different question - a container is "lavender" even when its children
   * cover every pixel of it - so this samples the rendered page instead: a grid of points, the
   * painted colour resolved at each by walking up from elementFromPoint to the first opaque
   * background, then a flood fill over the sample grid for the largest contiguous region.
   */
  function paint() {
    var area = document.querySelector('.OBTabSetMain') || document.body;
    var r = area.getBoundingClientRect();
    var step = 8;
    var cols = Math.floor(r.width / step);
    var rows = Math.floor(r.height / step);
    var keys = [];
    var counts = {};
    var i, j, el, cs, c, key;

    function paintedAt(x, y) {
      var node = document.elementFromPoint(x, y);
      while (node && node !== document.documentElement) {
        var value = getComputedStyle(node).backgroundColor;
        var parsed = rgb(value);
        if (parsed && parsed[3] > 0.95) { return parsed; }
        node = node.parentElement;
      }
      return [255, 255, 255, 1];
    }

    for (j = 0; j < rows; j++) {
      for (i = 0; i < cols; i++) {
        c = paintedAt(r.x + i * step + step / 2, r.y + j * step + step / 2);
        key = c[0] + ',' + c[1] + ',' + c[2];
        keys.push(key);
        counts[key] = (counts[key] || 0) + 1;
      }
    }

    // Largest contiguous run of one colour, 4-connected, over the sample grid.
    function isWhiteKey(key) {
      var parts = key.split(',').map(Number);
      return parts[0] >= 250 && parts[1] >= 250 && parts[2] >= 250;
    }

    var seen = new Array(keys.length);
    var best = { key: null, size: 0 };
    var bestColoured = { key: null, size: 0 };
    for (j = 0; j < keys.length; j++) {
      if (seen[j]) { continue; }
      var target = keys[j];
      var stack = [j];
      var size = 0;
      seen[j] = 1;
      while (stack.length) {
        var at = stack.pop();
        size++;
        var col = at % cols, row = Math.floor(at / cols);
        var neighbours = [col > 0 ? at - 1 : -1, col < cols - 1 ? at + 1 : -1, row > 0 ? at - cols : -1, row < rows - 1 ? at + cols : -1];
        for (i = 0; i < 4; i++) {
          var n = neighbours[i];
          if (n >= 0 && !seen[n] && keys[n] === target) { seen[n] = 1; stack.push(n); }
        }
      }
      if (size > best.size) { best = { key: target, size: size }; }
      if (!isWhiteKey(target) && size > bestColoured.size) { bestColoured = { key: target, size: size }; }
    }

    var isWhite = isWhiteKey;

    var total = keys.length || 1;
    var ranked = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).slice(0, 6).map(function (k) {
      return { color: k, share: round((counts[k] / total) * 100), white: isWhite(k) };
    });

    // Every element painted in the lavender family, with its own footprint, for the band/gutter rule.
    var lavender = [];
    all('*').forEach(function (node) {
      if (!laidOut(node)) { return; }
      var parsed = rgb(getComputedStyle(node).backgroundColor);
      if (!parsed || parsed[3] < 0.9) { return; }
      var h = hue(parsed);
      var light = (parsed[0] + parsed[1] + parsed[2]) / 3;
      if (h === null || h < 210 || h > 265 || light < 170 || light > 248) { return; }
      var nb = node.getBoundingClientRect();
      if (nb.width * nb.height < 4000) { return; }
      lavender.push({ cls: String(node.className).slice(0, 44), w: round(nb.width), h: round(nb.height) });
    });

    return {
      grid: { cols: cols, rows: rows, step: step },
      contentArea: round(r.width * r.height),
      byColour: ranked,
      largestRegion: { color: best.key, share: round((best.size / total) * 100), white: best.key ? isWhite(best.key) : true },
      largestColouredRegion: { color: bestColoured.key, share: round((bestColoured.size / total) * 100) },
      largestNonWhiteShare: (function () {
        var nonWhite = ranked.filter(function (item) { return !item.white; });
        return nonWhite.length ? nonWhite[0].share : 0;
      }()),
      lavenderElements: lavender.sort(function (a, b) { return (b.w * b.h) - (a.w * a.h); }).slice(0, 8)
    };
  }

  function accents() {
    var out = [];
    all('*').forEach(function (el) {
      if (!visible(el)) { return; }
      var cs = getComputedStyle(el);
      [cs.backgroundColor, cs.borderLeftColor].forEach(function (value, index) {
        var c = rgb(value);
        if (!c || c[3] < 0.6) { return; }
        var h = hue(c);
        if (h === null || h < 35 || h > 65) { return; }
        if (index === 1 && (parseFloat(cs.borderLeftWidth) || 0) < 2) { return; }
        var r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) { return; }
        out.push({ cls: String(el.className).slice(0, 40), w: round(r.width), h: round(r.height), source: index === 0 ? 'background' : 'border-left' });
      });
    });
    return out.sort(function (a, b) { return b.h - a.h; }).slice(0, 8);
  }

  function typography() {
    var seen = {};
    var uppercase = [];
    var heavy = [];
    textNodesIn(document.body).forEach(function (t) {
      // The skin suppresses stock labels with font-size 0; that is a hidden string, not a size.
      if (!t.size) { return; }
      seen[t.size] = (seen[t.size] || 0) + 1;
      if (t.transform === 'uppercase' && t.text.length > 3) { uppercase.push(t.text); }
      if (Number(t.weight) >= 700) { heavy.push(t.text); }
    });
    return {
      sizes: Object.keys(seen).map(Number).sort(function (a, b) { return a - b; }),
      sizeCounts: seen,
      uppercase: uppercase.slice(0, 12),
      weight700: heavy.slice(0, 12)
    };
  }


  // ------------------------------------------------------------------ login

  /*
   * The login page is its own document with its own stylesheet, so nothing else in this file
   * applies to it. What matters there is whether the panel says anything, whether the primary
   * matches the one the application uses, and whether the panel is still a blurred gradient.
   */
  function login() {
    var panel = document.querySelector('.sidebar');
    if (!panel) { return null; }
    var cs = getComputedStyle(panel);
    var button = document.querySelector('.login-button, .Login_LogForm_Button button, button');
    var footer = document.querySelector('.footer p, .footer');
    var content = all('*', panel).filter(function (el) {
      if (!visible(el)) { return false; }
      if (el.tagName === 'IMG' || el.tagName === 'SVG') { return true; }
      return (el.textContent || '').replace(/[\s\u00a0]+/g, '') && el.children.length === 0;
    });
    var gradient = cs.backgroundImage || 'none';
    return {
      panel: {
        box: box(panel),
        background: cs.backgroundColor,
        backgroundImage: gradient.slice(0, 300),
        gradientStops: gradient === 'none' ? 0 : (gradient.match(/(rgb|#|hsl)/g) || []).length,
        filter: cs.filter,
        blurred: /blur/.test(cs.filter) || all('*', panel).some(function (el) { return /blur/.test(getComputedStyle(el).filter); }),
        contentElements: content.length,
        contentText: content.map(function (el) { return el.tagName === 'IMG' ? '[img]' : (el.textContent || '').trim().slice(0, 40); })
      },
      primary: button ? getComputedStyle(button).backgroundColor : null,
      heading: (function () {
        var h = document.querySelector('h1');
        return h ? { text: (h.textContent || '').trim().slice(0, 40), size: round(parseFloat(getComputedStyle(h).fontSize)), weight: Number(getComputedStyle(h).fontWeight) } : null;
      }()),
      inputs: all('input').filter(visible).map(function (el) {
        var c = getComputedStyle(el);
        return { height: round(el.getBoundingClientRect().height), radius: round(parseFloat(c.borderTopLeftRadius) || 0), border: round(parseFloat(c.borderTopWidth) || 0) };
      }),
      footer: footer ? { size: round(parseFloat(getComputedStyle(footer).fontSize)), color: getComputedStyle(footer).color } : null
    };
  }



  // ------------------------------------------------------------- status bar

  /*
   * The record identity has nowhere else to go in this layout: the window tab truncates it and
   * there is no breadcrumb. The status bar is the one strip that belongs to the open record, so
   * F7's title is measured there.
   */
  function statusBar() {
    var bar = pick('.OBStatusBar, [class^="OBStatusBar"]');
    if (!bar) { return null; }
    var title = bar.querySelector('.etskin-record-title');
    var texts = textNodesIn(bar);
    var largest = null;
    texts.forEach(function (t) { if (!largest || t.size > largest.size) { largest = t; } });
    return {
      box: box(bar),
      height: round(bar.getBoundingClientRect().height),
      title: title && visible(title) ? {
        text: (title.textContent || '').trim().slice(0, 60),
        size: round(parseFloat(getComputedStyle(title).fontSize)),
        weight: Number(getComputedStyle(title).fontWeight)
      } : null,
      largestText: largest,
      texts: texts.slice(0, 12)
    };
  }

  // ------------------------------------------------------------ provenance

  /*
   * A recording that outlives the files it was taken from proves nothing. The deployed bundles are
   * hashed here and check-dom.mjs re-hashes the working copies: if a stylesheet was edited after
   * the browser was measured, the hashes diverge and the check refuses to pass rather than
   * silently blessing a stale reading.
   */
  async function fingerprint() {
    var base = location.pathname.replace(/\/(security\/)?[^/]*$/, '') + '/web/com.etendoerp.skin.modern/';
    var files = [
      'css/etendo-skin.css',
      'css/etendo-skin-login.css',
      'js/etendo-skin.js',
      'js/etendo-skin-nav.js',
      'js/etendo-skin-topbar.js',
      'js/etendo-skin-toolbar.js',
      'js/etendo-skin-form.js'
    ];
    var out = {};
    for (var i = 0; i < files.length; i++) {
      try {
        var r = await fetch(base + files[i] + '?fp=' + Date.now(), { cache: 'no-store' });
        if (!r.ok) { out[files[i]] = null; continue; }
        var buf = await r.arrayBuffer();
        var digest = await crypto.subtle.digest('SHA-256', buf);
        /*
         * SmartClient replaces Array.prototype.map with one that calls this.getLength(), so
         * borrowing it for a typed array throws. A plain loop is the only safe way to hex here.
         */
        var bytes = new Uint8Array(digest);
        var hex = '';
        for (var b = 0; b < bytes.length; b++) { hex += ('0' + bytes[b].toString(16)).slice(-2); }
        out[files[i]] = hex;
      } catch (e) {
        out[files[i]] = null;
      }
    }
    return out;
  }

  var sources = await fingerprint();

  return {
    screen: screen,
    href: location.href,
    recordedAt: new Date().toISOString(),
    sources: sources,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    tokens: {
      primary: token('--sk-primary'),
      accent: token('--sk-accent'),
      canvas: token('--sk-canvas'),
      surface: token('--sk-surface'),
      text: token('--sk-text')
    },
    topBar: topBar(),
    toolbar: toolbar(),
    grid: grid(),
    form: form(),
    panes: panes(),
    statusBar: statusBar(),
    nav: nav(),
    paint: paint(),
    accents: accents(),
    login: login(),
    typography: typography()
  };
}
