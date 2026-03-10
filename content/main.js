(function () {
  'use strict';

  var Mode = window.InputVim.Mode;
  var CommandType = window.InputVim.CommandType;
  var OperatorType = window.InputVim.OperatorType;
  var VimEngine = window.InputVim.VimEngine;
  var InputHandler = window.InputVim.InputHandler;
  var ContentEditableHandler = window.InputVim.ContentEditableHandler;
  var Overlay = window.InputVim.Overlay;
  var Register = window.InputVim.Register;

  var engine = new VimEngine();
  var inputHandler = new InputHandler();
  var ceHandler = new ContentEditableHandler();
  var overlay = new Overlay();

  var activeElement = null;
  var enabled = true;
  var startMode = Mode.INSERT;
  var excludePatterns = [];
  var matchBrackets = false;
  var tabSize = 4;
  var highlightYank = false;
  var halfPageJump = 20;
  var centerOnJump = false;

  var BRACKET_PAIRS = { '(': ')', '{': '}', '[': ']' };
  var CLOSING_BRACKETS = { ')': '(', '}': '{', ']': '[' };

  // Flag: true when we intercepted a keydown and need to also kill
  // the follow-up keypress / beforeinput / keyup events.
  var _blocked = false;

  // Tracks user actions that intentionally move focus away (mouse click,
  // Ctrl+L, etc.) so we can distinguish them from Chrome swallowing Escape.
  var _recentFocusSteal = 0;

  // ── Init ────────────────────────────────────────────

  // At document_start, documentElement exists but body may not.
  // Overlay appends to documentElement so it's fine.
  if (document.documentElement) {
    overlay.init();
  } else {
    document.addEventListener('DOMContentLoaded', function () { overlay.init(); });
  }
  loadSettings();

  // Detect already-focused inputs (e.g. page loads with autofocus)
  function checkExistingFocus() {
    var el = document.activeElement;
    if (el && isVimTarget(el) && el !== activeElement) {
      activateElement(el);
    }
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    checkExistingFocus();
  } else {
    document.addEventListener('DOMContentLoaded', checkExistingFocus);
    // Also try on full load in case focus happens between DOMContentLoaded and load
    window.addEventListener('load', checkExistingFocus);
  }

  function loadSettings() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.get(
        { enabled: true, startMode: 'INSERT', excludePatterns: [], matchBrackets: false, tabSize: 4, useClipboard: false, highlightYank: false },
        function (items) {
          enabled = items.enabled;
          startMode = items.startMode === 'NORMAL' ? Mode.NORMAL : Mode.INSERT;
          excludePatterns = items.excludePatterns || [];
          matchBrackets = items.matchBrackets || false;
          tabSize = items.tabSize || 4;
          highlightYank = items.highlightYank || false;
          Register.setUseClipboard(items.useClipboard || false);
          if (!enabled || isPageExcluded()) {
            deactivate();
          }
        }
      );
    }
  }

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener(function () {
      loadSettings();
    });
  }

  function isPageExcluded() {
    var url = location.href;
    for (var i = 0; i < excludePatterns.length; i++) {
      if (globMatch(excludePatterns[i], url)) return true;
    }
    return false;
  }

  function globMatch(pattern, str) {
    var escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    var regex = escaped.replace(/\*/g, '.*');
    try {
      return new RegExp('^' + regex + '$', 'i').test(str);
    } catch (e) {
      return false;
    }
  }

  function updateCursor(skipScroll) {
    if (!activeElement) return;
    var handler = getHandler(activeElement);
    if (!handler) return;
    if (engine.mode !== Mode.INSERT) {
      // Scroll the element so the cursor stays visible (skip on page-scroll to avoid loops)
      if (!skipScroll && handler.ensureCursorVisible) {
        handler.ensureCursorVisible(activeElement);
      }
      activeElement.style.caretColor = 'transparent';
      var visualPos = (engine.mode === Mode.VISUAL || engine.mode === Mode.VISUAL_LINE)
        ? engine.visualHead : undefined;
      var rect = handler.getCursorRect(activeElement, visualPos);
      if (rect) {
        overlay.showCursor(rect.x, rect.y, rect.width, rect.height);
        // Scroll the page so the cursor line stays in the viewport
        if (!skipScroll) {
          var margin = 10;
          if (rect.y + rect.height > window.innerHeight) {
            window.scrollBy(0, rect.y + rect.height - window.innerHeight + margin);
          } else if (rect.y < 0) {
            window.scrollBy(0, rect.y - margin);
          }
        }
      } else {
        overlay.hideCursor();
      }
    } else {
      activeElement.style.caretColor = '';
      overlay.hideCursor();
    }
  }

  // Reposition cursor overlay on any scroll (page or element)
  window.addEventListener('scroll', function () {
    updateCursor(true);
  }, true);

  function deactivate() {
    if (activeElement) {
      activeElement.style.caretColor = '';
      activeElement.removeAttribute('data-input-vim');
    }
    overlay.hideCursor();
    activeElement = null;
    engine.setMode(Mode.NORMAL);
    engine.parser.reset();
    overlay.hide();
  }

  // ── Element detection ───────────────────────────────

  function isTextInput(el) {
    if (!el) return false;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.tagName === 'INPUT') {
      var type = (el.type || '').toLowerCase();
      // Note: 'email' and 'number' are excluded — Chrome throws DOMException
      // when accessing selectionStart/selectionEnd on those types.
      return !type || type === 'text' || type === 'search' || type === 'url' || type === 'tel' || type === 'password';
    }
    return false;
  }

  function isContentEditable(el) {
    if (!el) return false;
    return el.isContentEditable === true;
  }

  function isVimTarget(el) {
    return isTextInput(el) || isContentEditable(el);
  }

  function getHandler(el) {
    if (isTextInput(el)) return inputHandler;
    if (isContentEditable(el)) return ceHandler;
    return null;
  }

  // ── Focus tracking ──────────────────────────────────

  function activateElement(el) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.get(
        { enabled: true, startMode: 'INSERT', excludePatterns: [], matchBrackets: false, tabSize: 4, useClipboard: false, highlightYank: false, halfPageJump: 20, centerOnJump: false },
        function (items) {
          enabled = items.enabled;
          excludePatterns = items.excludePatterns || [];
          matchBrackets = items.matchBrackets || false;
          tabSize = items.tabSize || 4;
          highlightYank = items.highlightYank || false;
          halfPageJump = items.halfPageJump || 20;
          centerOnJump = items.centerOnJump || false;
          Register.setUseClipboard(items.useClipboard || false);
          if (!enabled || isPageExcluded()) return;

          var mode = items.startMode === 'NORMAL' ? Mode.NORMAL : Mode.INSERT;
          activeElement = el;
          el.setAttribute('data-input-vim', mode);
          engine.setMode(mode);
          engine.parser.reset();
          overlay.show(mode, el);
          updateCursor();
        }
      );
    } else {
      // Fallback (no chrome API, e.g. local test)
      activeElement = el;
      el.setAttribute('data-input-vim', startMode);
      engine.setMode(startMode);
      engine.parser.reset();
      overlay.show(startMode, el);
      updateCursor();
    }
  }

  document.addEventListener('focusin', function (e) {
    var el = e.target;
    // If it's the same element we're already managing, don't re-activate
    // (this would reset mode back to INSERT after a re-focus).
    if (el === activeElement) return;
    if (!isVimTarget(el)) return;
    activateElement(el);
  }, true);

  document.addEventListener('mousedown', function () {
    _recentFocusSteal = Date.now();
  }, true);

  document.addEventListener('focusout', function (e) {
    if (e.target !== activeElement) return;

    // Chrome's native autocomplete UI (Google, GitHub) swallows the Escape
    // keydown before JS sees it, then blurs the input.  Detect this:
    // if we're in any non-NORMAL mode and the user didn't click or use a
    // modifier shortcut (Ctrl+L, etc.), treat the blur as an Escape press.
    if (engine.mode !== Mode.NORMAL && Date.now() - _recentFocusSteal > 300) {
      var el = activeElement;
      var handler = getHandler(el);
      if (handler) {
        var command = engine.handleKey('Escape');
        if (command) handler.execute(el, command, engine);
        updateCursor();
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

  // ── Mode change callback ────────────────────────────

  engine.onModeChange(function (newMode) {
    overlay.update(newMode);
    updateCursor();
    if (activeElement) {
      activeElement.setAttribute('data-input-vim', newMode);
    }
  });

  // ── Block helper: kill an event unconditionally ─────

  function killEvent(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  // ── Tab helper ─────────────────────────────────────

  function insertTab(el) {
    var spaces = '';
    for (var i = 0; i < tabSize; i++) spaces += ' ';

    if (isTextInput(el)) {
      var pos = el.selectionStart;
      var val = el.value;
      el.value = val.substring(0, pos) + spaces + val.substring(el.selectionEnd);
      el.selectionStart = el.selectionEnd = pos + tabSize;
      el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    } else if (isContentEditable(el)) {
      document.execCommand('insertText', false, spaces);
    }
  }

  // ── Bracket matching helpers ────────────────────────

  function insertBracketPair(el, open, close) {
    if (isTextInput(el)) {
      var pos = el.selectionStart;
      var val = el.value;
      el.value = val.substring(0, pos) + open + close + val.substring(pos);
      el.selectionStart = el.selectionEnd = pos + 1;
      el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    } else if (isContentEditable(el)) {
      document.execCommand('insertText', false, open + close);
      // Move cursor back one (between the pair)
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
    if (isTextInput(el)) {
      var pos = el.selectionStart;
      if (pos < el.value.length && el.value[pos] === bracket) {
        el.selectionStart = el.selectionEnd = pos + 1;
        return true;
      }
    } else if (isContentEditable(el)) {
      var text = el.textContent || '';
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

  // ── Keydown handler (capture phase on window) ───────

  window.addEventListener('keydown', function (e) {
    _blocked = false;

    if (!activeElement || !enabled) return;
    if (isPageExcluded()) return;

    var handler = getHandler(activeElement);
    if (!handler) return;

    // Ctrl+R in normal mode → redo
    if (e.ctrlKey && e.key === 'r' && engine.mode !== Mode.INSERT) {
      _blocked = true;
      killEvent(e);
      var redoCmd = { type: CommandType.REDO, count: 1 };
      handler.execute(activeElement, redoCmd, engine);
      updateCursor();
      return;
    }

    // Block paste (Ctrl+V / Cmd+V) outside insert mode
    if ((e.ctrlKey || e.metaKey) && e.key === 'v' && engine.mode !== Mode.INSERT) {
      _blocked = true;
      killEvent(e);
      return;
    }

    // Ctrl+D / Ctrl+U — half-page scroll jump (non-insert mode)
    if (e.ctrlKey && (e.key === 'd' || e.key === 'u') && engine.mode !== Mode.INSERT) {
      _blocked = true;
      killEvent(e);
      var scrollCmd = {
        type: e.key === 'd' ? CommandType.SCROLL_DOWN : CommandType.SCROLL_UP,
        count: halfPageJump,
        center: centerOnJump,
      };
      handler.execute(activeElement, scrollCmd, engine);
      if ((engine.mode === Mode.VISUAL || engine.mode === Mode.VISUAL_LINE)) {
        if (isTextInput(activeElement)) {
          engine.visualHead = activeElement.selectionStart;
          var anchor = engine.visualAnchor;
          var head = engine.visualHead;
          if (engine.mode === Mode.VISUAL) {
            if (head >= anchor) {
              activeElement.selectionStart = anchor;
              activeElement.selectionEnd = head + 1;
            } else {
              activeElement.selectionStart = head;
              activeElement.selectionEnd = anchor + 1;
            }
          }
        }
        // contenteditable: handler already set cursor, just update visualHead
      }
      updateCursor();
      // Center the cursor line on screen if the setting is enabled
      if (centerOnJump) {
        var cRect = handler.getCursorRect(activeElement,
          (engine.mode === Mode.VISUAL || engine.mode === Mode.VISUAL_LINE) ? engine.visualHead : undefined);
        if (cRect) {
          var centerY = cRect.y + cRect.height / 2;
          var screenCenter = window.innerHeight / 2;
          window.scrollBy(0, centerY - screenCenter);
          updateCursor(true);
        }
      }
      return;
    }

    // Ignore modifier combos (Ctrl+C, Cmd+V, etc.)
    // Also mark as intentional focus-steal so focusout doesn't
    // mistake Ctrl+L / Cmd+T for a swallowed Escape.
    if (e.ctrlKey || e.metaKey || e.altKey) {
      _recentFocusSteal = Date.now();
      return;
    }

    var key = e.key;

    // Ignore bare modifier keys (Shift, Control, etc.)
    if (key === 'Shift' || key === 'Control' || key === 'Alt' || key === 'Meta') return;

    // In insert mode, only intercept Escape, Tab, and bracket matching
    if (engine.mode === Mode.INSERT) {
      if (key === 'Tab') {
        _blocked = true;
        killEvent(e);
        insertTab(activeElement);
        return;
      }
      if (matchBrackets && BRACKET_PAIRS[key]) {
        _blocked = true;
        killEvent(e);
        insertBracketPair(activeElement, key, BRACKET_PAIRS[key]);
        return;
      }
      if (matchBrackets && CLOSING_BRACKETS[key]) {
        // Skip over closing bracket if it's the next character
        if (skipClosingBracket(activeElement, key)) {
          _blocked = true;
          killEvent(e);
          return;
        }
      }
      if (key !== 'Escape') return;
    }

    // We are handling this key — block it completely
    _blocked = true;
    killEvent(e);

    var command = engine.handleKey(key);
    overlay.updateCmd(engine.parser.getPending());

    if (!command) return;

    // Handle visual mode motion (extend selection)
    if ((engine.mode === Mode.VISUAL || engine.mode === Mode.VISUAL_LINE) && command.type === CommandType.MOTION) {
      handler.extendVisualSelection(activeElement, command, engine);
      updateCursor();
      return;
    }

    // Handle text object in visual mode (select the range)
    if ((engine.mode === Mode.VISUAL || engine.mode === Mode.VISUAL_LINE) && command.type === CommandType.TEXT_OBJECT) {
      handler.selectTextObject(activeElement, command, engine);
      updateCursor();
      return;
    }

    // For paste commands, sync from clipboard first (async)
    if (command.type === CommandType.PASTE || command.type === CommandType.PASTE_BEFORE) {
      var pasteEl = activeElement;
      var pasteHandler = handler;
      Register.syncFromClipboard(function () {
        pasteHandler.execute(pasteEl, command, engine);
        updateCursor();
      });
      return;
    }

    handler.execute(activeElement, command, engine);
    updateCursor();

    // Flash yank highlight after cursor is updated
    if (highlightYank && command.operator === OperatorType.YANK) {
      var flashEl = activeElement;
      handler.flashYank(flashEl, function () {
        updateCursor();
      });
    }
  }, true);

  // ── Kill follow-up events that the browser may still generate ──
  // Also block on document capture to stop site scripts that listen there.

  function blockIfBlocked(e) {
    if (_blocked) killEvent(e);
  }

  window.addEventListener('keypress', blockIfBlocked, true);
  document.addEventListener('keypress', blockIfBlocked, true);

  window.addEventListener('keyup', function (e) {
    if (_blocked) {
      killEvent(e);
      _blocked = false;
    }
  }, true);
  document.addEventListener('keyup', function (e) {
    if (_blocked) killEvent(e);
  }, true);

  // Block keydown on document capture — site scripts on document won't see blocked keys
  document.addEventListener('keydown', blockIfBlocked, true);

  window.addEventListener('beforeinput', function (e) {
    if (!activeElement) return;
    // In normal/visual mode, never allow text insertion
    if (engine.mode !== Mode.INSERT) {
      killEvent(e);
    }
  }, true);

  // ── Reposition block cursor after mouse click ──────

  document.addEventListener('mouseup', function () {
    if (!activeElement || engine.mode === Mode.INSERT) return;
    // Let the browser finish setting cursor position, then clamp and update
    setTimeout(function () {
      if (!activeElement || engine.mode === Mode.INSERT) return;
      clampCursorToLine();
      updateCursor();
    }, 0);
  }, true);

  function clampCursorToLine() {
    if (!activeElement) return;
    if (isTextInput(activeElement)) {
      try {
        var text = activeElement.value;
        var pos = activeElement.selectionStart;
        if (text.length === 0) return;
        var lineStart = text.lastIndexOf('\n', pos - 1) + 1;
        var lineEnd = text.indexOf('\n', pos);
        if (lineEnd === -1) lineEnd = text.length;
        var maxPos = lineEnd > lineStart ? lineEnd - 1 : lineStart;
        if (pos > maxPos) {
          activeElement.selectionStart = maxPos;
          activeElement.selectionEnd = maxPos;
        }
      } catch (e) {}
    } else if (isContentEditable(activeElement)) {
      // Contenteditable: clamp via flat offset
      var handler = getHandler(activeElement);
      if (!handler) return;
      var sel = window.getSelection();
      if (!sel.rangeCount) return;
      // Use handler internals indirectly — read flat text and clamp
      var el = activeElement;
      var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
      var flatText = '';
      var node;
      while ((node = walker.nextNode())) flatText += node.textContent;
      if (flatText.length === 0) return;

      var range = sel.getRangeAt(0);
      var preRange = document.createRange();
      preRange.selectNodeContents(el);
      preRange.setEnd(range.startContainer, range.startOffset);
      var pos2 = preRange.toString().length;

      var ls = flatText.lastIndexOf('\n', pos2 - 1) + 1;
      var le = flatText.indexOf('\n', pos2);
      if (le === -1) le = flatText.length;
      var max2 = le > ls ? le - 1 : ls;
      if (pos2 > max2) {
        // Reposition using flat offset
        var remaining = max2;
        walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
        while ((node = walker.nextNode())) {
          if (remaining <= node.textContent.length) {
            var r = document.createRange();
            r.setStart(node, remaining);
            r.collapse(true);
            sel.removeAllRanges();
            sel.addRange(r);
            return;
          }
          remaining -= node.textContent.length;
        }
      }
    }
  }

})();
