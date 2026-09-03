/*
 *************************************************************************
 * Copyright (C) 2026 Futit Services S.L.
 * Licensed under the Openbravo Public License version 1.1.
 * You may obtain a copy of the License at
 * http://www.openbravo.com/legal/license.html
 ************************************************************************
 */

/*
 * Puts the running application into each of the states capture.js records, so that a before and an
 * after recording are of the same screen rather than of whatever the browser happened to be showing.
 * It is a test fixture: it is injected into the page by hand, it is never registered with the kernel
 * and it never ships.
 *
 * The five states:
 *   grid  - the navigation open, the window in grid view
 *   form  - the navigation collapsed, a saved record open in form view
 *   new   - the navigation open, an unsaved new record in form view
 *   rail  - the navigation collapsed to its rail, over the grid
 *   login - the login page, which is a different document and is reached by navigating to it
 *
 * The four application states are all reached from one entry point, window.etskinDriveUrl - the
 * Sales Invoice window opened plainly, with no record named in the bookmark. That matters for the
 * transactional-filter notice, which is the whole of finding F5: the window carries an implicit
 * filter (draft documents from the last day), and it only applies when the window is opened this
 * way. A bookmark that names a record opens on that record instead, which empties the filter
 * clause - so a recording made from one would show neither the banner the stock skin raises nor the
 * dot that replaces it, and would prove nothing either way. An earlier version of this file drove
 * from a record bookmark and did exactly that.
 *
 * The form state therefore opens the record the filter left in the grid rather than one named in
 * the URL, which also keeps all four states on the same window instance.
 */
(function () {
  var SETTLE = 400;

  window.etskinDriveUrl =
    '/etendo_skin/#%7Bst:1,bm:%5B%7BviewId:__OBMyOpenbravoImplementation__,params:%7BmyOB:true,' +
    'canClose:false,tabTitle:__Workspace__%7D%7D,%7BviewId:___167__,params:%7BwindowId:__167__,' +
    'viewId:___167__,tabTitle:__Sales%20Invoice__%7D%7D%5D%7D';

  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function until(test, timeout) {
    var deadline = Date.now() + (timeout || 20000);
    return new Promise(function (resolve, reject) {
      (function poll() {
        var value;
        try { value = test(); } catch (e) { value = null; }
        if (value) { resolve(value); return; }
        if (Date.now() > deadline) { reject(new Error('timed out waiting for the application')); return; }
        setTimeout(poll, 150);
      }());
    });
  }

  /*
   * The window's own view, not one of its child tabs. SmartClient registers every canvas as a global
   * under its ID, so the candidates are enumerable; a child tab has a parentView and is skipped, and
   * among what is left the one actually on screen is the largest, since the others belong to windows
   * on inactive tabs and measure zero.
   */
  function view() {
    var best = null;
    var bestArea = 0;
    var key, candidate, rect, area;
    for (key in window) {
      if (key.indexOf('isc_OBStandardView_') !== 0) { continue; }
      try { candidate = window[key]; } catch (e) { continue; }
      if (!candidate || !candidate.isDrawn || !candidate.isDrawn()) { continue; }
      if (candidate.parentView || !candidate.toolBar) { continue; }
      rect = candidate.getPageRect ? candidate.getPageRect() : null;
      if (!rect) { continue; }
      area = rect[2] * rect[3];
      if (area > bestArea) { bestArea = area; best = candidate; }
    }
    return best;
  }

  async function navCollapsed(want) {
    var root = document.querySelector('.etskin-nav');
    if (!root) { return; }
    var is = root.className.indexOf('etskin-nav-collapsed') !== -1;
    if (is === want) { return; }
    var toggle = root.querySelector('.etskin-nav-toggle');
    if (!toggle) { return; }
    toggle.click();
    await wait(SETTLE);
  }

  async function showGrid(v) {
    if (v.isShowingForm) {
      v.switchFormGridVisibility();
      await until(function () { return !v.isShowingForm && document.querySelector('.OBViewGridBody'); });
      await wait(SETTLE);
    }
  }

  /*
   * The form opens on the record the grid is holding, so it has to have arrived first and it has to
   * be selected: switching with nothing selected opens a form with no record in it.
   */
  async function showForm(v) {
    var grid = v.viewGrid;
    if (!v.isShowingForm) {
      await until(function () { return grid.data && grid.data.getLength && grid.data.getLength() > 0; });
      if (!grid.getSelectedRecord()) {
        grid.selectSingleRecord(0);
        await wait(SETTLE);
      }
      v.switchFormGridVisibility();
      await until(function () { return v.isShowingForm && document.querySelector('.OBViewForm'); });
      await wait(SETTLE);
    }
  }

  window.etskinDrive = async function (screen) {
    var v = await until(view, 30000);
    await until(function () { return v.toolBar && v.toolBar.isDrawn && v.toolBar.isDrawn(); });

    if (screen === 'grid') {
      await navCollapsed(false);
      await showGrid(v);
    } else if (screen === 'form') {
      await navCollapsed(true);
      await showForm(v);
    } else if (screen === 'new') {
      await navCollapsed(false);
      await showForm(v);
      v.newDocument();
      await until(function () { return v.isShowingForm && v.viewForm && v.viewForm.isNew; });
      await wait(SETTLE * 2);
    } else if (screen === 'rail') {
      await navCollapsed(true);
      await showGrid(v);
    } else {
      throw new Error('unknown screen ' + screen);
    }

    await wait(SETTLE);
    return { screen: screen, view: v.getID ? v.getID() : null };
  };
}());
