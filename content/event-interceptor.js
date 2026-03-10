(function () {
  'use strict';

  var Mode = window.InputVim.Mode;
  var CommandType = window.InputVim.CommandType;
  var OperatorType = window.InputVim.OperatorType;

  var BRACKET_PAIRS = { '(': ')', '{': '}', '[': ']' };
  var CLOSING_BRACKETS = { ')': '(', '}': '{', ']': '[' };

  var _blocked = false;
  var _engine = null;
  var _overlay = null;
  var _getActiveElement = null;
  var _getHandler = null;
  var _updateCursor = null;
  var _markFocusSteal = null;
  var _cmdLineActive = false;
  var _cmdLineText = '';

  function init(engine, overlay, getActiveElement, getHandler, updateCursor, markFocusSteal) {
    _engine = engine;
    _overlay = overlay;
    _getActiveElement = getActiveElement;
    _getHandler = getHandler;
    _updateCursor = updateCursor;
    _markFocusSteal = markFocusSteal;

    window.addEventListener('keydown', handleKeydown, true);
    window.addEventListener('keypress', blockIfBlocked, true);
    document.addEventListener('keypress', blockIfBlocked, true);
    window.addEventListener('keyup', function (e) {
      if (_blocked) { killEvent(e); _blocked = false; }
    }, true);
    document.addEventListener('keyup', function (e) {
      if (_blocked) killEvent(e);
    }, true);
    document.addEventListener('keydown', blockIfBlocked, true);
    window.addEventListener('beforeinput', function (e) {
      var el = _getActiveElement();
      if (!el) return;
      if (_engine.mode !== Mode.INSERT) killEvent(e);
    }, true);
  }

  function killEvent(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  function blockIfBlocked(e) {
    if (_blocked) killEvent(e);
  }

  // ── Tab helper ─────────────────────────────────────

  function insertTab(el) {
    var Settings = window.InputVim.Settings;
    var tabSize = Settings.get('tabSize');
    var spaces = '';
    for (var i = 0; i < tabSize; i++) spaces += ' ';

    var ED = window.InputVim.ElementDetector;
    if (ED.isTextInput(el)) {
      var pos = el.selectionStart;
      var val = el.value;
      el.value = val.substring(0, pos) + spaces + val.substring(el.selectionEnd);
      el.selectionStart = el.selectionEnd = pos + tabSize;
      el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    } else if (ED.isContentEditable(el)) {
      document.execCommand('insertText', false, spaces);
    }
  }

  // ── Bracket matching helpers ────────────────────────

  function insertBracketPair(el, open, close) {
    var ED = window.InputVim.ElementDetector;
    if (ED.isTextInput(el)) {
      var pos = el.selectionStart;
      var val = el.value;
      el.value = val.substring(0, pos) + open + close + val.substring(pos);
      el.selectionStart = el.selectionEnd = pos + 1;
      el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    } else if (ED.isContentEditable(el)) {
      document.execCommand('insertText', false, open + close);
      var sel = window.getSelection();
      if (sel.rangeCount) {
        var range = sel.getRangeAt(0);
        range.setStart(range.startContainer, range.startOffset - 1);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
  }

  function skipClosingBracket(el, bracket) {
    var ED = window.InputVim.ElementDetector;
    if (ED.isTextInput(el)) {
      var pos = el.selectionStart;
      if (pos < el.value.length && el.value[pos] === bracket) {
        el.selectionStart = el.selectionEnd = pos + 1;
        return true;
      }
    } else if (ED.isContentEditable(el)) {
      var sel = window.getSelection();
      if (!sel.rangeCount) return false;
      var range = sel.getRangeAt(0);
      var node = range.startContainer;
      var offset = range.startOffset;
      if (node.nodeType === 3 && offset < node.textContent.length && node.textContent[offset] === bracket) {
        range.setStart(node, offset + 1);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        return true;
      }
    }
    return false;
  }

  // ── Command-line execution ─────────────────────────

  function executeCmdLine(cmd, el) {
    if (cmd === 'q') {
      window.InputVim.FocusManager.deactivate();
    }
  }

  // ── Keydown handler ─────────────────────────────────

  function handleKeydown(e) {
    _blocked = false;

    var el = _getActiveElement();
    var Settings = window.InputVim.Settings;
    if (!el || !Settings.get('enabled')) return;
    if (Settings.isPageExcluded()) return;

    var handler = _getHandler(el);
    if (!handler) return;

    // Command-line mode key handling
    if (_cmdLineActive) {
      _blocked = true;
      killEvent(e);
      var clKey = e.key;
      if (clKey === 'Escape') {
        _cmdLineActive = false;
        _cmdLineText = '';
        _overlay.hideCmdLine();
        return;
      }
      if (clKey === 'Enter') {
        var cmd = _cmdLineText;
        _cmdLineActive = false;
        _cmdLineText = '';
        _overlay.hideCmdLine();
        executeCmdLine(cmd, el);
        return;
      }
      if (clKey === 'Backspace') {
        _cmdLineText = _cmdLineText.substring(0, _cmdLineText.length - 1);
        if (_cmdLineText.length === 0) {
          _cmdLineActive = false;
          _overlay.hideCmdLine();
        } else {
          _overlay.showCmdLine(':' + _cmdLineText);
        }
        return;
      }
      if (clKey.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        _cmdLineText += clKey;
        _overlay.showCmdLine(':' + _cmdLineText);
      }
      return;
    }

    // Ctrl+R in normal mode → redo
    if (e.ctrlKey && e.key === 'r' && _engine.mode !== Mode.INSERT) {
      _blocked = true;
      killEvent(e);
      var redoCmd = { type: CommandType.REDO, count: 1 };
      handler.execute(el, redoCmd, _engine);
      _updateCursor();
      return;
    }

    // Block paste (Ctrl+V / Cmd+V) outside insert mode
    if ((e.ctrlKey || e.metaKey) && e.key === 'v' && _engine.mode !== Mode.INSERT) {
      _blocked = true;
      killEvent(e);
      return;
    }

    // Ctrl+D / Ctrl+U — half-page scroll jump (non-insert mode)
    if (e.ctrlKey && (e.key === 'd' || e.key === 'u') && _engine.mode !== Mode.INSERT) {
      _blocked = true;
      killEvent(e);
      var scrollCmd = {
        type: e.key === 'd' ? CommandType.SCROLL_DOWN : CommandType.SCROLL_UP,
        count: Settings.get('halfPageJump'),
      };
      handler.execute(el, scrollCmd, _engine);
      if ((_engine.mode === Mode.VISUAL || _engine.mode === Mode.VISUAL_LINE)) {
        var ED = window.InputVim.ElementDetector;
        if (ED.isTextInput(el)) {
          _engine.visualHead = el.selectionStart;
          var anchor = _engine.visualAnchor;
          var head = _engine.visualHead;
          if (_engine.mode === Mode.VISUAL) {
            if (head >= anchor) {
              el.selectionStart = anchor;
              el.selectionEnd = head + 1;
            } else {
              el.selectionStart = head;
              el.selectionEnd = anchor + 1;
            }
          }
        }
      }
      _updateCursor();
      return;
    }

    // Ignore modifier combos
    if (e.ctrlKey || e.metaKey || e.altKey) {
      _markFocusSteal();
      return;
    }

    var key = e.key;

    if (key === 'Shift' || key === 'Control' || key === 'Alt' || key === 'Meta') return;

    // Insert mode: only intercept Escape, Tab, and bracket matching
    if (_engine.mode === Mode.INSERT) {
      if (key === 'Tab') {
        _blocked = true;
        killEvent(e);
        insertTab(el);
        return;
      }
      if (Settings.get('matchBrackets') && BRACKET_PAIRS[key]) {
        _blocked = true;
        killEvent(e);
        insertBracketPair(el, key, BRACKET_PAIRS[key]);
        return;
      }
      if (Settings.get('matchBrackets') && CLOSING_BRACKETS[key]) {
        if (skipClosingBracket(el, key)) {
          _blocked = true;
          killEvent(e);
          return;
        }
      }
      if (key !== 'Escape') return;
    }

    // ':' activates command-line mode
    if (key === ':') {
      _blocked = true;
      killEvent(e);
      _cmdLineActive = true;
      _cmdLineText = '';
      _overlay.showCmdLine(':');
      return;
    }

    _blocked = true;
    killEvent(e);

    var command = _engine.handleKey(key);
    _overlay.updateCmd(_engine.parser.getPending());

    if (!command) return;

    // Handle visual mode motion (extend selection)
    if ((_engine.mode === Mode.VISUAL || _engine.mode === Mode.VISUAL_LINE) && command.type === CommandType.MOTION) {
      handler.extendVisualSelection(el, command, _engine);
      _updateCursor();
      return;
    }

    // Handle text object in visual mode
    if ((_engine.mode === Mode.VISUAL || _engine.mode === Mode.VISUAL_LINE) && command.type === CommandType.TEXT_OBJECT) {
      handler.selectTextObject(el, command, _engine);
      _updateCursor();
      return;
    }

    // Handle visual 'o' — anchor/head already swapped, just update cursor
    if (command.type === CommandType.VISUAL_SWAP) {
      _updateCursor();
      return;
    }

    // Paste: sync from clipboard first (async)
    if (command.type === CommandType.PASTE || command.type === CommandType.PASTE_BEFORE) {
      var pasteEl = el;
      var pasteHandler = handler;
      var Register = window.InputVim.Register;
      Register.syncFromClipboard(function () {
        pasteHandler.execute(pasteEl, command, _engine);
        _updateCursor();
      });
      return;
    }

    handler.execute(el, command, _engine);
    _updateCursor();

    // Flash yank highlight
    if (Settings.get('highlightYank') && command.operator === OperatorType.YANK) {
      var flashEl = el;
      handler.flashYank(flashEl, function () {
        _updateCursor();
      });
    }
  }

  window.InputVim = window.InputVim || {};
  window.InputVim.EventInterceptor = {
    init: init,
  };
})();
