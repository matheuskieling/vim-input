/**
 * @jest-environment jsdom
 */
const { loadUpTo } = require('./helpers/load-scripts');

let TU;

beforeAll(() => {
  loadUpTo('text-utils');
  TU = window.InputVim.TextUtils;
});

// =========================================================================
// charClass
// =========================================================================
describe('charClass', () => {
  test('word characters return 0', () => {
    for (const ch of ['a', 'Z', '0', '9', '_']) {
      expect(TU.charClass(ch)).toBe(0);
    }
  });

  test('punctuation returns 1', () => {
    for (const ch of ['.', ',', '!', '@', '#', '{', '}', '-', '+']) {
      expect(TU.charClass(ch)).toBe(1);
    }
  });

  test('whitespace returns 2', () => {
    for (const ch of [' ', '\t', '\n', '\r']) {
      expect(TU.charClass(ch)).toBe(2);
    }
  });

  test('null/undefined returns -1', () => {
    expect(TU.charClass(null)).toBe(-1);
    expect(TU.charClass(undefined)).toBe(-1);
  });
});

// =========================================================================
// isWhitespace
// =========================================================================
describe('isWhitespace', () => {
  test('true for space, tab, newline', () => {
    expect(TU.isWhitespace(' ')).toBe(true);
    expect(TU.isWhitespace('\t')).toBe(true);
    expect(TU.isWhitespace('\n')).toBe(true);
  });

  test('true for empty/falsy', () => {
    expect(TU.isWhitespace('')).toBe(true);
    expect(TU.isWhitespace(null)).toBe(true);
    expect(TU.isWhitespace(undefined)).toBe(true);
  });

  test('false for word chars and punctuation', () => {
    expect(TU.isWhitespace('a')).toBe(false);
    expect(TU.isWhitespace('.')).toBe(false);
  });
});

// =========================================================================
// clamp
// =========================================================================
describe('clamp', () => {
  test('returns value when in range', () => {
    expect(TU.clamp(5, 0, 10)).toBe(5);
  });

  test('clamps to min', () => {
    expect(TU.clamp(-1, 0, 10)).toBe(0);
  });

  test('clamps to max', () => {
    expect(TU.clamp(15, 0, 10)).toBe(10);
  });

  test('handles equal min/max', () => {
    expect(TU.clamp(5, 3, 3)).toBe(3);
  });
});

// =========================================================================
// wordForward (w)
// =========================================================================
describe('wordForward', () => {
  test('moves to next word start', () => {
    expect(TU.wordForward('hello world', 0)).toBe(6);
  });

  test('skips trailing whitespace', () => {
    expect(TU.wordForward('hello   world', 0)).toBe(8);
  });

  test('transitions word → punctuation', () => {
    expect(TU.wordForward('hello.world', 0)).toBe(5);
  });

  test('transitions punctuation → word', () => {
    expect(TU.wordForward('hello.world', 5)).toBe(6);
  });

  test('at end returns length', () => {
    expect(TU.wordForward('hello', 5)).toBe(5);
  });

  test('past end returns length', () => {
    expect(TU.wordForward('hello', 10)).toBe(5);
  });

  test('empty text', () => {
    expect(TU.wordForward('', 0)).toBe(0);
  });

  test('multiple punctuation groups', () => {
    // from "..." pos 0, skip "..." then whitespace
    expect(TU.wordForward('... abc', 0)).toBe(4);
  });

  test('across newlines', () => {
    expect(TU.wordForward('hello\nworld', 0)).toBe(6);
  });
});

// =========================================================================
// wordBack (b)
// =========================================================================
describe('wordBack', () => {
  test('moves to previous word start', () => {
    expect(TU.wordBack('hello world', 6)).toBe(0);
  });

  test('skips leading whitespace', () => {
    expect(TU.wordBack('hello   world', 8)).toBe(0);
  });

  test('at start returns 0', () => {
    expect(TU.wordBack('hello', 0)).toBe(0);
  });

  test('transitions word ← punctuation', () => {
    expect(TU.wordBack('hello.world', 6)).toBe(5);
  });

  test('from middle of word', () => {
    expect(TU.wordBack('hello world', 8)).toBe(6);
  });

  test('across newlines', () => {
    expect(TU.wordBack('hello\nworld', 6)).toBe(0);
  });
});

