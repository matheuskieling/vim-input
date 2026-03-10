(function () {
  'use strict';

  var MotionType = window.InputVim.MotionType;
  var OperatorType = window.InputVim.OperatorType;
  var CommandType = window.InputVim.CommandType;
  var InsertEntry = window.InputVim.InsertEntry;
  var Register = window.InputVim.Register;
  var TU = window.InputVim.TextUtils;
  var MR = window.InputVim.MotionResolver;

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

  // ── Visual line helpers for contenteditable ────────────

  function computeCEVisualLines(el, text) {
    if (text.length === 0) return [{ start: 0, end: 0 }];

    var lines = [];
    var lineStart = 0;
    var lastTop = -1;
    var tolerance = 2;

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

  // ── Undo stack ──────────────────────────────────────

  function UndoStack() {
    this._stack = [];
    this._redo = [];
    this._maxSize = 100;
  }

  UndoStack.prototype.push = function (el) {
    this._stack.push({ html: el.innerHTML, offset: flatOffsetFromSelection(el) });
    if (this._stack.length > this._maxSize) this._stack.shift();
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
        var vi = TU.findVisualLine(vLines, pos);
        this._desiredCol = pos - vLines[vi].start;
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

    setCursorAt(el, newPos);
  };

  ContentEditableHandler.prototype._doOperatorMotion = function (el, text, pos, command) {
    var linewise = command.motion === MotionType.LINE_UP || command.motion === MotionType.LINE_DOWN;
    var vLines = linewise ? computeCEVisualLines(el, text) : null;
    var range = MR.resolveMotion(text, pos, command.motion, command.count, true, -1, command.char, vLines);

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

    var newText = text.substring(0, range.from) + text.substring(range.to);
    el.textContent = newText;
    setCursorAt(el, range.from);
    TU.fireInputEvent(el);
  };

  ContentEditableHandler.prototype._doOperatorTextObject = function (el, text, pos, command) {
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

    var newText = text.substring(0, range.from) + text.substring(range.to);
    el.textContent = newText;
    setCursorAt(el, range.from);
    TU.fireInputEvent(el);
  };

  ContentEditableHandler.prototype._doLineOperator = function (el, text, pos, command) {
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

    el.textContent = before + after;
    setCursorAt(el, Math.min(startOffset, (before + after).length));
    TU.fireInputEvent(el);
  };

  ContentEditableHandler.prototype._doInsertEnter = function (el, text, pos, command) {
    this._saveUndo(el);

    var info = TU.getLineInfo(text, pos);
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
        TU.fireInputEvent(el);
        break;
      case InsertEntry.O_UPPER:
        el.textContent = text.substring(0, info.lineStart) + '\n' + text.substring(info.lineStart);
        setCursorAt(el, info.lineStart);
        TU.fireInputEvent(el);
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
    var vi = TU.findVisualLine(vLines, pos);
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
        var vi = TU.findVisualLine(vLines, engine.visualHead);
        this._desiredCol = engine.visualHead - vLines[vi].start;
      }
    } else {
      this._desiredCol = -1;
    }

    var newPos = MR.resolveMotion(text, engine.visualHead, command.motion, command.count, false, this._desiredCol, command.char, vLines);
    engine.visualHead = newPos;

    if (isLinewise) {
      var anchorVi = TU.findVisualLine(vLines, anchor);
      var headVi = TU.findVisualLine(vLines, newPos);
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
    var range = MR.resolveTextObject(text, pos, command.object, command.modifier, command.char);
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
      var pos = flatOffsetFromSelection(el);
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
    TU.fireInputEvent(el);
  };

  ContentEditableHandler.prototype._doPaste = function (el, text, pos, before) {
    var reg = Register.get();
    if (!reg.content) return;

    this._saveUndo(el);

    if (reg.type === 'line') {
      var info = TU.getLineInfo(text, pos);
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
      var cInfo = TU.getLineInfo(text, pos);
      var insertPos = before ? pos : Math.min(pos + 1, cInfo.lineEnd);
      insertPos = TU.clamp(insertPos, 0, text.length);
      var newText3 = text.substring(0, insertPos) + reg.content + text.substring(insertPos);
      el.textContent = newText3;
      setCursorAt(el, insertPos + reg.content.length - 1);
    }

    TU.fireInputEvent(el);
  };

  ContentEditableHandler.prototype._doUndo = function (el, count) {
    var undo = this._getUndo(el);
    for (var i = 0; i < count; i++) {
      var state = undo.pop();
      if (!state) break;
      undo.pushRedo({
        html: el.innerHTML,
        offset: flatOffsetFromSelection(el),
      });
      el.innerHTML = state.html;
      setCursorAt(el, state.offset);
    }
    TU.fireInputEvent(el);
  };

  ContentEditableHandler.prototype._doRedo = function (el, count) {
    var undo = this._getUndo(el);
    for (var i = 0; i < count; i++) {
      var state = undo.popRedo();
      if (!state) break;
      undo._stack.push({
        html: el.innerHTML,
        offset: flatOffsetFromSelection(el),
      });
      el.innerHTML = state.html;
      setCursorAt(el, state.offset);
    }
    TU.fireInputEvent(el);
  };

  ContentEditableHandler.prototype._doReplaceChar = function (el, text, pos, command) {
    if (pos >= text.length) return;
    this._saveUndo(el);
    var count = Math.min(command.count, text.length - pos);
    var replacement = '';
    for (var i = 0; i < count; i++) replacement += command.char;
    el.textContent = text.substring(0, pos) + replacement + text.substring(pos + count);
    setCursorAt(el, pos + count - 1);
    TU.fireInputEvent(el);
  };

  ContentEditableHandler.prototype._doDeleteChar = function (el, text, pos, command) {
    var info = TU.getLineInfo(text, pos);
    var count = Math.min(command.count, info.lineEnd - pos);
    if (count <= 0) return;

    this._saveUndo(el);
    var deleted = text.substring(pos, pos + count);
    Register.set(deleted, 'char');
    var newText = text.substring(0, pos) + text.substring(pos + count);
    el.textContent = newText;

    var newInfo = TU.getLineInfo(newText, Math.min(pos, newText.length));
    var maxPos = newInfo.lineEnd > newInfo.lineStart ? newInfo.lineEnd - 1 : newInfo.lineStart;
    setCursorAt(el, Math.min(pos, maxPos));
    TU.fireInputEvent(el);
  };

  ContentEditableHandler.prototype._doEscape = function (el, text, pos, command) {
    if (command.fromMode === 'INSERT') {
      var lineStart = TU.getLineInfo(text, pos).lineStart;
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

    var vi = TU.findVisualLine(vLines, pos);
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

  window.InputVim = window.InputVim || {};
  window.InputVim.ContentEditableHandler = ContentEditableHandler;
})();
