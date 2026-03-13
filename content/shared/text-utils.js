(function () {
  'use strict';

  var WORD_CHAR = /[a-zA-Z0-9_]/;

  function charClass(ch) {
    if (ch === undefined || ch === null) return -1;
    if (WORD_CHAR.test(ch)) return 0; // word
    if (/\s/.test(ch)) return 2;      // whitespace
    return 1;                           // punctuation
  }

  function isWhitespace(ch) {
    return !ch || /\s/.test(ch);
  }

  function clamp(val, min, max) {
    return val < min ? min : val > max ? max : val;
  }

  // ── Word motion helpers ─────────────────────────────

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

  function wordEndBack(text, pos) {
    if (pos <= 0) return 0;
    var startCls = charClass(text[pos]);
    pos--;
    while (pos > 0 && charClass(text[pos]) === 2) pos--;
    if (charClass(text[pos]) === 2) return 0;
    var nowCls = charClass(text[pos]);
    if (nowCls !== startCls || startCls === 2) return pos;
    while (pos > 0 && charClass(text[pos - 1]) === nowCls) pos--;
    if (pos <= 0) return 0;
    pos--;
    while (pos > 0 && charClass(text[pos]) === 2) pos--;
    return pos;
  }

  function wordEndBackBig(text, pos) {
    if (pos <= 0) return 0;
    pos--;
    if (!isWhitespace(text[pos])) {
      while (pos > 0 && !isWhitespace(text[pos - 1])) pos--;
      if (pos <= 0) return 0;
      pos--;
    }
    while (pos > 0 && isWhitespace(text[pos])) pos--;
    return pos;
  }

  // ── Line helpers ──────────────────────────────────────

  function getLineInfo(text, pos) {
    var lineStart = pos > 0 ? text.lastIndexOf('\n', pos - 1) + 1 : 0;
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

  // ── Visual line lookup ────────────────────────────────

  function findVisualLine(vLines, pos) {
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

  // ── Indent helper ─────────────────────────────────────

  function computeNewLineIndent(lineText, addExtraIndent, tabSize) {
    var match = lineText.match(/^(\s*)/);
    var indent = match ? match[1] : '';
    if (addExtraIndent) {
      for (var i = 0; i < tabSize; i++) indent += ' ';
    }
    return indent;
  }

  // ── Event helper ──────────────────────────────────────

  function fireInputEvent(el) {
    el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
  }

  // ── Export ────────────────────────────────────────────

  window.InputVim = window.InputVim || {};
  window.InputVim.TextUtils = {
    WORD_CHAR: WORD_CHAR,
    charClass: charClass,
    isWhitespace: isWhitespace,
    clamp: clamp,
    wordForward: wordForward,
    wordBack: wordBack,
    wordEnd: wordEnd,
    wordForwardBig: wordForwardBig,
    wordBackBig: wordBackBig,
    wordEndBig: wordEndBig,
    wordEndBack: wordEndBack,
    wordEndBackBig: wordEndBackBig,
    getLineInfo: getLineInfo,
    getLineNumber: getLineNumber,
    getLineStartOffset: getLineStartOffset,
    findCharForward: findCharForward,
    findCharBackward: findCharBackward,
    findVisualLine: findVisualLine,
    computeNewLineIndent: computeNewLineIndent,
    fireInputEvent: fireInputEvent,
  };
})();
