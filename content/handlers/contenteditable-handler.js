(function () {
  'use strict';

  var MotionType = window.InputVim.MotionType;
  var OperatorType = window.InputVim.OperatorType;
  var CommandType = window.InputVim.CommandType;
  var InsertEntry = window.InputVim.InsertEntry;
  var Register = window.InputVim.Register;
  var TU = window.InputVim.TextUtils;
  var MR = window.InputVim.MotionResolver;

  // ── Block detection helpers ───────────────────────

  var BLOCK_TAGS = {
    P:1, DIV:1, H1:1, H2:1, H3:1, H4:1, H5:1, H6:1,
    LI:1, UL:1, OL:1, BLOCKQUOTE:1, PRE:1, SECTION:1,
    ARTICLE:1, ASIDE:1, HEADER:1, FOOTER:1, NAV:1,
    MAIN:1, FIGURE:1, FIGCAPTION:1, TABLE:1, TR:1, TD:1, TH:1,
    DD:1, DT:1, DL:1, DETAILS:1, SUMMARY:1, ADDRESS:1
  };

  function _isBlock(node) {
    return node.nodeType === 1 && !!BLOCK_TAGS[node.tagName];
  }

  // A BR is a placeholder if nothing meaningful follows it in its parent
  function _isPlaceholderBR(br) {
    var next = br.nextSibling;
    while (next) {
      if (next.nodeType === 3 && next.textContent.length > 0) return false;
      if (next.nodeType === 1) return false;
      next = next.nextSibling;
    }
    return true;
  }

  // Get text content of a single block, treating placeholder BRs as empty
  function _blockText(block) {
    if (block.nodeType === 3) return block.textContent;
    var parts = [];
    function walk(node) {
      var child = node.firstChild;
      while (child) {
        if (child.nodeType === 3) {
          parts.push(child.textContent);
        } else if (child.nodeName === 'BR') {
          if (!_isPlaceholderBR(child)) parts.push('\n');
        } else if (child.nodeType === 1 && child.nodeName !== 'BR') {
          walk(child);
        }
        child = child.nextSibling;
      }
    }
    walk(block);
    return parts.join('');
  }

  // Get the direct block (or text node) children of el
  function _getBlocks(el) {
    var hasBlock = false;
    var child = el.firstChild;
    while (child) {
      if (_isBlock(child)) { hasBlock = true; break; }
      child = child.nextSibling;
    }
    if (!hasBlock) return [el]; // treat el as single block (plain text case)

    var blocks = [];
    child = el.firstChild;
    while (child) {
      if (child.nodeType === 1 || (child.nodeType === 3 && child.textContent.trim())) {
        blocks.push(child);
      }
      child = child.nextSibling;
    }
    return blocks.length ? blocks : [el];
  }

  function _childIdx(node) {
    var i = 0;
    var n = node.parentNode.firstChild;
    while (n && n !== node) { i++; n = n.nextSibling; }
    return i;
  }

  // ── Flat text helpers ───────────────────────────────

  function getFlatText(el) {
    var blocks = _getBlocks(el);
    var parts = [];
    for (var i = 0; i < blocks.length; i++) {
      parts.push(_blockText(blocks[i]));
    }
    var result = parts.join('\n');
    console.log('[CE getFlatText] ' + JSON.stringify({ len: result.length, blocks: blocks.length }));
    return result;
  }

  // Count characters in a node using our flat text model
  function _countChars(node) {
    if (node.nodeType === 3) return node.textContent.length;
    if (node.nodeName === 'BR') return _isPlaceholderBR(node) ? 0 : 1;
    var count = 0;
    var child = node.firstChild;
    while (child) {
      count += _countChars(child);
      child = child.nextSibling;
    }
    return count;
  }

  // Count flat offset from start of a block to a DOM position within it
  function _offsetInBlock(block, targetNode, targetOff) {
    if (block.nodeType === 3) {
      return targetNode === block ? Math.min(targetOff, block.textContent.length) : 0;
    }

    // If target is the block itself, count children up to targetOff
    if (targetNode === block) {
      var offset = 0;
      for (var i = 0; i < targetOff && i < block.childNodes.length; i++) {
        offset += _countChars(block.childNodes[i]);
      }
      return offset;
    }

    // Walk to find target
    var result = { offset: 0, done: false };
    function walk(container) {
      if (result.done) return;
      var child = container.firstChild;
      while (child && !result.done) {
        if (child === targetNode) {
          if (child.nodeType === 3) {
            result.offset += Math.min(targetOff, child.textContent.length);
          } else {
            for (var j = 0; j < targetOff && j < child.childNodes.length; j++) {
              result.offset += _countChars(child.childNodes[j]);
            }
          }
          result.done = true;
          return;
        }
        if (child.nodeType === 1 && child.contains && child.contains(targetNode)) {
          walk(child);
          return;
        }
        result.offset += _countChars(child);
        child = child.nextSibling;
      }
    }
    walk(block);
    return result.offset;
  }

  // Compute flat offset for a given DOM position
  function _flatOffsetAt(el, targetNode, targetOff) {
    var blocks = _getBlocks(el);
    var flatPos = 0;

    for (var i = 0; i < blocks.length; i++) {
      if (i > 0) flatPos++;
      var block = blocks[i];

      if (block === targetNode || (block.contains && block.contains(targetNode))) {
        return flatPos + _offsetInBlock(block, targetNode, targetOff);
      }

      flatPos += _blockText(block).length;
    }

    // Container-level position (between blocks)
    if (targetNode === el) {
      flatPos = 0;
      for (var j = 0; j < blocks.length; j++) {
        if (j > 0) flatPos++;
        if (_childIdx(blocks[j]) >= targetOff) return flatPos;
        flatPos += _blockText(blocks[j]).length;
      }
    }

    return flatPos;
  }

  function flatOffsetFromSelection(el) {
    var sel = window.getSelection();
    if (!sel.rangeCount) return 0;
    var range = sel.getRangeAt(0);
    var result = _flatOffsetAt(el, range.startContainer, range.startOffset);
    console.log('[CE flatOffset] ' + JSON.stringify({ pos: result }));
    return result;
  }

  // Find DOM position for a flat offset within a block
  function _domPosInBlock(block, localOffset) {
    if (block.nodeType === 3) {
      return { node: block, offset: Math.min(localOffset, block.textContent.length) };
    }

    if (localOffset === 0) {
      var walker = document.createTreeWalker(block, NodeFilter.SHOW_ALL, null, false);
      var n;
      while ((n = walker.nextNode())) {
        if (n.nodeType === 3) return { node: n, offset: 0 };
        if (n.nodeName === 'BR') return { node: n.parentNode, offset: _childIdx(n) };
      }
      return { node: block, offset: 0 };
    }

    // Walk content to find the position
    var remaining = localOffset;
    var result = null;

    function walk(container) {
      if (result) return;
      var child = container.firstChild;
      while (child && !result) {
        if (child.nodeType === 3) {
          if (remaining <= child.textContent.length) {
            result = { node: child, offset: remaining };
            return;
          }
          remaining -= child.textContent.length;
        } else if (child.nodeName === 'BR') {
          if (!_isPlaceholderBR(child)) {
            if (remaining === 0) {
              result = { node: child.parentNode, offset: _childIdx(child) };
              return;
            }
            remaining--;
            if (remaining === 0) {
              // Position right after this BR (the \n was consumed)
              result = { node: child.parentNode, offset: _childIdx(child) + 1 };
              return;
            }
          }
        } else if (child.nodeType === 1) {
          walk(child);
        }
        child = child.nextSibling;
      }
    }
    walk(block);

    if (result) return result;

    // Past end of block
    var lastWalker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, null, false);
    var last = null, node;
    while ((node = lastWalker.nextNode())) last = node;
    if (last) return { node: last, offset: last.textContent.length };
    return { node: block, offset: block.childNodes.length };
  }

  function selectionFromFlatOffset(el, offset) {
    var blocks = _getBlocks(el);

    if (offset <= 0 && blocks.length > 0) {
      return _domPosInBlock(blocks[0], 0);
    }

    var flatPos = 0;
    for (var i = 0; i < blocks.length; i++) {
      if (i > 0) flatPos++;
      var block = blocks[i];
      var blockLen = _blockText(block).length;

      if (offset <= flatPos + blockLen) {
        return _domPosInBlock(block, offset - flatPos);
      }

      flatPos += blockLen;
    }

    // Past end — return end of last block
    if (blocks.length > 0) {
      var lastBlock = blocks[blocks.length - 1];
      return _domPosInBlock(lastBlock, _blockText(lastBlock).length);
    }
    return { node: el, offset: 0 };
  }

  function setCursorAt(el, flatOffset) {
    var point = selectionFromFlatOffset(el, flatOffset);
    console.log('[CE setCursorAt] ' + JSON.stringify({ pos: flatOffset }));
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

  // ── Mutation helpers (execCommand with fallback) ────

  function _execCmd(cmd, value) {
    try {
      return document.execCommand(cmd, false, value);
    } catch (e) {
      return false;
    }
  }

  function deleteRange(el, from, to) {
    setSelectionRange(el, from, to);
    if (!_execCmd('delete')) {
      var text = getFlatText(el);
      el.textContent = text.substring(0, from) + text.substring(to);
    }
  }

  function insertTextAt(el, offset, str) {
    setCursorAt(el, offset);
    if (!_execCmd('insertText', str)) {
      var text = getFlatText(el);
      el.textContent = text.substring(0, offset) + str + text.substring(offset);
    }
    setCursorAt(el, offset + str.length);
  }

  function insertParagraphAt(el, offset) {
    setCursorAt(el, offset);
    // No fallback: execCommand returns false when editors like ProseMirror
    // prevent default on beforeinput, but they handle it internally.
    _execCmd('insertParagraph');
  }

  // ── Visual line helpers for contenteditable ────────────

  function computeCEVisualLines(el, text) {
    if (text.length === 0) return [{ start: 0, end: 0 }];

    // Guard for test environments (JSDOM) where Range.getBoundingClientRect
    // is not available. Fall back to one visual line per real line.
    var probe = document.createRange();
    if (typeof probe.getBoundingClientRect !== 'function') {
      var fallback = [];
      var fStart = 0;
      for (var fi = 0; fi <= text.length; fi++) {
        if (fi === text.length || text[fi] === '\n') {
          fallback.push({ start: fStart, end: fi });
          fStart = fi + 1;
        }
      }
      return fallback.length > 0 ? fallback : [{ start: 0, end: 0 }];
    }

    var blocks = _getBlocks(el);
    var lines = [];
    var flatPos = 0;

    for (var bi = 0; bi < blocks.length; bi++) {
      if (bi > 0) flatPos++; // \n separator between blocks
      var block = blocks[bi];
      var blockLen = _blockText(block).length;

      if (blockLen === 0) {
        // Empty block — one empty visual line
        lines.push({ start: flatPos, end: flatPos });
      } else {
        // Walk text in block, checking for soft wraps
        var blockStart = flatPos;
        var lineStart = flatPos;
        var lastTop = -1;
        var tolerance = 2;
        var localOffset = 0;

        var walker = document.createTreeWalker(block, NodeFilter.SHOW_ALL, null, false);
        var node;
        var range = document.createRange();

        while ((node = walker.nextNode())) {
          if (node.nodeType === 3) {
            var content = node.textContent;
            for (var ci = 0; ci < content.length; ci++) {
              var flatIdx = blockStart + localOffset;

              if (content[ci] === '\n') {
                lines.push({ start: lineStart, end: flatIdx });
                lineStart = flatIdx + 1;
                lastTop = -1;
                localOffset++;
                continue;
              }

              range.setStart(node, ci);
              range.setEnd(node, ci + 1);
              var rect = range.getBoundingClientRect();

              if (rect.height > 0 && lastTop >= 0 && rect.top - lastTop > tolerance) {
                lines.push({ start: lineStart, end: flatIdx });
                lineStart = flatIdx;
              }

              if (rect.height > 0) lastTop = rect.top;
              localOffset++;
            }
          } else if (node.nodeName === 'BR' && !_isPlaceholderBR(node)) {
            var flatIdx2 = blockStart + localOffset;
            lines.push({ start: lineStart, end: flatIdx2 });
            lineStart = flatIdx2 + 1;
            lastTop = -1;
            localOffset++;
          }
        }

        if (lineStart <= flatPos + blockLen) {
          lines.push({ start: lineStart, end: flatPos + blockLen });
        }
      }

      flatPos += blockLen;
    }

    if (lines.length === 0) lines.push({ start: 0, end: text.length });
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
    console.log('[CE exec] ' + JSON.stringify({ type: command.type, op: command.operator, m: command.motion, entry: command.entry }));

    var text = getFlatText(el);
    var pos = flatOffsetFromSelection(el);

    console.log('[CE exec] ' + JSON.stringify({ pos: pos, len: text.length, html: el.innerHTML.substring(0, 120) }));

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
        this._doVisualOperator(el, command, engine);
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
    var isHL = command.motion === MotionType.CHAR_LEFT || command.motion === MotionType.CHAR_RIGHT;
    var vLines = null;

    console.log('[CE motion] ' + JSON.stringify({ m: command.motion, pos: pos }));

    // FIX: Compute vLines for h/l too so they clamp to visual line boundaries.
    // WHY: h/l crossing visual lines causes cursor to land on \n separators
    // or render on wrong visual line in contenteditable.
    // WARNING: Removing isHL here lets h/l cross visual line boundaries.
    if (isVertical || isHL) {
      vLines = computeCEVisualLines(el, text);
    }

    if (isVertical) {
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

    console.log('[CE motion] ' + JSON.stringify({ from: pos, to: newPos }));

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

    deleteRange(el, range.from, range.to);
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

    deleteRange(el, range.from, range.to);
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

    var delFrom = startOffset;
    var delTo = endOffset;
    if (delFrom > 0 && text[delFrom - 1] === '\n' && delTo >= text.length) {
      delFrom--;
    }

    deleteRange(el, delFrom, delTo);
    var newText = getFlatText(el);
    setCursorAt(el, Math.min(delFrom, newText.length));
    TU.fireInputEvent(el);
  };

  ContentEditableHandler.prototype._doInsertEnter = function (el, text, pos, command) {
    this._saveUndo(el);

    var info = TU.getLineInfo(text, pos);
    switch (command.entry) {
      case InsertEntry.I_LOWER:
        break;
      case InsertEntry.A_LOWER:
        // FIX: Visual-line-aware "a" — at visual line boundary, use
        // sel.modify to keep cursor on current visual line.
        // WHY: setCursorAt(pos+1) at a visual line boundary renders on the
        // next visual line due to caret affinity. A<esc>a was jumping to
        // the next line on Jira/Slack/Outlook.
        // WARNING: Removing the vLines check causes a to jump to next visual line.
        if (info.lineStart < info.lineEnd) {
          var vLinesAl = computeCEVisualLines(el, text);
          var viAl = TU.findVisualLine(vLinesAl, pos);
          var vEndAl = vLinesAl[viAl].end;
          if (pos + 1 >= vEndAl) {
            // At or past visual line end — use lineboundary modify to get
            // end-of-visual-line position with correct caret affinity.
            setCursorAt(el, pos);
            var selAl = window.getSelection();
            selAl.modify('move', 'forward', 'lineboundary');
          } else {
            setCursorAt(el, Math.min(pos + 1, text.length));
          }
        }
        break;
      case InsertEntry.I_UPPER: {
        var vLinesI = computeCEVisualLines(el, text);
        var viI = TU.findVisualLine(vLinesI, pos);
        var vStartI = vLinesI[viI].start;
        var vText = text.substring(vStartI, vLinesI[viI].end);
        var mI = vText.match(/^\s*/);
        setCursorAt(el, vStartI + (mI ? mI[0].length : 0));
        break;
      }
      case InsertEntry.A_UPPER: {
        var vLinesA = computeCEVisualLines(el, text);
        var viA = TU.findVisualLine(vLinesA, pos);
        var vEndA = vLinesA[viA].end;
        console.log('[CE A] ' + JSON.stringify({ pos: pos, vEnd: vEndA, lineEnd: info.lineEnd }));
        if (vEndA < info.lineEnd) {
          // Mid-block soft wrap: setting cursor to vEnd renders on the
          // next visual line. Instead, place on last char of this line
          // then use Selection.modify to reach the true end-of-line
          // with correct line affinity (stays on current visual line).
          setCursorAt(el, vEndA - 1);
          var selA = window.getSelection();
          selA.modify('move', 'forward', 'lineboundary');
        } else {
          // Block boundary: end is the \n separator, renders correctly.
          setCursorAt(el, vEndA);
        }
        break;
      }
      case InsertEntry.O_LOWER: {
        var vLinesO = computeCEVisualLines(el, text);
        var viO = TU.findVisualLine(vLinesO, pos);
        var vEnd = vLinesO[viO].end;
        var midBlockO = vEnd < info.lineEnd;
        setCursorAt(el, vEnd);
        document.dispatchEvent(new Event('selectionchange'));
        console.log('[CE o] ' + JSON.stringify({ vEnd: vEnd, midBlock: midBlockO }));
        _execCmd('insertParagraph');
        if (midBlockO) {
          // Mid-block split: first insertParagraph split the block,
          // second creates the empty line between the two halves.
          _execCmd('insertParagraph');
          var emptyPosO = vEnd + 1;
          setTimeout(function () {
            setCursorAt(el, emptyPosO);
          }, 0);
        }
        TU.fireInputEvent(el);
        break;
      }
      case InsertEntry.O_UPPER: {
        var vLinesU = computeCEVisualLines(el, text);
        var viU = TU.findVisualLine(vLinesU, pos);
        var vStart = vLinesU[viU].start;
        var midBlockU = vStart > info.lineStart;
        setCursorAt(el, vStart);
        document.dispatchEvent(new Event('selectionchange'));
        console.log('[CE O] ' + JSON.stringify({ vStart: vStart, midBlock: midBlockU }));
        _execCmd('insertParagraph');
        if (midBlockU) {
          // Mid-block split: first insertParagraph split the block,
          // second creates the empty line between the two halves.
          _execCmd('insertParagraph');
        }
        TU.fireInputEvent(el);
        // Cursor lands on the wrong block after insertParagraph.
        // Defer repositioning so ProseMirror's async DOM updates settle.
        var targetPosU = midBlockU ? vStart + 1 : vStart;
        setTimeout(function () {
          setCursorAt(el, targetPosU);
        }, 0);
        break;
      }
    }
  };

  ContentEditableHandler.prototype._doVisualEnter = function (el, pos, engine) {
    engine.visualAnchor = pos;
    engine.visualHead = pos;
    setSelectionRange(el, pos, pos + 1);
  };

  // Set a linewise selection from startVi to endVi (visual line indices).
  // Selects visual line ranges rather than entire blocks.
  function _setLinewiseSelection(el, startVi, endVi, vLines, text) {
    var startLine = vLines[startVi];
    var endLine = vLines[endVi];

    // For single empty visual lines in separate empty blocks, use block-level
    // selection so the highlight is visible even when there is no text.
    if (startVi === endVi && startLine.start === startLine.end) {
      var bInfo = _blockForPos(el, startLine.start);
      if (bInfo && bInfo.isEmpty && bInfo.block.nodeType === 1 && bInfo.block.parentNode === el) {
        var sel = window.getSelection();
        var range = document.createRange();
        range.setStartBefore(bInfo.block);
        range.setEndAfter(bInfo.block);
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }
    }

    // When the end visual line is empty (e.g. intra-block hardBreak),
    // extend selection past the \n so the browser highlights the line.
    var end = endLine.end;
    if (endLine.start === endLine.end && end < text.length) {
      end = endLine.end + 1;
    }

    setSelectionRange(el, startLine.start, end);
  }

  ContentEditableHandler.prototype._doVisualLineEnter = function (el, pos, engine) {
    var text = getFlatText(el);
    engine.visualAnchor = pos;
    engine.visualHead = pos;
    var vLines = computeCEVisualLines(el, text);
    var vi = TU.findVisualLine(vLines, pos);
    _setLinewiseSelection(el, vi, vi, vLines, text);
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
        _setLinewiseSelection(el, anchorVi, headVi, vLines, text);
      } else {
        _setLinewiseSelection(el, headVi, anchorVi, vLines, text);
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

  ContentEditableHandler.prototype._doVisualOperator = function (el, command, engine) {
    // For linewise operations, use flat offset deletion so empty blocks
    // and visual lines are handled correctly.
    if (command.lineWise && engine) {
      var text = getFlatText(el);
      var vLines = computeCEVisualLines(el, text);
      var anchor = engine.visualAnchor;
      var head = engine.visualHead;
      var anchorVi = TU.findVisualLine(vLines, anchor);
      var headVi = TU.findVisualLine(vLines, head);
      var startVi = Math.min(anchorVi, headVi);
      var endVi = Math.max(anchorVi, headVi);
      var from = vLines[startVi].start;
      var to = vLines[endVi].end;

      // Include the newline separator so the block/line is fully removed
      if (to < text.length) to++;
      else if (from > 0) from--;

      var deleted = text.substring(from, to);

      if (command.operator === OperatorType.YANK) {
        Register.set(deleted, 'line');
        this._lastYankFrom = from;
        this._lastYankTo = to;
        setCursorAt(el, from);
        return;
      }

      this._saveUndo(el);
      Register.set(deleted, 'line');
      deleteRange(el, from, to);
      var newText = getFlatText(el);
      setCursorAt(el, Math.min(from, Math.max(newText.length - 1, 0)));
      TU.fireInputEvent(el);
      return;
    }

    // Char-wise visual operator
    var sel = window.getSelection();
    if (!sel.rangeCount) return;
    var selected = sel.toString();

    if (command.operator === OperatorType.YANK) {
      Register.set(selected, 'char');
      var selRange = sel.getRangeAt(0);
      this._lastYankFrom = _flatOffsetAt(el, selRange.startContainer, selRange.startOffset);
      this._lastYankTo = this._lastYankFrom + selected.length;
      var pos = flatOffsetFromSelection(el);
      setCursorAt(el, pos);
      return;
    }

    this._saveUndo(el);
    Register.set(selected, 'char');

    if (!_execCmd('delete')) {
      var range = sel.getRangeAt(0);
      range.deleteContents();
    }
    TU.fireInputEvent(el);
  };

  ContentEditableHandler.prototype._doPaste = function (el, text, pos, before) {
    var reg = Register.get();
    if (!reg.content) return;

    this._saveUndo(el);

    if (reg.type === 'line') {
      var info = TU.getLineInfo(text, pos);
      var content = reg.content;
      if (content[content.length - 1] === '\n') content = content.substring(0, content.length - 1);
      if (before) {
        insertParagraphAt(el, info.lineStart);
        insertTextAt(el, info.lineStart, content);
        setCursorAt(el, info.lineStart);
      } else {
        insertParagraphAt(el, info.lineEnd);
        insertTextAt(el, info.lineEnd + 1, content);
        setCursorAt(el, info.lineEnd + 1);
      }
    } else {
      var cInfo = TU.getLineInfo(text, pos);
      var insertPos = before ? pos : Math.min(pos + 1, cInfo.lineEnd);
      insertPos = TU.clamp(insertPos, 0, text.length);
      insertTextAt(el, insertPos, reg.content);
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
    setSelectionRange(el, pos, pos + count);
    if (!_execCmd('insertText', replacement)) {
      el.textContent = text.substring(0, pos) + replacement + text.substring(pos + count);
    }
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
    deleteRange(el, pos, pos + count);

    var newText = getFlatText(el);
    var newInfo = TU.getLineInfo(newText, Math.min(pos, newText.length));
    var maxPos = newInfo.lineEnd > newInfo.lineStart ? newInfo.lineEnd - 1 : newInfo.lineStart;
    setCursorAt(el, Math.min(pos, maxPos));
    TU.fireInputEvent(el);
  };

  ContentEditableHandler.prototype._doEscape = function (el, text, pos, command) {
    if (command.fromMode === 'INSERT') {
      // FIX: In NORMAL mode the cursor can't sit on a \n separator.
      // Use visual lines to find the last real char of the preceding line.
      // WHY: \n positions are gaps between visual lines (block boundaries).
      // sel.modify('backward') doesn't work in Outlook. setCursorAt to
      // the last char of the visual line ending at \n is reliable.
      // WARNING: Removing this leaves cursor on \n causing h/a to misbehave.
      if (pos > 0 && text[pos] === '\n') {
        var vLinesNl = computeCEVisualLines(el, text);
        var nlTarget = pos - 1;
        for (var ni = 0; ni < vLinesNl.length; ni++) {
          if (vLinesNl[ni].end >= pos) {
            nlTarget = Math.max(vLinesNl[ni].start, vLinesNl[ni].end - 1);
            break;
          }
        }
        console.log('[CE esc \\n] ' + JSON.stringify({ pos: pos, target: nlTarget }));
        setCursorAt(el, nlTarget);
        return;
      }
      var vLines = computeCEVisualLines(el, text);
      var lineStart;
      if (vLines && vLines.length > 0) {
        var vi = TU.findVisualLine(vLines, pos);
        // At a soft-wrap boundary, pos equals the start of vLine[vi] AND
        // the end of vLine[vi-1]. The cursor was logically at the end of
        // the previous visual line (e.g., after A + lineboundary modify).
        // Prefer the previous visual line so Escape moves back correctly.
        if (vi > 0 && pos === vLines[vi].start && vLines[vi - 1].end === pos) {
          vi = vi - 1;
        }
        lineStart = vLines[vi].start;
      } else {
        lineStart = TU.getLineInfo(text, pos).lineStart;
      }
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

  // ── Cursor clamping (for mouseup) ────────────────────

  ContentEditableHandler.prototype.clampCursorToLine = function (el) {
    var text = getFlatText(el);
    if (text.length === 0) return;
    var pos = flatOffsetFromSelection(el);
    var info = TU.getLineInfo(text, pos);
    var maxPos = info.lineEnd > info.lineStart ? info.lineEnd - 1 : info.lineStart;
    if (pos > maxPos) setCursorAt(el, maxPos);
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

  // Find which block a flat offset belongs to, and the block's properties
  function _blockForPos(el, pos) {
    var blocks = _getBlocks(el);
    var flatPos = 0;
    for (var bi = 0; bi < blocks.length; bi++) {
      if (bi > 0) flatPos++;
      var block = blocks[bi];
      var blockLen = _blockText(block).length;
      if (pos <= flatPos + blockLen) {
        return { block: block, isEmpty: blockLen === 0 };
      }
      flatPos += blockLen;
    }
    if (blocks.length > 0) {
      var last = blocks[blocks.length - 1];
      return { block: last, isEmpty: _blockText(last).length === 0 };
    }
    return null;
  }

  ContentEditableHandler.prototype.getCursorRect = function (el, overridePos) {
    var text = getFlatText(el);
    var pos = overridePos != null ? overridePos : flatOffsetFromSelection(el);

    // Some editors (e.g. Outlook) normalize the cursor past the last char
    // of a block, landing on a \n separator or past the end of text.
    // Clamp back to the previous character so the overlay stays on the
    // correct line instead of jumping to the left edge.
    if (overridePos == null && pos > 0) {
      var atNewlineOrEnd = pos >= text.length || text[pos] === '\n';
      if (atNewlineOrEnd && text[pos - 1] !== '\n') {
        pos = pos - 1;
      }
    }

    // For empty blocks (<p><br></p>), use the block element's bounding rect
    var bInfo = _blockForPos(el, pos);
    if (bInfo && bInfo.isEmpty && bInfo.block.nodeType === 1) {
      var bRect = bInfo.block.getBoundingClientRect();
      if (bRect.height > 0) {
        var cs = window.getComputedStyle(bInfo.block);
        var fw = parseFloat(cs.fontSize) * 0.6;
        console.log('[CE rect] ' + JSON.stringify({ path: 'empty-block', pos: pos }));
        return { x: bRect.left, y: bRect.top, width: fw, height: bRect.height };
      }
    }

    // For real characters (not \n block boundaries), measure char width
    if (pos < text.length && text[pos] !== '\n') {
      var start = selectionFromFlatOffset(el, pos);
      var end = selectionFromFlatOffset(el, pos + 1);
      // Only use span if both are in the same block
      var startBlock = start.node;
      while (startBlock && startBlock.parentNode !== el) startBlock = startBlock.parentNode;
      var endBlock = end.node;
      while (endBlock && endBlock.parentNode !== el) endBlock = endBlock.parentNode;

      // Allow cross-text-node ranges when both are sibling text nodes
      // (happens after splitText in o/O commands)
      var sameContext = startBlock === endBlock ||
        (start.node.nodeType === 3 && end.node.nodeType === 3 &&
         start.node.parentNode === end.node.parentNode);
      if (sameContext) {
        var range = document.createRange();
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
        var rect = range.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          console.log('[CE rect] ' + JSON.stringify({ path: 'char', pos: pos, y: rect.top }));
          return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
        }
      }
    }

    // For \n positions in text nodes (plain text contenteditable with white-space: pre-wrap),
    // Chrome returns zero-height rects for collapsed ranges. Find a nearby measurable
    // character and offset by line count to compute the correct position.
    var isNewlinePos = (pos < text.length && text[pos] === '\n') || (pos >= text.length && text.length > 0);
    if (isNewlinePos) {
      var nlCS = window.getComputedStyle(el);
      var nlFontSize = parseFloat(nlCS.fontSize) || 16;
      var nlCharWidth = nlFontSize * 0.6;
      var nlLineHeight = parseFloat(nlCS.lineHeight);
      if (isNaN(nlLineHeight)) nlLineHeight = nlFontSize * 1.2;

      // Search outward from pos for a measurable non-\n character
      var nlRef = null;
      var nlRefPos = -1;
      for (var nlDist = 1; nlDist <= text.length; nlDist++) {
        var nlBefore = pos - nlDist;
        if (nlBefore >= 0 && text[nlBefore] !== '\n') {
          var nlBS = selectionFromFlatOffset(el, nlBefore);
          var nlBE = selectionFromFlatOffset(el, nlBefore + 1);
          var nlBR = document.createRange();
          nlBR.setStart(nlBS.node, nlBS.offset);
          nlBR.setEnd(nlBE.node, nlBE.offset);
          var nlBRect = nlBR.getBoundingClientRect();
          if (nlBRect.height > 0) { nlRef = nlBRect; nlRefPos = nlBefore; break; }
        }
        var nlAfter = pos + nlDist;
        if (nlAfter < text.length && text[nlAfter] !== '\n') {
          var nlAS = selectionFromFlatOffset(el, nlAfter);
          var nlAE = selectionFromFlatOffset(el, nlAfter + 1);
          var nlAR = document.createRange();
          nlAR.setStart(nlAS.node, nlAS.offset);
          nlAR.setEnd(nlAE.node, nlAE.offset);
          var nlARect = nlAR.getBoundingClientRect();
          if (nlARect.height > 0) { nlRef = nlARect; nlRefPos = nlAfter; break; }
        }
      }

      if (nlRef) {
        // Count \n chars between reference and target to get line offset
        var nlCount = 0;
        var nlMin = Math.min(pos, nlRefPos);
        var nlMax = Math.max(pos, nlRefPos);
        for (var nlI = nlMin; nlI < nlMax; nlI++) {
          if (text[nlI] === '\n') nlCount++;
        }
        var nlDir = pos > nlRefPos ? 1 : -1;

        var nlElRect = el.getBoundingClientRect();
        var nlBorderLeft = parseInt(nlCS.borderLeftWidth) || 0;
        var nlPadLeft = parseInt(nlCS.paddingLeft) || 0;

        console.log('[CE rect] ' + JSON.stringify({ path: 'nl-offset', pos: pos, nlCount: nlCount }));
        return {
          x: nlElRect.left + nlBorderLeft + nlPadLeft,
          y: nlRef.top + nlDir * nlCount * nlLineHeight,
          width: nlCharWidth,
          height: nlRef.height
        };
      }

      // All content is newlines (e.g. ProseMirror hardBreaks in a single block)
      // — no measurable character exists. Compute position from block rect + line height.
      if (bInfo && bInfo.block.nodeType === 1) {
        var abRect = bInfo.block.getBoundingClientRect();
        if (abRect.height > 0) {
          var abCS = window.getComputedStyle(bInfo.block);
          var abBT = parseInt(abCS.borderTopWidth) || 0;
          var abPT = parseInt(abCS.paddingTop) || 0;
          var abBL = parseInt(abCS.borderLeftWidth) || 0;
          var abPL = parseInt(abCS.paddingLeft) || 0;
          var abLine = 0;
          for (var abI = 0; abI < pos && abI < text.length; abI++) {
            if (text[abI] === '\n') abLine++;
          }
          console.log('[CE rect] ' + JSON.stringify({ path: 'all-nl', pos: pos, line: abLine }));
          return {
            x: abRect.left + abBL + abPL,
            y: abRect.top + abBT + abPT + abLine * nlLineHeight,
            width: nlCharWidth,
            height: nlLineHeight
          };
        }
      }
    }

    // For \n positions (block boundaries between non-empty blocks) or cross-block,
    // use a collapsed range at the target position
    var point = selectionFromFlatOffset(el, pos);
    var collapsedRange = document.createRange();
    collapsedRange.setStart(point.node, point.offset);
    collapsedRange.collapse(true);
    var cRect = collapsedRange.getBoundingClientRect();
    if (cRect.height > 0) {
      var computed = window.getComputedStyle(el);
      var fw2 = parseFloat(computed.fontSize) * 0.6;
      console.log('[CE rect] ' + JSON.stringify({ path: 'collapsed', pos: pos, y: cRect.top }));
      return { x: cRect.left, y: cRect.top, width: fw2, height: cRect.height };
    }

    // Fallback: use current selection's collapsed range
    var sel = window.getSelection();
    if (sel.rangeCount) {
      var r = sel.getRangeAt(0).cloneRange();
      r.collapse(true);
      var rect2 = r.getBoundingClientRect();
      if (rect2.height > 0) {
        var computed2 = window.getComputedStyle(el);
        var fw3 = parseFloat(computed2.fontSize) * 0.6;
        console.log('[CE rect] ' + JSON.stringify({ path: 'sel-range', pos: pos, y: rect2.top }));
        return { x: rect2.left, y: rect2.top, width: fw3, height: rect2.height };
      }
    }

    console.log('[CE rect] ' + JSON.stringify({ path: 'fallback', pos: pos }));
    var elRect = el.getBoundingClientRect();
    var csf = window.getComputedStyle(el);
    var fs = parseFloat(csf.fontSize) || 16;
    var bt = parseInt(csf.borderTopWidth) || 0;
    var bl = parseInt(csf.borderLeftWidth) || 0;
    var pt = parseInt(csf.paddingTop) || 0;
    var pl = parseInt(csf.paddingLeft) || 0;
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

  // ── Mouse selection detection ─────────────────────

  ContentEditableHandler.prototype.getMouseSelection = function (el) {
    var sel = window.getSelection();
    if (!sel.rangeCount || sel.isCollapsed) return null;
    var anchorFlat = _flatOffsetAt(el, sel.anchorNode, sel.anchorOffset);
    var focusFlat = _flatOffsetAt(el, sel.focusNode, sel.focusOffset);
    if (anchorFlat <= focusFlat) {
      return { anchor: anchorFlat, head: focusFlat - 1 };
    }
    return { anchor: anchorFlat - 1, head: focusFlat };
  };

  window.InputVim = window.InputVim || {};
  window.InputVim.ContentEditableHandler = ContentEditableHandler;
})();
