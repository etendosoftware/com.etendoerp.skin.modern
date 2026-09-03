/*
 *************************************************************************
 * Copyright (C) 2026 Futit Services S.L.
 * Licensed under the Openbravo Public License version 1.1.
 * You may obtain a copy of the License at
 * http://www.openbravo.com/legal/license.html
 ************************************************************************
 */

/*
 * Five things about a form that a stylesheet cannot reach, because they are markup or geometry the
 * framework writes rather than paint.
 *
 * The required marker is a bare "*" the form appends inside <b>...</b>, so it is a bold black
 * character with nothing to select and no way to colour. The framework builds it from four string
 * properties, and replacing those with our own is enough: the asterisk arrives already wrapped, and
 * the bold that made every label shout leaves with them.
 *
 * The "open in new tab" arrow is an <img> written by OBViewForm#getTitleHTML with a fixed class.
 * A second class is added to it on the way past so the stylesheet can hide it until the field is
 * under the pointer.
 *
 * A section header is a button whose title is plain text, so there is no element for a stylesheet
 * to turn into a disclosure chevron and the only affordance was a 12px icon at the far left, a
 * hundred pixels from the edge the section actually opens against. A span is appended to the title
 * for the stylesheet to shape and rotate.
 *
 * A new record arrives with its child tabs already open below it - a second grid, empty, because
 * the record it would belong to does not exist yet - taking about half of a form the user is trying
 * to fill in. Core already knows how to collapse them: it is what the maximise button does. It is
 * asked to do it while the record is unsaved and to undo it once the record exists.
 *
 * The status bar names the state of the record ("New", "Editing") but never the record, so the
 * largest text on a screen showing one invoice was the word "New". The record's own identifier is
 * put in front of it, which is also the only heading the form has.
 *
 * ES5 only: this file is concatenated into the kernel bundle and minified by JSMin.
 */
