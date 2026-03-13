(function () {
  'use strict';

  // ── Scratch Buffer ────────────────────────────────────
  // Completely isolated editing surface: opens a plain <textarea>
  // overlay pre-filled with the text from the active element.
  //   :e   — open scratch buffer
  //   :wq  — write content back to source element and close
  //   :w   — write content back without closing
  //   :q!  — discard changes and close
  //   :q   — close (discards changes)

  var _sourceEl = null;
  var _onSave = null;
  var _container = null;
  var _textarea = null;
  var _label = null;
  var _active = false;
  var _originalText = '';

  function _createUI() {
    _container = document.createElement('div');
    _container.style.cssText =
      'position:fixed;top:0;left:0;width:100vw;height:100vh;' +
      'z-index:2147483646;background:rgba(0,0,0,0.88);display:none;' +
      'flex-direction:column;align-items:center;justify-content:center;';

    _label = document.createElement('div');
    _label.style.cssText =
      'color:#888;font-family:monospace;font-size:12px;margin-bottom:6px;' +
      'user-select:none;';
    _label.textContent = ':e scratch buffer \u2014 :wq save, :q! discard';
    _container.appendChild(_label);

    _textarea = document.createElement('textarea');
    _textarea.style.cssText =
      'width:80vw;height:70vh;max-width:900px;background:#1e1e1e;color:#d4d4d4;' +
      'font-family:monospace;font-size:14px;line-height:1.5;padding:16px;' +
      'border:1px solid #555;border-radius:4px;resize:none;outline:none;' +
      'tab-size:4;white-space:pre-wrap;word-wrap:break-word;box-sizing:border-box;';
    _textarea.setAttribute('data-input-vim-scratch', 'true');
    _textarea.setAttribute('spellcheck', 'false');
    _textarea.setAttribute('autocomplete', 'off');
    _textarea.setAttribute('autocorrect', 'off');
    _textarea.setAttribute('autocapitalize', 'off');
    _container.appendChild(_textarea);

    document.documentElement.appendChild(_container);
  }

  function open(sourceEl, text, cursorPos, onSave) {
    if (_active) return;
    if (!_container) _createUI();

    _sourceEl = sourceEl;
    _onSave = onSave;
    _originalText = text;

    _textarea.value = text;
    _container.style.display = 'flex';
    _active = true;

    // Defer focus so FocusManager picks it up cleanly
    var pos = cursorPos || 0;
    setTimeout(function () {
      _textarea.focus();
      _textarea.selectionStart = _textarea.selectionEnd = pos;
    }, 0);
  }

  function close(save) {
    if (!_active) return;

    if (save && _onSave) {
      _onSave(_textarea.value);
    }

    _container.style.display = 'none';
    _active = false;

    // Re-focus source element
    var el = _sourceEl;
    _sourceEl = null;
    _onSave = null;
    _originalText = '';

    if (el && el.isConnected) {
      setTimeout(function () { el.focus(); }, 0);
    }
  }

  function write() {
    if (!_active || !_onSave) return;
    _onSave(_textarea.value);
    _originalText = _textarea.value;
  }

  function isActive() {
    return _active;
  }

  function isScratchTextarea(el) {
    return el === _textarea;
  }

  window.InputVim = window.InputVim || {};
  window.InputVim.ScratchBuffer = {
    open: open,
    close: close,
    write: write,
    isActive: isActive,
    isScratchTextarea: isScratchTextarea
  };
})();
