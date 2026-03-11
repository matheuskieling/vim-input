/**
 * @jest-environment jsdom
 */
const { loadUpTo } = require('./helpers/load-scripts');

let MR, MT, TO;

beforeAll(() => {
  loadUpTo('motion-resolver');
  MR = window.InputVim.MotionResolver;
  MT = window.InputVim.MotionType;
  TO = window.InputVim.TextObject;
  // Reset search state
  window.InputVim.lastSearch = '';
  window.InputVim.lastSearchWholeWord = false;
  window.InputVim.lastSearchForward = true;
});

beforeEach(() => {
  window.InputVim.lastSearch = '';
  window.InputVim.lastSearchWholeWord = false;
  window.InputVim.lastSearchForward = true;
});

// =========================================================================
// findMatchingPair
// =========================================================================
describe('findMatchingPair', () => {
  test('finds simple pair', () => {
    const result = MR.findMatchingPair('(hello)', 3, '(', ')');
    expect(result).toEqual({ start: 0, end: 6 });
  });

  test('finds nested pairs', () => {
    const result = MR.findMatchingPair('(a(b)c)', 3, '(', ')');
    expect(result).toEqual({ start: 2, end: 4 });
  });

  test('cursor on opening bracket', () => {
    const result = MR.findMatchingPair('(hello)', 0, '(', ')');
    expect(result).toEqual({ start: 0, end: 6 });
  });

  test('cursor on closing bracket', () => {
    const result = MR.findMatchingPair('(hello)', 6, '(', ')');
    expect(result).toEqual({ start: 0, end: 6 });
  });

  test('returns null when no pair found', () => {
    expect(MR.findMatchingPair('hello', 2, '(', ')')).toBeNull();
  });

  test('finds pair forward on same line when not inside', () => {
    const result = MR.findMatchingPair('a (b) c', 0, '(', ')');
    expect(result).toEqual({ start: 2, end: 4 });
  });

  test('curly braces', () => {
    const result = MR.findMatchingPair('{a}', 1, '{', '}');
    expect(result).toEqual({ start: 0, end: 2 });
  });

  test('square brackets', () => {
    const result = MR.findMatchingPair('[1,2]', 2, '[', ']');
    expect(result).toEqual({ start: 0, end: 4 });
  });

  test('deeply nested', () => {
    const result = MR.findMatchingPair('((()))', 3, '(', ')');
    expect(result).toEqual({ start: 2, end: 3 });
  });
});

// =========================================================================
// findQuotePair
// =========================================================================
describe('findQuotePair', () => {
  test('finds double quote pair', () => {
    const result = MR.findQuotePair('"hello"', 3, '"');
    expect(result).toEqual({ start: 0, end: 6 });
  });

  test('cursor on opening quote', () => {
    const result = MR.findQuotePair('"hi"', 0, '"');
    expect(result).toEqual({ start: 0, end: 3 });
  });

  test('cursor on closing quote', () => {
    const result = MR.findQuotePair('"hi"', 3, '"');
    expect(result).toEqual({ start: 0, end: 3 });
  });

  test('finds pair ahead when cursor is before', () => {
    const result = MR.findQuotePair('a "b" c', 0, '"');
    expect(result).toEqual({ start: 2, end: 4 });
  });

  test('does not cross newline', () => {
    expect(MR.findQuotePair('"hello\nworld"', 0, '"')).toBeNull();
  });

  test('returns null when no pair', () => {
    expect(MR.findQuotePair('hello', 2, '"')).toBeNull();
  });

  test('single quotes', () => {
    const result = MR.findQuotePair("'hi'", 2, "'");
    expect(result).toEqual({ start: 0, end: 3 });
  });

  test('backticks', () => {
    const result = MR.findQuotePair('`code`', 3, '`');
    expect(result).toEqual({ start: 0, end: 5 });
  });

  test('multiple pairs on one line', () => {
    const result = MR.findQuotePair('"a" "b"', 5, '"');
    expect(result).toEqual({ start: 4, end: 6 });
  });
});

