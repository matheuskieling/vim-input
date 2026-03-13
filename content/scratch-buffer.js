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
  var _mirror = null;
  var _active = false;
  var _originalText = '';
  var _lineNumMode = 'relative';
  var _singleLineH = 0;
  var _cachedText = null;
  var _cachedWraps = null;

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

    // Hidden mirror div — same font/wrapping as textarea, used to measure
    // how many visual lines each logical line occupies.
    _mirror = document.createElement('div');
    _mirror.style.cssText =
      'position:absolute;left:-9999px;top:-9999px;visibility:hidden;' +
      'font-family:' + FONT + ';font-size:' + FONT_SIZE + ';line-height:' + LINE_HEIGHT + ';' +
      'white-space:pre-wrap;word-wrap:break-word;box-sizing:content-box;' +
      'tab-size:4;padding:0;margin:0;border:none;overflow:hidden;';

    _editorWrap.appendChild(_gutter);
    _editorWrap.appendChild(_textarea);
    _container.appendChild(_editorWrap);
    _container.appendChild(_mirror);
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

  // Measure how many visual lines each logical line takes when wrapped.
  // Cached until text changes.
  function _measureWraps() {
    var text = _textarea.value;
    if (text === _cachedText && _cachedWraps) return _cachedWraps;

    // Set mirror width to match textarea's content area
    var cs = getComputedStyle(_textarea);
    var contentW = _textarea.clientWidth -
      parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    _mirror.style.width = contentW + 'px';

    // Measure single-line height if needed
    if (!_singleLineH) {
      _mirror.textContent = 'X';
      _singleLineH = _mirror.offsetHeight;
    }

    var lines = text.split('\n');
    var wraps = [];

    // Build all line divs at once, then measure (single reflow)
    _mirror.innerHTML = '';
    for (var i = 0; i < lines.length; i++) {
      var div = document.createElement('div');
      div.textContent = lines[i] || '\u00a0';
      _mirror.appendChild(div);
    }
    var children = _mirror.children;
    for (var j = 0; j < children.length; j++) {
      wraps.push(Math.max(1, Math.round(children[j].offsetHeight / _singleLineH)));
    }

    _cachedText = text;
    _cachedWraps = wraps;
    return wraps;
  }

  function _getCursorLine() {
    var text = _textarea.value.substring(0, _textarea.selectionStart);
    return text.split('\n').length;
  }

  function _updateLineNumbers() {
    if (!_active) return;
    _lineNumMode = _getLineNumMode();

    if (_lineNumMode === 'off') {
      _gutter.style.display = 'none';
      return;
    }
    _gutter.style.display = '';

    var wraps = _measureWraps();
    var cursorLine = _getCursorLine();
    var entries = [];
    var maxWidth = 1;

    for (var i = 0; i < wraps.length; i++) {
      var lineNum = i + 1;
      var label;
      if (_lineNumMode === 'relative') {
        label = lineNum === cursorLine ? String(lineNum) : String(Math.abs(lineNum - cursorLine));
      } else {
        label = String(lineNum);
      }
      if (label.length > maxWidth) maxWidth = label.length;
      entries.push({ label: label, current: lineNum === cursorLine });
      // Blank rows for wrapped visual lines
      for (var w = 1; w < wraps[i]; w++) {
        entries.push({ label: '', current: false });
      }
    }

    // Render gutter
    var parts = [];
    for (var k = 0; k < entries.length; k++) {
      var n = entries[k].label;
      while (n.length < maxWidth) n = ' ' + n;
      if (entries[k].current) {
        parts.push('<span style="color:#d4d4d4;">' + n + '</span>');
      } else {
        parts.push(n);
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
    _cachedText = null;
    _cachedWraps = null;
    _singleLineH = 0;

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
