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

    console.log('[IH exec] ' + JSON.stringify({ type: command.type, op: command.operator, m: command.motion, entry: command.entry, pos: pos, len: text.length, val: text }));

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
    var isHL = command.motion === MotionType.CHAR_LEFT || command.motion === MotionType.CHAR_RIGHT;
    var text = el.value;
    var pos = el.selectionStart;
    // FIX: Compute vLines for h/l too so they clamp to visual line boundaries.
    // WHY: h/l should not cross visual lines, matching the behavior of not
    // crossing real lines.
    // WARNING: Removing isHL here lets h/l cross visual line boundaries.
    // FIX: Also compute vLines for $ and ^ so they respect visual lines.
    // WHY: User wants $ and ^ to navigate within visual (soft-wrapped) lines.
    // WARNING: Removing LINE_END/FIRST_NON_BLANK here makes them use real lines only.
    var needsVLines = isVertical || isHL ||
      command.motion === MotionType.LINE_END ||
      command.motion === MotionType.FIRST_NON_BLANK;
    var vLines = needsVLines ? getElementVisualLines(el) : null;

    console.log('[IH motion] ' + JSON.stringify({ m: command.motion, pos: pos }));

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

    console.log('[IH motion] ' + JSON.stringify({ from: pos, to: newPos }));

    setCursor(el, newPos);
  };

  // ── Operator + Motion ───────────────────────────────

  InputHandler.prototype._doOperatorMotion = function (el, command) {
    var text = el.value;
    var pos = el.selectionStart;
    var linewise = command.motion === MotionType.LINE_UP || command.motion === MotionType.LINE_DOWN;
    var needsVLines = linewise ||
      command.motion === MotionType.LINE_END ||
      command.motion === MotionType.FIRST_NON_BLANK;
    var vLines = needsVLines ? getElementVisualLines(el) : null;
    var range = MR.resolveMotion(text, pos, command.motion, command.count, true, -1, command.char, vLines);
    console.log('[IH opMotion] ' + JSON.stringify({ op: command.operator, m: command.motion, from: range.from, to: range.to }));

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
    // FIX: Clamp cursor to last character on line after delete.
    // WHY: When dw deletes the last word on a line, range.from lands on the
    // newline character, placing the cursor on the next line.
    // WARNING: Removing this causes the cursor to jump to the wrong line after dw.
    var cursorPos = range.from;
    if (command.operator === OperatorType.DELETE && el.value.length > 0) {
      cursorPos = Math.min(cursorPos, el.value.length - 1);
      var li = TU.getLineInfo(el.value, cursorPos);
      var maxPos = li.lineEnd > li.lineStart ? li.lineEnd - 1 : li.lineStart;
      if (cursorPos > maxPos) cursorPos = maxPos;
    }
    setCursor(el, cursorPos);
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

  // FIX: dd/cc/yy use visual lines so they operate on soft-wrapped lines, not real lines
  // WHY: With soft wrap, a single real line may span multiple visual lines; dd should
  //   delete only the current visual line, matching Vim's behavior in wrap mode
  // WARNING: Removing this makes dd/cc/yy delete entire real lines ignoring soft wraps
  InputHandler.prototype._doLineOperator = function (el, command) {
    var text = el.value;
    var pos = el.selectionStart;
    var vLines = getElementVisualLines(el);

    var startOffset, endOffset, deleted;

    if (vLines) {
      var vi = TU.findVisualLine(vLines, pos);
      var count = Math.min(command.count, vLines.length - vi);
      var firstVl = vLines[vi];
      var lastVl = vLines[vi + count - 1];
      startOffset = firstVl.start;
      endOffset = lastVl.end;
      // Include trailing newline if present, or leading newline if at end
      if (endOffset < text.length && text[endOffset] === '\n') {
        endOffset++;
      } else if (startOffset > 0 && text[startOffset - 1] === '\n') {
        startOffset--;
      }
      deleted = text.substring(startOffset, endOffset);
    } else {
      var lineNum = TU.getLineNumber(text, pos);
      var lines = text.split('\n');
      var count = Math.min(command.count, lines.length - lineNum);
      startOffset = TU.getLineStartOffset(text, lineNum);
      var endLine = lineNum + count - 1;
      endOffset = endLine < lines.length - 1
        ? TU.getLineStartOffset(text, endLine + 1)
        : text.length;
      deleted = text.substring(startOffset, endOffset);
    }

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
    var newVLines = getElementVisualLines(el);
    if (newVLines) {
      var newVi = TU.findVisualLine(newVLines, Math.min(newPos, el.value.length));
      var newVl = newVLines[newVi];
      var vlText = el.value.substring(newVl.start, newVl.end);
      var fnb = vlText.match(/^\s*/);
      setCursor(el, newVl.start + (fnb ? fnb[0].length : 0));
    } else {
      var info = TU.getLineInfo(el.value, newPos);
      var firstNonBlank = info.lineText.match(/^\s*/);
      setCursor(el, info.lineStart + (firstNonBlank ? firstNonBlank[0].length : 0));
    }

    TU.fireInputEvent(el);
  };

  // ── Insert Entry ────────────────────────────────────

  InputHandler.prototype._doInsertEnter = function (el, command) {
    this._saveUndo(el);

    var text = el.value;
    var pos = el.selectionStart;
    var info = TU.getLineInfo(text, pos);

    console.log('[IH insert] ' + JSON.stringify({ entry: command.entry, pos: pos }));

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
          console.log('[IH I] ' + JSON.stringify({ pos: pos, vStart: vStartI, vEnd: vLinesI[viI].end }));
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
          console.log('[IH A] ' + JSON.stringify({ pos: pos, vEnd: vEndA, lineEnd: info.lineEnd }));
          setCursor(el, targetA);
        } else {
          setCursor(el, info.lineEnd);
        }
        break;
      }
      // FIX: Auto-indent and smart-indent for o command (gated by settings)
      // WHY: New lines should preserve indentation and add extra indent after {
      // WARNING: Removing this will lose auto-indent/smart-indent on o command
      case InsertEntry.O_LOWER: {
        var Settings_oL = window.InputVim.Settings;
        var tabSize_oL = Settings_oL.get('tabSize');
        var indentMode_oL = Settings_oL.get('indentMode');
        var autoIndent_oL = indentMode_oL === 'auto' || indentMode_oL === 'smart';
        var smartIndent_oL = indentMode_oL === 'smart';
        var trimmed_oL = info.lineText.trimEnd();
        var smartO = smartIndent_oL && trimmed_oL.length > 0 && trimmed_oL[trimmed_oL.length - 1] === '{';
        var vLinesO = getElementVisualLines(el);
        if (vLinesO) {
          var viO = TU.findVisualLine(vLinesO, pos);
          var vEndO = vLinesO[viO].end;
          var midBlockO = vEndO < info.lineEnd;
          var insertO = midBlockO ? '\n\n' : '\n';
          var oIndent = '';
          if (!midBlockO && autoIndent_oL) {
            oIndent = TU.computeNewLineIndent(info.lineText, smartO, tabSize_oL);
          }
          el.value = text.substring(0, vEndO) + insertO + oIndent + text.substring(vEndO);
          setCursor(el, vEndO + 1 + oIndent.length);
        } else {
          var oIndent2 = autoIndent_oL ? TU.computeNewLineIndent(info.lineText, smartO, tabSize_oL) : '';
          el.value = text.substring(0, info.lineEnd) + '\n' + oIndent2 + text.substring(info.lineEnd);
          setCursor(el, info.lineEnd + 1 + oIndent2.length);
        }
        TU.fireInputEvent(el);
        break;
      }
      // FIX: Auto-indent for O command, with smart-indent between braces (gated by settings)
      // WHY: New lines should preserve indentation; O on } after { should smart-indent
      // WARNING: Removing this will lose auto-indent on O command
      case InsertEntry.O_UPPER: {
        var Settings_oU = window.InputVim.Settings;
        var tabSize_oU = Settings_oU.get('tabSize');
        var indentMode_oU = Settings_oU.get('indentMode');
        var autoIndent_oU = indentMode_oU === 'auto' || indentMode_oU === 'smart';
        var smartIndent_oU = indentMode_oU === 'smart';
        var oUIndent = '';
        if (autoIndent_oU) {
          // Smart-indent for O: if current line starts with } and prev line ends with {
          var oUSmartIndent = false;
          var oUBaseText = info.lineText;
          if (smartIndent_oU) {
            var oUFirstChar = info.lineText.trimStart();
            if (oUFirstChar.length > 0 && oUFirstChar[0] === '}') {
              var lineNum_oU = TU.getLineNumber(text, pos);
              if (lineNum_oU > 0) {
                var prevStart_oU = TU.getLineStartOffset(text, lineNum_oU - 1);
                var prevInfo_oU = TU.getLineInfo(text, prevStart_oU);
                var prevTrimmed_oU = prevInfo_oU.lineText.trimEnd();
                if (prevTrimmed_oU.length > 0 && prevTrimmed_oU[prevTrimmed_oU.length - 1] === '{') {
                  oUSmartIndent = true;
                  oUBaseText = prevInfo_oU.lineText;
                }
              }
            }
          }
          oUIndent = TU.computeNewLineIndent(oUBaseText, oUSmartIndent, tabSize_oU);
        }
        var vLinesU = getElementVisualLines(el);
        if (vLinesU) {
          var viU = TU.findVisualLine(vLinesU, pos);
          var vStartU = vLinesU[viU].start;
          if (vStartU > info.lineStart) {
            el.value = text.substring(0, vStartU) + '\n\n' + text.substring(vStartU);
            setCursor(el, vStartU + 1);
          } else {
            el.value = text.substring(0, vStartU) + oUIndent + '\n' + text.substring(vStartU);
            setCursor(el, vStartU + oUIndent.length);
          }
        } else {
          el.value = text.substring(0, info.lineStart) + oUIndent + '\n' + text.substring(info.lineStart);
          setCursor(el, info.lineStart + oUIndent.length);
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
      console.log('[IH V-line] ' + JSON.stringify({ pos: pos, vStart: vl.start, vEnd: vl.end }));
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
    var needsVLines = isVertical || isLinewise ||
      command.motion === MotionType.LINE_END ||
      command.motion === MotionType.FIRST_NON_BLANK;
    var vLines = needsVLines ? getElementVisualLines(el) : null;

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
        console.log('[IH visOp vLines] ' + JSON.stringify({ from: start, to: end }));
      } else {
        var info = TU.getLineInfo(text, start);
        start = info.lineStart;
        var endInfo = TU.getLineInfo(text, Math.max(end - 1, start));
        end = endInfo.lineEnd;
        if (end < text.length) end++;
        console.log('[IH visOp real] ' + JSON.stringify({ from: start, to: end }));
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

    // FIX: Line-mode paste respects visual lines so p/P paste relative to visual line
    // WHY: If dd yanks a visual line, p should paste at the visual line boundary
    // WARNING: Removing this makes line-mode paste use real line boundaries only
    if (reg.type === 'line') {
      var vLines = getElementVisualLines(el);
      var lineStart, lineEnd;
      if (vLines) {
        var vi = TU.findVisualLine(vLines, pos);
        lineStart = vLines[vi].start;
        lineEnd = vLines[vi].end;
      } else {
        var info = TU.getLineInfo(text, pos);
        lineStart = info.lineStart;
        lineEnd = info.lineEnd;
      }
      if (before) {
        var content = reg.content;
        if (content[content.length - 1] !== '\n') content += '\n';
        el.value = text.substring(0, lineStart) + content + text.substring(lineStart);
        setCursor(el, lineStart);
      } else {
        var content2 = reg.content;
        if (content2[content2.length - 1] !== '\n') content2 += '\n';
        el.value = text.substring(0, lineEnd) + '\n' + content2.replace(/\n$/, '') + text.substring(lineEnd);
        setCursor(el, lineEnd + 1);
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
    console.log('[IH esc] ' + JSON.stringify({ from: command.fromMode, pos: el.selectionStart }));
    if (command.fromMode === 'INSERT') {
      var pos = el.selectionStart;
      // FIX: When pos is on \n (after A or a at end of line), use pos-1
      // for the visual line lookup so findVisualLine finds the correct line.
      // WHY: \n positions fall in a gap between visual lines, causing
      // findVisualLine to return the last visual line of the entire text.
      // The original pos is still used for cursor movement (pos-1 = last char).
      // WARNING: Removing this breaks A<esc> and a<esc> on last visual lines.
      var lookupPos = pos;
      if (lookupPos > 0 && el.value[lookupPos] === '\n') {
        lookupPos = lookupPos - 1;
      }
      var vLines = getElementVisualLines(el);
      var lineStart;
      if (vLines) {
        var vi = TU.findVisualLine(vLines, lookupPos);
        lineStart = vLines[vi].start;
      } else {
        lineStart = TU.getLineInfo(el.value, lookupPos).lineStart;
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

  // ── Scratch buffer support ──────────────────────────

  InputHandler.prototype.getFullText = function (el) {
    return el.value;
  };

  InputHandler.prototype.getCursorPosition = function (el) {
    return el.selectionStart;
  };

  InputHandler.prototype.setFullText = function (el, text) {
    el.value = text;
    el.selectionStart = el.selectionEnd = 0;
    TU.fireInputEvent(el);
  };

  // ── Expose ──────────────────────────────────────────

  window.InputVim = window.InputVim || {};
  window.InputVim.InputHandler = InputHandler;
  window.InputVim.InputHandler.getElementVisualLines = getElementVisualLines;
})();