// =========================================================================
// wordEnd (e)
// =========================================================================
describe('wordEnd', () => {
  test('moves to end of current/next word', () => {
    expect(TU.wordEnd('hello world', 0)).toBe(4);
  });

  test('from end of word, moves to next word end', () => {
    expect(TU.wordEnd('hello world', 4)).toBe(10);
  });

  test('at end stays at end', () => {
    expect(TU.wordEnd('hello', 4)).toBe(4);
  });

  test('skips whitespace to next word', () => {
    expect(TU.wordEnd('hello   world', 4)).toBe(12);
  });

  test('word → punctuation boundary', () => {
    expect(TU.wordEnd('hello.world', 0)).toBe(4);
  });
});

// =========================================================================
// wordForwardBig (W)
// =========================================================================
describe('wordForwardBig', () => {
  test('treats punctuation as part of word', () => {
    expect(TU.wordForwardBig('hello.world next', 0)).toBe(12);
  });

  test('skips whitespace', () => {
    expect(TU.wordForwardBig('abc   xyz', 0)).toBe(6);
  });

  test('at end returns length', () => {
    expect(TU.wordForwardBig('hello', 5)).toBe(5);
  });
});

// =========================================================================
// wordBackBig (B)
// =========================================================================
describe('wordBackBig', () => {
  test('treats punctuation as part of word', () => {
    expect(TU.wordBackBig('hello.world next', 12)).toBe(0);
  });

  test('at start returns 0', () => {
    expect(TU.wordBackBig('hello', 0)).toBe(0);
  });

  test('skips whitespace', () => {
    expect(TU.wordBackBig('abc   xyz', 6)).toBe(0);
  });
});

// =========================================================================
// wordEndBig (E)
// =========================================================================
describe('wordEndBig', () => {
  test('treats punctuation as part of word', () => {
    expect(TU.wordEndBig('hello.world next', 0)).toBe(10);
  });

  test('from end, goes to next WORD end', () => {
    expect(TU.wordEndBig('abc def', 2)).toBe(6);
  });

  test('at end stays', () => {
    expect(TU.wordEndBig('hello', 4)).toBe(4);
  });
});

// =========================================================================
// wordEndBack (ge)
// =========================================================================
describe('wordEndBack', () => {
  test('from end of word, moves to end of previous word', () => {
    // "hello world test" at pos 12 ('t'), ge goes to end of "world" = 10
    // Actually: pos=12, startCls=0, pos--=11(' '), skip ws→10('d'), same cls,
    // skip back through "world" to 6, pos--=5(' '), skip ws→4('o')
    expect(TU.wordEndBack('hello world test', 12)).toBe(4);
  });

  test('at start returns 0', () => {
    expect(TU.wordEndBack('hello', 0)).toBe(0);
  });

  test('from whitespace goes to end of previous word', () => {
    // pos=5 (space), startCls=2 (whitespace), pos--=4('o'),
    // skip ws: no ws at 4, charClass(text[4])=0, not ws
    // nowCls=0, nowCls !== startCls(2) → return pos=4
    expect(TU.wordEndBack('hello world', 5)).toBe(4);
  });

  test('from word start with only one word before, goes to 0', () => {
    expect(TU.wordEndBack('hello world', 6)).toBe(0);
  });
});

// =========================================================================
// wordEndBackBig (gE)
// =========================================================================
describe('wordEndBackBig', () => {
  test('moves to end of previous WORD', () => {
    expect(TU.wordEndBackBig('hello.x world', 8)).toBe(6);
  });

  test('at start returns 0', () => {
    expect(TU.wordEndBackBig('hello', 0)).toBe(0);
  });
});

// =========================================================================
// getLineInfo
// =========================================================================
describe('getLineInfo', () => {
  test('single line', () => {
    const info = TU.getLineInfo('hello', 2);
    expect(info).toEqual({ lineStart: 0, lineEnd: 5, lineText: 'hello', col: 2 });
  });

  test('first line of multi-line', () => {
    const info = TU.getLineInfo('hello\nworld', 2);
    expect(info).toEqual({ lineStart: 0, lineEnd: 5, lineText: 'hello', col: 2 });
  });

  test('second line of multi-line', () => {
    const info = TU.getLineInfo('hello\nworld', 8);
    expect(info).toEqual({ lineStart: 6, lineEnd: 11, lineText: 'world', col: 2 });
  });

  test('at newline character', () => {
    const info = TU.getLineInfo('hello\nworld', 5);
    expect(info.lineStart).toBe(0);
    expect(info.lineEnd).toBe(5);
  });

  test('empty line in middle', () => {
    const info = TU.getLineInfo('hello\n\nworld', 6);
    expect(info).toEqual({ lineStart: 6, lineEnd: 6, lineText: '', col: 0 });
  });

  test('at position 0', () => {
    const info = TU.getLineInfo('hello', 0);
    expect(info.col).toBe(0);
    expect(info.lineStart).toBe(0);
  });
});