// =========================================================================
// resolveWordTextObject
// =========================================================================
describe('resolveWordTextObject', () => {
  test('inner word', () => {
    const result = MR.resolveWordTextObject('hello world', 2, false, false);
    expect(result).toEqual({ from: 0, to: 5 });
  });

  test('around word (trailing space)', () => {
    const result = MR.resolveWordTextObject('hello world', 2, true, false);
    expect(result).toEqual({ from: 0, to: 6 });
  });

  test('around word (leading space when no trailing)', () => {
    const result = MR.resolveWordTextObject('hello world', 8, true, false);
    expect(result).toEqual({ from: 5, to: 11 });
  });

  test('inner WORD (big)', () => {
    const result = MR.resolveWordTextObject('hello.world next', 3, false, true);
    expect(result).toEqual({ from: 0, to: 11 });
  });

  test('around WORD (big)', () => {
    const result = MR.resolveWordTextObject('hello.world next', 3, true, true);
    expect(result).toEqual({ from: 0, to: 12 });
  });

  test('cursor on whitespace (inner word)', () => {
    const result = MR.resolveWordTextObject('hello world', 5, false, false);
    expect(result).toEqual({ from: 5, to: 6 });
  });

  test('empty text returns null', () => {
    expect(MR.resolveWordTextObject('', 0, false, false)).toBeNull();
  });

  test('single char word', () => {
    const result = MR.resolveWordTextObject('a b', 0, false, false);
    expect(result).toEqual({ from: 0, to: 1 });
  });
});

// =========================================================================
// resolveTextObject
// =========================================================================
describe('resolveTextObject', () => {
  test('inner brace', () => {
    const result = MR.resolveTextObject('{hello}', 3, TO.BRACE, 'inner');
    expect(result).toEqual({ from: 1, to: 6 });
  });

  test('around brace', () => {
    const result = MR.resolveTextObject('{hello}', 3, TO.BRACE, 'around');
    expect(result).toEqual({ from: 0, to: 7 });
  });

  test('inner paren', () => {
    const result = MR.resolveTextObject('(abc)', 2, TO.PAREN, 'inner');
    expect(result).toEqual({ from: 1, to: 4 });
  });

  test('around paren', () => {
    const result = MR.resolveTextObject('(abc)', 2, TO.PAREN, 'around');
    expect(result).toEqual({ from: 0, to: 5 });
  });

  test('inner bracket', () => {
    const result = MR.resolveTextObject('[1,2]', 2, TO.BRACKET, 'inner');
    expect(result).toEqual({ from: 1, to: 4 });
  });

  test('inner angle', () => {
    const result = MR.resolveTextObject('<div>', 2, TO.ANGLE, 'inner');
    expect(result).toEqual({ from: 1, to: 4 });
  });

  test('inner double quote', () => {
    const result = MR.resolveTextObject('"hello"', 3, TO.DOUBLE_QUOTE, 'inner');
    expect(result).toEqual({ from: 1, to: 6 });
  });

  test('around double quote', () => {
    const result = MR.resolveTextObject('"hello"', 3, TO.DOUBLE_QUOTE, 'around');
    expect(result).toEqual({ from: 0, to: 7 });
  });

  test('inner single quote', () => {
    const result = MR.resolveTextObject("'hi'", 2, TO.SINGLE_QUOTE, 'inner');
    expect(result).toEqual({ from: 1, to: 3 });
  });

  test('inner backtick', () => {
    const result = MR.resolveTextObject('`code`', 3, TO.BACKTICK, 'inner');
    expect(result).toEqual({ from: 1, to: 5 });
  });

  test('inner char pair (|)', () => {
    const result = MR.resolveTextObject('|hello|', 3, TO.CHAR_PAIR, 'inner', '|');
    expect(result).toEqual({ from: 1, to: 6 });
  });

  test('around char pair', () => {
    const result = MR.resolveTextObject('|hello|', 3, TO.CHAR_PAIR, 'around', '|');
    expect(result).toEqual({ from: 0, to: 7 });
  });

  test('returns null when no match', () => {
    expect(MR.resolveTextObject('hello', 2, TO.BRACE, 'inner')).toBeNull();
  });

  test('inner word delegates to resolveWordTextObject', () => {
    const result = MR.resolveTextObject('hello world', 2, TO.WORD, 'inner');
    expect(result).toEqual({ from: 0, to: 5 });
  });

  test('inner WORD_BIG', () => {
    const result = MR.resolveTextObject('hello.world next', 3, TO.WORD_BIG, 'inner');
    expect(result).toEqual({ from: 0, to: 11 });
  });
});

