(function () {
  'use strict';

  var MotionType = window.InputVim.MotionType;
  var OperatorType = window.InputVim.OperatorType;
  var CommandType = window.InputVim.CommandType;
  var InsertEntry = window.InputVim.InsertEntry;
  var TextObject = window.InputVim.TextObject;
  var Register = window.InputVim.Register;

  // ── Flat text helpers ───────────────────────────────

  function getFlatText(el) {
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
    var text = '';
    var node;
    while ((node = walker.nextNode())) {
      text += node.textContent;
    }
    return text;
  }

  function flatOffsetFromSelection(el) {
    var sel = window.getSelection();
    if (!sel.rangeCount) return 0;
    var range = sel.getRangeAt(0);
    var preRange = document.createRange();
    preRange.selectNodeContents(el);
    preRange.setEnd(range.startContainer, range.startOffset);
    return preRange.toString().length;
  }

  function selectionFromFlatOffset(el, offset) {
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
    var remaining = offset;
    var node;
    while ((node = walker.nextNode())) {
      if (remaining <= node.textContent.length) {
        return { node: node, offset: remaining };
      }
      remaining -= node.textContent.length;
    }
    // Fallback to end
    var lastNode = el;
    while (lastNode.lastChild) lastNode = lastNode.lastChild;
    var len = lastNode.textContent ? lastNode.textContent.length : 0;
    return { node: lastNode, offset: len };
  }

  function setCursorAt(el, flatOffset) {
    var point = selectionFromFlatOffset(el, flatOffset);
    var sel = window.getSelection();
    var range = document.createRange();
    range.setStart(point.node, point.offset);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function setSelectionRange(el, start, end) {
    var p1 = selectionFromFlatOffset(el, start);
    var p2 = selectionFromFlatOffset(el, end);
    var sel = window.getSelection();
    var range = document.createRange();
    range.setStart(p1.node, p1.offset);
    range.setEnd(p2.node, p2.offset);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // ── Reuse word/line helpers from input-handler logic ─

  var WORD_CHAR = /[a-zA-Z0-9_]/;

  function charClass(ch) {
    if (!ch) return -1;
    if (WORD_CHAR.test(ch)) return 0;
    if (/\s/.test(ch)) return 2;
    return 1;
  }

  function wordForward(text, pos) {
    var len = text.length;
    if (pos >= len) return len;
    var cls = charClass(text[pos]);
    while (pos < len && charClass(text[pos]) === cls) pos++;
    while (pos < len && charClass(text[pos]) === 2) pos++;
    return pos;
  }

  function wordBack(text, pos) {
    if (pos <= 0) return 0;
    pos--;
    while (pos > 0 && charClass(text[pos]) === 2) pos--;
    var cls = charClass(text[pos]);
    while (pos > 0 && charClass(text[pos - 1]) === cls) pos--;
    return pos;
  }

  function wordEnd(text, pos) {
    var len = text.length;
    if (pos >= len - 1) return len - 1;
    pos++;
    while (pos < len && charClass(text[pos]) === 2) pos++;
    var cls = charClass(text[pos]);
    while (pos < len - 1 && charClass(text[pos + 1]) === cls) pos++;
    return pos;
  }

  function isWhitespace(ch) {
    return !ch || /\s/.test(ch);
  }

  function wordForwardBig(text, pos) {
    var len = text.length;
    if (pos >= len) return len;
    while (pos < len && !isWhitespace(text[pos])) pos++;
    while (pos < len && isWhitespace(text[pos])) pos++;
    return pos;
  }

  function wordBackBig(text, pos) {
    if (pos <= 0) return 0;
    pos--;
    while (pos > 0 && isWhitespace(text[pos])) pos--;
    while (pos > 0 && !isWhitespace(text[pos - 1])) pos--;
    return pos;
  }

  function wordEndBig(text, pos) {
    var len = text.length;
    if (pos >= len - 1) return len - 1;
    pos++;
    while (pos < len && isWhitespace(text[pos])) pos++;
    while (pos < len - 1 && !isWhitespace(text[pos + 1])) pos++;
    return pos;
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

  function clamp(val, min, max) {
    return val < min ? min : val > max ? max : val;
  }

  // ── Visual line helpers for contenteditable ────────────

  /**
   * Computes visual line boundaries for a contenteditable element,
   * accounting for soft wrapping. Uses Range API to detect Y position changes.
   * Returns an array of { start, end } (flat text offsets, end is exclusive).
   */
  function computeCEVisualLines(el, text) {
    if (text.length === 0) return [{ start: 0, end: 0 }];

    var lines = [];
    var lineStart = 0;
    var lastTop = -1;
    var tolerance = 2; // px — absorb sub-pixel rounding

    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
    var node;
    var range = document.createRange();
    var flatIdx = 0;

    while ((node = walker.nextNode())) {
      var content = node.textContent;
      for (var i = 0; i < content.length; i++) {
        if (content[i] === '\n') {
          lines.push({ start: lineStart, end: flatIdx });
          lineStart = flatIdx + 1;
          lastTop = -1;
          flatIdx++;
          continue;
        }

        range.setStart(node, i);
        range.setEnd(node, i + 1);
        var rect = range.getBoundingClientRect();

        if (rect.height > 0 && lastTop >= 0 && rect.top - lastTop > tolerance) {
          lines.push({ start: lineStart, end: flatIdx });
          lineStart = flatIdx;
        }

        if (rect.height > 0) lastTop = rect.top;
        flatIdx++;
      }
    }

    lines.push({ start: lineStart, end: text.length });
    return lines;
  }

  function findCEVisualLine(vLines, pos) {
    for (var i = 0; i < vLines.length; i++) {
      var vl = vLines[i];
      if (vl.start === vl.end) {
        if (pos === vl.start) return i;
        continue;
      }
      if (pos >= vl.start &&
          (pos < vl.end || (i === vLines.length - 1 && pos <= vl.end))) {
        return i;
      }
    }
    return vLines.length - 1;
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
    // 1. Try to find a pair that contains the cursor
    var depth = 0;
    var start = -1;
    for (var i = pos; i >= 0; i--) {
      if (text[i] === close && i !== pos) depth++;
      if (text[i] === open) {
        if (depth === 0) { start = i; break; }
        depth--;
      }
    }
    if (start !== -1) {
      depth = 0;
      for (var j = start + 1; j < text.length; j++) {
        if (text[j] === open) depth++;
        if (text[j] === close) {
          if (depth === 0) return { start: start, end: j };
          depth--;
        }
      }
    }
    // 2. Not inside a pair — search forward on current line for the next one
    var lineEnd = text.indexOf('\n', pos);
    if (lineEnd === -1) lineEnd = text.length;
    for (var k = pos + 1; k < lineEnd; k++) {
      if (text[k] === open) {
        depth = 0;
        for (var l = k + 1; l < text.length; l++) {
          if (text[l] === open) depth++;
          if (text[l] === close) {
            if (depth === 0) return { start: k, end: l };
            depth--;
          }
        }
        break;
      }
    }
    return null;
  }

  function findQuotePair(text, pos, quote) {
    var lineStart = text.lastIndexOf('\n', pos - 1) + 1;
    var lineEnd = text.indexOf('\n', pos);
    if (lineEnd === -1) lineEnd = text.length;

    var positions = [];
    for (var i = lineStart; i < lineEnd; i++) {
      if (text[i] === quote) positions.push(i);
    }

    for (var j = 0; j + 1 < positions.length; j += 2) {
      if (pos >= positions[j] && pos <= positions[j + 1]) {
        return { start: positions[j], end: positions[j + 1] };
      }
    }
    for (var k = 0; k + 1 < positions.length; k += 2) {
      if (positions[k] > pos) {
        return { start: positions[k], end: positions[k + 1] };
      }
    }
    return null;
  }

  function resolveTextObject(text, pos, object, modifier) {
    var around = modifier === 'around';
    if (object === TextObject.WORD || object === TextObject.WORD_BIG) {
      return resolveWordTextObject(text, pos, around, object === TextObject.WORD_BIG);
    }

    if (object === TextObject.DOUBLE_QUOTE || object === TextObject.SINGLE_QUOTE) {
      var q = object === TextObject.DOUBLE_QUOTE ? '"' : "'";
      var qm = findQuotePair(text, pos, q);
      if (!qm) return null;
      if (around) return { from: qm.start, to: qm.end + 1 };
      return { from: qm.start + 1, to: qm.end };
    }

    var pairs = {};
    pairs[TextObject.BRACE] = ['{', '}'];
    pairs[TextObject.PAREN] = ['(', ')'];
    pairs[TextObject.BRACKET] = ['[', ']'];
    pairs[TextObject.ANGLE] = ['<', '>'];
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
    var from = pos, to = pos;
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
      if (to + 1 < text.length && /\s/.test(text[to + 1])) {
        while (to + 1 < text.length && /\s/.test(text[to + 1])) to++;
      } else if (from > 0 && /\s/.test(text[from - 1])) {
        while (from > 0 && /\s/.test(text[from - 1])) from--;
      }
    }
    return { from: from, to: to + 1 };
  }

  // ── Motion resolver for flat text ────────────────────

  function resolveMotion(text, pos, motion, count, forOperator, desiredCol, charArg, vLines) {
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
          if (vLines) {
            var vi = findCEVisualLine(vLines, newPos);
            if (col < 0) col = newPos - vLines[vi].start;
            if (vi > 0) {
              var prev = vLines[vi - 1];
              var prevLen = prev.end - prev.start;
              var maxC = forOperator ? prevLen : Math.max(0, prevLen - 1);
              newPos = prev.start + Math.min(col, maxC);
            }
          } else {
            var info = getLineInfo(text, newPos);
            if (col < 0) col = info.col;
            var ln = getLineNumber(text, newPos);
            if (ln > 0) {
              var pls = getLineStartOffset(text, ln - 1);
              var pli = getLineInfo(text, pls);
              var maxC = forOperator ? pli.lineText.length : Math.max(0, pli.lineText.length - 1);
              newPos = pls + Math.min(col, maxC);
            }
          }
          break;
        }
        case MotionType.LINE_DOWN: {
          if (vLines) {
            var vi2 = findCEVisualLine(vLines, newPos);
            if (col < 0) col = newPos - vLines[vi2].start;
            if (vi2 < vLines.length - 1) {
              var next = vLines[vi2 + 1];
              var nextLen = next.end - next.start;
              var maxC2 = forOperator ? nextLen : Math.max(0, nextLen - 1);
              newPos = next.start + Math.min(col, maxC2);
            }
          } else {
            var info2 = getLineInfo(text, newPos);
            if (col < 0) col = info2.col;
            var ln2 = getLineNumber(text, newPos);
            var totalLines = text.split('\n').length;
            if (ln2 < totalLines - 1) {
              var nls = getLineStartOffset(text, ln2 + 1);
              var nli = getLineInfo(text, nls);
              var maxC2 = forOperator ? nli.lineText.length : Math.max(0, nli.lineText.length - 1);
              newPos = nls + Math.min(col, maxC2);
            }
          }
          break;
        }
        case MotionType.WORD_FORWARD:
          newPos = wordForward(text, newPos); break;
        case MotionType.WORD_BACK:
          newPos = wordBack(text, newPos); break;
        case MotionType.WORD_END:
          newPos = wordEnd(text, newPos);
          break;
        case MotionType.WORD_FORWARD_BIG:
          newPos = wordForwardBig(text, newPos); break;
        case MotionType.WORD_BACK_BIG:
          newPos = wordBackBig(text, newPos); break;
        case MotionType.WORD_END_BIG:
          newPos = wordEndBig(text, newPos);
          break;
        case MotionType.LINE_START:
          newPos = getLineInfo(text, newPos).lineStart; break;
        case MotionType.LINE_END: {
          var leInfo = getLineInfo(text, newPos);
          newPos = forOperator ? leInfo.lineEnd : Math.max(leInfo.lineStart, leInfo.lineEnd - 1);
          break;
        }
        case MotionType.FIRST_NON_BLANK: {
          var info3 = getLineInfo(text, newPos);
          var m = info3.lineText.match(/^\s*/);
          newPos = info3.lineStart + (m ? m[0].length : 0);
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
          newPos = 0; break;
        case MotionType.DOC_END:
          newPos = forOperator ? text.length : Math.max(0, text.length - 1); break;
      }
    }
    if (forOperator) {
      return { from: Math.min(pos, newPos), to: Math.max(pos, newPos) };
    }
    return newPos;
  }

  // ── Undo stack ──────────────────────────────────────

  function UndoStack() {
    this._stack = [];
    this._redo = [];
    this._maxSize = 100;
  }

  UndoStack.prototype.push = function (el) {
    this._stack.push({ html: el.innerHTML, offset: flatOffsetFromSelection(el) });
    if (this._stack.length > this._maxSize) this._stack.shift();
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

  // ── ContentEditableHandler ──────────────────────────

  function ContentEditableHandler() {
    this._undoMap = new WeakMap();
    this._desiredCol = -1;
    this._lastYankFrom = null;
    this._lastYankTo = null;
  }

  ContentEditableHandler.prototype._getUndo = function (el) {
    if (!this._undoMap.has(el)) this._undoMap.set(el, new UndoStack());
    return this._undoMap.get(el);
  };

  ContentEditableHandler.prototype._saveUndo = function (el) {
    this._getUndo(el).push(el);
  };

  ContentEditableHandler.prototype.execute = function (el, command, engine) {
    var text = getFlatText(el);
    var pos = flatOffsetFromSelection(el);

    if (command.type !== CommandType.MOTION ||
        (command.motion !== MotionType.LINE_UP && command.motion !== MotionType.LINE_DOWN)) {
      this._desiredCol = -1;
    }

    switch (command.type) {
      case CommandType.MOTION:
        this._doMotion(el, text, pos, command);
        break;
      case CommandType.OPERATOR_MOTION:
        this._doOperatorMotion(el, text, pos, command);
        break;
      case CommandType.OPERATOR_TEXT_OBJECT:
        this._doOperatorTextObject(el, text, pos, command);
        break;
      case CommandType.LINE_OPERATOR:
        this._doLineOperator(el, text, pos, command);
        break;
      case CommandType.INSERT_ENTER:
        this._doInsertEnter(el, text, pos, command);
        break;
      case CommandType.VISUAL_ENTER:
        this._doVisualEnter(el, pos, engine);
        break;
      case CommandType.VISUAL_LINE_ENTER:
        this._doVisualLineEnter(el, pos, engine);
        break;
      case CommandType.VISUAL_OPERATOR:
        this._doVisualOperator(el, command);
        break;
      case CommandType.PASTE:
        this._doPaste(el, text, pos, false);
        break;
      case CommandType.PASTE_BEFORE:
        this._doPaste(el, text, pos, true);
        break;
      case CommandType.UNDO:
        this._doUndo(el, command.count);
        break;
      case CommandType.REDO:
        this._doRedo(el, command.count);
        break;
      case CommandType.REPLACE_CHAR:
        this._doReplaceChar(el, text, pos, command);
        break;
      case CommandType.DELETE_CHAR:
        this._doDeleteChar(el, text, pos, command);
        break;
      case CommandType.ESCAPE:
        this._doEscape(el, text, pos, command);
        break;

      case CommandType.SCROLL_DOWN:
        this._doScrollJump(el, text, pos, command.count, false);
        break;

      case CommandType.SCROLL_UP:
        this._doScrollJump(el, text, pos, command.count, true);
        break;
    }
  };

  ContentEditableHandler.prototype._doMotion = function (el, text, pos, command) {
    var isVertical = command.motion === MotionType.LINE_UP || command.motion === MotionType.LINE_DOWN;
    var vLines = null;

    if (isVertical) {
      vLines = computeCEVisualLines(el, text);
      if (this._desiredCol < 0) {
        var vi = findCEVisualLine(vLines, pos);
        this._desiredCol = pos - vLines[vi].start;
      }
    } else {
      this._desiredCol = -1;
    }

    var newPos = resolveMotion(text, pos, command.motion, command.count, false, this._desiredCol, command.char, vLines);

    // Normal-mode clamp: cursor must be ON a character, not past the last one
    if (text.length > 0) {
      var li = getLineInfo(text, newPos);
      var maxPos = li.lineEnd > li.lineStart ? li.lineEnd - 1 : li.lineStart;
      if (newPos > maxPos) newPos = maxPos;
    }

    setCursorAt(el, newPos);
  };

  ContentEditableHandler.prototype._doOperatorMotion = function (el, text, pos, command) {
    var linewise = command.motion === MotionType.LINE_UP || command.motion === MotionType.LINE_DOWN;
    var vLines = linewise ? computeCEVisualLines(el, text) : null;
    var range = resolveMotion(text, pos, command.motion, command.count, true, -1, command.char, vLines);

    if (linewise) {
      var startLine = getLineInfo(text, range.from);
      var endLine = getLineInfo(text, range.to);
      range.from = startLine.lineStart;
      range.to = endLine.lineEnd;
      if (range.to < text.length) range.to++;
    }

    var deleted = text.substring(range.from, range.to);
    var regType = linewise ? 'line' : 'char';

    if (command.operator === OperatorType.YANK) {
      Register.set(deleted, regType);
      this._lastYankFrom = range.from;
      this._lastYankTo = range.to;
      return;
    }

    this._saveUndo(el);
    Register.set(deleted, regType);

    var newText = text.substring(0, range.from) + text.substring(range.to);
    el.textContent = newText;
    setCursorAt(el, range.from);
    fireInputEvent(el);
  };

  ContentEditableHandler.prototype._doOperatorTextObject = function (el, text, pos, command) {
    var range = resolveTextObject(text, pos, command.object, command.modifier);
    if (!range) return;

    var deleted = text.substring(range.from, range.to);

    if (command.operator === OperatorType.YANK) {
      Register.set(deleted, 'char');
      this._lastYankFrom = range.from;
      this._lastYankTo = range.to;
      return;
    }

    this._saveUndo(el);
    Register.set(deleted, 'char');

    var newText = text.substring(0, range.from) + text.substring(range.to);
    el.textContent = newText;
    setCursorAt(el, range.from);
    fireInputEvent(el);
  };

  ContentEditableHandler.prototype._doLineOperator = function (el, text, pos, command) {
    var lineNum = getLineNumber(text, pos);
    var lines = text.split('\n');
    var count = Math.min(command.count, lines.length - lineNum);

    var startOffset = getLineStartOffset(text, lineNum);
    var endLine = lineNum + count - 1;
    var endOffset = endLine < lines.length - 1
      ? getLineStartOffset(text, endLine + 1)
      : text.length;

    var deleted = text.substring(startOffset, endOffset);

    if (command.operator === OperatorType.YANK) {
      Register.set(deleted, 'line');
      this._lastYankFrom = startOffset;
      this._lastYankTo = endOffset;
      return;
    }

    this._saveUndo(el);
    Register.set(deleted, 'line');

    var before = text.substring(0, startOffset);
    var after = text.substring(endOffset);
    if (before.length > 0 && before[before.length - 1] === '\n' && after.length === 0) {
      before = before.substring(0, before.length - 1);
    }

    el.textContent = before + after;
    setCursorAt(el, Math.min(startOffset, (before + after).length));
    fireInputEvent(el);
  };

  ContentEditableHandler.prototype._doInsertEnter = function (el, text, pos, command) {
    this._saveUndo(el);

    var info = getLineInfo(text, pos);
    switch (command.entry) {
      case InsertEntry.I_LOWER:
        break;
      case InsertEntry.A_LOWER:
        setCursorAt(el, Math.min(pos + 1, text.length));
        break;
      case InsertEntry.I_UPPER:
        var m = info.lineText.match(/^\s*/);
        setCursorAt(el, info.lineStart + (m ? m[0].length : 0));
        break;
      case InsertEntry.A_UPPER:
        setCursorAt(el, info.lineEnd);
        break;
      case InsertEntry.O_LOWER:
        el.textContent = text.substring(0, info.lineEnd) + '\n' + text.substring(info.lineEnd);
        setCursorAt(el, info.lineEnd + 1);
        fireInputEvent(el);
        break;
      case InsertEntry.O_UPPER:
        el.textContent = text.substring(0, info.lineStart) + '\n' + text.substring(info.lineStart);
        setCursorAt(el, info.lineStart);
        fireInputEvent(el);
        break;
    }
  };

  ContentEditableHandler.prototype._doVisualEnter = function (el, pos, engine) {
    engine.visualAnchor = pos;
    engine.visualHead = pos;
    setSelectionRange(el, pos, pos + 1);
  };

  ContentEditableHandler.prototype._doVisualLineEnter = function (el, pos, engine) {
    var text = getFlatText(el);
    engine.visualAnchor = pos;
    engine.visualHead = pos;
    var vLines = computeCEVisualLines(el, text);
    var vi = findCEVisualLine(vLines, pos);
    var vl = vLines[vi];
    setSelectionRange(el, vl.start, vl.end);
  };

  ContentEditableHandler.prototype.extendVisualSelection = function (el, command, engine) {
    var text = getFlatText(el);
    var anchor = engine.visualAnchor;
    var isVertical = command.motion === MotionType.LINE_UP || command.motion === MotionType.LINE_DOWN;
    var isLinewise = engine.mode === 'VISUAL_LINE';
    var vLines = null;

    if (isVertical || isLinewise) {
      vLines = computeCEVisualLines(el, text);
    }

    if (isVertical) {
      if (this._desiredCol < 0) {
        var vi = findCEVisualLine(vLines, engine.visualHead);
        this._desiredCol = engine.visualHead - vLines[vi].start;
      }
    } else {
      this._desiredCol = -1;
    }

    var newPos = resolveMotion(text, engine.visualHead, command.motion, command.count, false, this._desiredCol, command.char, vLines);
    engine.visualHead = newPos;

    if (isLinewise) {
      var anchorVi = findCEVisualLine(vLines, anchor);
      var headVi = findCEVisualLine(vLines, newPos);
      if (newPos >= anchor) {
        setSelectionRange(el, vLines[anchorVi].start, vLines[headVi].end);
      } else {
        setSelectionRange(el, vLines[headVi].start, vLines[anchorVi].end);
      }
    } else {
      if (newPos >= anchor) {
        setSelectionRange(el, anchor, newPos + 1);
      } else {
        setSelectionRange(el, newPos, anchor + 1);
      }
    }
  };

  ContentEditableHandler.prototype.selectTextObject = function (el, command, engine) {
    var text = getFlatText(el);
    var pos = flatOffsetFromSelection(el);
    var range = resolveTextObject(text, pos, command.object, command.modifier);
    if (!range) return;
    engine.visualAnchor = range.from;
    setSelectionRange(el, range.from, range.to);
  };

  ContentEditableHandler.prototype._doVisualOperator = function (el, command) {
    var sel = window.getSelection();
    if (!sel.rangeCount) return;
    var selected = sel.toString();
    var regType = command.lineWise ? 'line' : 'char';

    if (command.operator === OperatorType.YANK) {
      Register.set(selected, regType);
      var text = getFlatText(el);
      var pos = flatOffsetFromSelection(el);
      // Store yank range before moving cursor
      var preRange = document.createRange();
      preRange.selectNodeContents(el);
      preRange.setEnd(sel.getRangeAt(0).startContainer, sel.getRangeAt(0).startOffset);
      this._lastYankFrom = preRange.toString().length;
      this._lastYankTo = this._lastYankFrom + selected.length;
      setCursorAt(el, pos);
      return;
    }

    this._saveUndo(el);
    Register.set(selected, regType);

    var range = sel.getRangeAt(0);
    range.deleteContents();
    fireInputEvent(el);
  };

  ContentEditableHandler.prototype._doPaste = function (el, text, pos, before) {
    var reg = Register.get();
    if (!reg.content) return;

    this._saveUndo(el);

    if (reg.type === 'line') {
      var info = getLineInfo(text, pos);
      var content = reg.content;
      if (content[content.length - 1] !== '\n') content += '\n';
      if (before) {
        var newText = text.substring(0, info.lineStart) + content + text.substring(info.lineStart);
        el.textContent = newText;
        setCursorAt(el, info.lineStart);
      } else {
        var newText2 = text.substring(0, info.lineEnd) + '\n' + content.replace(/\n$/, '') + text.substring(info.lineEnd);
        el.textContent = newText2;
        setCursorAt(el, info.lineEnd + 1);
      }
    } else {
      var cInfo = getLineInfo(text, pos);
      var insertPos = before ? pos : Math.min(pos + 1, cInfo.lineEnd);
      insertPos = clamp(insertPos, 0, text.length);
      var newText3 = text.substring(0, insertPos) + reg.content + text.substring(insertPos);
      el.textContent = newText3;
      setCursorAt(el, insertPos + reg.content.length - 1);
    }

    fireInputEvent(el);
  };

  ContentEditableHandler.prototype._doUndo = function (el, count) {
    var undo = this._getUndo(el);
    for (var i = 0; i < count; i++) {
      var state = undo.pop();
      if (!state) break;
      // Save current state to redo before restoring
      undo.pushRedo({
        html: el.innerHTML,
        offset: flatOffsetFromSelection(el),
      });
      el.innerHTML = state.html;
      setCursorAt(el, state.offset);
    }
    fireInputEvent(el);
  };

  ContentEditableHandler.prototype._doRedo = function (el, count) {
    var undo = this._getUndo(el);
    for (var i = 0; i < count; i++) {
      var state = undo.popRedo();
      if (!state) break;
      // Save current state to undo (without clearing redo)
      undo._stack.push({
        html: el.innerHTML,
        offset: flatOffsetFromSelection(el),
      });
      el.innerHTML = state.html;
      setCursorAt(el, state.offset);
    }
    fireInputEvent(el);
  };

  ContentEditableHandler.prototype._doReplaceChar = function (el, text, pos, command) {
    if (pos >= text.length) return;
    this._saveUndo(el);
    var count = Math.min(command.count, text.length - pos);
    var replacement = '';
    for (var i = 0; i < count; i++) replacement += command.char;
    el.textContent = text.substring(0, pos) + replacement + text.substring(pos + count);
    setCursorAt(el, pos + count - 1);
    fireInputEvent(el);
  };

  ContentEditableHandler.prototype._doDeleteChar = function (el, text, pos, command) {
    var info = getLineInfo(text, pos);
    var count = Math.min(command.count, info.lineEnd - pos);
    if (count <= 0) return;

    this._saveUndo(el);
    var deleted = text.substring(pos, pos + count);
    Register.set(deleted, 'char');
    var newText = text.substring(0, pos) + text.substring(pos + count);
    el.textContent = newText;

    var newInfo = getLineInfo(newText, Math.min(pos, newText.length));
    var maxPos = newInfo.lineEnd > newInfo.lineStart ? newInfo.lineEnd - 1 : newInfo.lineStart;
    setCursorAt(el, Math.min(pos, maxPos));
    fireInputEvent(el);
  };

  ContentEditableHandler.prototype._doEscape = function (el, text, pos, command) {
    if (command.fromMode === 'INSERT') {
      var lineStart = getLineInfo(text, pos).lineStart;
      if (pos > lineStart) setCursorAt(el, pos - 1);
    } else if (command.fromMode === 'NORMAL') {
      el.blur();
    } else if (command.fromMode === 'VISUAL' || command.fromMode === 'VISUAL_LINE') {
      setCursorAt(el, command.visualHead != null ? command.visualHead : pos);
    }
  };

  // ── Scroll Jump (Ctrl+D / Ctrl+U) ──────────────────

  ContentEditableHandler.prototype._doScrollJump = function (el, text, pos, count, isUp) {
    var vLines = computeCEVisualLines(el, text);
    if (vLines.length <= 1) return;

    var vi = findCEVisualLine(vLines, pos);
    if (isUp && vi === 0) return;
    if (!isUp && vi === vLines.length - 1) return;

    var targetVi = isUp
      ? Math.max(0, vi - count)
      : Math.min(vLines.length - 1, vi + count);

    var col = pos - vLines[vi].start;
    var targetVL = vLines[targetVi];
    var targetLen = targetVL.end - targetVL.start;
    var maxCol = Math.max(0, targetLen - 1);
    if (targetVL.start === targetVL.end) maxCol = 0;
    setCursorAt(el, targetVL.start + Math.min(col, maxCol));
  };

  // ── Scroll ──────────────────────────────────────────

  ContentEditableHandler.prototype.ensureCursorVisible = function (el) {
    // Browser handles scrolling for contenteditable natively via Selection
    var sel = window.getSelection();
    if (sel.rangeCount) {
      var range = sel.getRangeAt(0);
      var rect = range.getBoundingClientRect();
      if (rect.height > 0) {
        var elRect = el.getBoundingClientRect();
        if (rect.bottom > elRect.bottom) {
          el.scrollTop += rect.bottom - elRect.bottom;
        } else if (rect.top < elRect.top) {
          el.scrollTop -= elRect.top - rect.top;
        }
      }
    }
  };

  // ── Cursor rect (for overlay block cursor) ──────────

  ContentEditableHandler.prototype.getCursorRect = function (el, overridePos) {
    var text = getFlatText(el);
    var pos = overridePos != null ? overridePos : flatOffsetFromSelection(el);

    // Try to measure the character at cursor position
    if (pos < text.length) {
      var start = selectionFromFlatOffset(el, pos);
      var end = selectionFromFlatOffset(el, pos + 1);
      var range = document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      var rect = range.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
      }
    }

    // Fallback: collapsed range or empty text
    var sel = window.getSelection();
    if (sel.rangeCount) {
      var r = sel.getRangeAt(0).cloneRange();
      r.collapse(true);
      var rect2 = r.getBoundingClientRect();
      if (rect2.height > 0) {
        var computed = window.getComputedStyle(el);
        var fw = parseFloat(computed.fontSize) * 0.6;
        return { x: rect2.left, y: rect2.top, width: fw, height: rect2.height };
      }
    }

    // Last resort: use element position
    var elRect = el.getBoundingClientRect();
    var cs = window.getComputedStyle(el);
    var fs = parseFloat(cs.fontSize) || 16;
    var bt = parseInt(cs.borderTopWidth) || 0;
    var bl = parseInt(cs.borderLeftWidth) || 0;
    var pt = parseInt(cs.paddingTop) || 0;
    var pl = parseInt(cs.paddingLeft) || 0;
    return { x: elRect.left + bl + pl, y: elRect.top + bt + pt, width: fs * 0.6, height: fs * 1.2 };
  };

  // ── Yank highlight ─────────────────────────────────

  ContentEditableHandler.prototype.flashYank = function (el, onDone) {
    var from = this._lastYankFrom;
    var to = this._lastYankTo;
    this._lastYankFrom = null;
    this._lastYankTo = null;
    if (from == null || to == null || from === to) { if (onDone) onDone(); return; }
    var sel = window.getSelection();
    if (!sel.rangeCount) { if (onDone) onDone(); return; }
    var savedRange = sel.getRangeAt(0).cloneRange();
    try {
      setSelectionRange(el, from, to);
    } catch (e) { if (onDone) onDone(); return; }
    setTimeout(function () {
      try {
        sel.removeAllRanges();
        sel.addRange(savedRange);
      } catch (e) {}
      if (onDone) onDone();
    }, 200);
  };

  function fireInputEvent(el) {
    el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
  }

  window.InputVim = window.InputVim || {};
  window.InputVim.ContentEditableHandler = ContentEditableHandler;
})();
