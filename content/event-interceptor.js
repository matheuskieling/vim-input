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
      if (_blocked) { killEvent(e); _blocked = false; return; }
      // Escape fallback: if keydown was swallowed by the page, handle Escape on keyup
      if (e.key === 'Escape') {
        handleEscapeFallback(e);
      }
    }, true);
    document.addEventListener('keyup', function (e) {
      if (_blocked) killEvent(e);
    }, true);
    document.addEventListener('keydown', blockIfBlocked, true);
    window.addEventListener('beforeinput', function (e) {
      // Scratch buffer write-back uses execCommand which fires beforeinput;
      // the bypass flag lets those events through to the target editor.
      if (window.InputVim._bypassInputBlock) return;
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
      // FIX: Framework editors must bypass execCommand for text insertion
      // WHY: execCommand('insertText') fires beforeinput that CKEditor may mishandle for whitespace
      // WARNING: Removing the framework branch breaks Tab in Teams/CKEditor editors
      var _isFwTab = window.InputVim.isFrameworkEditor && window.InputVim.isFrameworkEditor(el);
      if (_isFwTab && window.InputVim.bridgeExec) {
        window.InputVim.bridgeExec(el, 'insertText', { text: spaces });
      } else {
        var tabBefore = el.innerHTML;
        document.execCommand('insertText', false, spaces);
        if (el.innerHTML === tabBefore && window.InputVim.bridgeExec) {
          window.InputVim.bridgeExec(el, 'insertText', { text: spaces });
        }
      }
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
      // FIX: Framework editors (CKEditor 5 in Teams, etc.) must use the bridge
      //   instead of execCommand, because execCommand('insertParagraph') fires a
      //   beforeinput event that CKEditor maps to its enter command — which Teams
      //   overrides to send messages instead of inserting a new line.
      // WHY: execCommand is NOT a no-op in CKEditor; it triggers Teams' send behavior
      // WARNING: Removing the framework branch will break Enter in Teams/CKEditor editors
      var _isFwEnter = window.InputVim.isFrameworkEditor && window.InputVim.isFrameworkEditor(el);
      var _bridgeEnter = _isFwEnter ? window.InputVim.bridgeExec : null;

      if (_isFwEnter && _bridgeEnter) {
        // Framework editor path: use bridge for all mutations
        if (!autoIndent) {
          _bridgeEnter(el, 'insertParagraph');
          return;
        }

        var selFw = window.getSelection();
        if (!selFw.rangeCount) return;
        var rangeFw = selFw.getRangeAt(0);
        var startNodeFw = rangeFw.startContainer;
        var startOffFw = rangeFw.startOffset;

        var blockNodeFw = startNodeFw;
        if (blockNodeFw.nodeType === 3) blockNodeFw = blockNodeFw.parentNode;
        while (blockNodeFw && blockNodeFw !== el &&
               !(/^(P|DIV|LI|H[1-6]|PRE|BLOCKQUOTE)$/.test(blockNodeFw.tagName))) {
          blockNodeFw = blockNodeFw.parentNode;
        }

        var blockTextFw = (blockNodeFw && blockNodeFw !== el) ? blockNodeFw.textContent : '';
        var charBeforeFw = '';
        if (startNodeFw.nodeType === 3 && startOffFw > 0) {
          charBeforeFw = startNodeFw.textContent[startOffFw - 1];
        }
        var charAfterFw = '';
        if (startNodeFw.nodeType === 3 && startOffFw < startNodeFw.textContent.length) {
          charAfterFw = startNodeFw.textContent[startOffFw];
        }

        // Split braces in framework editors
        if (smartIndent && charBeforeFw === '{' && charAfterFw === '}') {
          var baseIndFw = TU.computeNewLineIndent(blockTextFw, false, tabSize);
          var smartIndFw = TU.computeNewLineIndent(blockTextFw, true, tabSize);
          _bridgeEnter(el, 'deleteForward', { count: 1 });
          _bridgeEnter(el, 'insertParagraph');
          if (smartIndFw) _bridgeEnter(el, 'insertText', { text: smartIndFw });
          _bridgeEnter(el, 'insertParagraph');
          _bridgeEnter(el, 'insertText', { text: baseIndFw + '}' });
          // Move cursor back to the indented middle line
          var selBack = window.getSelection();
          selBack.modify('move', 'backward', 'line');
          selBack.modify('move', 'forward', 'lineboundary');
          return;
        }

        var doSmartFw = smartIndent && charBeforeFw === '{';
        var indentFw = TU.computeNewLineIndent(blockTextFw, doSmartFw, tabSize);

        _bridgeEnter(el, 'insertParagraph');
        if (indentFw) _bridgeEnter(el, 'insertText', { text: indentFw });
        return;
      }

      // Non-framework contenteditable path (unchanged)
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
      // FIX: Use Range-based character detection to work across span boundaries
      // WHY: CodeMirror wraps brackets in <span class="cm-matchingBracket">, so the cursor
      //   may sit at a text node boundary or between element nodes; text-node-only
      //   detection misses the char before/after the cursor, breaking smart indent after {
      // WARNING: Removing this breaks smart indent after { in CodeMirror-based editors
      var charBeforeCE = '';
      var charAfterCE = '';
      if (blockNode && blockNode !== el) {
        try {
          var preRangeCE = document.createRange();
          preRangeCE.setStart(blockNode, 0);
          preRangeCE.setEnd(startNode, startOff);
          var preTextCE = preRangeCE.toString();
          if (preTextCE.length > 0) charBeforeCE = preTextCE[preTextCE.length - 1];
        } catch (e) {}
        try {
          var postRangeCE = document.createRange();
          postRangeCE.setStart(startNode, startOff);
          postRangeCE.setEnd(blockNode, blockNode.childNodes.length);
          var postTextCE = postRangeCE.toString();
          if (postTextCE.length > 0) charAfterCE = postTextCE[0];
        } catch (e) {}
      } else {
        if (startNode.nodeType === 3 && startOff > 0) {
          charBeforeCE = startNode.textContent[startOff - 1];
        }
        if (startNode.nodeType === 3 && startOff < startNode.textContent.length) {
          charAfterCE = startNode.textContent[startOff];
        }
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
      if (indentCE) {
        // FIX: Check if editor already auto-indented after insertParagraph
        // WHY: CodeMirror intercepts insertParagraph and may run its own auto-indent,
        //   so inserting our full indent on top would double the indentation
        // WARNING: Removing this will cause doubled indentation in CodeMirror-based editors
        var selAfterCE = window.getSelection();
        if (selAfterCE.rangeCount) {
          var rangeAfterCE = selAfterCE.getRangeAt(0);
          var newBlockCE = rangeAfterCE.startContainer;
          if (newBlockCE.nodeType === 3) newBlockCE = newBlockCE.parentNode;
          while (newBlockCE && newBlockCE !== el &&
                 !(/^(P|DIV|LI|H[1-6]|PRE|BLOCKQUOTE)$/.test(newBlockCE.tagName))) {
            newBlockCE = newBlockCE.parentNode;
          }
          var newBlockTextCE = (newBlockCE && newBlockCE !== el) ? newBlockCE.textContent : '';
          var existMatchCE = newBlockTextCE.match(/^(\s*)/);
          var existLenCE = existMatchCE ? existMatchCE[1].length : 0;
          if (existLenCE < indentCE.length) {
            var diffCE = indentCE.substring(existLenCE);
            document.execCommand('insertText', false, diffCE);
          }
        }
      }
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

  // ── Framework editor fallback helpers ────────────────
  // Used ONLY when document.execCommand is a no-op (e.g., CKEditor 5 in Teams).
  // Tries the page-bridge (MAIN world CKEditor API) first, then synthetic
  // beforeinput events, then direct DOM manipulation as a last resort.

  function _tryInsertParagraphFallback(el) {
    // Strategy 0: page-bridge → CKEditor API (most reliable)
    var bridge = window.InputVim.bridgeExec;
    if (bridge && bridge(el, 'insertParagraph')) return true;

    var before = el.innerHTML;

    // Strategy 1: synthetic beforeinput — insertParagraph
    el.dispatchEvent(new InputEvent('beforeinput', {
      inputType: 'insertParagraph',
      bubbles: true,
      cancelable: true,
      composed: true
    }));
    if (el.innerHTML !== before) return true;

    // Strategy 2: synthetic beforeinput — insertLineBreak
    el.dispatchEvent(new InputEvent('beforeinput', {
      inputType: 'insertLineBreak',
      bubbles: true,
      cancelable: true,
      composed: true
    }));
    if (el.innerHTML !== before) return true;

    // Strategy 3: direct DOM <br> insertion + input event notification
    var sel = window.getSelection();
    if (!sel.rangeCount) return false;
    var range = sel.getRangeAt(0);
    range.deleteContents();
    var br = document.createElement('br');
    range.insertNode(br);
    range.setStartAfter(br);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    el.dispatchEvent(new InputEvent('input', {
      inputType: 'insertLineBreak',
      bubbles: true
    }));
    return true;
  }

  function _tryInsertTextFallback(el, text) {
    // Strategy 0: page-bridge → CKEditor API (most reliable)
    var bridge = window.InputVim.bridgeExec;
    if (bridge && bridge(el, 'insertText', { text: text })) return true;

    var before = el.innerHTML;

    // Strategy 1: synthetic beforeinput — insertText
    el.dispatchEvent(new InputEvent('beforeinput', {
      inputType: 'insertText',
      data: text,
      bubbles: true,
      cancelable: true,
      composed: true
    }));
    if (el.innerHTML !== before) return true;

    // Strategy 2: direct DOM text node insertion + input event notification
    var sel = window.getSelection();
    if (!sel.rangeCount) return false;
    var range = sel.getRangeAt(0);
    range.deleteContents();
    var textNode = document.createTextNode(text);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    el.dispatchEvent(new InputEvent('input', {
      inputType: 'insertText',
      data: text,
      bubbles: true
    }));
    return true;
  }

  // ── Command-line execution ─────────────────────────

  function executeCmdLine(cmd, el) {
    var SB = window.InputVim.ScratchBuffer;

    // ── Scratch buffer commands ──────────────────────
    if (SB && SB.isActive()) {
      if (cmd === 'wq' || cmd === 'x') {
        SB.close(true);
        return;
      }
      if (cmd === 'w') {
        SB.write();
        return;
      }
      if (cmd === 'q!' || cmd === 'q') {
        SB.close(false);
        return;
      }
      // Don't open nested scratch buffers
      if (cmd === 'e') return;
    }

    // ── Open scratch buffer ──────────────────────────
    if (cmd === 'e' && SB) {
      var handler = _getHandler(el);
      if (!handler) return;

      var text = handler.getFullText(el);
      var cursorPos = handler.getCursorPosition(el);

      SB.open(el, text, cursorPos, function (newText) {
        handler.setFullText(el, newText);
      });
      return;
    }

    if (cmd === 'q' || cmd === 'q!' || cmd === 'wq') {
      window.InputVim.FocusManager.deactivate();
    }
  }

  // ── Escape fallback (keyup) ─────────────────────────
  // Some sites (e.g. GitHub) swallow Escape on keydown via stopImmediatePropagation,
  // so our keydown handler never fires. This keyup fallback handles Escape in that case.

  function handleEscapeFallback(e) {
    var el = _getActiveElement();
    if (!el) return;

    // 1. Clear transient state (search, cmdline, pending cmd)
    if (_searchActive || _cmdLineActive || _engine.parser.getPending().length > 0) {
      killEvent(e);
      clearTransientState();
      _engine.parser.reset();
      _overlay.updateCmd('');
      return;
    }

    // 2. Exit visual/insert → normal
    if (_engine.mode !== Mode.NORMAL) {
      killEvent(e);
      var handler = _getHandler(el);
      var command = _engine.handleKey('Escape');
      if (command && handler) handler.execute(el, command, _engine);
      _updateCursor();
      return;
    }

    // 3. Normal mode, nothing to cancel → do nothing (no blur)
  }

  // ── Keydown handler ─────────────────────────────────

  function hasTransientState() {
    return _searchActive || _cmdLineActive || _engine.parser.getPending().length > 0;
  }

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
        // FIX: Snapshot DOM to detect framework editor failures, then fall back if needed
        // WHY: Framework editors (CKEditor 5 in Teams, etc.) ignore execCommand entirely
        // WARNING: Removing the fallback breaks Enter in Teams and similar framework editors
        var _ceEnter = window.InputVim.ElementDetector.isContentEditable(el);
        var _enterSnap = _ceEnter ? el.innerHTML : null;
        insertNewlineWithIndent(el);
        if (_enterSnap !== null && el.innerHTML === _enterSnap) {
          _tryInsertParagraphFallback(el);
        }
        return;
      }
      if (Settings.get('matchBrackets') && BRACKET_PAIRS[key]) {
        _blocked = true;
        killEvent(e);
        // FIX: For framework editors, skip insertBracketPair (it corrupts Selection
        //       after the no-op execCommand) and use the bridge to insert the pair.
        // WHY: insertBracketPair uses execCommand which CKEditor intercepts via beforeinput;
        //       the bridge inserts both chars and positions cursor between them.
        // WARNING: Removing this breaks bracket pairing in framework editors like Teams
        var _isFwBrk = window.InputVim.isFrameworkEditor &&
          window.InputVim.ElementDetector.isContentEditable(el) &&
          window.InputVim.isFrameworkEditor(el);
        if (_isFwBrk) {
          if (window.InputVim.bridgeExec) {
            var pair = key + BRACKET_PAIRS[key];
            window.InputVim.bridgeExec(el, 'insertText', { text: pair });
            // Move cursor back between the brackets
            var selBrk = window.getSelection();
            selBrk.modify('move', 'backward', 'character');
          }
          return;
        }
        // FIX: Snapshot DOM to detect framework editor failures, then fall back if needed
        // WHY: Framework editors (CKEditor 5 in Teams, etc.) ignore execCommand entirely
        // WARNING: Removing the fallback breaks bracket typing in framework editors
        var _ceBrk = window.InputVim.ElementDetector.isContentEditable(el);
        var _brkSnap = _ceBrk ? el.innerHTML : null;
        insertBracketPair(el, key, BRACKET_PAIRS[key]);
        if (_brkSnap !== null && el.innerHTML === _brkSnap) {
          _tryInsertTextFallback(el, key);
        }
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
        // FIX: For framework editors, skip quote pair logic and insert the pair via bridge.
        // WHY: insertBracketPair uses execCommand which CKEditor intercepts via beforeinput;
        //       the bridge inserts both quotes and positions cursor between them.
        // WARNING: Removing this breaks quote pairing in framework editors like Teams
        var _isFwQt = window.InputVim.isFrameworkEditor &&
          window.InputVim.ElementDetector.isContentEditable(el) &&
          window.InputVim.isFrameworkEditor(el);
        if (_isFwQt) {
          _blocked = true;
          killEvent(e);
          if (window.InputVim.bridgeExec) {
            var quotePair = key + key;
            window.InputVim.bridgeExec(el, 'insertText', { text: quotePair });
            var selQt = window.getSelection();
            selQt.modify('move', 'backward', 'character');
          }
          return;
        }
        if (!skipClosingBracket(el, key)) {
          _blocked = true;
          killEvent(e);
          // FIX: Snapshot DOM to detect framework editor failures, then fall back if needed
          // WHY: Framework editors (CKEditor 5 in Teams, etc.) ignore execCommand entirely
          // WARNING: Removing the fallback breaks quote typing in framework editors
          var _ceQt = window.InputVim.ElementDetector.isContentEditable(el);
          var _qtSnap = _ceQt ? el.innerHTML : null;
          insertBracketPair(el, key, key);
          if (_qtSnap !== null && el.innerHTML === _qtSnap) {
            _tryInsertTextFallback(el, key);
          }
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

    // '/' and '?' activate search mode (clears pending command first)
    if (key === '/' || key === '?') {
      _blocked = true;
      killEvent(e);
      _engine.parser.reset();
      _overlay.updateCmd('');
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

    // Escape: check transient state again (safety net in case the early check didn't catch it)
    if (key === 'Escape' && hasTransientState()) {
      _blocked = true;
      killEvent(e);
      clearTransientState();
      _engine.parser.reset();
      _overlay.updateCmd('');
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
    if (command.type === CommandType.PASTE || command.type === CommandType.PASTE_BEFORE || command.type === CommandType.VISUAL_PASTE) {
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

  function clearTransientState() {
    if (_searchActive) {
      _searchActive = false;
      _searchText = '';
      _overlay.hideCmdLine();
    }
    if (_cmdLineActive) {
      _cmdLineActive = false;
      _cmdLineText = '';
      _overlay.hideCmdLine();
    }
  }

  window.InputVim = window.InputVim || {};
  function isSearchOrCmdActive() {
    return _searchActive || _cmdLineActive;
  }

  window.InputVim.EventInterceptor = {
    init: init,
    clearTransientState: clearTransientState,
    hasTransientState: hasTransientState,
    isSearchOrCmdActive: isSearchOrCmdActive,
  };
})();
