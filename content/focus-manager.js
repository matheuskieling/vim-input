(function () {
  'use strict';

  var Mode = window.InputVim.Mode;

  var _activeElement = null;
  var _recentFocusSteal = 0;
  var _deactivating = false;
  var _engine = null;
  var _overlay = null;
  var _getHandler = null;
  var _updateCursor = null;

  function init(engine, overlay, getHandler, updateCursor) {
    _engine = engine;
    _overlay = overlay;
    _getHandler = getHandler;
    _updateCursor = updateCursor;

    document.addEventListener('focusin', function (e) {
      var el = e.composedPath ? e.composedPath()[0] : e.target;
      if (el === _activeElement) return;
      var ED = window.InputVim.ElementDetector;
      if (!ED.isVimTarget(el)) return;
      activate(el);
    }, true);

    document.addEventListener('mousedown', function () {
      _recentFocusSteal = Date.now();
    }, true);

    document.addEventListener('focusout', function (e) {
      var el = e.composedPath ? e.composedPath()[0] : e.target;
      if (el !== _activeElement) return;

      // deactivate() sets _deactivating before blurring — let that through
      if (_deactivating) return;

      var EI = window.InputVim.EventInterceptor;
      var hadSearchOrCmd = EI.isSearchOrCmdActive();

      // Always clear all transient state (search, cmdline, pending parser cmd)
      EI.clearTransientState();
      _engine.parser.reset();
      _overlay.updateCmd('');

      // Search/cmdline takes priority — only clear, don't switch mode
      if (hadSearchOrCmd) {
        // stay in current mode
      }
      // Otherwise, switch non-NORMAL modes to NORMAL (pending cmd already cleared above)
      else if (_engine.mode !== Mode.NORMAL && Date.now() - _recentFocusSteal > 300) {
        var activeEl = _activeElement;
        var handler = _getHandler(activeEl);
        if (handler) {
          var command = _engine.handleKey('Escape');
          if (command) handler.execute(activeEl, command, _engine);
          _updateCursor();
        }
      }

      // User-initiated blur (Tab, Enter, click) — deactivate normally
      if (Date.now() - _recentFocusSteal <= 300) {
        deactivate();
        return;
      }

      // Re-focus unless the user clicked on another vim-target (let focusin handle it)
      var refocusEl = _activeElement;
      setTimeout(function () {
        if (!refocusEl || refocusEl !== _activeElement) return;
        var ED = window.InputVim.ElementDetector;
        var newFocus = document.activeElement;
        if (newFocus && newFocus !== refocusEl && ED.isVimTarget(newFocus)) return;
        if (document.activeElement !== refocusEl) {
          refocusEl.focus();
        }
      }, 0);
    }, true);
  }

  function activate(el) {
    var Settings = window.InputVim.Settings;
    Settings.load(function () {
      if (!Settings.get('enabled') || Settings.isPageExcluded()) return;

      // Swap email inputs to text so selectionStart/selectionEnd work
      if (el.tagName === 'INPUT' && el.type.toLowerCase() === 'email') {
        el.setAttribute('data-input-vim-original-type', 'email');
        el.type = 'text';
      }

      var mode = Settings.getStartMode();
      _activeElement = el;
      el.setAttribute('data-input-vim', mode);
      _engine.setMode(mode);
      _engine.parser.reset();
      _overlay.show(mode, el);
      _updateCursor();
    });
  }

  function deactivate() {
    var el = _activeElement;
    if (el) {
      el.style.caretColor = '';
      el.removeAttribute('data-input-vim');
      // Restore original email type if it was swapped
      var origType = el.getAttribute('data-input-vim-original-type');
      if (origType) {
        el.type = origType;
        el.removeAttribute('data-input-vim-original-type');
      }
    }
    _overlay.hideCursor();
    _activeElement = null;
    _engine.setMode(Mode.NORMAL);
    _engine.parser.reset();
    window.InputVim.EventInterceptor.clearTransientState();
    _overlay.hide();
    // Blur after removing data-input-vim so the page-escape-blocker allows it.
    // _deactivating flag tells the focusout handler not to re-focus.
    _deactivating = true;
    if (el) el.blur();
    _deactivating = false;
  }

  function getActiveElement() {
    return _activeElement;
  }

  function markFocusSteal() {
    _recentFocusSteal = Date.now();
  }

  // Check for already-focused elements on page load
  function checkExistingFocus() {
    var el = document.activeElement;
    // Traverse into shadow roots to find the real focused element
    while (el && el.shadowRoot && el.shadowRoot.activeElement) {
      el = el.shadowRoot.activeElement;
    }
    var ED = window.InputVim.ElementDetector;
    if (el && ED.isVimTarget(el) && el !== _activeElement) {
      activate(el);
    }
  }

  window.InputVim = window.InputVim || {};
  window.InputVim.FocusManager = {
    init: init,
    activate: activate,
    deactivate: deactivate,
    getActiveElement: getActiveElement,
    markFocusSteal: markFocusSteal,
    checkExistingFocus: checkExistingFocus,
  };
})();
