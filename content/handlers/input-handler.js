(function () {
  'use strict';

  var MotionType = window.InputVim.MotionType;
  var OperatorType = window.InputVim.OperatorType;
  var CommandType = window.InputVim.CommandType;
  var InsertEntry = window.InputVim.InsertEntry;
  var TextObject = window.InputVim.TextObject;
  var Register = window.InputVim.Register;

  var WORD_CHAR = /[a-zA-Z0-9_]/;

  // ── Undo stack ──────────────────────────────────────

  function UndoStack() {
    this._stack = [];
    this._redo = [];
    this._maxSize = 100;
  }

  UndoStack.prototype.push = function (el) {
    this._stack.push({
      value: el.value,
      selectionStart: el.selectionStart,
      selectionEnd: el.selectionEnd,
    });
    if (this._stack.length > this._maxSize) {
      this._stack.shift();
    }
    this._redo = []; // new change clears redo history
  };

  UndoStack.prototype.pop = function () {
    return this._stack.pop() || null;
  };

  UndoStack.prototype.pushRedo = function (state) {
    this._redo.push(state);
  };

  UndoStack.prototype.popRedo = function () {
    return this._redo.pop() || null;
  };

  UndoStack.prototype.clear = function () {
    this._stack = [];
    this._redo = [];
  };

  // ── Helpers ─────────────────────────────────────────

  function fireInputEvent(el) {
    var evt = new Event('input', { bubbles: true, cancelable: true });
    el.dispatchEvent(evt);
  }

  function setCursor(el, pos) {
    try {
      pos = clamp(pos, 0, el.value.length);
      el.selectionStart = pos;
      el.selectionEnd = pos;
    } catch (e) {
      // email/number inputs don't support selection API
    }
  }

  function setSelection(el, start, end) {
    try {
      el.selectionStart = Math.min(start, end);
      el.selectionEnd = Math.max(start, end);
      if (start <= end) {
        el.selectionDirection = 'forward';
      } else {
        el.selectionDirection = 'backward';
      }
    } catch (e) {
      // email/number inputs don't support selection API
    }
  }

  function clamp(val, min, max) {
    return val < min ? min : val > max ? max : val;
  }

  function getLineInfo(text, pos) {
    var lineStart = text.lastIndexOf('\n', pos - 1) + 1;
    var lineEndIdx = text.indexOf('\n', pos);
    if (lineEndIdx === -1) lineEndIdx = text.length;
    return {
      lineStart: lineStart,
      lineEnd: lineEndIdx,
      lineText: text.substring(lineStart, lineEndIdx),
      col: pos - lineStart,
    };
  }

  function getLines(text) {
    return text.split('\n');
  }

  function getLineNumber(text, pos) {
    var count = 0;
    for (var i = 0; i < pos && i < text.length; i++) {
      if (text[i] === '\n') count++;
    }
    return count;
  }

  function getLineStartOffset(text, lineNum) {
    var cur = 0;
    for (var i = 0; i < lineNum; i++) {
      var idx = text.indexOf('\n', cur);
      if (idx === -1) return text.length;
      cur = idx + 1;
    }
    return cur;
  }

  // ── Word motion helpers ─────────────────────────────

  function charClass(ch) {
    if (ch === undefined || ch === null) return -1;
    if (WORD_CHAR.test(ch)) return 0; // word
    if (/\s/.test(ch)) return 2;      // whitespace
    return 1;                           // punctuation
  }

  function wordForward(text, pos) {
    var len = text.length;
    if (pos >= len) return len;

    var cls = charClass(text[pos]);

    // Skip current class
    while (pos < len && charClass(text[pos]) === cls) pos++;
    // Skip whitespace
    while (pos < len && charClass(text[pos]) === 2) pos++;

    return pos;
  }

  function wordBack(text, pos) {
    if (pos <= 0) return 0;
    pos--;
    // Skip whitespace
    while (pos > 0 && charClass(text[pos]) === 2) pos--;

    var cls = charClass(text[pos]);
    while (pos > 0 && charClass(text[pos - 1]) === cls) pos--;

    return pos;
  }

  function wordEnd(text, pos) {
    var len = text.length;
    if (pos >= len - 1) return len;

    pos++; // move off current char
    // Skip whitespace
    while (pos < len && charClass(text[pos]) === 2) pos++;

    var cls = charClass(text[pos]);
    while (pos < len - 1 && charClass(text[pos + 1]) === cls) pos++;

    return pos + 1; // position AFTER last char (browser cursor model)
  }

  // ── Big-WORD motion helpers (W B E) ─────────────────
  // WORD = any non-whitespace sequence

  function isWhitespace(ch) {
    return !ch || /\s/.test(ch);
  }

  function wordForwardBig(text, pos) {
    var len = text.length;
    if (pos >= len) return len;
    // Skip current non-whitespace
    while (pos < len && !isWhitespace(text[pos])) pos++;
    // Skip whitespace
    while (pos < len && isWhitespace(text[pos])) pos++;
    return pos;
  }

  function wordBackBig(text, pos) {
    if (pos <= 0) return 0;
    pos--;
    // Skip whitespace
    while (pos > 0 && isWhitespace(text[pos])) pos--;
    // Skip non-whitespace
    while (pos > 0 && !isWhitespace(text[pos - 1])) pos--;
    return pos;
  }

  function wordEndBig(text, pos) {
    var len = text.length;
    if (pos >= len - 1) return len;
    pos++;
    // Skip whitespace
    while (pos < len && isWhitespace(text[pos])) pos++;
    // Skip non-whitespace
    while (pos < len - 1 && !isWhitespace(text[pos + 1])) pos++;
    return pos + 1; // position AFTER last char (browser cursor model)
  }

  // ── Find/Till helpers ─────────────────────────────────

  function findCharForward(text, pos, ch) {
    var info = getLineInfo(text, pos);
    var idx = text.indexOf(ch, pos + 1);
    if (idx === -1 || idx > info.lineEnd) return -1;
    return idx;
  }

  function findCharBackward(text, pos, ch) {
    var info = getLineInfo(text, pos);
    for (var i = pos - 1; i >= info.lineStart; i--) {
      if (text[i] === ch) return i;
    }
    return -1;
  }

  // ── Text object resolver ────────────────────────────

  function findMatchingPair(text, pos, open, close) {
    // Search backward for opening bracket
    var depth = 0;
    var start = -1;
    for (var i = pos; i >= 0; i--) {
      if (text[i] === close && i !== pos) depth++;
      if (text[i] === open) {
        if (depth === 0) { start = i; break; }
        depth--;
      }
    }
    if (start === -1) return null;
    // Search forward for closing bracket
    depth = 0;
    for (var j = start + 1; j < text.length; j++) {
      if (text[j] === open) depth++;
      if (text[j] === close) {
        if (depth === 0) return { start: start, end: j };
        depth--;
      }
    }
    return null;
  }

  function resolveTextObject(text, pos, object, modifier) {
    var around = modifier === 'around';

    if (object === TextObject.WORD || object === TextObject.WORD_BIG) {
      return resolveWordTextObject(text, pos, around, object === TextObject.WORD_BIG);
    }

    var pairs = {};
    pairs[TextObject.BRACE] = ['{', '}'];
    pairs[TextObject.PAREN] = ['(', ')'];
    pairs[TextObject.BRACKET] = ['[', ']'];
    var p = pairs[object];
    if (!p) return null;

    var match = findMatchingPair(text, pos, p[0], p[1]);
    if (!match) return null;
    if (around) return { from: match.start, to: match.end + 1 };
    return { from: match.start + 1, to: match.end };
  }

  function resolveWordTextObject(text, pos, around, big) {
    if (text.length === 0) return null;
    pos = clamp(pos, 0, text.length - 1);

    var from = pos;
    var to = pos;

    if (big) {
      var onSpace = /\s/.test(text[pos]);
      if (onSpace) {
        while (from > 0 && /\s/.test(text[from - 1])) from--;
        while (to < text.length - 1 && /\s/.test(text[to + 1])) to++;
      } else {
        while (from > 0 && !/\s/.test(text[from - 1])) from--;
        while (to < text.length - 1 && !/\s/.test(text[to + 1])) to++;
      }
    } else {
      var cls = charClass(text[pos]);
      while (from > 0 && charClass(text[from - 1]) === cls) from--;
      while (to < text.length - 1 && charClass(text[to + 1]) === cls) to++;
    }

    if (around) {
      // Include trailing whitespace, or leading if no trailing
      if (to + 1 < text.length && /\s/.test(text[to + 1])) {
        while (to + 1 < text.length && /\s/.test(text[to + 1])) to++;
      } else if (from > 0 && /\s/.test(text[from - 1])) {
        while (from > 0 && /\s/.test(text[from - 1])) from--;
      }
    }

    return { from: from, to: to + 1 };
  }

  // ── Motion resolver ─────────────────────────────────

  /**
   * Returns the new cursor position after applying a motion.
   * For operator use, returns { from, to } range.
   */
  function resolveMotion(el, motion, count, forOperator, desiredCol, charArg) {
    var text = el.value;
    var pos = el.selectionStart;
    var newPos = pos;
    var col = (desiredCol >= 0) ? desiredCol : -1;

    for (var i = 0; i < count; i++) {
      switch (motion) {
        case MotionType.CHAR_LEFT: {
          var clInfo = getLineInfo(text, newPos);
          if (newPos > clInfo.lineStart) newPos--;
          break;
        }

        case MotionType.CHAR_RIGHT: {
          var crInfo = getLineInfo(text, newPos);
          var crMax = crInfo.lineEnd > crInfo.lineStart ? crInfo.lineEnd - 1 : crInfo.lineStart;
          if (newPos < crMax) newPos++;
          break;
        }

        case MotionType.LINE_UP: {
          var info = getLineInfo(text, newPos);
          if (col < 0) col = info.col;
          var lineNum = getLineNumber(text, newPos);
          if (lineNum > 0) {
            var prevLineStart = getLineStartOffset(text, lineNum - 1);
            var prevLineInfo = getLineInfo(text, prevLineStart);
            var maxCol = forOperator ? prevLineInfo.lineText.length : Math.max(0, prevLineInfo.lineText.length - 1);
            newPos = prevLineStart + Math.min(col, maxCol);
          }
          break;
        }

        case MotionType.LINE_DOWN: {
          var info2 = getLineInfo(text, newPos);
          if (col < 0) col = info2.col;
          var lineNum2 = getLineNumber(text, newPos);
          var lines = getLines(text);
          if (lineNum2 < lines.length - 1) {
            var nextLineStart = getLineStartOffset(text, lineNum2 + 1);
            var nextLineInfo = getLineInfo(text, nextLineStart);
            var maxCol2 = forOperator ? nextLineInfo.lineText.length : Math.max(0, nextLineInfo.lineText.length - 1);
            newPos = nextLineStart + Math.min(col, maxCol2);
          }
          break;
        }

        case MotionType.WORD_FORWARD:
          newPos = wordForward(text, newPos);
          break;

        case MotionType.WORD_BACK:
          newPos = wordBack(text, newPos);
          break;

        case MotionType.WORD_END:
          newPos = wordEnd(text, newPos);
          break;

        case MotionType.WORD_FORWARD_BIG:
          newPos = wordForwardBig(text, newPos);
          break;

        case MotionType.WORD_BACK_BIG:
          newPos = wordBackBig(text, newPos);
          break;

        case MotionType.WORD_END_BIG:
          newPos = wordEndBig(text, newPos);
          break;

        case MotionType.LINE_START: {
          var info3 = getLineInfo(text, newPos);
          newPos = info3.lineStart;
          break;
        }

        case MotionType.LINE_END: {
          var info4 = getLineInfo(text, newPos);
          newPos = forOperator ? info4.lineEnd : Math.max(info4.lineStart, info4.lineEnd - 1);
          break;
        }

        case MotionType.FIRST_NON_BLANK: {
          var info5 = getLineInfo(text, newPos);
          var match = info5.lineText.match(/^\s*/);
          newPos = info5.lineStart + (match ? match[0].length : 0);
          break;
        }

        case MotionType.FIND_CHAR: {
          var fc = findCharForward(text, newPos, charArg);
          if (fc !== -1) newPos = fc;
          break;
        }

        case MotionType.FIND_CHAR_BACK: {
          var fcb = findCharBackward(text, newPos, charArg);
          if (fcb !== -1) newPos = fcb;
          break;
        }

        case MotionType.TILL_CHAR: {
          var tc = findCharForward(text, newPos, charArg);
          if (tc !== -1) newPos = tc - 1;
          break;
        }

        case MotionType.TILL_CHAR_BACK: {
          var tcb = findCharBackward(text, newPos, charArg);
          if (tcb !== -1) newPos = tcb + 1;
          break;
        }

        case MotionType.DOC_START:
          newPos = 0;
          break;

        case MotionType.DOC_END:
          newPos = forOperator ? text.length : Math.max(0, text.length - 1);
          break;
      }
    }

    if (forOperator) {
      return { from: Math.min(pos, newPos), to: Math.max(pos, newPos) };
    }
    return newPos;
  }

  // ── InputHandler ────────────────────────────────────

  function InputHandler() {
    this._undoMap = new WeakMap();
    this._desiredCol = -1; // sticky column for j/k
  }

  InputHandler.prototype._getUndo = function (el) {
    if (!this._undoMap.has(el)) {
      this._undoMap.set(el, new UndoStack());
    }
    return this._undoMap.get(el);
  };

  InputHandler.prototype._saveUndo = function (el) {
    this._getUndo(el).push(el);
  };

  InputHandler.prototype.execute = function (el, command, engine) {
    // Reset sticky column for any non-vertical-motion command
    if (command.type !== CommandType.MOTION ||
        (command.motion !== MotionType.LINE_UP && command.motion !== MotionType.LINE_DOWN)) {
      this._desiredCol = -1;
    }

    switch (command.type) {
      case CommandType.MOTION:
        this._doMotion(el, command);
        break;

      case CommandType.OPERATOR_MOTION:
        this._doOperatorMotion(el, command);
        break;

      case CommandType.OPERATOR_TEXT_OBJECT:
        this._doOperatorTextObject(el, command);
        break;

      case CommandType.LINE_OPERATOR:
        this._doLineOperator(el, command);
        break;

      case CommandType.INSERT_ENTER:
        this._doInsertEnter(el, command);
        break;

      case CommandType.VISUAL_ENTER:
        this._doVisualEnter(el, engine);
        break;

      case CommandType.VISUAL_LINE_ENTER:
        this._doVisualLineEnter(el, engine);
        break;

      case CommandType.VISUAL_OPERATOR:
        this._doVisualOperator(el, command);
        break;

      case CommandType.PASTE:
        this._doPaste(el, false);
        break;

      case CommandType.PASTE_BEFORE:
        this._doPaste(el, true);
        break;

      case CommandType.UNDO:
        this._doUndo(el, command.count);
        break;

      case CommandType.REDO:
        this._doRedo(el, command.count);
        break;

      case CommandType.REPLACE_CHAR:
        this._doReplaceChar(el, command);
        break;

      case CommandType.DELETE_CHAR:
        this._doDeleteChar(el, command);
        break;

      case CommandType.ESCAPE:
        this._doEscape(el, command);
        break;
    }
  };

  // ── Motion ──────────────────────────────────────────

  InputHandler.prototype._doMotion = function (el, command) {
    var isVertical = command.motion === MotionType.LINE_UP || command.motion === MotionType.LINE_DOWN;

    if (isVertical) {
      // Set sticky column from current position if not already set
      if (this._desiredCol < 0) {
        var info = getLineInfo(el.value, el.selectionStart);
        this._desiredCol = info.col;
      }
    } else {
      this._desiredCol = -1;
    }

    var newPos = resolveMotion(el, command.motion, command.count, false, this._desiredCol, command.char);

    // Normal-mode clamp: cursor must be ON a character, not past the last one
    if (el.value.length > 0) {
      var li = getLineInfo(el.value, newPos);
      var maxPos = li.lineEnd > li.lineStart ? li.lineEnd - 1 : li.lineStart;
      if (newPos > maxPos) newPos = maxPos;
    }

    setCursor(el, newPos);
  };

  // ── Operator + Motion ───────────────────────────────

  InputHandler.prototype._doOperatorMotion = function (el, command) {
    var range = resolveMotion(el, command.motion, command.count, true, -1, command.char);
    var text = el.value;
    var linewise = command.motion === MotionType.LINE_UP || command.motion === MotionType.LINE_DOWN;

    // j/k are linewise motions — expand range to full lines
    if (linewise) {
      var startLine = getLineInfo(text, range.from);
      var endLine = getLineInfo(text, range.to);
      range.from = startLine.lineStart;
      range.to = endLine.lineEnd;
      if (range.to < text.length) range.to++; // include the trailing \n
    }

    var deleted = text.substring(range.from, range.to);
    var regType = linewise ? 'line' : 'char';

    if (command.operator === OperatorType.YANK) {
      Register.set(deleted, regType);
      return;
    }

    this._saveUndo(el);
    Register.set(deleted, regType);

    el.value = text.substring(0, range.from) + text.substring(range.to);
    setCursor(el, range.from);
    fireInputEvent(el);
  };

  // ── Operator + Text Object ──────────────────────────

  InputHandler.prototype._doOperatorTextObject = function (el, command) {
    var text = el.value;
    var pos = el.selectionStart;
    var range = resolveTextObject(text, pos, command.object, command.modifier);
    if (!range) return;

    var deleted = text.substring(range.from, range.to);

    if (command.operator === OperatorType.YANK) {
      Register.set(deleted, 'char');
      return;
    }

    this._saveUndo(el);
    Register.set(deleted, 'char');

    el.value = text.substring(0, range.from) + text.substring(range.to);
    setCursor(el, range.from);
    fireInputEvent(el);
  };

  // ── Line Operator ───────────────────────────────────

  InputHandler.prototype._doLineOperator = function (el, command) {
    var text = el.value;
    var pos = el.selectionStart;
    var lineNum = getLineNumber(text, pos);
    var lines = getLines(text);
    var count = Math.min(command.count, lines.length - lineNum);

    var startLine = lineNum;
    var endLine = lineNum + count - 1;

    var startOffset = getLineStartOffset(text, startLine);
    var endOffset = endLine < lines.length - 1
      ? getLineStartOffset(text, endLine + 1)
      : text.length;

    var deleted = text.substring(startOffset, endOffset);

    if (command.operator === OperatorType.YANK) {
      Register.set(deleted, 'line');
      return;
    }

    this._saveUndo(el);
    Register.set(deleted, 'line');

    // Remove lines
    var before = text.substring(0, startOffset);
    var after = text.substring(endOffset);

    // If we removed the trailing part, trim the leftover newline
    if (before.length > 0 && before[before.length - 1] === '\n' && after.length === 0) {
      before = before.substring(0, before.length - 1);
    }

    el.value = before + after;

    // Position cursor at start of where the deleted lines were
    var newPos = Math.min(startOffset, el.value.length);
    var info = getLineInfo(el.value, newPos);
    var firstNonBlank = info.lineText.match(/^\s*/);
    setCursor(el, info.lineStart + (firstNonBlank ? firstNonBlank[0].length : 0));

    fireInputEvent(el);
  };

  // ── Insert Entry ────────────────────────────────────

  InputHandler.prototype._doInsertEnter = function (el, command) {
    var text = el.value;
    var pos = el.selectionStart;
    var info = getLineInfo(text, pos);

    switch (command.entry) {
      case InsertEntry.I_LOWER:
        // cursor stays
        break;

      case InsertEntry.A_LOWER:
        // Move one right, but never past the end of the current line
        setCursor(el, Math.min(pos + 1, info.lineEnd));
        break;

      case InsertEntry.I_UPPER:
        var firstNonBlank = info.lineText.match(/^\s*/);
        setCursor(el, info.lineStart + (firstNonBlank ? firstNonBlank[0].length : 0));
        break;

      case InsertEntry.A_UPPER:
        setCursor(el, info.lineEnd);
        break;

      case InsertEntry.O_LOWER:
        this._saveUndo(el);
        el.value = text.substring(0, info.lineEnd) + '\n' + text.substring(info.lineEnd);
        setCursor(el, info.lineEnd + 1);
        fireInputEvent(el);
        break;

      case InsertEntry.O_UPPER:
        this._saveUndo(el);
        el.value = text.substring(0, info.lineStart) + '\n' + text.substring(info.lineStart);
        setCursor(el, info.lineStart);
        fireInputEvent(el);
        break;
    }
  };

  // ── Visual Mode ─────────────────────────────────────

  InputHandler.prototype._doVisualEnter = function (el, engine) {
    engine.visualAnchor = el.selectionStart;
    engine.visualHead = el.selectionStart;
    setSelection(el, el.selectionStart, el.selectionStart + 1);
  };

  InputHandler.prototype._doVisualLineEnter = function (el, engine) {
    var pos = el.selectionStart;
    engine.visualAnchor = pos;
    engine.visualHead = pos;
    var info = getLineInfo(el.value, pos);
    var end = info.lineEnd;
    if (end < el.value.length) end++;
    setSelection(el, info.lineStart, end);
  };

  InputHandler.prototype.extendVisualSelection = function (el, command, engine) {
    var anchor = engine.visualAnchor;
    var text = el.value;
    var isLinewise = engine.mode === 'VISUAL_LINE';
    var isVertical = command.motion === MotionType.LINE_UP || command.motion === MotionType.LINE_DOWN;

    if (isVertical) {
      if (this._desiredCol < 0) {
        var headInfo = getLineInfo(text, engine.visualHead);
        this._desiredCol = headInfo.col;
      }
    } else {
      this._desiredCol = -1;
    }

    setCursor(el, engine.visualHead);

    var newPos = resolveMotion(el, command.motion, command.count, false, this._desiredCol, command.char);
    engine.visualHead = newPos;

    if (isLinewise) {
      // Expand selection to full lines (include trailing \n so empty lines are covered)
      var anchorLine = getLineInfo(text, anchor);
      var headLine = getLineInfo(text, newPos);
      if (newPos >= anchor) {
        var end = headLine.lineEnd;
        if (end < text.length) end++;
        setSelection(el, anchorLine.lineStart, end);
      } else {
        var end2 = anchorLine.lineEnd;
        if (end2 < text.length) end2++;
        setSelection(el, headLine.lineStart, end2);
      }
    } else {
      if (newPos >= anchor) {
        setSelection(el, anchor, newPos + 1);
      } else {
        setSelection(el, newPos, anchor + 1);
      }
    }
  };

  InputHandler.prototype.selectTextObject = function (el, command, engine) {
    var text = el.value;
    var pos = el.selectionStart;
    var range = resolveTextObject(text, pos, command.object, command.modifier);
    if (!range) return;
    engine.visualAnchor = range.from;
    setSelection(el, range.from, range.to);
  };

  InputHandler.prototype._doVisualOperator = function (el, command) {
    var text = el.value;
    var start = el.selectionStart;
    var end = el.selectionEnd;
    var regType = command.lineWise ? 'line' : 'char';

    // For linewise, expand to include the trailing newline
    if (command.lineWise) {
      var info = getLineInfo(text, start);
      start = info.lineStart;
      var endInfo = getLineInfo(text, Math.max(end - 1, start));
      end = endInfo.lineEnd;
      if (end < text.length) end++; // include the \n
    }

    var selected = text.substring(start, end);

    if (command.operator === OperatorType.YANK) {
      Register.set(selected, regType);
      setCursor(el, start);
      return;
    }

    this._saveUndo(el);
    Register.set(selected, regType);

    el.value = text.substring(0, start) + text.substring(end);
    setCursor(el, Math.min(start, el.value.length));
    fireInputEvent(el);
  };

  // ── Paste ───────────────────────────────────────────

  InputHandler.prototype._doPaste = function (el, before) {
    var reg = Register.get();
    if (!reg.content) return;

    this._saveUndo(el);

    var text = el.value;
    var pos = el.selectionStart;

    if (reg.type === 'line') {
      var info = getLineInfo(text, pos);
      if (before) {
        var insertAt = info.lineStart;
        var content = reg.content;
        if (content[content.length - 1] !== '\n') content += '\n';
        el.value = text.substring(0, insertAt) + content + text.substring(insertAt);
        setCursor(el, insertAt);
      } else {
        var insertAt2 = info.lineEnd;
        var content2 = reg.content;
        if (content2[content2.length - 1] !== '\n') content2 += '\n';
        el.value = text.substring(0, insertAt2) + '\n' + content2.replace(/\n$/, '') + text.substring(insertAt2);
        setCursor(el, insertAt2 + 1);
      }
    } else {
      var insertPos = before ? pos : pos + 1;
      insertPos = clamp(insertPos, 0, text.length);
      el.value = text.substring(0, insertPos) + reg.content + text.substring(insertPos);
      setCursor(el, insertPos + reg.content.length - 1);
    }

    fireInputEvent(el);
  };

  // ── Undo ────────────────────────────────────────────

  InputHandler.prototype._doUndo = function (el, count) {
    var undo = this._getUndo(el);
    for (var i = 0; i < count; i++) {
      var state = undo.pop();
      if (!state) break;
      // Save current state to redo before restoring
      undo.pushRedo({
        value: el.value,
        selectionStart: el.selectionStart,
        selectionEnd: el.selectionEnd,
      });
      el.value = state.value;
      el.selectionStart = state.selectionStart;
      el.selectionEnd = state.selectionEnd;
    }
    fireInputEvent(el);
  };

  InputHandler.prototype._doRedo = function (el, count) {
    var undo = this._getUndo(el);
    for (var i = 0; i < count; i++) {
      var state = undo.popRedo();
      if (!state) break;
      // Save current state to undo (without clearing redo)
      undo._stack.push({
        value: el.value,
        selectionStart: el.selectionStart,
        selectionEnd: el.selectionEnd,
      });
      el.value = state.value;
      el.selectionStart = state.selectionStart;
      el.selectionEnd = state.selectionEnd;
    }
    fireInputEvent(el);
  };

  // ── Replace Char ────────────────────────────────────

  InputHandler.prototype._doReplaceChar = function (el, command) {
    var text = el.value;
    var pos = el.selectionStart;
    if (pos >= text.length) return;

    this._saveUndo(el);

    var count = Math.min(command.count, text.length - pos);
    var replacement = '';
    for (var i = 0; i < count; i++) replacement += command.char;

    el.value = text.substring(0, pos) + replacement + text.substring(pos + count);
    setCursor(el, pos + count - 1);
    fireInputEvent(el);
  };

  // ── Delete char under cursor (x) ────────────────────

  InputHandler.prototype._doDeleteChar = function (el, command) {
    var text = el.value;
    var pos = el.selectionStart;
    var info = getLineInfo(text, pos);
    var count = Math.min(command.count, info.lineEnd - pos);
    if (count <= 0) return;

    this._saveUndo(el);
    var deleted = text.substring(pos, pos + count);
    Register.set(deleted, 'char');
    el.value = text.substring(0, pos) + text.substring(pos + count);

    // Clamp cursor to last char of line
    var newInfo = getLineInfo(el.value, Math.min(pos, el.value.length));
    var maxPos = newInfo.lineEnd > newInfo.lineStart ? newInfo.lineEnd - 1 : newInfo.lineStart;
    setCursor(el, Math.min(pos, maxPos));
    fireInputEvent(el);
  };

  // ── Escape ──────────────────────────────────────────

  InputHandler.prototype._doEscape = function (el, command) {
    if (command.fromMode === 'INSERT') {
      // Move cursor back one (vim behavior), but not past line start
      var pos = el.selectionStart;
      var lineStart = getLineInfo(el.value, pos).lineStart;
      if (pos > lineStart) setCursor(el, pos - 1);
    } else if (command.fromMode === 'NORMAL') {
      el.blur();
    } else if (command.fromMode === 'VISUAL' || command.fromMode === 'VISUAL_LINE') {
      setCursor(el, command.visualHead != null ? command.visualHead : el.selectionStart);
    }
  };

  // ── Cursor rect (for overlay block cursor) ──────────

  var _mirror = null;
  var MIRROR_PROPS = [
    'direction', 'boxSizing', 'width',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize',
    'lineHeight', 'fontFamily',
    'textAlign', 'textTransform', 'textIndent', 'textDecoration',
    'letterSpacing', 'wordSpacing'
  ];

  function ensureMirror() {
    if (_mirror && _mirror.parentNode) return _mirror;
    _mirror = document.createElement('div');
    _mirror.style.cssText = 'position:fixed;visibility:hidden;top:-9999px;left:-9999px;overflow:hidden;';
    document.body.appendChild(_mirror);
    return _mirror;
  }

  function getCaretCoordinates(el, position) {
    var mirror = ensureMirror();
    var s = mirror.style;
    var computed = window.getComputedStyle(el);
    var isInput = el.tagName === 'INPUT';

    for (var i = 0; i < MIRROR_PROPS.length; i++) {
      s[MIRROR_PROPS[i]] = computed[MIRROR_PROPS[i]];
    }
    s.height = 'auto';
    s.overflow = 'hidden';
    s.whiteSpace = isInput ? 'nowrap' : 'pre-wrap';
    s.wordWrap = isInput ? 'normal' : 'break-word';
    if (isInput) s.width = 'auto';

    mirror.textContent = el.value.substring(0, position);
    var span = document.createElement('span');
    var ch = position < el.value.length ? el.value[position] : null;
    // Use a non-breaking space for measurement if char is newline or at end
    span.textContent = (ch && ch !== '\n') ? ch : '\u00a0';
    mirror.appendChild(span);

    var result = {
      top: span.offsetTop,
      left: span.offsetLeft,
      width: span.offsetWidth,
      height: span.offsetHeight
    };

    mirror.textContent = '';
    return result;
  }

  InputHandler.prototype.getCursorRect = function (el, overridePos) {
    var pos;
    try { pos = overridePos != null ? overridePos : el.selectionStart; } catch (e) { return null; }

    var coords = getCaretCoordinates(el, pos);
    var elRect = el.getBoundingClientRect();

    var x = elRect.left + coords.left - (el.scrollLeft || 0);
    var y = elRect.top + coords.top - (el.scrollTop || 0);

    // Clip: hide if cursor is outside the visible area of the element
    if (x + coords.width < elRect.left || x > elRect.right ||
        y + coords.height < elRect.top || y > elRect.bottom) {
      return null;
    }

    return { x: x, y: y, width: coords.width, height: coords.height };
  };

  // ── Expose ──────────────────────────────────────────

  // Static helper for visual mode motion in main.js
  InputHandler.prototype.resolveMotion = resolveMotion;

  window.InputVim = window.InputVim || {};
  window.InputVim.InputHandler = InputHandler;
})();
