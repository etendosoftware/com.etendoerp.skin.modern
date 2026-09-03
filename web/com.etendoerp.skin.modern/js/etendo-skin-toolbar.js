/*
 *************************************************************************
 * Copyright (C) 2026 Futit Services S.L.
 * Licensed under the Openbravo Public License version 1.1.
 * You may obtain a copy of the License at
 * http://www.openbravo.com/legal/license.html
 ************************************************************************
 */

/*
 * Etendo Modern Skin - toolbar.
 *
 * Stock Classic lays sixteen identical grey glyphs in one undifferentiated run and then appends
 * every process button of the window as a wide text button. On a 1440px screen the last of those
 * ends at x=1889: two of them are simply off the edge, unreachable, and nothing on the strip says
 * which of the sixteen glyphs is the one you came for. That is the "breathes complexity" the
 * review was pointing at.
 *
 * This file gives the strip a shape:
 *
 *   - Three small groups on the left - create, edit, record - separated by hairlines, with Save
 *     carrying the one filled accent on the screen. Seven glyphs where there were sixteen.
 *   - The six occasional ones (export, attach, clone, print, email, link) move into a single
 *     overflow menu. Nothing is removed; it is one click away and it has a name, which is more
 *     than a bare glyph offered.
 *   - The process buttons become one labelled "Actions" menu anchored at the right edge, next to
 *     the three view controls. A window with eight processes now costs 96px instead of 630px of
 *     horizontal run, and none of them can fall off the screen.
 *
 * How it hooks in
 *
 * OBToolbar#initWidget builds its members array from this.leftMembers and this.rightMembers, with
 * a 100% spacer between them, and OBToolbar#addRightMembers computes its insert index from the
 * lengths of both arrays. Rearranging the drawn members directly would therefore desynchronise
 * every later call. So the rearrangement happens to leftMembers and rightMembers *before* stock
 * initWidget reads them: the framework then builds the strip we want by its own rules and its own
 * arithmetic stays correct.
 *
 * The process buttons are the exception, because they arrive later through addRightMembers. Those
 * are pulled out of the layout with removeMembers but deliberately left in this.rightMembers, so
 * refreshCustomButtons keeps computing their enabled and visible state exactly as before. The
 * Actions menu is built at click time from that live state, which means it inherits every access
 * rule the stock buttons obey rather than reimplementing them.
 *
 * Same constraints as the other bundles: concatenated into the global static resource and minified
 * with Crockford's JSMin, so conservative ES5 only.
 */

