/*
 *************************************************************************
 * Copyright (C) 2026 Futit Services S.L.
 * Licensed under the Openbravo Public License version 1.1.
 * You may obtain a copy of the License at
 * http://www.openbravo.com/legal/license.html
 ************************************************************************
 */

/*
 * Two things a stylesheet cannot reach, because they are markup the framework writes.
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

  /*
   * Applied to the instance, not just the prototype. The kernel serialises OBViewForm's own
   * property block into the generated window definition and passes it back as the create config,
   * so a form arrives carrying its own copy of titlePrefix, requiredTitleSuffix and getTitleHTML -
   * own properties, which shadow anything the prototype says. Re-stating them on each new form is
   * what actually reaches the screen; the prototype defaults below still cover forms built any
   * other way.
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
    if (typeof inner === 'function') {
      form.getTitleHTML = function () {
        return markLinkGlyph(inner.apply(this, arguments));
      };
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
})();