// =========================================================================
// paragraph text object
// =========================================================================
describe('paragraph text object', () => {
  const text = 'hello\nworld\n\nfoo\nbar';

  test('inner paragraph (non-blank line)', () => {
    const result = MR.resolveTextObject(text, 2, TO.PARAGRAPH, 'inner');
    // "hello\nworld\n" = from 0 to 12
    expect(result.from).toBe(0);
    expect(result.to).toBe(12);
  });

  test('around paragraph includes trailing blank', () => {
    const result = MR.resolveTextObject(text, 2, TO.PARAGRAPH, 'around');
    expect(result.from).toBe(0);
    expect(result.to).toBe(13); // includes empty line
  });

  test('inner paragraph on blank line', () => {
    const result = MR.resolveTextObject(text, 12, TO.PARAGRAPH, 'inner');
    expect(result.from).toBe(12);
    expect(result.to).toBe(13);
  });

  test('empty text returns null', () => {
    expect(MR.resolveTextObject('', 0, TO.PARAGRAPH, 'inner')).toBeNull();
  });
});

// =========================================================================
// resolveMotion
// =========================================================================
describe('resolveMotion', () => {
  test('CHAR_LEFT moves left', () => {
    expect(MR.resolveMotion('hello', 2, MT.CHAR_LEFT, 1, false, -1)).toBe(1);
  });

  test('CHAR_LEFT does not cross line start', () => {
    expect(MR.resolveMotion('ab\ncd', 3, MT.CHAR_LEFT, 1, false, -1)).toBe(3);
  });

  test('CHAR_RIGHT moves right', () => {
    expect(MR.resolveMotion('hello', 2, MT.CHAR_RIGHT, 1, false, -1)).toBe(3);
  });

  test('CHAR_RIGHT does not cross line end', () => {
    expect(MR.resolveMotion('ab\ncd', 1, MT.CHAR_RIGHT, 1, false, -1)).toBe(1);
  });

  test('WORD_FORWARD', () => {
    expect(MR.resolveMotion('hello world', 0, MT.WORD_FORWARD, 1, false, -1)).toBe(6);
  });

  test('WORD_FORWARD with count', () => {
    expect(MR.resolveMotion('one two three', 0, MT.WORD_FORWARD, 2, false, -1)).toBe(8);
  });

  test('WORD_BACK', () => {
    expect(MR.resolveMotion('hello world', 6, MT.WORD_BACK, 1, false, -1)).toBe(0);
  });

  test('WORD_END', () => {
    expect(MR.resolveMotion('hello world', 0, MT.WORD_END, 1, false, -1)).toBe(4);
  });

  test('WORD_FORWARD_BIG', () => {
    expect(MR.resolveMotion('hello.world next', 0, MT.WORD_FORWARD_BIG, 1, false, -1)).toBe(12);
  });

  test('LINE_START', () => {
    expect(MR.resolveMotion('  hello', 5, MT.LINE_START, 1, false, -1)).toBe(0);
  });

  test('LINE_END normal mode', () => {
    expect(MR.resolveMotion('hello', 0, MT.LINE_END, 1, false, -1)).toBe(4);
  });

  test('LINE_END operator mode returns range', () => {
    expect(MR.resolveMotion('hello', 0, MT.LINE_END, 1, true, -1)).toEqual({ from: 0, to: 5 });
  });

  test('FIRST_NON_BLANK', () => {
    expect(MR.resolveMotion('  hello', 0, MT.FIRST_NON_BLANK, 1, false, -1)).toBe(2);
  });

  test('FIRST_NON_BLANK no indent', () => {
    expect(MR.resolveMotion('hello', 3, MT.FIRST_NON_BLANK, 1, false, -1)).toBe(0);
  });

  test('DOC_START', () => {
    expect(MR.resolveMotion('hello\nworld', 8, MT.DOC_START, 1, false, -1)).toBe(0);
  });

  test('DOC_END normal mode', () => {
    expect(MR.resolveMotion('hello', 0, MT.DOC_END, 1, false, -1)).toBe(4);
  });

  test('DOC_END operator mode returns range', () => {
    expect(MR.resolveMotion('hello', 0, MT.DOC_END, 1, true, -1)).toEqual({ from: 0, to: 5 });
  });

  test('FIND_CHAR', () => {
    expect(MR.resolveMotion('hello', 0, MT.FIND_CHAR, 1, false, -1, 'l')).toBe(2);
  });

  test('FIND_CHAR not found stays', () => {
    expect(MR.resolveMotion('hello', 0, MT.FIND_CHAR, 1, false, -1, 'z')).toBe(0);
  });

  test('FIND_CHAR_BACK', () => {
    expect(MR.resolveMotion('hello', 4, MT.FIND_CHAR_BACK, 1, false, -1, 'l')).toBe(3);
  });

  test('TILL_CHAR', () => {
    expect(MR.resolveMotion('hello', 0, MT.TILL_CHAR, 1, false, -1, 'l')).toBe(1);
  });

  test('TILL_CHAR_BACK', () => {
    expect(MR.resolveMotion('hello', 4, MT.TILL_CHAR_BACK, 1, false, -1, 'l')).toBe(4);
  });

  test('LINE_UP', () => {
    const pos = MR.resolveMotion('hello\nworld', 8, MT.LINE_UP, 1, false, -1);
    expect(pos).toBe(2);
  });

  test('LINE_DOWN', () => {
    const pos = MR.resolveMotion('hello\nworld', 2, MT.LINE_DOWN, 1, false, -1);
    expect(pos).toBe(8);
  });

  test('LINE_UP at first line stays', () => {
    expect(MR.resolveMotion('hello\nworld', 2, MT.LINE_UP, 1, false, -1)).toBe(2);
  });

  test('LINE_DOWN at last line stays', () => {
    expect(MR.resolveMotion('hello\nworld', 8, MT.LINE_DOWN, 1, false, -1)).toBe(8);
  });

  test('LINE_DOWN desired column clamps to shorter line', () => {
    const pos = MR.resolveMotion('hello\nab', 4, MT.LINE_DOWN, 1, false, -1);
    expect(pos).toBe(7); // 'b' at index 7 (last char of "ab")
  });

  test('PARAGRAPH_FORWARD', () => {
    const text = 'hello\nworld\n\nfoo';
    const pos = MR.resolveMotion(text, 0, MT.PARAGRAPH_FORWARD, 1, false, -1);
    expect(pos).toBe(13); // start of "foo"
  });

  test('PARAGRAPH_BACK', () => {
    const text = 'hello\nworld\n\nfoo';
    const pos = MR.resolveMotion(text, 14, MT.PARAGRAPH_BACK, 1, false, -1);
    expect(pos).toBe(0);
  });

  test('operator mode returns {from, to}', () => {
    const result = MR.resolveMotion('hello world', 0, MT.WORD_FORWARD, 1, true, -1);
    expect(result).toEqual({ from: 0, to: 6 });
  });

  test('operator range: from < to always', () => {
    const result = MR.resolveMotion('hello world', 6, MT.WORD_BACK, 1, true, -1);
    expect(result.from).toBeLessThanOrEqual(result.to);
  });
});

