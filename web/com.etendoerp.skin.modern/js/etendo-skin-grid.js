/*
 *************************************************************************
 * Copyright (C) 2026 Futit Services S.L.
 * Licensed under the Openbravo Public License version 1.1.
 * You may obtain a copy of the License at
 * http://www.openbravo.com/legal/license.html
 ************************************************************************
 */

/*
 * Five things about a grid that a stylesheet cannot reach, because they are decided in the
 * component rather than painted.
 *
 * A row was 34px, which is a spreadsheet's density applied to a list of documents. SmartClient
 * measures rows itself, from cellHeight, so the four extra pixels have to be asked for in
 * JavaScript rather than added as padding.
 *
 * A header sits over its column, so it should be aligned like the column. Every header was centred
 * over left- and right-aligned data alike, and where the grid does read the field, a date field
 * declares align:'right' for the header and cellAlign:'left' for the data - so the two disagree at
 * the source. The header is given the alignment the grid itself uses to place the value.
 *
 * The frozen pane on the left held a checkbox and a 56px column of two icons - open as form, edit
 * in place - repeated on every row. Both actions already exist without them: double click opens the
 * record and a click on a cell starts editing it. The column goes and the grid begins 56px earlier.
 * It is switched off at the source: the grid builds that column from an editGrid flag its own
 * documentation describes as the way to prevent it, so the field is never created. An earlier
 * attempt hid the field after the fact, from draw, which left the grid drawing a body it had
 * already measured for one more column - the rows were laid out below the viewport and the grid
 * stayed hidden.
 *
 * That column was doing a second job, though: its cell in the filter row carried the record count,
 * as a bare number in an unlabelled 56px slot. The count is worth keeping and the slot is not, so
 * updateRowCountDisplay is redirected to a labelled readout on the toolbar - "128 records" instead
 * of "128" - and falls back to the stock behaviour untouched whenever the column is still there.
 * The stock method reaches straight into the filter form for a field that is no longer among the
 * grid's fields, so leaving it alone is not an option: it throws on every data arrival.
 *
 * An active filter was announced by a banner across the top of the view - two bold blue lines and a
 * "never show this again" link, for news the funnel icon was already carrying. There are two of
 * them, one for the window's own implicit filter and one for arriving on a single record from a
 * link, and both are suppressed the same way. The filter button carries the news instead, as a dot,
 * which is why the button needs to know.
 *
 * ES5 only: this file is concatenated into the kernel bundle and minified by JSMin.
 */