// =========================================================================
// getLineNumber
// =========================================================================
describe('getLineNumber', () => {
  test('first line is 0', () => {
    expect(TU.getLineNumber('hello\nworld', 2)).toBe(0);
  });

  test('second line is 1', () => {
    expect(TU.getLineNumber('hello\nworld', 8)).toBe(1);
  });

  test('at newline boundary', () => {
    expect(TU.getLineNumber('hello\nworld', 5)).toBe(0);
  });

  test('right after newline', () => {
    expect(TU.getLineNumber('hello\nworld', 6)).toBe(1);
  });

  test('third line', () => {
    expect(TU.getLineNumber('a\nb\nc', 4)).toBe(2);
  });

  test('single line', () => {
    expect(TU.getLineNumber('hello', 3)).toBe(0);
  });
});

// =========================================================================
// getLineStartOffset
// =========================================================================
describe('getLineStartOffset', () => {
  test('line 0 starts at 0', () => {
    expect(TU.getLineStartOffset('hello\nworld', 0)).toBe(0);
  });

  test('line 1', () => {
    expect(TU.getLineStartOffset('hello\nworld', 1)).toBe(6);
  });

  test('line beyond text returns text length', () => {
    expect(TU.getLineStartOffset('hello', 5)).toBe(5);
  });

  test('multiple lines', () => {
    expect(TU.getLineStartOffset('a\nbb\nccc', 2)).toBe(5);
  });
});

// =========================================================================
// findCharForward (f)
// =========================================================================
describe('findCharForward', () => {
  test('finds character on same line', () => {
    expect(TU.findCharForward('hello world', 0, 'o')).toBe(4);
  });

  test('returns -1 if not found on line', () => {
    expect(TU.findCharForward('hello world', 0, 'z')).toBe(-1);
  });

  test('does not cross newline', () => {
    expect(TU.findCharForward('hello\nworld', 0, 'w')).toBe(-1);
  });

  test('finds next occurrence after current position', () => {
    expect(TU.findCharForward('abcabc', 0, 'b')).toBe(1);
    expect(TU.findCharForward('abcabc', 2, 'b')).toBe(4);
  });

  test('does not find char at current position', () => {
    expect(TU.findCharForward('abc', 1, 'b')).toBe(-1); // 'b' is at 1, looks from 2
  });
});

// =========================================================================
// findCharBackward (F)
// =========================================================================
describe('findCharBackward', () => {
  test('finds character backwards on same line', () => {
    expect(TU.findCharBackward('hello world', 10, 'o')).toBe(7);
  });

  test('returns -1 if not found', () => {
    expect(TU.findCharBackward('hello', 4, 'z')).toBe(-1);
  });

  test('does not cross newline backwards', () => {
    expect(TU.findCharBackward('hello\nworld', 8, 'e')).toBe(-1);
  });

  test('finds closest occurrence before position', () => {
    expect(TU.findCharBackward('abcabc', 5, 'a')).toBe(3);
  });
});

// =========================================================================
// findVisualLine
// =========================================================================
describe('findVisualLine', () => {
  const vLines = [
    { start: 0, end: 10 },
    { start: 10, end: 20 },
    { start: 20, end: 25 },
  ];

  test('finds first line', () => {
    expect(TU.findVisualLine(vLines, 0)).toBe(0);
    expect(TU.findVisualLine(vLines, 5)).toBe(0);
    expect(TU.findVisualLine(vLines, 9)).toBe(0);
  });

  test('finds second line', () => {
    expect(TU.findVisualLine(vLines, 10)).toBe(1);
    expect(TU.findVisualLine(vLines, 15)).toBe(1);
  });

  test('finds last line (inclusive end)', () => {
    expect(TU.findVisualLine(vLines, 25)).toBe(2);
  });

  test('past end returns last index', () => {
    expect(TU.findVisualLine(vLines, 30)).toBe(2);
  });

  test('handles empty visual line', () => {
    const lines = [{ start: 0, end: 5 }, { start: 5, end: 5 }, { start: 6, end: 10 }];
    expect(TU.findVisualLine(lines, 5)).toBe(1);
  });
});

// =========================================================================
// fireInputEvent
// =========================================================================
describe('fireInputEvent', () => {
  test('dispatches input event', () => {
    const el = document.createElement('input');
    const handler = jest.fn();
    el.addEventListener('input', handler);
    TU.fireInputEvent(el);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('event bubbles', () => {
    const parent = document.createElement('div');
    const el = document.createElement('input');
    parent.appendChild(el);
    const handler = jest.fn();
    parent.addEventListener('input', handler);
    TU.fireInputEvent(el);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
