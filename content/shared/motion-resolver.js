(function () {
  'use strict';

  var MotionType = window.InputVim.MotionType;
  var TextObject = window.InputVim.TextObject;
  var TU = window.InputVim.TextUtils;

  // ── Bracket/quote pair finders ────────────────────────

  function findMatchingPair(text, pos, open, close) {
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

  // ── Text object resolver ──────────────────────────────

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
    pos = TU.clamp(pos, 0, text.length - 1);
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
      var cls = TU.charClass(text[pos]);
      while (from > 0 && TU.charClass(text[from - 1]) === cls) from--;
      while (to < text.length - 1 && TU.charClass(text[to + 1]) === cls) to++;
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

  // ── Motion resolver ───────────────────────────────────

  function resolveMotion(text, pos, motion, count, forOperator, desiredCol, charArg, vLines) {
    var newPos = pos;
    var col = (desiredCol >= 0) ? desiredCol : -1;

    for (var i = 0; i < count; i++) {
      switch (motion) {
        case MotionType.CHAR_LEFT: {
          var clInfo = TU.getLineInfo(text, newPos);
          if (newPos > clInfo.lineStart) newPos--;
          break;
        }
        case MotionType.CHAR_RIGHT: {
          var crInfo = TU.getLineInfo(text, newPos);
          var crMax = crInfo.lineEnd > crInfo.lineStart ? crInfo.lineEnd - 1 : crInfo.lineStart;
          if (newPos < crMax) newPos++;
          break;
        }
        case MotionType.LINE_UP: {
          if (vLines) {
            var vi = TU.findVisualLine(vLines, newPos);
            if (col < 0) col = newPos - vLines[vi].start;
            if (vi > 0) {
              var prev = vLines[vi - 1];
              var prevLen = prev.end - prev.start;
              var maxC = forOperator ? prevLen : Math.max(0, prevLen - 1);
              newPos = prev.start + Math.min(col, maxC);
            }
          } else {
            var info = TU.getLineInfo(text, newPos);
            if (col < 0) col = info.col;
            var ln = TU.getLineNumber(text, newPos);
            if (ln > 0) {
              var pls = TU.getLineStartOffset(text, ln - 1);
              var pli = TU.getLineInfo(text, pls);
              var maxC2 = forOperator ? pli.lineText.length : Math.max(0, pli.lineText.length - 1);
              newPos = pls + Math.min(col, maxC2);
            }
          }
          break;
        }
        case MotionType.LINE_DOWN: {
          if (vLines) {
            var vi2 = TU.findVisualLine(vLines, newPos);
            if (col < 0) col = newPos - vLines[vi2].start;
            if (vi2 < vLines.length - 1) {
              var next = vLines[vi2 + 1];
              var nextLen = next.end - next.start;
              var maxC3 = forOperator ? nextLen : Math.max(0, nextLen - 1);
              newPos = next.start + Math.min(col, maxC3);
            }
          } else {
            var info2 = TU.getLineInfo(text, newPos);
            if (col < 0) col = info2.col;
            var ln2 = TU.getLineNumber(text, newPos);
            var totalLines = text.split('\n').length;
            if (ln2 < totalLines - 1) {
              var nls = TU.getLineStartOffset(text, ln2 + 1);
              var nli = TU.getLineInfo(text, nls);
              var maxC4 = forOperator ? nli.lineText.length : Math.max(0, nli.lineText.length - 1);
              newPos = nls + Math.min(col, maxC4);
            }
          }
          break;
        }
        case MotionType.WORD_FORWARD:
          newPos = TU.wordForward(text, newPos); break;
        case MotionType.WORD_BACK:
          newPos = TU.wordBack(text, newPos); break;
        case MotionType.WORD_END:
          newPos = TU.wordEnd(text, newPos); break;
        case MotionType.WORD_FORWARD_BIG:
          newPos = TU.wordForwardBig(text, newPos); break;
        case MotionType.WORD_BACK_BIG:
          newPos = TU.wordBackBig(text, newPos); break;
        case MotionType.WORD_END_BIG:
          newPos = TU.wordEndBig(text, newPos); break;
        case MotionType.WORD_END_BACK:
          newPos = TU.wordEndBack(text, newPos); break;
        case MotionType.WORD_END_BACK_BIG:
          newPos = TU.wordEndBackBig(text, newPos); break;
        case MotionType.LINE_START:
          newPos = TU.getLineInfo(text, newPos).lineStart; break;
        case MotionType.LINE_END: {
          var leInfo = TU.getLineInfo(text, newPos);
          newPos = forOperator ? leInfo.lineEnd : Math.max(leInfo.lineStart, leInfo.lineEnd - 1);
          break;
        }
        case MotionType.FIRST_NON_BLANK: {
          var info3 = TU.getLineInfo(text, newPos);
          var m = info3.lineText.match(/^\s*/);
          newPos = info3.lineStart + (m ? m[0].length : 0);
          break;
        }
        case MotionType.FIND_CHAR: {
          var fc = TU.findCharForward(text, newPos, charArg);
          if (fc !== -1) newPos = fc;
          break;
        }
        case MotionType.FIND_CHAR_BACK: {
          var fcb = TU.findCharBackward(text, newPos, charArg);
          if (fcb !== -1) newPos = fcb;
          break;
        }
        case MotionType.TILL_CHAR: {
          var tc = TU.findCharForward(text, newPos, charArg);
          if (tc !== -1) newPos = tc - 1;
          break;
        }
        case MotionType.TILL_CHAR_BACK: {
          var tcb = TU.findCharBackward(text, newPos, charArg);
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

  // ── Export ────────────────────────────────────────────

  window.InputVim = window.InputVim || {};
  window.InputVim.MotionResolver = {
    findMatchingPair: findMatchingPair,
    findQuotePair: findQuotePair,
    resolveTextObject: resolveTextObject,
    resolveWordTextObject: resolveWordTextObject,
    resolveMotion: resolveMotion,
  };
})();
