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
  var _editorWrap = null;
  var _gutter = null;
  var _textarea = null;
  var _label = null;
  var _active = false;
  var _originalText = '';
  var _lineNumMode = 'relative';

  var FONT = 'monospace';
  var FONT_SIZE = '14px';
  var LINE_HEIGHT = '1.5';
  var PAD = '16px';

  function _getLineNumMode() {
    var S = window.InputVim && window.InputVim.Settings;
    if (S) return S.get('lineNumbers') || 'relative';
    return 'relative';
  }

  function _createUI() {
    _container = document.createElement('div');
    _container.style.cssText =
      'position:fixed;top:0;left:0;width:100vw;height:100vh;' +
      'z-index:2147483646;background:rgba(0,0,0,0.88);display:none;' +
      'flex-direction:column;align-items:center;justify-content:center;';

    _label = document.createElement('div');
    _label.style.cssText =
      'color:#888;font-family:' + FONT + ';font-size:12px;margin-bottom:6px;' +
      'user-select:none;';
    _label.textContent = ':e scratch buffer \u2014 :wq save, :q! discard';
    _container.appendChild(_label);

    // Wrapper holds gutter + textarea side by side
    _editorWrap = document.createElement('div');
    _editorWrap.style.cssText =
      'display:flex;width:80vw;max-width:900px;height:70vh;' +
      'border:1px solid #555;border-radius:4px;overflow:hidden;box-sizing:border-box;';

    // Line number gutter
    _gutter = document.createElement('div');
    _gutter.style.cssText =
      'background:#1a1a1a;color:#555;font-family:' + FONT + ';font-size:' + FONT_SIZE + ';' +
      'line-height:' + LINE_HEIGHT + ';padding:' + PAD + ' 8px ' + PAD + ' 8px;' +
      'text-align:right;overflow:hidden;user-select:none;box-sizing:border-box;' +
      'min-width:40px;border-right:1px solid #333;white-space:pre;';

    _textarea = document.createElement('textarea');
    _textarea.style.cssText =
      'flex:1;background:#1e1e1e;color:#d4d4d4;' +
      'font-family:' + FONT + ';font-size:' + FONT_SIZE + ';line-height:' + LINE_HEIGHT + ';' +
      'padding:' + PAD + ';resize:none;outline:none;border:none;' +
      'tab-size:4;white-space:pre-wrap;word-wrap:break-word;box-sizing:border-box;';
    _textarea.setAttribute('data-input-vim-scratch', 'true');
    _textarea.setAttribute('spellcheck', 'false');
    _textarea.setAttribute('autocomplete', 'off');
    _textarea.setAttribute('autocorrect', 'off');
    _textarea.setAttribute('autocapitalize', 'off');

    _editorWrap.appendChild(_gutter);
    _editorWrap.appendChild(_textarea);
    _container.appendChild(_editorWrap);
    document.documentElement.appendChild(_container);

    // Update line numbers on content or cursor changes
    _textarea.addEventListener('input', function () {
      _cachedText = null;
      _updateLineNumbers();
    });
    _textarea.addEventListener('scroll', _updateLineNumbers);
    // selectionchange fires when vim moves the cursor programmatically
    // (keydown/keyup are blocked by event-interceptor, so they never reach here)
    document.addEventListener('selectionchange', function () {
      if (_active && document.activeElement === _textarea) _updateLineNumbers();
    });
  }

  function _getVisualLines() {
    var IH = window.InputVim && window.InputVim.InputHandler;
    if (IH && IH.getElementVisualLines) {
      return IH.getElementVisualLines(_textarea);
    }
    return null;
  }

  function _getCursorVisualRow(vLines) {
    var pos = _textarea.selectionStart;
    // Search from the end — the last visual line whose start <= pos is the one
    // the cursor is on. This avoids boundary ambiguity at wrap points where
    // vLines[N].end === vLines[N+1].start.
    for (var i = vLines.length - 1; i >= 0; i--) {
      if (pos >= vLines[i].start) return i;
    }
    return 0;
  }

  function _updateLineNumbers() {
    if (!_active) return;
    _lineNumMode = _getLineNumMode();

    if (_lineNumMode === 'off') {
      _gutter.style.display = 'none';
      return;
    }
    _gutter.style.display = '';

    var vLines = _getVisualLines();
    if (!vLines || vLines.length === 0) return;

    var cursorVisRow = _getCursorVisualRow(vLines);
    var maxWidth = String(vLines.length).length;

    // Build a label for every visual line
    var parts = [];
    for (var i = 0; i < vLines.length; i++) {
      var label;
      var isCurrent = i === cursorVisRow;
      if (_lineNumMode === 'relative') {
        label = isCurrent ? String(i + 1) : String(Math.abs(i - cursorVisRow));
      } else {
        label = String(i + 1);
      }
      if (label.length > maxWidth) maxWidth = label.length;
      while (label.length < maxWidth) label = ' ' + label;
      if (isCurrent) {
        parts.push('<span style="color:#d4d4d4;">' + label + '</span>');
      } else {
        parts.push(label);
      }
    }
    _gutter.innerHTML = parts.join('\n');

    // Adjust gutter width based on digit count
    _gutter.style.minWidth = Math.max(40, (maxWidth + 2) * 8.4) + 'px';

    // Keep scroll synced
    _gutter.scrollTop = _textarea.scrollTop;
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
      _updateLineNumbers();
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