(function () {
  if (typeof isc === 'undefined' || !isc.OBViewGrid) {
    return;
  }
  if (typeof OB === 'undefined' || !OB.ETSkin) {
    return;
  }

  var FILTERED = 'etskin-toolbar-filtered';
  var EDIT_LINK = isc.OBViewGrid.EDIT_LINK_FIELD_NAME || '_editLink';

  // -------------------------------------------------------------- alignment

  /*
   * Where the data actually lands, asked of the grid rather than read off the field. A date field
   * declares align:'right' for its header and cellAlign:'left' for its data, and a type can move a
   * column again on its own - so getCellAlign, the method the grid uses to place the value, is the
   * only answer that always matches what the eye sees. The field is the fallback for a column the
   * grid will not answer for.
   */
  function columnAlign(grid, field) {
    var num;
    if (!field) {
      return null;
    }
    num = grid.getFieldNum ? grid.getFieldNum(field.name) : -1;
    if (num >= 0 && grid.getCellAlign) {
      try {
        return grid.getCellAlign(null, 0, num) || null;
      } catch (e) {
        // Fall through to what the field declares.
      }
    }
    return field.cellAlign || field.align || null;
  }

  /*
   * Set after the fact, on the button, rather than through getHeaderButtonProperties: the grid
   * writes the field's own align over whatever that method returns, so a header for a date column
   * still came out right-aligned over left-aligned dates. setAlign alone changes nothing on screen -
   * the alignment is written into the title cell as an attribute when the button paints - so a
   * button whose alignment changed is redrawn. Both headers are visited, the frozen one included.
   */
  function syncHeaderAlign(grid) {
    var headers = [grid.header, grid.frozenHeader];
    var h, members, i, button, field, align;
    for (h = 0; h < headers.length; h++) {
      members = headers[h] && headers[h].getMembers ? headers[h].getMembers() : [];
      for (i = 0; i < members.length; i++) {
        button = members[i];
        field = button.name && grid.getField ? grid.getField(button.name) : null;
        align = field ? columnAlign(grid, field) : null;
        if (!align || button.align === align || !button.setAlign) {
          continue;
        }
        button.setAlign(align);
        if (button.isDrawn && button.isDrawn() && button.redraw) {
          button.redraw();
        }
      }
    }
  }

  // --------------------------------------------------------------- row count

  /*
   * The same arithmetic the stock method does - the page size is a ceiling, so a full page reports
   * "more than" rather than a wrong total - kept here because the readout it feeds is ours.
   */
  function countOf(grid) {
    var data = grid.data;
    var length;
    if (!data || !data.getLength) {
      return null;
    }
    length = isc.isA.Tree(data) ? grid.countGroupContent() : data.getLength();
    if (typeof length !== 'number') {
      return null;
    }
    return { length: length, capped: length > grid.dataPageSize };
  }

  function countText(grid) {
    var count = countOf(grid);
    var one, many, capped;
    if (!count) {
      return '';
    }
    if (count.length === 0) {
      return '';
    }
    one = skinLabel('recordOne', '1 record');
    many = skinLabel('recordMany', '{0} records');
    capped = skinLabel('recordMore', 'more than {0} records');
    if (count.capped) {
      return capped.replace('{0}', grid.dataPageSize);
    }
    if (count.length === 1) {
      return one;
    }
    return many.replace('{0}', count.length);
  }

  function skinLabel(name, fallback) {
    var labels = OB.ETSkin && OB.ETSkin.labels;
    return labels && labels[name] ? String(labels[name]) : fallback;
  }

  function countReadout(grid) {
    var view = grid.view;
    var toolbar = view && view.toolBar;
    return toolbar && toolbar.etskinCount ? toolbar.etskinCount : null;
  }

  /*
   * True while the grid still owns the column the stock readout writes into. Asking the filter
   * form rather than the grid, because that form is what the stock method dereferences.
   */
  function hasEditLinkField(grid) {
    var editor = grid.filterEditor;
    var form = editor && editor.getEditForm ? editor.getEditForm() : null;
    return !!(form && form.getField && form.getField(EDIT_LINK));
  }

  // ----------------------------------------------------------- filter state

  /*
   * Two kinds of filter reach the same dot. The implicit one is the window's own - the transactional
   * range that made the banner appear in the first place - and lives on the grid as a clause. The
   * explicit one is whatever the user typed, and the filter editor is the honest source for it:
   * getCriteria also carries a _dummy entry the framework adds to force a reload, so counting
   * criteria would report a filter on every grid.
   */
  function hasFilter(grid) {
    if (grid.filterClause || grid.sqlFilterClause) {
      return true;
    }
    if (grid.view && grid.view.directNavigation) {
      return true;
    }
    var editor = grid.getFilterEditor ? grid.getFilterEditor() : null;
    var form = editor && editor.getEditForm ? editor.getEditForm() : null;
    var values = form && form.getValues ? form.getValues() : null;
    var key, value;
    if (!values) {
      return false;
    }
    for (key in values) {
      if (!values.hasOwnProperty(key) || key.charAt(0) === '_') {
        continue;
      }
      value = values[key];
      if (value === null || value === undefined || value === '') {
        continue;
      }
      if (isc.isAn.Array(value) && value.length === 0) {
        continue;
      }
      return true;
    }
    return false;
  }

  function filterButton(grid) {
    var view = grid.view;
    var toolbar = view && view.toolBar;
    var members = toolbar && toolbar.getMembers ? toolbar.getMembers() : [];
    var i;
    for (i = 0; i < members.length; i++) {
      if (members[i].buttonType === 'gridAndFilter') {
        return members[i];
      }
    }
    return null;
  }

  /*
   * The class is written straight onto the wrapper. The toolbar's own marking only ever adds its
   * classes and never rewrites the attribute, so the two do not fight, and the wrapper survives the
   * redraws that replace the button's contents.
   */
  function showFilterState(grid) {
    var button = filterButton(grid);
    var handle = button && button.getHandle ? button.getHandle() : null;
    if (!handle) {
      return;
    }
    var on = hasFilter(grid);
    var has = handle.className.indexOf(FILTERED) !== -1;
    if (on && !has) {
      handle.className = handle.className + ' ' + FILTERED;
    } else if (!on && has) {
      handle.className = handle.className.split(FILTERED).join('').replace(/\s+/g, ' ');
    }
  }

  /*
   * checkShowFilterFunnelIcon does two jobs: it points the funnel icon at the right tooltip, and,
   * when the window carries an implicit filter, it raises the banner - two bold blue lines and a
   * "never show this again" link, 38px of the viewport spent saying what the funnel already says.
   *
   * Only the second job is unwanted, and the method guards it with `messageBar && !isVisible()`.
   * Handing it a bar that reports itself already visible therefore skips exactly that branch and
   * leaves everything else running as written - no copy of the method, nothing to keep in step with
   * a future core release. The real bar is untouched, so an error or a save confirmation still
   * appears there.
   */
  var QUIET_BAR = {
    hasFilterMessage: false,
    isVisible: function () { return true; },
    hide: function () { return; },
    setMessage: function () { return; }
  };

  /*
   * setSingleRecordFilterMessage raises the same kind of notice for the other filter the window can
   * arrive with - opened on one record from a link, so the grid shows one row - but reads the bar
   * off the view instead of taking it as an argument. The bar is therefore swapped for the quiet one
   * across the call and put back immediately, which reaches the same branch by the same means.
   */
  function withoutMessageBar(grid, original, args) {
    var view = grid.view;
    var real = view ? view.messageBar : null;
    if (!real) {
      return original.apply(grid, args);
    }
    view.messageBar = QUIET_BAR;
    try {
      return original.apply(grid, args);
    } finally {
      view.messageBar = real;
    }
  }

  // -------------------------------------------------------------- badges

  var STATUS_FIELD = 'documentStatus';

  /*
   * A document status cell is drawn as a badge. Only that one property, and only where the grid is
   * drawing an ordinary row: a group header cell holds the group's own title and count, a summary
   * row holds an aggregate, and the row being edited holds an editor - none of them are a status
   * to colour, and all three come through here.
   *
   * The label comes out of the field's value map rather than out of the superclass call, which
   * would return a rendered cell. That keeps the badge to plain text it can escape itself, and it
   * keeps this from depending on what the superclass decides a cell looks like.
   */
  function badgeCell(grid, record, recordNum, field) {
    var raw, label;
    if (!field || field.name !== STATUS_FIELD || !record) {
      return null;
    }
    if (!OB.ETSkin || !OB.ETSkin.statusBadge) {
      return null;
    }
    if (record.groupMembers || record[grid.groupSummaryRecordProperty] ||
        record[grid.gridSummaryRecordProperty]) {
      return null;
    }
    if (recordNum === grid.getEditRow()) {
      return null;
    }
    raw = record[field.name];
    if (raw === null || raw === undefined || raw === '') {
      return null;
    }
    label = field.valueMap && field.valueMap[raw] ? field.valueMap[raw] : raw;
    return OB.ETSkin.statusBadge(raw, label);
  }

  // -------------------------------------------------------------------- main

  try {
    var proto = isc.OBViewGrid.getPrototype();
    var originalDraw = proto.draw;
    var originalFilter = proto.filterData;
    var originalRowCount = proto.updateRowCountDisplay;
    var originalFunnel = proto.checkShowFilterFunnelIcon;
    var originalSingle = proto.setSingleRecordFilterMessage;
    var originalCell = proto.getCellValue;

    isc.OBViewGrid.addProperties({
      /*
       * 28px of cell plus the stylesheet's padding came to a 34px row, which is a dense spreadsheet
       * rather than a list of documents. The row is exactly this number - the padding is inside it,
       * not added to it - and at 38 a row reads as one object rather than as a line of a ledger. It
       * lives here because SmartClient measures rows itself and a stylesheet cannot move them.
       */
      cellHeight: 38,

      /*
       * The edit-link column, off at the source rather than hidden afterwards. The grid reads this
       * flag once, while it is assembling its field list, so the column is never built and nothing
       * downstream has to be told about it.
       */
      editGrid: false,

      updateRowCountDisplay: function () {
        var readout;
        if (hasEditLinkField(this)) {
          return originalRowCount.apply(this, arguments);
        }
        try {
          readout = countReadout(this);
          if (readout && readout.setContents) {
            readout.setContents(countText(this));
          }
        } catch (e) {
          // A missing count is a missing count, not a broken grid.
        }
      },

      draw: function () {
        var result = originalDraw.apply(this, arguments);
        try {
          syncHeaderAlign(this);
          showFilterState(this);
        } catch (e) {
          // As above.
        }
        return result;
      },

      filterData: function () {
        var result = originalFilter.apply(this, arguments);
        try {
          syncHeaderAlign(this);
          showFilterState(this);
        } catch (e) {
          // As above.
        }
        return result;
      },

      checkShowFilterFunnelIcon: function (criteria) {
        var result = originalFunnel.call(this, criteria, QUIET_BAR);
        try {
          showFilterState(this);
        } catch (e) {
          // As above.
        }
        return result;
      },

      setSingleRecordFilterMessage: function () {
        return withoutMessageBar(this, originalSingle, arguments);
      },

      getCellValue: function (record, recordNum, fieldNum) {
        var badge = null;
        try {
          badge = badgeCell(this, record, recordNum, this.fields[fieldNum]);
        } catch (e) {
          // A cell that cannot be badged is drawn the way it always was.
        }
        if (badge !== null) {
          return badge;
        }
        return originalCell.apply(this, arguments);
      }
    });
  } catch (e) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('Etendo Modern Skin could not adjust the grid', e);
    }
  }
})();
