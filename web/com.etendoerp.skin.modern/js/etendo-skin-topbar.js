/*
 *************************************************************************
 * Copyright (C) 2026 Futit Services S.L.
 * Licensed under the Openbravo Public License version 1.1.
 * You may obtain a copy of the License at
 * http://www.openbravo.com/legal/license.html
 ************************************************************************
 */

/*
 * Etendo Modern Skin - navigation bar.
 *
 * Stock Classic packs every utility control against the left edge of the top bar as text buttons -
 * "Alerts (1)", "Help", "admin" - and puts the logos on the right. Etendo's React skin does the
 * opposite and does it with one gesture: the brand sits with the navigation on the left, and the
 * utilities are a single tray on the right, a soft pill holding round icon buttons. This file
 * makes Classic's navigation bar read the same way.
 *
 * Only two things here cannot be done from the stylesheet, and they are the only two things this
 * file does to the layout:
 *
 *   - Member order. OB.TopLayout is an HLayout of [left spacer, navbar, middle spacer, logos].
 *     CSS cannot reorder absolutely positioned canvases, so the members are re-ordered to
 *     [logos, spacers, navbar].
 *   - Measurements. SmartClient writes width and height inline on every canvas from numbers it
 *     took itself, so a 70x30 text button stays 70x30 whatever the stylesheet says. The buttons
 *     are re-measured to 40x40 here and everything else about them is styling.
 *
 * The rest is bookkeeping so the styling survives: OBQuickRun swaps the wrapper's styleName to
 * OBNavBarComponentSelected while its flyout is open and back again when it closes, which would
 * drop the marker class the stylesheet keys on - so setStyleName is wrapped to re-append it.
 *
 * Same constraints as etendo-skin.js: concatenated into the global bundle and minified with
 * Crockford's JSMin, so conservative ES5 only - no let/const, no arrow functions, no template
 * literals, no trailing commas.
 */

