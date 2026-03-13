(function () {
  'use strict';

  var Mode = window.InputVim.Mode;
  var CommandType = window.InputVim.CommandType;
  var OperatorType = window.InputVim.OperatorType;

  var BRACKET_PAIRS = { '(': ')', '{': '}', '[': ']' };
  var CLOSING_BRACKETS = { ')': '(', '}': '{', ']': '[' };
  var QUOTE_PAIRS = { '"': '"', "'": "'", '`': '`' };

  var _blocked = false;
  var _engine = null;
  var _overlay = null;
  var _getActiveElement = null;
  var _getHandler = null;
  var _updateCursor = null;
  var _markFocusSteal = null;
  var _cmdLineActive = false;
  var _cmdLineText = '';
  var _searchActive = false;
  var _searchText = '';
  var _searchDirection = '/';

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

  // ── Enter / auto-indent helper ─────────────────────

  function insertNewlineWithIndent(el) {
    var Settings = window.InputVim.Settings;
    var ED = window.InputVim.ElementDetector;
    var TU = window.InputVim.TextUtils;
    var tabSize = Settings.get('tabSize');
    var indentMode = Settings.get('indentMode');
    var autoIndent = indentMode === 'auto' || indentMode === 'smart';
    var smartIndent = indentMode === 'smart';

    if (ED.isTextInput(el)) {
      var pos = el.selectionStart;
      var val = el.value;

      if (!autoIndent) {
        var plain = '\n';
        el.value = val.substring(0, pos) + plain + val.substring(el.selectionEnd);
        el.selectionStart = el.selectionEnd = pos + 1;
        el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        return;
      }

      var lineInfo = TU.getLineInfo(val, pos);
      var charBefore = pos > 0 ? val[pos - 1] : '';
      var charAfter = pos < val.length ? val[pos] : '';

      // FIX: Split braces — Enter between {} creates indented middle line + } on its own line
      // WHY: Typing inside {} should produce the standard block structure
      // WARNING: Removing this makes Enter between {} push } onto the indented line
      if (smartIndent && charBefore === '{' && charAfter === '}') {
        var baseIndent = TU.computeNewLineIndent(lineInfo.lineText, false, tabSize);
        var smartInd = TU.computeNewLineIndent(lineInfo.lineText, true, tabSize);
        var splitInsert = '\n' + smartInd + '\n' + baseIndent;
        el.value = val.substring(0, pos) + splitInsert + val.substring(pos);
        el.selectionStart = el.selectionEnd = pos + 1 + smartInd.length;
        el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        return;
      }

      var doSmart = smartIndent && charBefore === '{';
      var indent = TU.computeNewLineIndent(lineInfo.lineText, doSmart, tabSize);
      var insert = '\n' + indent;
      el.value = val.substring(0, pos) + insert + val.substring(el.selectionEnd);
      el.selectionStart = el.selectionEnd = pos + insert.length;
      el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    } else if (ED.isContentEditable(el)) {
      if (!autoIndent) {
        document.execCommand('insertParagraph');
        return;
      }

      // Determine indentation from current block context
      var sel = window.getSelection();
      if (!sel.rangeCount) return;
      var range = sel.getRangeAt(0);
      var startNode = range.startContainer;
      var startOff = range.startOffset;

      // Find the nearest block ancestor to extract indentation
      var blockNode = startNode;
      if (blockNode.nodeType === 3) blockNode = blockNode.parentNode;
      while (blockNode && blockNode !== el &&
             !(/^(P|DIV|LI|H[1-6]|PRE|BLOCKQUOTE)$/.test(blockNode.tagName))) {
        blockNode = blockNode.parentNode;
      }

      var blockText = (blockNode && blockNode !== el) ? blockNode.textContent : '';
      var charBeforeCE = '';
      if (startNode.nodeType === 3 && startOff > 0) {
        charBeforeCE = startNode.textContent[startOff - 1];
      }
      var charAfterCE = '';
      if (startNode.nodeType === 3 && startOff < startNode.textContent.length) {
        charAfterCE = startNode.textContent[startOff];
      }

      // FIX: Split braces — Enter between {} in contenteditable
      // WHY: Same split-braces behavior as textarea
      // WARNING: Removing this makes Enter between {} push } onto the indented line
      if (smartIndent && charBeforeCE === '{' && charAfterCE === '}') {
        var baseIndentCE = TU.computeNewLineIndent(blockText, false, tabSize);
        var smartIndCE = TU.computeNewLineIndent(blockText, true, tabSize);
        sel.modify('extend', 'forward', 'character');
        document.execCommand('delete');
        document.execCommand('insertParagraph');
        if (smartIndCE) document.execCommand('insertText', false, smartIndCE);
        document.execCommand('insertParagraph');
        document.execCommand('insertText', false, baseIndentCE + '}');
        var sCE = window.getSelection();
        sCE.modify('move', 'backward', 'line');
        sCE.modify('move', 'forward', 'lineboundary');
        return;
      }

      var doSmartCE = smartIndent && charBeforeCE === '{';
      var indentCE = TU.computeNewLineIndent(blockText, doSmartCE, tabSize);

      document.execCommand('insertParagraph');
      if (indentCE) document.execCommand('insertText', false, indentCE);
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

    // Search mode key handling
    if (_searchActive) {
      _blocked = true;
      killEvent(e);
      var sKey = e.key;
      if (sKey === 'Escape') {
        _searchActive = false;
        _searchText = '';
        _overlay.hideCmdLine();
        return;
      }
      if (sKey === 'Enter') {
        var term = _searchText;
        _searchActive = false;
        _searchText = '';
        _overlay.hideCmdLine();
        if (term) {
          window.InputVim.lastSearch = term;
          window.InputVim.lastSearchWholeWord = false;
          window.InputVim.lastSearchForward = _searchDirection === '/';
          var searchMotion = _searchDirection === '/' ? window.InputVim.MotionType.SEARCH_NEXT : window.InputVim.MotionType.SEARCH_PREV;
          var searchCmd = { type: CommandType.MOTION, motion: searchMotion, count: 1 };
          if (_engine.mode === Mode.VISUAL || _engine.mode === Mode.VISUAL_LINE) {
            handler.extendVisualSelection(el, searchCmd, _engine);
          } else {
            handler.execute(el, searchCmd, _engine);
          }
          _updateCursor();
        }
        return;
      }
      if (sKey === 'Backspace') {
        _searchText = _searchText.substring(0, _searchText.length - 1);
        if (_searchText.length === 0) {
          _searchActive = false;
          _overlay.hideCmdLine();
        } else {
          _overlay.showCmdLine(_searchDirection + _searchText);
        }
        return;
      }
      if (sKey.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        _searchText += sKey;
        _overlay.showCmdLine(_searchDirection + _searchText);
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

    // Insert mode: only intercept Escape, Tab, Enter, and bracket matching
    if (_engine.mode === Mode.INSERT) {
      if (key === 'Tab') {
        _blocked = true;
        killEvent(e);
        insertTab(el);
        return;
      }
      // FIX: Always intercept Enter in insert mode; indent behavior is gated by settings
      // WHY: Prevents native Enter from firing (e.g. form submit, Slack send) while in insert mode
      // WARNING: Removing this lets the browser handle Enter natively in insert mode
      if (key === 'Enter') {
        _blocked = true;
        killEvent(e);
        insertNewlineWithIndent(el);
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
      if (Settings.get('matchBrackets') && QUOTE_PAIRS[key]) {
        if (!skipClosingBracket(el, key)) {
          _blocked = true;
          killEvent(e);
          insertBracketPair(el, key, key);
          return;
        }
        _blocked = true;
        killEvent(e);
        return;
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

    // '/' and '?' activate search mode
    if (key === '/' || key === '?') {
      _blocked = true;
      killEvent(e);
      _searchActive = true;
      _searchText = '';
      _searchDirection = key;
      _overlay.showCmdLine(key);
      return;
    }

    // FIX: Let Tab / Shift+Tab and Enter pass through in non-insert modes
    // WHY: User expects native browser behavior (tab between inputs, Enter to submit/send) outside insert mode
    // WARNING: Removing this will cause Tab/Enter to be swallowed in normal/visual modes
    if (key === 'Tab' || key === 'Enter') {
      _markFocusSteal();
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
