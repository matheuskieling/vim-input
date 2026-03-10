(function () {
  'use strict';

  var Mode = window.InputVim.Mode;

  var _activeElement = null;
  var _recentFocusSteal = 0;
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
      var el = e.target;
      if (el === _activeElement) return;
      var ED = window.InputVim.ElementDetector;
      if (!ED.isVimTarget(el)) return;
      activate(el);
    }, true);

    document.addEventListener('mousedown', function () {
      _recentFocusSteal = Date.now();
    }, true);

    document.addEventListener('focusout', function (e) {
      if (e.target !== _activeElement) return;

      if (_engine.mode !== Mode.NORMAL && Date.now() - _recentFocusSteal > 300) {
        var el = _activeElement;
        var handler = _getHandler(el);
        if (handler) {
          var command = _engine.handleKey('Escape');
          if (command) handler.execute(el, command, _engine);
          _updateCursor();
        }
        setTimeout(function () {
          if (el && document.activeElement !== el) {
            el.focus();
          }
        }, 0);
        return;
      }

      deactivate();
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
    if (_activeElement) {
      _activeElement.style.caretColor = '';
      _activeElement.removeAttribute('data-input-vim');
      // Restore original email type if it was swapped
      var origType = _activeElement.getAttribute('data-input-vim-original-type');
      if (origType) {
        _activeElement.type = origType;
        _activeElement.removeAttribute('data-input-vim-original-type');
      }
    }
    _overlay.hideCursor();
    _activeElement = null;
    _engine.setMode(Mode.NORMAL);
    _engine.parser.reset();
    _overlay.hide();
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
