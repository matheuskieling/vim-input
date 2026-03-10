(function () {
  'use strict';

  var Mode = window.InputVim.Mode;
  var VimEngine = window.InputVim.VimEngine;
  var Overlay = window.InputVim.Overlay;
  var Settings = window.InputVim.Settings;
  var ED = window.InputVim.ElementDetector;
  var CursorController = window.InputVim.CursorController;
  var FocusManager = window.InputVim.FocusManager;
  var EventInterceptor = window.InputVim.EventInterceptor;

  var engine = new VimEngine();
  var overlay = new Overlay();

  // ── Init overlay ─────────────────────────────────────

  if (document.documentElement) {
    overlay.init();
  } else {
    document.addEventListener('DOMContentLoaded', function () { overlay.init(); });
  }

  // ── Load settings ────────────────────────────────────

  Settings.load(function () {
    if (!Settings.get('enabled') || Settings.isPageExcluded()) {
      FocusManager.deactivate();
    }
  });

  Settings.onChange(function () {
    if (!Settings.get('enabled') || Settings.isPageExcluded()) {
      FocusManager.deactivate();
    }
  });

  // ── Wire modules ─────────────────────────────────────

  var getActiveElement = FocusManager.getActiveElement;
  var getHandler = ED.getHandler;
  var updateCursor = CursorController.update;

  CursorController.init(overlay, engine, getActiveElement, getHandler);
  FocusManager.init(engine, overlay, getHandler, updateCursor);
  EventInterceptor.init(engine, overlay, getActiveElement, getHandler, updateCursor, FocusManager.markFocusSteal);

  // ── Mode change callback ─────────────────────────────

  engine.onModeChange(function (newMode) {
    overlay.update(newMode);
    updateCursor();
    var el = getActiveElement();
    if (el) {
      el.setAttribute('data-input-vim', newMode);
    }
  });

  // ── Detect already-focused inputs ────────────────────

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    FocusManager.checkExistingFocus();
  } else {
    document.addEventListener('DOMContentLoaded', FocusManager.checkExistingFocus);
    window.addEventListener('load', FocusManager.checkExistingFocus);
  }

})();