// =========================================================================
// Search motions
// =========================================================================
describe('search motions', () => {
  test('SEARCH_NEXT finds next occurrence', () => {
    window.InputVim.lastSearch = 'world';
    window.InputVim.lastSearchForward = true;
    const text = 'hello world hello world';
    const pos = MR.resolveMotion(text, 0, MT.SEARCH_NEXT, 1, false, -1);
    expect(pos).toBe(6);
  });

  test('SEARCH_NEXT wraps around', () => {
    window.InputVim.lastSearch = 'hello';
    window.InputVim.lastSearchForward = true;
    const text = 'hello world';
    const pos = MR.resolveMotion(text, 3, MT.SEARCH_NEXT, 1, false, -1);
    expect(pos).toBe(0); // wraps
  });

  test('SEARCH_PREV finds previous occurrence', () => {
    window.InputVim.lastSearch = 'hello';
    window.InputVim.lastSearchForward = true;
    const text = 'hello world hello';
    // From pos 14, search backward: lastIndexOf("hello", 13) = 12
    const pos = MR.resolveMotion(text, 14, MT.SEARCH_PREV, 1, false, -1);
    expect(pos).toBe(12);
  });

  test('SEARCH_WORD sets lastSearch and finds next', () => {
    const text = 'foo bar foo baz';
    const pos = MR.resolveMotion(text, 0, MT.SEARCH_WORD, 1, false, -1);
    expect(window.InputVim.lastSearch).toBe('foo');
    expect(pos).toBe(8); // second "foo"
  });

  test('SEARCH_WORD_BACK', () => {
    const text = 'foo bar foo baz';
    const pos = MR.resolveMotion(text, 8, MT.SEARCH_WORD_BACK, 1, false, -1);
    expect(pos).toBe(0); // first "foo"
  });

  test('search is case insensitive', () => {
    window.InputVim.lastSearch = 'Hello';
    window.InputVim.lastSearchForward = true;
    const pos = MR.resolveMotion('hello world', 0, MT.SEARCH_NEXT, 1, false, -1);
    expect(pos).toBe(0); // wraps to self (only match)
  });

  test('search with no term stays', () => {
    window.InputVim.lastSearch = '';
    const pos = MR.resolveMotion('hello', 2, MT.SEARCH_NEXT, 1, false, -1);
    expect(pos).toBe(2);
  });
});
