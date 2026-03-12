(function () {
  'use strict';

  var MotionType = window.InputVim.MotionType;
  var OperatorType = window.InputVim.OperatorType;
  var CommandType = window.InputVim.CommandType;
  var InsertEntry = window.InputVim.InsertEntry;
  var Register = window.InputVim.Register;
  var TU = window.InputVim.TextUtils;
  var MR = window.InputVim.MotionResolver;

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
    this._redo = [];
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

  function setCursor(el, pos) {
    try {
      pos = TU.clamp(pos, 0, el.value.length);
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

  // ── Visual line helpers (soft-wrap aware) ────────────

  var _measureCanvas = null;
  function getMeasureCtx() {
    if (!_measureCanvas) _measureCanvas = document.createElement('canvas');
    return _measureCanvas.getContext('2d');
  }

  function setupMeasureCtx(el) {
    var computed = window.getComputedStyle(el);
    var ctx = getMeasureCtx();
    ctx.font = computed.font ||
      (computed.fontStyle + ' ' + computed.fontVariant + ' ' +
       computed.fontWeight + ' ' + computed.fontSize + ' ' + computed.fontFamily);
    if (ctx.letterSpacing !== undefined) ctx.letterSpacing = computed.letterSpacing || '0px';
    if (ctx.wordSpacing !== undefined) ctx.wordSpacing = computed.wordSpacing || '0px';
    return ctx;
  }

  function computeVisualLines(text, ctx, contentWidth) {
    var lines = [];
    var lineStart = 0;
    var i = 0;

    while (i <= text.length) {
      if (i === text.length || text[i] === '\n') {
        lines.push({ start: lineStart, end: i });
        lineStart = i + 1;
        i++;
        continue;
      }

      var lineWidth = ctx.measureText(text.substring(lineStart, i + 1)).width;

      if (lineWidth > contentWidth && i > lineStart && text[i] !== ' ' && text[i] !== '\t') {
        var wrapAt = i;
        for (var j = i - 1; j > lineStart; j--) {
          if (text[j] === ' ' || text[j] === '\t' || text[j] === '-') {
            wrapAt = j + 1;
            break;
          }
        }
        lines.push({ start: lineStart, end: wrapAt });
        lineStart = wrapAt;
        i = wrapAt;
        continue;
      }

      i++;
    }

    if (lines.length === 0) lines.push({ start: 0, end: 0 });
    return lines;
  }

  function getElementVisualLines(el) {
    if (el.tagName === 'INPUT') return null;
    var computed = window.getComputedStyle(el);
    var paddingLeft = parseFloat(computed.paddingLeft) || 0;
    var paddingRight = parseFloat(computed.paddingRight) || 0;
    var contentWidth = el.clientWidth - paddingLeft - paddingRight;
    if (contentWidth <= 0) return null;
    var ctx = setupMeasureCtx(el);
    return computeVisualLines(el.value, ctx, contentWidth);
  }

  // ── InputHandler ────────────────────────────────────

  function InputHandler() {
    this._undoMap = new WeakMap();
    this._desiredCol = -1;
    this._lastYankFrom = null;
    this._lastYankTo = null;
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
    var text = el.value;
    var pos = el.selectionStart;

    console.log('[IH-DEBUG execute] ' + JSON.stringify({
      commandType: command.type,
      operator: command.operator,
      motion: command.motion,
      count: command.count,
      entry: command.entry,
      selectionStart: el.selectionStart,
      selectionEnd: el.selectionEnd,
    }));

    console.log('[IH-DEBUG execute pos] ' + JSON.stringify({ pos: pos, textLen: text.length, text: text }));

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
        this._doVisualOperator(el, command, engine);
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
      case CommandType.SCROLL_DOWN:
        this._doScrollJump(el, command.count, false);
        break;
      case CommandType.SCROLL_UP:
        this._doScrollJump(el, command.count, true);
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
    var text = el.value;
    var pos = el.selectionStart;
    var vLines = isVertical ? getElementVisualLines(el) : null;

    console.log('[IH-DEBUG _doMotion] ' + JSON.stringify({
      motion: command.motion,
      pos: pos,
      count: command.count,
      char: command.char,
      isVertical: isVertical,
    }));

    if (isVertical) {
      if (this._desiredCol < 0) {
        if (vLines) {
          var vi = TU.findVisualLine(vLines, pos);
          this._desiredCol = pos - vLines[vi].start;
        } else {
          var info = TU.getLineInfo(text, pos);
          this._desiredCol = info.col;
        }
      }
    } else {
      this._desiredCol = -1;
    }

    var newPos = MR.resolveMotion(text, pos, command.motion, command.count, false, this._desiredCol, command.char, vLines);

    if (text.length > 0) {
      var li = TU.getLineInfo(text, newPos);
      var maxPos = li.lineEnd > li.lineStart ? li.lineEnd - 1 : li.lineStart;
      if (newPos > maxPos) newPos = maxPos;
    }

    console.log('[IH-DEBUG _doMotion result] ' + JSON.stringify({
      motion: command.motion,
      oldPos: pos,
      newPos: newPos,
      charAtNewPos: text[newPos],
    }));

    setCursor(el, newPos);
  };

  // ── Operator + Motion ───────────────────────────────

  InputHandler.prototype._doOperatorMotion = function (el, command) {
    var text = el.value;
    var pos = el.selectionStart;
    var linewise = command.motion === MotionType.LINE_UP || command.motion === MotionType.LINE_DOWN;
    var vLines = linewise ? getElementVisualLines(el) : null;
    var range = MR.resolveMotion(text, pos, command.motion, command.count, true, -1, command.char, vLines);
    console.log('[IH-DEBUG _doOperatorMotion] ' + JSON.stringify({
      operator: command.operator, motion: command.motion, pos: pos,
      from: range.from, to: range.to, linewise: linewise,
    }));

    if (linewise) {
      var startLine = TU.getLineInfo(text, range.from);
      var endLine = TU.getLineInfo(text, range.to);
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

    el.value = text.substring(0, range.from) + text.substring(range.to);
    setCursor(el, range.from);
    TU.fireInputEvent(el);
  };

  // ── Operator + Text Object ──────────────────────────

  InputHandler.prototype._doOperatorTextObject = function (el, command) {
    var text = el.value;
    var pos = el.selectionStart;
    var range = MR.resolveTextObject(text, pos, command.object, command.modifier, command.char);
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

    el.value = text.substring(0, range.from) + text.substring(range.to);
    setCursor(el, range.from);
    TU.fireInputEvent(el);
  };

  // ── Line Operator ───────────────────────────────────

  InputHandler.prototype._doLineOperator = function (el, command) {
    var text = el.value;
    var pos = el.selectionStart;
    var lineNum = TU.getLineNumber(text, pos);
    var lines = text.split('\n');
    var count = Math.min(command.count, lines.length - lineNum);

    var startOffset = TU.getLineStartOffset(text, lineNum);
    var endLine = lineNum + count - 1;
    var endOffset = endLine < lines.length - 1
      ? TU.getLineStartOffset(text, endLine + 1)
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

    el.value = before + after;

    var newPos = Math.min(startOffset, el.value.length);
    var info = TU.getLineInfo(el.value, newPos);
    var firstNonBlank = info.lineText.match(/^\s*/);
    setCursor(el, info.lineStart + (firstNonBlank ? firstNonBlank[0].length : 0));

    TU.fireInputEvent(el);
  };

  // ── Insert Entry ────────────────────────────────────

  InputHandler.prototype._doInsertEnter = function (el, command) {
    this._saveUndo(el);

    var text = el.value;
    var pos = el.selectionStart;
    var info = TU.getLineInfo(text, pos);

    console.log('[IH-DEBUG _doInsertEnter] ' + JSON.stringify({
      entry: command.entry, pos: pos,
      lineStart: info.lineStart, lineEnd: info.lineEnd,
    }));

    switch (command.entry) {
      case InsertEntry.I_LOWER:
        break;
      case InsertEntry.A_LOWER:
        setCursor(el, Math.min(pos + 1, info.lineEnd));
        break;
      case InsertEntry.I_UPPER: {
        var vLinesI = getElementVisualLines(el);
        if (vLinesI) {
          var viI = TU.findVisualLine(vLinesI, pos);
          var vStartI = vLinesI[viI].start;
          var vTextI = text.substring(vStartI, vLinesI[viI].end);
          var mI = vTextI.match(/^\s*/);
          console.log('[IH-DEBUG I_UPPER] ' + JSON.stringify({
            pos: pos, viI: viI, vStart: vStartI, vEnd: vLinesI[viI].end,
            target: vStartI + (mI ? mI[0].length : 0),
          }));
          setCursor(el, vStartI + (mI ? mI[0].length : 0));
        } else {
          var firstNonBlank = info.lineText.match(/^\s*/);
          setCursor(el, info.lineStart + (firstNonBlank ? firstNonBlank[0].length : 0));
        }
        break;
      }
      case InsertEntry.A_UPPER: {
        var vLinesA = getElementVisualLines(el);
        if (vLinesA) {
          var viA = TU.findVisualLine(vLinesA, pos);
          var vEndA = vLinesA[viA].end;
          var targetA = vEndA < info.lineEnd ? vEndA - 1 : vEndA;
          console.log('[IH-DEBUG A_UPPER] ' + JSON.stringify({
            pos: pos, viA: viA, vStart: vLinesA[viA].start, vEnd: vEndA,
            lineEnd: info.lineEnd, target: targetA,
          }));
          setCursor(el, targetA);
        } else {
          setCursor(el, info.lineEnd);
        }
        break;
      }
      case InsertEntry.O_LOWER: {
        var vLinesO = getElementVisualLines(el);
        if (vLinesO) {
          var viO = TU.findVisualLine(vLinesO, pos);
          var vEndO = vLinesO[viO].end;
          var insertO = vEndO < info.lineEnd ? '\n\n' : '\n';
          el.value = text.substring(0, vEndO) + insertO + text.substring(vEndO);
          setCursor(el, vEndO + 1);
        } else {
          el.value = text.substring(0, info.lineEnd) + '\n' + text.substring(info.lineEnd);
          setCursor(el, info.lineEnd + 1);
        }
        TU.fireInputEvent(el);
        break;
      }
      case InsertEntry.O_UPPER: {
        var vLinesU = getElementVisualLines(el);
        if (vLinesU) {
          var viU = TU.findVisualLine(vLinesU, pos);
          var vStartU = vLinesU[viU].start;
          if (vStartU > info.lineStart) {
            el.value = text.substring(0, vStartU) + '\n\n' + text.substring(vStartU);
            setCursor(el, vStartU + 1);
          } else {
            el.value = text.substring(0, vStartU) + '\n' + text.substring(vStartU);
            setCursor(el, vStartU);
          }
        } else {
          el.value = text.substring(0, info.lineStart) + '\n' + text.substring(info.lineStart);
          setCursor(el, info.lineStart);
        }
        TU.fireInputEvent(el);
        break;
      }
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
    var vLines = getElementVisualLines(el);
    if (vLines) {
      var vi = TU.findVisualLine(vLines, pos);
      var vl = vLines[vi];
      console.log('[IH-DEBUG _doVisualLineEnter vLines] ' + JSON.stringify({
        pos: pos, vi: vi, vStart: vl.start, vEnd: vl.end,
      }));
      setSelection(el, vl.start, vl.end);
    } else {
      var info = TU.getLineInfo(el.value, pos);
      var end = info.lineEnd;
      if (end < el.value.length) end++;
      setSelection(el, info.lineStart, end);
    }
  };

  InputHandler.prototype.extendVisualSelection = function (el, command, engine) {
    var anchor = engine.visualAnchor;
    var text = el.value;
    var isLinewise = engine.mode === 'VISUAL_LINE';
    var isVertical = command.motion === MotionType.LINE_UP || command.motion === MotionType.LINE_DOWN;
    var vLines = (isVertical || isLinewise) ? getElementVisualLines(el) : null;

    if (isVertical) {
      if (this._desiredCol < 0) {
        if (vLines) {
          var vi = TU.findVisualLine(vLines, engine.visualHead);
          this._desiredCol = engine.visualHead - vLines[vi].start;
        } else {
          var headInfo = TU.getLineInfo(text, engine.visualHead);
          this._desiredCol = headInfo.col;
        }
      }
    } else {
      this._desiredCol = -1;
    }

    setCursor(el, engine.visualHead);

    var newPos = MR.resolveMotion(text, engine.visualHead, command.motion, command.count, false, this._desiredCol, command.char, vLines);
    engine.visualHead = newPos;

    if (isLinewise) {
      if (vLines) {
        var anchorVi = TU.findVisualLine(vLines, anchor);
        var headVi = TU.findVisualLine(vLines, newPos);
        if (newPos >= anchor) {
          setSelection(el, vLines[anchorVi].start, vLines[headVi].end);
        } else {
          setSelection(el, vLines[headVi].start, vLines[anchorVi].end);
        }
      } else {
        var anchorLine = TU.getLineInfo(text, anchor);
        var headLine = TU.getLineInfo(text, newPos);
        if (newPos >= anchor) {
          var end = headLine.lineEnd;
          if (end < text.length) end++;
          setSelection(el, anchorLine.lineStart, end);
        } else {
          var end2 = anchorLine.lineEnd;
          if (end2 < text.length) end2++;
          setSelection(el, headLine.lineStart, end2);
        }
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
    var range = MR.resolveTextObject(text, pos, command.object, command.modifier, command.char);
    if (!range) return;
    engine.visualAnchor = range.from;
    setSelection(el, range.from, range.to);
  };

  InputHandler.prototype._doVisualOperator = function (el, command, engine) {
    var text = el.value;
    var start = el.selectionStart;
    var end = el.selectionEnd;
    var regType = command.lineWise ? 'line' : 'char';

    if (command.lineWise) {
      var vLines = getElementVisualLines(el);
      if (vLines && engine) {
        var anchor = engine.visualAnchor;
        var head = engine.visualHead;
        var anchorVi = TU.findVisualLine(vLines, anchor);
        var headVi = TU.findVisualLine(vLines, head);
        var startVi = Math.min(anchorVi, headVi);
        var endVi = Math.max(anchorVi, headVi);
        start = vLines[startVi].start;
        end = vLines[endVi].end;
        if (end < text.length) end++;
        else if (start > 0) start--;
        console.log('[IH-DEBUG _doVisualOperator lineWise vLines] ' + JSON.stringify({
          anchor: anchor, head: head, anchorVi: anchorVi, headVi: headVi,
          from: start, to: end,
        }));
      } else {
        var info = TU.getLineInfo(text, start);
        start = info.lineStart;
        var endInfo = TU.getLineInfo(text, Math.max(end - 1, start));
        end = endInfo.lineEnd;
        if (end < text.length) end++;
        console.log('[IH-DEBUG _doVisualOperator lineWise real] ' + JSON.stringify({
          from: start, to: end,
        }));
      }
    }

    var selected = text.substring(start, end);

    if (command.operator === OperatorType.YANK) {
      Register.set(selected, regType);
      this._lastYankFrom = start;
      this._lastYankTo = end;
      setCursor(el, start);
      return;
    }

    this._saveUndo(el);
    Register.set(selected, regType);

    el.value = text.substring(0, start) + text.substring(end);
    setCursor(el, Math.min(start, el.value.length));
    TU.fireInputEvent(el);
  };

  // ── Paste ───────────────────────────────────────────

  InputHandler.prototype._doPaste = function (el, before) {
    var reg = Register.get();
    if (!reg.content) return;

    this._saveUndo(el);

    var text = el.value;
    var pos = el.selectionStart;

    if (reg.type === 'line') {
      var info = TU.getLineInfo(text, pos);
      if (before) {
        var content = reg.content;
        if (content[content.length - 1] !== '\n') content += '\n';
        el.value = text.substring(0, info.lineStart) + content + text.substring(info.lineStart);
        setCursor(el, info.lineStart);
      } else {
        var content2 = reg.content;
        if (content2[content2.length - 1] !== '\n') content2 += '\n';
        el.value = text.substring(0, info.lineEnd) + '\n' + content2.replace(/\n$/, '') + text.substring(info.lineEnd);
        setCursor(el, info.lineEnd + 1);
      }
    } else {
      var cInfo = TU.getLineInfo(text, pos);
      var insertPos = before ? pos : Math.min(pos + 1, cInfo.lineEnd);
      insertPos = TU.clamp(insertPos, 0, text.length);
      el.value = text.substring(0, insertPos) + reg.content + text.substring(insertPos);
      setCursor(el, insertPos + reg.content.length - 1);
    }

    TU.fireInputEvent(el);
  };

  // ── Undo ────────────────────────────────────────────

  InputHandler.prototype._doUndo = function (el, count) {
    var undo = this._getUndo(el);
    for (var i = 0; i < count; i++) {
      var state = undo.pop();
      if (!state) break;
      undo.pushRedo({
        value: el.value,
        selectionStart: el.selectionStart,
        selectionEnd: el.selectionEnd,
      });
      el.value = state.value;
      el.selectionStart = state.selectionStart;
      el.selectionEnd = state.selectionEnd;
    }
    TU.fireInputEvent(el);
  };

  InputHandler.prototype._doRedo = function (el, count) {
    var undo = this._getUndo(el);
    for (var i = 0; i < count; i++) {
      var state = undo.popRedo();
      if (!state) break;
      undo._stack.push({
        value: el.value,
        selectionStart: el.selectionStart,
        selectionEnd: el.selectionEnd,
      });
      el.value = state.value;
      el.selectionStart = state.selectionStart;
      el.selectionEnd = state.selectionEnd;
    }
    TU.fireInputEvent(el);
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
    TU.fireInputEvent(el);
  };

  // ── Delete char under cursor (x) ────────────────────

  InputHandler.prototype._doDeleteChar = function (el, command) {
    var text = el.value;
    var pos = el.selectionStart;
    var info = TU.getLineInfo(text, pos);
    var count = Math.min(command.count, info.lineEnd - pos);
    if (count <= 0) return;

    this._saveUndo(el);
    var deleted = text.substring(pos, pos + count);
    Register.set(deleted, 'char');
    el.value = text.substring(0, pos) + text.substring(pos + count);

    var newInfo = TU.getLineInfo(el.value, Math.min(pos, el.value.length));
    var maxPos = newInfo.lineEnd > newInfo.lineStart ? newInfo.lineEnd - 1 : newInfo.lineStart;
    setCursor(el, Math.min(pos, maxPos));
    TU.fireInputEvent(el);
  };

  // ── Escape ──────────────────────────────────────────

  InputHandler.prototype._doEscape = function (el, command) {
    console.log('[IH-DEBUG _doEscape] ' + JSON.stringify({
      fromMode: command.fromMode, pos: el.selectionStart,
      visualHead: command.visualHead,
    }));
    if (command.fromMode === 'INSERT') {
      var pos = el.selectionStart;
      var vLines = getElementVisualLines(el);
      var lineStart;
      if (vLines) {
        var vi = TU.findVisualLine(vLines, pos);
        lineStart = vLines[vi].start;
      } else {
        lineStart = TU.getLineInfo(el.value, pos).lineStart;
      }
      if (pos > lineStart) setCursor(el, pos - 1);
    } else if (command.fromMode === 'NORMAL') {
      el.blur();
    } else if (command.fromMode === 'VISUAL' || command.fromMode === 'VISUAL_LINE') {
      setCursor(el, command.visualHead != null ? command.visualHead : el.selectionStart);
    }
  };

  // ── Scroll Jump (Ctrl+D / Ctrl+U) ──────────────────

  InputHandler.prototype._doScrollJump = function (el, count, isUp) {
    var vLines = getElementVisualLines(el);
    if (!vLines || vLines.length <= 1) {
      var text = el.value;
      var lines = text.split('\n');
      if (lines.length <= 1) return;
      var curLine = TU.getLineNumber(text, el.selectionStart);
      if (isUp && curLine === 0) return;
      if (!isUp && curLine === lines.length - 1) return;

      var targetLine = isUp
        ? Math.max(0, curLine - count)
        : Math.min(lines.length - 1, curLine + count);

      var info = TU.getLineInfo(text, el.selectionStart);
      var col = el.selectionStart - info.lineStart;
      var targetOffset = TU.getLineStartOffset(text, targetLine);
      var targetInfo = TU.getLineInfo(text, targetOffset);
      var maxCol = Math.max(0, targetInfo.lineEnd - targetInfo.lineStart - 1);
      setCursor(el, targetInfo.lineStart + Math.min(col, maxCol));
      return;
    }

    var vi = TU.findVisualLine(vLines, el.selectionStart);

    if (isUp && vi === 0) return;
    if (!isUp && vi === vLines.length - 1) return;

    var targetVi = isUp
      ? Math.max(0, vi - count)
      : Math.min(vLines.length - 1, vi + count);

    var currentVL = vLines[vi];
    var col2 = el.selectionStart - currentVL.start;

    var targetVL = vLines[targetVi];
    var targetLen = targetVL.end - targetVL.start;
    var maxCol2 = Math.max(0, targetLen - 1);
    if (targetVL.start === targetVL.end) maxCol2 = 0;
    setCursor(el, targetVL.start + Math.min(col2, maxCol2));
  };

  // ── Cursor rect (for overlay block cursor) ──────────

  function getCaretCoordinates(el, position) {
    var computed = window.getComputedStyle(el);
    var isInput = el.tagName === 'INPUT';

    var paddingLeft = parseFloat(computed.paddingLeft) || 0;
    var paddingRight = parseFloat(computed.paddingRight) || 0;
    var paddingTop = parseFloat(computed.paddingTop) || 0;
    var borderLeft = parseFloat(computed.borderLeftWidth) || 0;
    var borderTop = parseFloat(computed.borderTopWidth) || 0;
    var fontSize = parseFloat(computed.fontSize) || 16;
    var lineHeight = parseFloat(computed.lineHeight);
    if (isNaN(lineHeight)) lineHeight = Math.ceil(fontSize * 1.2);

    var ctx = setupMeasureCtx(el);
    var text = el.value;
    var offsetX = paddingLeft + borderLeft;
    var offsetY = paddingTop + borderTop;

    if (isInput) {
      var ix = ctx.measureText(text.substring(0, position)).width;
      var iw = position < text.length ? ctx.measureText(text[position]).width : fontSize * 0.6;
      return { top: offsetY, left: ix + offsetX, width: iw, height: lineHeight };
    }

    var contentWidth = el.clientWidth - paddingLeft - paddingRight;
    var vLines = computeVisualLines(text, ctx, contentWidth);
    var vi = TU.findVisualLine(vLines, position);
    var vl = vLines[vi];

    var x = ctx.measureText(text.substring(vl.start, position)).width;
    var w = (position < text.length && text[position] !== '\n')
      ? ctx.measureText(text[position]).width : fontSize * 0.6;
    return { top: vi * lineHeight + offsetY, left: x + offsetX, width: w, height: lineHeight };
  }

  InputHandler.prototype.ensureCursorVisible = function (el) {
    var pos;
    try { pos = el.selectionStart; } catch (e) { return; }

    var coords = getCaretCoordinates(el, pos);
    var computed = window.getComputedStyle(el);

    if (el.tagName === 'INPUT') {
      var paddingLeft = parseFloat(computed.paddingLeft) || 0;
      var paddingRight = parseFloat(computed.paddingRight) || 0;
      var borderLeft = parseFloat(computed.borderLeftWidth) || 0;
      var visibleWidth = el.clientWidth - paddingLeft - paddingRight;
      var cursorLeft = coords.left - paddingLeft - borderLeft;
      var cursorRight = cursorLeft + coords.width;

      if (cursorRight > el.scrollLeft + visibleWidth) {
        el.scrollLeft = cursorRight - visibleWidth;
      } else if (cursorLeft < el.scrollLeft) {
        el.scrollLeft = cursorLeft;
      }
      return;
    }

    var borderTop = parseFloat(computed.borderTopWidth) || 0;
    var paddingBottom = parseFloat(computed.paddingBottom) || 0;

    var cursorTop = coords.top - borderTop;
    var cursorBottom = cursorTop + coords.height;
    var visibleHeight = el.clientHeight - paddingBottom;

    if (cursorBottom > el.scrollTop + visibleHeight) {
      el.scrollTop = cursorBottom - visibleHeight;
    } else if (cursorTop < el.scrollTop) {
      el.scrollTop = cursorTop;
    }
  };

  InputHandler.prototype.getCursorRect = function (el, overridePos) {
    var pos;
    try { pos = overridePos != null ? overridePos : el.selectionStart; } catch (e) { return null; }

    var coords = getCaretCoordinates(el, pos);
    var elRect = el.getBoundingClientRect();

    var x = elRect.left + coords.left - (el.scrollLeft || 0);
    var y = elRect.top + coords.top - (el.scrollTop || 0);

    if (x + coords.width < elRect.left || x > elRect.right ||
        y + coords.height < elRect.top || y > elRect.bottom) {
      return null;
    }

    return { x: x, y: y, width: coords.width, height: coords.height };
  };

  // ── Yank highlight ─────────────────────────────────

  InputHandler.prototype.flashYank = function (el, onDone) {
    var from = this._lastYankFrom;
    var to = this._lastYankTo;
    this._lastYankFrom = null;
    this._lastYankTo = null;
    if (from == null || to == null || from === to) { if (onDone) onDone(); return; }
    var savedStart, savedEnd;
    try {
      savedStart = el.selectionStart;
      savedEnd = el.selectionEnd;
      el.selectionStart = from;
      el.selectionEnd = to;
    } catch (e) { if (onDone) onDone(); return; }
    setTimeout(function () {
      try {
        el.selectionStart = savedStart;
        el.selectionEnd = savedEnd;
      } catch (e) {}
      if (onDone) onDone();
    }, 200);
  };

  // ── Mouse selection detection ─────────────────────

  InputHandler.prototype.getMouseSelection = function (el) {
    try {
      if (el.selectionStart === el.selectionEnd) return null;
      if (el.selectionDirection === 'backward') {
        return { anchor: el.selectionEnd - 1, head: el.selectionStart };
      }
      return { anchor: el.selectionStart, head: el.selectionEnd - 1 };
    } catch (e) {
      return null;
    }
  };

  // ── Expose ──────────────────────────────────────────

  window.InputVim = window.InputVim || {};
  window.InputVim.InputHandler = InputHandler;
})();