(function () {
  if (typeof isc === 'undefined' || !isc.OBViewForm) {
    return;
  }
  if (typeof OB === 'undefined' || !OB.ETSkin) {
    return;
  }

  var REQUIRED_MARK = ' <span class="etskin-required">*</span>';

  /*
   * The img and the span that wraps the title both carry class OBFormFieldLinkButton. Only the img
   * has a space after the closing quote, because its attributes come from an extraStuff string
   * rather than from literal markup, so that is what identifies it.
   */
  var IMG_CLASS = 'class="OBFormFieldLinkButton" ';
  var IMG_CLASS_SKINNED = 'class="OBFormFieldLinkButton etskin-linkglyph" ';
  var RIGHT_REQUIRED_MARK = '<span class="etskin-required">*</span> ';

  // The stylesheet draws the chevron out of two borders on an empty box, so the span carries no
  // character of its own and nothing to translate.
  var CHEVRON = '<span class="etskin-section-chevron"></span>';

  /*
   * Applied to the instance, not just the prototype. The kernel serialises OBViewForm's own
   * property block into the generated window definition and passes it back as the create config,
   * so a form arrives carrying its own copy of titlePrefix, requiredTitleSuffix and getTitleHTML -
   * own properties, which shadow anything the prototype says. Re-stating them on each new form is
   * what actually reaches the screen; the prototype defaults below still cover forms built any
   * other way. setNewState comes across in the same block and is wrapped here for the same reason.
   */
  function adopt(form) {
    if (!form || form.etskinAdopted) {
      return;
    }
    form.etskinAdopted = true;
    form.titlePrefix = '';
    form.titleSuffix = '';
    form.requiredTitlePrefix = '';
    form.requiredTitleSuffix = REQUIRED_MARK;
    form.requiredRightTitlePrefix = RIGHT_REQUIRED_MARK;
    form.rightTitlePrefix = '';
    form.rightTitleSuffix = '';

    var inner = form.getTitleHTML;
    var newState;
    if (typeof inner === 'function') {
      form.getTitleHTML = function () {
        return markLinkGlyph(inner.apply(this, arguments));
      };
    }

    /*
     * setNewState arrives in that same serialised block, so the form carries its own copy and the
     * patch further down this file - which is on the prototype - is never the one that runs. It is
     * wrapped here instead, and only when the instance really does shadow it, so a form built any
     * other way is left to the prototype and does not get the work done twice.
     */
    if (Object.prototype.hasOwnProperty.call(form, 'setNewState')) {
      newState = form.setNewState;
      if (typeof newState === 'function') {
        form.setNewState = function (isNew) {
          var result = newState.apply(this, arguments);
          try {
            laterSplit(this.view, isNew);
          } catch (e) {
            // A pane that will not move is a pane in its stock place.
          }
          return result;
        };
      }
    }
  }

  function markLinkGlyph(html) {
    if (typeof html !== 'string' || html.indexOf(IMG_CLASS) === -1) {
      return html;
    }
    return html.split(IMG_CLASS).join(IMG_CLASS_SKINNED);
  }

  try {
    var proto = isc.OBViewForm.getPrototype();
    var originalTitleHTML = proto.getTitleHTML;

    isc.OBViewForm.addProperties({
      titlePrefix: '',
      titleSuffix: '',
      requiredTitlePrefix: '',
      requiredTitleSuffix: REQUIRED_MARK,
      requiredRightTitlePrefix: RIGHT_REQUIRED_MARK,
      rightTitlePrefix: '',
      rightTitleSuffix: '',

      getTitleHTML: function () {
        return markLinkGlyph(originalTitleHTML.apply(this, arguments));
      }
    });

    var originalCreate = isc.OBViewForm.create;
    isc.OBViewForm.create = function () {
      var form = originalCreate.apply(this, arguments);
      try {
        adopt(form);
      } catch (e) {
        // A bold asterisk is a blemish, not a broken form.
      }
      return form;
    };
  } catch (e) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('Etendo Modern Skin could not adjust the form titles', e);
    }
  }

  // ------------------------------------------------------- section chevrons

  /*
   * ImgSectionHeader is a SmartClient class, so it is defined in ISC_Combined.js and is certainly
   * there by the time this file runs. OBSectionItemButton, the subclass a form section actually
   * uses, is defined in the skin's own JavaScript and may not be - which is why the patch goes on
   * the ancestor and identifies the subclass at draw time, when it exists either way.
   *
   * SectionStack headers share the ancestor, so the class name is checked: only a form section gets
   * the chevron.
   */
  function withChevron(header, title) {
    if (typeof title !== 'string' || title.indexOf(CHEVRON) !== -1) {
      return title;
    }
    if (!header.getClassName || header.getClassName().indexOf('OBSectionItemButton') !== 0) {
      return title;
    }
    return title + CHEVRON;
  }

  function decorate(header) {
    var title = header.title;
    var wanted = withChevron(header, title);
    if (wanted !== title && header.setTitle) {
      // setTitle, not an override of getTitle: the background button caches the markup it rendered,
      // so a title that only answers differently when asked never reaches the screen.
      header.setTitle(wanted);
    }
  }

  try {
    if (isc.ImgSectionHeader) {
      var originalHeaderDraw = isc.ImgSectionHeader.getPrototype().draw;
      var originalHeaderTitle = isc.ImgSectionHeader.getPrototype().setTitle;
      isc.ImgSectionHeader.addProperties({
        /*
         * The chevron is added on the way in rather than after the fact, because a section is
         * re-titled while the window is running: the ones that carry a count - Notes, Attachments,
         * Linked Items - are titled again each time their contents are counted, and a title written
         * over ours took the chevron with it. Three of six sections lost theirs that way on a record
         * that had actually been loaded, which a form reached without one did not show.
         *
         * Transforming the argument also means this never calls itself: what it hands to the
         * original already contains the chevron, so the guard in withChevron ends the chain.
         */
        setTitle: function (title) {
          var wanted = title;
          try {
            wanted = withChevron(this, title);
          } catch (e) {
            // A section without a chevron is still a section.
          }
          return originalHeaderTitle.call(this, wanted);
        },

        // The first title arrives as a property rather than through setTitle, so it is put through
        // the same transformation once the header is on screen and knows its own class.
        draw: function () {
          var result = originalHeaderDraw.apply(this, arguments);
          try {
            decorate(this);
          } catch (e) {
            // As above.
          }
          return result;
        }
      });
    }
  } catch (e) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('Etendo Modern Skin could not adjust the form sections', e);
    }
  }

  // ---------------------------------------------------------- record title

  function escapeHTML(text) {
    return String(text)
      .split('&').join('&amp;')
      .split('<').join('&lt;')
      .split('>').join('&gt;');
  }

  /*
   * What the bar should be called. A saved record has an identifier, which is the string the rest
   * of the application uses for it in grids and in links, so it is the same name the user came
   * here by. A new one has none yet - the fields are empty - so the tab's own title stands in, and
   * the "New" chip beside it says the rest.
   */
  function recordTitle(bar) {
    var view = bar.view;
    var form = view && view.viewForm;
    var values, record;
    if (!view) {
      return '';
    }
    if (form && form.isNew) {
      return view.tabTitle || '';
    }
    values = form && form.getValues ? form.getValues() : null;
    if (values && values._identifier) {
      return String(values._identifier);
    }
    record = view.viewGrid && view.viewGrid.getSelectedRecord
      ? view.viewGrid.getSelectedRecord()
      : null;
    if (record && record._identifier) {
      return String(record._identifier);
    }
    return view.tabTitle || '';
  }

  /*
   * updateContentTitle is the one place the bar rebuilds its contents: it destroys every member and
   * sets a fresh list, so anything added anywhere else is thrown away the next time the record
   * changes. Adding the title after that rebuild is the only placement that survives - and it goes
   * in at index 0 so it reads as the heading it is rather than as another status field.
   *
   * It is called from a second place as well, because the rebuild does not always happen: core
   * labels the bar when a record is new, being edited or just saved, and on a record simply opened
   * from the grid it labels nothing at all - the bar stays empty. So setNewState calls this too,
   * which means it can run twice for one record and has to be able to.
   *
   * Hence etskinTitle. The label is remembered and taken down before another goes up; the destroyed
   * check is for the ordinary case where the bar rebuilt itself in between and already disposed of
   * it. Re-titling is not skipped when the label is still there, because the reason for the second
   * call is usually that the record changed underneath it.
   */
  function titleTheBar(bar) {
    var text = recordTitle(bar);
    var previous = bar.etskinTitle;

    if (previous) {
      bar.etskinTitle = null;
      if (!previous.destroyed) {
        if (bar.content && bar.content.removeMember) {
          bar.content.removeMember(previous);
        }
        previous.destroy();
      }
    }
    if (!text || !bar.content || !bar.content.addMember) {
      return;
    }
    bar.etskinTitle = isc.OBStatusBarTextLabel.create({
      contents: '<span class="etskin-record-title">' + escapeHTML(text) + '</span>'
    });
    bar.content.addMember(bar.etskinTitle, 0);
  }

  try {
    if (isc.OBStatusBar) {
      var originalUpdateTitle = isc.OBStatusBar.getPrototype().updateContentTitle;
      isc.OBStatusBar.addProperties({
        updateContentTitle: function () {
          var result = originalUpdateTitle.apply(this, arguments);
          try {
            titleTheBar(this);
          } catch (e) {
            // An untitled bar is the stock bar, which is what was there before.
          }
          return result;
        }
      });
    }
  } catch (e) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('Etendo Modern Skin could not title the status bar', e);
    }
  }

  // ------------------------------------------------------------ child panes

  /*
   * The child tabs of an unsaved record can hold nothing - there is no parent row for a line to
   * belong to - so the half of the screen they occupy is half of the screen spent on an empty grid
   * and its empty toolbar, while the form the user is filling in is squeezed above it.
   *
   * setTopMaximum and setHalfSplit are core's own, the two halves of the maximise button, so the
   * collapsed state is a state the window already knows how to be in and the restore button already
   * offers a way out of. Nothing here reimplements a layout.
   *
   * etskinCollapsed records that this file was the one that collapsed the panes, so a record the
   * user had already maximised by hand is not silently re-split when it is saved.
   */
  function collapseChildren(view) {
    if (!view || !view.members || !view.members[1] || !view.setTopMaximum) {
      return;
    }
    if (view.state === isc.OBStandardView.STATE_TOP_MAX) {
      return;
    }
    view.etskinCollapsed = true;
    view.setTopMaximum();
  }

  function restoreChildren(view) {
    if (!view || !view.etskinCollapsed) {
      return;
    }
    view.etskinCollapsed = false;
    if (view.state === isc.OBStandardView.STATE_TOP_MAX && view.setHalfSplit) {
      view.setHalfSplit();
    }
  }

  /*
   * Deferred, because setNewState runs in the middle of building the form: the view is still
   * deciding its own height, and a resize asked for from inside that pass is measured against a
   * layout that has not settled. A tick later the window is whole and the split is arithmetic.
   */
  function laterSplit(view, isNew) {
    setTimeout(function () {
      try {
        if (isNew) {
          collapseChildren(view);
        } else {
          restoreChildren(view);
        }
      } catch (e) {
        // A pane that will not move is a pane in its stock place.
      }
      try {
        // The other half of the record title. A record opened from the grid never reaches
        // updateContentTitle, so without this the heading only appears once the record is touched.
        if (view && view.statusBar) {
          titleTheBar(view.statusBar);
        }
      } catch (e) {
        // As above.
      }
    }, 0);
  }

  try {
    var originalNewState = isc.OBViewForm.getPrototype().setNewState;
    isc.OBViewForm.addProperties({
      setNewState: function (isNew) {
        var result = originalNewState.apply(this, arguments);
        try {
          laterSplit(this.view, isNew);
        } catch (e) {
          // As above.
        }
        return result;
      }
    });
  } catch (e) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('Etendo Modern Skin could not size the child panes', e);
    }
  }
})();