(function () {
  'use strict';

  // 40px buttons with a 4px gutter, which is the React tray's geometry: a 180x48 pill holding four
  // 40x40 buttons on a 44px pitch.
  var BUTTON = 40;
  var GAP = 4;
  var BASE_STYLE = 'OBNavBarComponent';
  // Every marker starts with this, which is what lets a repeat setStyleName strip the old one.
  var MARKER = 'etskin-tray-';

  // The inner widget's class name is the only reliable way to tell one wrapper from another: the
  // three text buttons all share the OBNavBarTextButton styleName, so the stylesheet cannot.
  var ROLES = {
    OBAlertIcon: 'alert',
    OBHelpAbout: 'help',
    OBUserProfile: 'profile',
    OBLogout: 'logout'
  };

  // ------------------------------------------------------------------ gates

  function wanted() {
    // etendo-skin.js publishes OB.ETSkin only when it decided the skin is on, so this follows the
    // ETSKIN_Enabled and SKINLEG_LegacySkin decisions without repeating them.
    return typeof OB !== 'undefined' && !!OB && !!OB.ETSkin && !!OB.TopLayout && !!OB.NavBar;
  }

  // ----------------------------------------------------------------- marker

  /*
   * Keeps a marker class on a wrapper for good. OBQuickRun calls setStyleName on the wrapper twice
   * per flyout - once with 'OBNavBarComponentSelected' and once with 'OBNavBarComponent' - so the
   * marker has to be re-appended on every call rather than written once.
   */
  function keepMarked(wrapper, marker) {
    var original = wrapper.setStyleName;

    wrapper.etskinMarker = marker;
    wrapper.setStyleName = function (style) {
      var base = String(style || BASE_STYLE);
      var cut = base.indexOf(' ' + MARKER);
      if (cut !== -1) {
        base = base.substring(0, cut);
      }
      return original.call(this, base + ' ' + this.etskinMarker);
    };
    wrapper.setStyleName(wrapper.styleName || BASE_STYLE);
  }

  function remark(wrapper, marker) {
    wrapper.etskinMarker = marker;
    wrapper.setStyleName(wrapper.styleName || BASE_STYLE);
  }

  // ----------------------------------------------------------------- alerts

  function countOf(title) {
    var text = title === null || title === undefined ? '' : String(title);
    var digits = '';
    var i, ch;
    for (i = 0; i < text.length; i++) {
      ch = text.charAt(i);
      if (ch >= '0' && ch <= '9') {
        digits += ch;
      }
    }
    return digits === '' ? 0 : parseInt(digits, 10);
  }

  /*
   * The bell carries a dot rather than a number. The count is not lost: the full stock label,
   * already translated and already formatted, becomes the button's tooltip, which is more than the
   * bare "Alerts (1)" said and costs no width in the tray.
   */
  function trackAlerts(wrapper, button) {
    var original = button.setTitle;

    function reflect(title) {
      remark(
        wrapper,
        MARKER + 'item ' + MARKER + 'alert' + (countOf(title) > 0 ? ' ' + MARKER + 'alert-on' : '')
      );
      if (button.setPrompt) {
        button.setPrompt(title === null || title === undefined ? '' : String(title));
      }
    }

    button.setTitle = function (title) {
      reflect(title);
      // The title is emptied because the stylesheet paints the bell as a mask on the button and a
      // label would sit on top of it. OB.I18N.getLabel calls this back asynchronously whenever the
      // alert manager refreshes, which is what keeps the dot honest.
      return original.call(this, '');
    };
    reflect(button.title);
    original.call(button, '');
  }

  // ---------------------------------------------------------------- profile

  function firstLetters(user) {
    var first = user.firstName ? String(user.firstName) : '';
    var last = user.lastName ? String(user.lastName) : '';
    var name;

    if (first && last) {
      return (first.charAt(0) + last.charAt(0)).toUpperCase();
    }
    name = String(user.name || user.userName || '');
    if (!name) {
      return '•';
    }
    return name.substring(0, 2).toUpperCase();
  }

  /*
   * An avatar rather than an icon, because the user name is the one thing in the tray worth
   * keeping: Classic users switch role, client and organisation from this menu, and the initials
   * say which identity is loaded. The full name stays as the tooltip.
   */
  function makeAvatar(button) {
    var user = (OB && OB.User) || {};
    var full = button.title ? String(button.title) : String(user.name || '');

    if (button.setPrompt && full) {
      button.setPrompt(full);
    }
    button.setTitle(firstLetters(user));
  }

  // ------------------------------------------------------------------ sizes

  function resize(canvas, width, height) {
    if (canvas.setWidth) {
      canvas.setWidth(width);
    }
    if (canvas.setHeight) {
      canvas.setHeight(height);
    }
  }

  /*
   * A quick launch button already is an icon and the stylesheet already knows it by its own
   * styleName, so anything the stylesheet can name is a round icon chip. Anything else is a navbar
   * component from a module we know nothing about - it may well be a text button, and clipping it
   * to 40px would leave a word cut in half - so it keeps its width and only takes the pill.
   */
  function isIcon(inner) {
    var role = ROLES[inner.getClassName()];
    var style = inner.styleName;
    return !!role || style === 'OBNavBarCreateNew' || style === 'OBQuickLaunch';
  }

  function dressMember(wrapper) {
    var inner = wrapper.getMembers ? wrapper.getMembers()[0] : null;
    var role;

    // dressMember runs again for every later addMembers, so already dressed wrappers are left
    // alone: keepMarked and trackAlerts both wrap a method, and wrapping one twice would double
    // every call it makes.
    if (!inner || wrapper.etskinMarker) {
      return;
    }

    if (!isIcon(inner)) {
      wrapper.setHeight(BUTTON);
      keepMarked(wrapper, MARKER + 'item ' + MARKER + 'wide');
      return;
    }

    resize(wrapper, BUTTON, BUTTON);
    resize(inner, BUTTON, BUTTON);
    // Stock leaves these overflowing - the profile button still carries the menu arrow the
    // stylesheet hides - and a ToolStrip measures its members by what they draw, not by what they
    // were set to, so without this the tray would space them by their old widths.
    wrapper.setOverflow('hidden');

    role = ROLES[inner.getClassName()];
    if (role === 'alert') {
      keepMarked(wrapper, MARKER + 'item ' + MARKER + 'alert');
      trackAlerts(wrapper, inner);
    } else if (role === 'profile') {
      keepMarked(wrapper, MARKER + 'item ' + MARKER + 'profile');
      makeAvatar(inner);
    } else if (role) {
      keepMarked(wrapper, MARKER + 'item ' + MARKER + role);
    } else {
      keepMarked(wrapper, MARKER + 'item');
    }
  }

  function dressButtons() {
    var members = OB.NavBar.getMembers() || [];
    var i;

    for (i = 0; i < members.length; i++) {
      dressMember(members[i]);
    }
  }

  /*
   * The navigation bar is not finished being built when OB.Layout.initialize returns. The debug
   * tools module, for one, waits for the tab set to exist and only then calls createMembers, so a
   * tray dressed once would end with one undressed member in it.
   */
  function watchAdditions() {
    var strip = OB.NavBar;
    var original = strip.addMembers;

    strip.addMembers = function () {
      var result = original.apply(this, arguments);
      try {
        dressButtons();
      } catch (e) {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('Etendo Modern Skin could not dress a new navigation bar component', e);
        }
      }
      return result;
    };
  }

  function dressTray() {
    var strip = OB.NavBar;

    strip.layoutLeftMargin = GAP;
    strip.layoutRightMargin = GAP;
    strip.layoutTopMargin = GAP;
    strip.layoutBottomMargin = GAP;
    strip.membersMargin = GAP;
    strip.setHeight(BUTTON + 2 * GAP);
  }

  // ------------------------------------------------------------------ order

  /*
   * [left spacer, navbar, middle spacer, logos] becomes [logos, spacers, navbar]. The members are
   * the canvases core created, moved rather than rebuilt, so OB.TopLayout.CompanyImageLogo and
   * OB.TopLayout.OpenbravoLogo stay the objects core handed out and anything holding a reference
   * to them still works.
   */
  function reorder() {
    var top = OB.TopLayout;
    var members = top.getMembers() || [];
    var logos = OB.TopLayout.CompanyImageLogo
      ? OB.TopLayout.CompanyImageLogo.getParentCanvas()
      : null;
    var ordered = [];
    var i, member;

    if (!logos) {
      return;
    }

    ordered.push(logos);
    for (i = 0; i < members.length; i++) {
      member = members[i];
      if (member !== logos && member !== OB.NavBar) {
        ordered.push(member);
      }
    }
    ordered.push(OB.NavBar);

    /*
     * layoutRightMargin on OB.TopLayout is ignored once the layout has been drawn - the stock bar
     * was built with the tray hard against the right edge and never reflows its margins - so the
     * gutter is a member instead. A spacer is a member like any other and lands where it is put.
     */
    if (!top.etskinEdge) {
      top.etskinEdge = isc.LayoutSpacer.create({ width: 8, height: 1 });
    }
    ordered.push(top.etskinEdge);

    // The logos container was built to hug the right edge; on the left it is the brand.
    if (logos.setAlign) {
      logos.setAlign('left');
    }
    logos.layoutLeftMargin = 12;
    logos.layoutRightMargin = 12;

    top.setMembers(ordered);
  }

  function dressBar() {
    var top = OB.TopLayout;

    // Stock is 4 + 40 + 10; the tray is 48 tall and the band around it is even. 56 is the height
    // of the React skin's top bar.
    top.layoutTopMargin = GAP;
    top.layoutBottomMargin = GAP;
    top.layoutLeftMargin = 0;
    top.layoutRightMargin = 8;
    if (top.setDefaultLayoutAlign) {
      top.setDefaultLayoutAlign('center');
    }
  }

  // ---------------------------------------------------------------- install

  function install() {
    dressBar();
    dressTray();
    dressButtons();
    watchAdditions();
    reorder();
    OB.TopLayout.reflow();

    OB.ETSkin.topBar = { tray: OB.NavBar };
  }

  // ------------------------------------------------------------------ main

  try {
    if (typeof OB !== 'undefined' && OB && OB.Layout && OB.Layout.initialize) {
      var originalInitialize = OB.Layout.initialize;
      OB.Layout.initialize = function () {
        var result = originalInitialize.apply(this, arguments);
        try {
          if (wanted()) {
            install();
          }
        } catch (e) {
          // A tray that fails to build must not cost the user the navigation bar: every control is
          // still there, in its stock place, because nothing here removes anything.
          if (typeof console !== 'undefined' && console.warn) {
            console.warn('Etendo Modern Skin could not restyle the navigation bar', e);
          }
        }
        return result;
      };
    }
  } catch (e) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('Etendo Modern Skin navigation bar styling is unavailable', e);
    }
  }
})();