(function () {
  'use strict';

  // A 32px hit area on a 34px pitch. Wide enough to click, tight enough that a group of three
  // reads as one object rather than three.
  var ICON = 32;
  var GAP = 2;
  var LEFT_MARGIN = 12;
  var RIGHT_MARGIN = 24;
  // A 1px rule centred in 13px of air: the gap is what separates the groups, the line only
  // confirms it.
  var DIVIDER = 13;
  // Wide enough for the word plus the chevron the stylesheet draws after it.
  var ACTIONS_WIDTH = 96;
  // "more than 100 records" is the longest string the readout ever holds.
  var COUNT_WIDTH = 148;

  var GROUPS = [
    { name: 'create', types: ['newDoc', 'newRow'] },
    { name: 'edit', types: ['save', 'savecloseX', 'undo'] },
    { name: 'record', types: ['eliminate', 'refresh'] }
  ];
  var MORE = ['export', 'attach', 'clone', 'print', 'email', 'link'];
  var VIEW = ['personalization', 'manageviews', 'gridAndFilter'];
  var PRIMARY = 'save';

  // Beyond this the left run stops reading as a few groups and starts reading as a wall again, so
  // buttons contributed by other modules spill into the overflow menu rather than extend it.
  var MAX_LEFT = 9;

  /*
   * Stock buttons carry a prompt - a whole sentence explaining the action - and, for most of them,
   * no title at all. A sentence makes a poor menu item, so each one is matched to an existing
   * application label first. These keys are the ones this installation already translates; when a
   * button has none, its own title or prompt is used, which is never worse than what the bare
   * glyph said.
   */
  var LABEL_KEYS = {
    'export': ['OBUIAPP_ExportGrid'],
    attach: ['OBUIAPP_GoToAttachments'],
    clone: ['OBUIAPP_CloneButton'],
    print: ['OBUIAPP_Print'],
    link: ['OBUIAPP_Document_Link'],
    manageviews: ['OBUIAPP_SaveView']
  };

  // ------------------------------------------------------------------ gates

  function wanted() {
    return typeof OB !== 'undefined' && !!OB && !!OB.ETSkin &&
      typeof isc !== 'undefined' && !!isc && !!isc.OBToolbar && !!isc.Menu;
  }

  // ----------------------------------------------------------------- labels

  function skinLabel(name, fallback) {
    var labels = OB.ETSkin && OB.ETSkin.labels;
    return labels && labels[name] ? String(labels[name]) : fallback;
  }

  function labelFor(button) {
    var keys = LABEL_KEYS[button.buttonType] || [];
    var i, value;
    for (i = 0; i < keys.length; i++) {
      value = OB.I18N && OB.I18N.labels ? OB.I18N.labels[keys[i]] : null;
      if (value) {
        return String(value);
      }
    }
    if (button.title) {
      return String(button.title);
    }
    return String(button.prompt || button.buttonType || '');
  }

  // --------------------------------------------------------- process buttons

  /*
   * isA rather than getClassName, so a module that subclasses the stock button is still
   * recognised as one.
   */
  function isActionButton(canvas) {
    if (isc.isA && isc.isA.OBToolbarActionButton) {
      return !!isc.isA.OBToolbarActionButton(canvas);
    }
    return !!canvas.getClassName && canvas.getClassName() === 'OBToolbarActionButton';
  }

  function actionButtons(toolbar) {
    var members = toolbar.rightMembers || [];
    var only = [];
    var i;
    for (i = 0; i < members.length; i++) {
      if (isActionButton(members[i])) {
        only.push(members[i]);
      }
    }
    return only;
  }

  /*
   * Whether the window would have put this process button on the strip for the record that is
   * open now. updateState computes displayIf and then ends in show() or hide(), so visibility is
   * where the answer lands; the flag it sets on the way is what says the answer was computed at
   * all, and a button no refresh has reached yet must not be offered as if it had passed.
   */
  function shown(button) {
    return button.visible === true && (!button.isVisible || button.isVisible());
  }

  // ------------------------------------------------------------- DOM marking

  /*
   * A SmartClient button is a table, and its styleName lands on every cell of it: the label cell,
   * the spacers and the icon slot alike. Marking a button through styleName would therefore mark
   * five elements and make "exactly one primary action" unmeasurable. The wrapper is the single
   * element that is exactly the button, so the marks go there.
   *
   * Redraw rewrites the contents of that wrapper but keeps the wrapper itself, so a mark applied
   * once survives. It is reapplied from updateButtonState anyway, which is the one method the
   * toolbar calls on every record and view change and therefore after any full redraw.
   */
  function mark(canvas, group, classes, width) {
    canvas.etskinMark = { group: group, classes: classes || '', width: width || 0 };
    remark(canvas);
  }

  function remark(canvas) {
    var m = canvas.etskinMark;
    var handle = m && canvas.getHandle ? canvas.getHandle() : null;
    var i, list;
    if (!handle) {
      return;
    }
    handle.setAttribute('data-etskin-group', m.group);
    list = m.classes ? m.classes.split(' ') : [];
    for (i = 0; i < list.length; i++) {
      if (list[i] && handle.className.indexOf(list[i]) === -1) {
        handle.className = handle.className + ' ' + list[i];
      }
    }
  }

  /*
   * Marks a canvas as something the stock toolbar loops may walk over but must not act on.
   * refreshCustomButtons disables and re-enables the keyboard shortcut of every entry of
   * rightMembers, and the count readout is a Label, which has no shortcut to disable. A pair of
   * no-ops there is cheaper - and far less brittle - than teaching that loop about this file.
   */
  function inert(canvas) {
    if (!canvas.disableShortcut) {
      canvas.disableShortcut = function () {};
    }
    if (!canvas.enableShortcut) {
      canvas.enableShortcut = function () {};
    }
    return canvas;
  }

  /*
   * Width is re-asserted rather than set once. The buttons are sized before stock initWidget runs,
   * which is the only moment their order can be rewritten, but a Layout that has already measured
   * its members keeps the size it measured; re-applying after the toolbar is built, and again on
   * every state refresh, is what makes 32px stick.
   */
  function resize(canvas) {
    var m = canvas.etskinMark;
    if (m && m.width && canvas.getWidth() !== m.width) {
      canvas.setWidth(m.width);
    }
  }

  // ------------------------------------------------------------------ menus

  /*
   * Reads the state off the live buttons every time it opens rather than caching it. The stock
   * buttons stay wired to refreshCustomButtons, so whatever the window decided about a process -
   * not applicable to this record, forbidden for this role, disabled until the document is
   * completed - is what the menu shows, without this file knowing any of those rules.
   */
  function menuFrom(entries) {
    var data = [];
    var i, entry;
    for (i = 0; i < entries.length; i++) {
      entry = entries[i];
      if (entry.honourVisible && !shown(entry.button)) {
        continue;
      }
      data.push({
        title: entry.title,
        enabled: !entry.button.isDisabled(),
        etskinTarget: entry.button,
        click: function (target, item) {
          var button = item.etskinTarget;
          if (button.action) {
            button.action();
          } else if (button.click) {
            button.click();
          }
        }
      });
    }
    if (data.length === 0) {
      data.push({ title: skinLabel('empty', 'Nothing available here'), enabled: false });
    }
    /*
     * A Menu is a ListGrid, and styleName only reaches its outer element - the one the body is
     * positioned inside. What is seen is the body, whose class comes from bodyStyleName, and
     * which the stock skin paints as a bordered panel with a grey gradient gutter down its left
     * edge; that gutter is the icon column, and it is drawn whether or not any item has an icon.
     * None of these items has one, and none has a submenu or a keyboard shortcut either, so the
     * three columns that would carry them are turned off and the body is named for the skin. The
     * shadow is the stylesheet's, not the framework's stack of translucent images.
     */
    return isc.Menu.create({
      autoDraw: false,
      showShadow: false,
      showIcons: false,
      showKeys: false,
      showSubmenus: false,
      styleName: 'etskin-menu',
      bodyStyleName: 'etskin-menuBody',
      iconBodyStyleName: 'etskin-menuBody',
      cellHeight: 32,
      width: 240,
      data: data
    });
  }

  function openMenu(menu, anchor) {
    var box = anchor.getPageRect();
    // The menu is rebuilt on every open, because the state it reports is only true for the record
    // that is open now. The one it replaces is discarded rather than left behind hidden.
    if (anchor.etskinMenu && anchor.etskinMenu !== menu && anchor.etskinMenu.destroy) {
      anchor.etskinMenu.destroy();
    }
    anchor.etskinMenu = menu;
    menu.setWidth(Math.max(220, menu.getWidth()));
    menu.showNextTo(anchor, 'bottom');
    // showNextTo aligns left edges; the overflow and Actions buttons both sit far enough right
    // that a left aligned menu would hang off the window, so it is pulled back under the button.
    if (menu.getPageLeft() + menu.getVisibleWidth() > isc.Page.getWidth()) {
      menu.moveTo(Math.max(4, box[0] + box[2] - menu.getVisibleWidth()), menu.getPageTop());
    }
  }

  // -------------------------------------------------------------- arranging

  function divider() {
    return isc.Canvas.create({
      autoDraw: false,
      width: DIVIDER,
      height: 20,
      styleName: 'etskin-tb-divider'
    });
  }

  function overflowButton(buttons) {
    var button = isc.OBToolbarIconButton.create({
      autoDraw: false,
      buttonType: 'etskinMore',
      width: ICON,
      height: ICON,
      prompt: skinLabel('more', 'More actions'),
      action: function () {
        var entries = [];
        var i;
        for (i = 0; i < buttons.length; i++) {
          entries.push({ button: buttons[i], title: labelFor(buttons[i]), honourVisible: false });
        }
        openMenu(menuFrom(entries), this);
      }
    });
    return button;
  }

  /*
   * The grid's record count used to live in the filter row of the edit-link column, as a bare
   * number under a blank header. That column is gone, and the number comes back here with a word
   * attached. It is a plain Label rather than a button so it is never mistaken for one, and it is
   * left unmarked so the toolbar measurements keep counting only controls.
   *
   * Written by etendo-skin-grid.js, which reaches it through toolbar.etskinCount.
   */
  function countReadout() {
    return inert(isc.Label.create({
      autoDraw: false,
      width: COUNT_WIDTH,
      height: ICON,
      align: 'right',
      valign: 'center',
      wrap: false,
      styleName: 'etskin-tb-count',
      contents: ''
    }));
  }

  /*
   * Re-evaluates displayIf for the record that is open now, synchronously and from values the
   * browser already holds - which is what refreshCustomButtonsView is for. The framework does the
   * same thing on every record and selection change, so this normally confirms what is already
   * there; it is what makes the first open of a window, before anything has changed, right too.
   */
  function refreshState(toolbar, buttons) {
    var seen = [];
    var i, context;
    for (i = 0; i < buttons.length; i++) {
      context = buttons[i].contextView;
      if (context && seen.indexOf(context) === -1) {
        seen.push(context);
        try {
          toolbar.refreshCustomButtonsView(context);
        } catch (e) {
          // Then the menu reports the state of the last refresh, which is the state the stock
          // buttons would have been in as well.
        }
      }
    }
  }

  function actionsButton(toolbar) {
    return inert(isc.OBToolbarIconButton.create({
      autoDraw: false,
      buttonType: 'etskinActions',
      width: ACTIONS_WIDTH,
      height: ICON,
      title: skinLabel('actions', 'Actions'),
      prompt: skinLabel('actionsPrompt', 'Actions available for this record'),
      action: function () {
        var buttons = actionButtons(toolbar);
        var entries = [];
        var i, button;
        refreshState(toolbar, buttons);
        for (i = 0; i < buttons.length; i++) {
          button = buttons[i];
          entries.push({
            button: button,
            // updateState rewrites the title from the document's status - Complete becomes
            // Reactivate on a completed invoice - so realTitle is read after the refresh above.
            title: String(button.realTitle || button.originalTitle || button.title || ''),
            honourVisible: true
          });
        }
        openMenu(menuFrom(entries), this);
      }
    }));
  }

  /*
   * Runs before stock initWidget, on the two arrays it is about to read. Everything downstream -
   * the members it builds, the index arithmetic in addRightMembers, the state refresh loops over
   * leftMembers and rightMembers - then operates on the arrangement we want as if it had always
   * been there.
   */
  function arrange(toolbar) {
    var byType = {};
    var known = {};
    var extras = [];
    var left = [];
    var right = [];
    var spill = [];
    var i, j, group, button, source, classes;

    if (!toolbar.leftMembers || toolbar.leftMembers.length === 0) {
      toolbar.leftMembers = OB.ToolbarRegistry.getButtons(toolbar.view.tabId);
    }
    source = toolbar.leftMembers;

    for (i = 0; i < source.length; i++) {
      if (source[i].buttonType) {
        byType[source[i].buttonType] = source[i];
      }
    }

    function claim(type) {
      known[type] = true;
      return byType[type];
    }

    for (i = 0; i < GROUPS.length; i++) {
      group = GROUPS[i];
      if (left.length > 0) {
        left.push(divider());
      }
      for (j = 0; j < group.types.length; j++) {
        button = claim(group.types[j]);
        if (button) {
          button.setWidth(ICON);
          mark(button, group.name, group.types[j] === PRIMARY ? 'etskin-tb-primary' : '', ICON);
          left.push(button);
        }
      }
    }

    for (i = 0; i < MORE.length; i++) {
      button = claim(MORE[i]);
      if (button) {
        spill.push(button);
      }
    }
    for (i = 0; i < VIEW.length; i++) {
      claim(VIEW[i]);
    }

    // Whatever another module put on this toolbar. It keeps its place on the strip while there is
    // room, and joins the overflow menu when there is not, so an install with many extra buttons
    // degrades into a longer menu rather than back into a wall of glyphs.
    for (i = 0; i < source.length; i++) {
      button = source[i];
      if (button.buttonType && !known[button.buttonType]) {
        extras.push(button);
      }
    }
    for (i = 0; i < extras.length; i++) {
      if (left.length + 1 < MAX_LEFT) {
        if (i === 0) {
          left.push(divider());
        }
        extras[i].setWidth(ICON);
        mark(extras[i], 'extra', '', ICON);
        left.push(extras[i]);
      } else {
        spill.push(extras[i]);
      }
    }

    if (spill.length > 0) {
      left.push(divider());
      button = overflowButton(spill);
      mark(button, 'more', 'etskin-tb-overflow', ICON);
      left.push(button);
    }

    toolbar.etskinCount = countReadout();
    right.push(toolbar.etskinCount);

    button = actionsButton(toolbar);
    mark(button, 'actions', 'etskin-tb-actions', ACTIONS_WIDTH);
    right.push(button);
    for (i = 0; i < VIEW.length; i++) {
      if (byType[VIEW[i]]) {
        // Actions is a labelled pill and the view controls are bare glyphs; abutting them reads
        // as one control with a word stuck to it. The rule that separates the groups on the left
        // separates these two as well.
        if (right[right.length - 1] === button) {
          right.push(inert(divider()));
        }
        byType[VIEW[i]].setWidth(ICON);
        /*
         * manageviews is an icon button by class but a menu button by style: it keeps its
         * "Save View" title and draws no glyph, so at 32px the word is clipped to "S...".
         * A second class lets the stylesheet swap the word for a glyph, and the title moves
         * to the tooltip so nothing is lost.
         */
        classes = 'etskin-tb-view';
        if (VIEW[i] === 'manageviews') {
          classes += ' etskin-tb-saveview';
          if (!byType[VIEW[i]].prompt) {
            byType[VIEW[i]].prompt = labelFor(byType[VIEW[i]]);
          }
        }
        mark(byType[VIEW[i]], 'right', classes, ICON);
        right.push(inert(byType[VIEW[i]]));
      }
    }

    toolbar.leftMembers = left;
    toolbar.rightMembers = (toolbar.rightMembers || []).length > 0
      ? right.concat(toolbar.rightMembers)
      : right;
    toolbar.leftMargin = LEFT_MARGIN;
    toolbar.leftMembersMargin = GAP;
    toolbar.rightMembersMargin = GAP;
    toolbar.rightMargin = RIGHT_MARGIN;
    toolbar.etskinArranged = true;
  }

  /*
   * Takes the process buttons out of the strip and leaves them in rightMembers. They keep being
   * updated by refreshCustomButtons, they keep their keyboard shortcuts, and the Actions menu
   * reads them; they simply no longer occupy 630px of a 1440px window.
   */
  function withdrawActionButtons(toolbar) {
    var members = toolbar.rightMembers || [];
    var drawn = [];
    var i, button;
    for (i = 0; i < members.length; i++) {
      button = members[i];
      if (isActionButton(button) &&
          toolbar.getMemberNumber && toolbar.getMemberNumber(button) >= 0) {
        drawn.push(button);
      }
    }
    if (drawn.length > 0) {
      toolbar.removeMembers(drawn);
      for (i = 0; i < drawn.length; i++) {
        detach(drawn[i]);
      }
    }
  }

  /*
   * Off the strip, a process button is no longer a widget: it is where its display logic keeps its
   * answer, and the menu is what draws that answer. It still has to accept show and hide, because
   * that is how updateState records the answer, but a canvas with no parent that is told to show
   * draws itself wherever it happens to be - which is the top left corner of the page, over the
   * logo. So the two methods keep their meaning and lose their side effect. Everything else about
   * the button is untouched: its title still changes, its shortcut still fires, isVisible and
   * isDisabled still answer for it.
   */
  function detach(button) {
    if (button.etskinDetached) {
      return button;
    }
    button.etskinDetached = true;
    button.show = function () {
      this.visible = true;
      this.visibility = isc.Canvas.INHERIT;
      return this;
    };
    button.hide = function () {
      this.visible = false;
      this.visibility = isc.Canvas.HIDDEN;
      return this;
    };
    if (button.isDrawn && button.isDrawn() && button.clear) {
      button.clear();
    }
    return button;
  }

  function restamp(toolbar) {
    var members = (toolbar.leftMembers || []).concat(toolbar.rightMembers || []);
    var i;
    for (i = 0; i < members.length; i++) {
      if (members[i].etskinMark) {
        remark(members[i]);
        resize(members[i]);
      }
    }
  }

  /*
   * Two stock methods walk rightMembers assuming every entry is a process button: one reads
   * realTitle.length to derive a keyboard shortcut, the other reads contextView.getCurrentValues().
   * Neither guards. The icon buttons this file moves to the right hand end satisfy neither
   * assumption, so the originals run against a view of the array holding only what they were
   * written for, and the array is restored the moment they return.
   */
  function amongActionButtons(toolbar, original, args) {
    var all = toolbar.rightMembers || [];
    toolbar.rightMembers = actionButtons(toolbar);
    try {
      return original.apply(toolbar, args);
    } finally {
      toolbar.rightMembers = all;
    }
  }

  // ------------------------------------------------------------------- main

  try {
    if (wanted()) {
      var proto = isc.OBToolbar.getPrototype();
      var originalInit = proto.initWidget;
      var originalAddRight = proto.addRightMembers;
      var originalUpdateState = proto.updateButtonState;
      var originalShortcuts = proto.defineRightMembersShortcuts;
      var originalHideShow = proto.hideShowRightMembers;

      isc.OBToolbar.addProperties({
        initWidget: function () {
          try {
            arrange(this);
          } catch (e) {
            if (typeof console !== 'undefined' && console.warn) {
              console.warn('Etendo Modern Skin could not arrange the toolbar', e);
            }
          }
          return originalInit.apply(this, arguments);
        },

        addRightMembers: function () {
          var result = originalAddRight.apply(this, arguments);
          try {
            withdrawActionButtons(this);
          } catch (e) {
            // A process button left on the strip is ugly, not broken.
          }
          return result;
        },

        /*
         * Stock reads this to walk the process buttons and refresh each one's display logic
         * against its view: the loop asks every entry for its contextView and then for that
         * view's state. This file also parks its own canvases in rightMembers - the count
         * readout, the Actions button, the view icons - because that array is what initWidget
         * lays out, and none of them belongs to a view. Returning only the process buttons is
         * what stock already assumes it is getting, and it is what keeps that refresh - the one
         * that decides which options the record allows - running at all.
         */
        getRightMembers: function () {
          return actionButtons(this);
        },

        defineRightMembersShortcuts: function () {
          return amongActionButtons(this, originalShortcuts, arguments);
        },

        hideShowRightMembers: function () {
          return amongActionButtons(this, originalHideShow, arguments);
        },

        updateButtonState: function () {
          var result = originalUpdateState.apply(this, arguments);
          try {
            withdrawActionButtons(this);
            restamp(this);
          } catch (e) {
            // As above.
          }
          return result;
        }
      });
    }
  } catch (e) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('Etendo Modern Skin could not install the toolbar arrangement', e);
    }
  }
})();
