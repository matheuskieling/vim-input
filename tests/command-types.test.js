/**
 * @jest-environment jsdom
 */
const { loadUpTo } = require('./helpers/load-scripts');

beforeAll(() => loadUpTo('command-types'));

describe('Mode enum', () => {
  test('has all four modes', () => {
    const { Mode } = window.InputVim;
    expect(Mode.NORMAL).toBe('NORMAL');
    expect(Mode.INSERT).toBe('INSERT');
    expect(Mode.VISUAL).toBe('VISUAL');
    expect(Mode.VISUAL_LINE).toBe('VISUAL_LINE');
  });

  test('is frozen', () => {
    expect(Object.isFrozen(window.InputVim.Mode)).toBe(true);
  });
});

describe('MotionType enum', () => {
  test('has all motion types', () => {
    const MT = window.InputVim.MotionType;
    const expected = [
      'CHAR_LEFT', 'CHAR_RIGHT', 'LINE_UP', 'LINE_DOWN',
      'WORD_FORWARD', 'WORD_BACK', 'WORD_END',
      'LINE_START', 'LINE_END', 'FIRST_NON_BLANK',
      'WORD_FORWARD_BIG', 'WORD_BACK_BIG', 'WORD_END_BIG',
      'WORD_END_BACK', 'WORD_END_BACK_BIG',
      'FIND_CHAR', 'FIND_CHAR_BACK', 'TILL_CHAR', 'TILL_CHAR_BACK',
      'DOC_START', 'DOC_END',
      'PARAGRAPH_FORWARD', 'PARAGRAPH_BACK',
      'SEARCH_NEXT', 'SEARCH_PREV', 'SEARCH_WORD', 'SEARCH_WORD_BACK',
    ];
    for (const key of expected) {
      expect(MT[key]).toBeDefined();
    }
  });

  test('is frozen', () => {
    expect(Object.isFrozen(window.InputVim.MotionType)).toBe(true);
  });
});

describe('OperatorType enum', () => {
  test('has delete, change, yank', () => {
    const OT = window.InputVim.OperatorType;
    expect(OT.DELETE).toBe('delete');
    expect(OT.CHANGE).toBe('change');
    expect(OT.YANK).toBe('yank');
  });
});

describe('TextObject enum', () => {
  test('has all text objects', () => {
    const TO = window.InputVim.TextObject;
    const expected = [
      'WORD', 'WORD_BIG', 'BRACE', 'PAREN', 'BRACKET', 'ANGLE',
      'DOUBLE_QUOTE', 'SINGLE_QUOTE', 'BACKTICK', 'CHAR_PAIR', 'PARAGRAPH',
    ];
    for (const key of expected) {
      expect(TO[key]).toBeDefined();
    }
  });
});

describe('CommandType enum', () => {
  test('has all command types', () => {
    const CT = window.InputVim.CommandType;
    const expected = [
      'MOTION', 'OPERATOR_MOTION', 'OPERATOR_TEXT_OBJECT', 'TEXT_OBJECT',
      'LINE_OPERATOR', 'INSERT_ENTER', 'VISUAL_ENTER', 'VISUAL_LINE_ENTER',
      'VISUAL_OPERATOR', 'PASTE', 'PASTE_BEFORE', 'UNDO', 'REDO',
      'SCROLL_DOWN', 'SCROLL_UP', 'ESCAPE', 'REPLACE_CHAR', 'DELETE_CHAR',
      'VISUAL_SWAP',
    ];
    for (const key of expected) {
      expect(CT[key]).toBeDefined();
    }
  });
});

describe('InsertEntry enum', () => {
  test('has all insert entries', () => {
    const IE = window.InputVim.InsertEntry;
    expect(IE.I_LOWER).toBe('i');
    expect(IE.A_LOWER).toBe('a');
    expect(IE.I_UPPER).toBe('I');
    expect(IE.A_UPPER).toBe('A');
    expect(IE.O_LOWER).toBe('o');
    expect(IE.O_UPPER).toBe('O');
  });
});

describe('global search state', () => {
  test('initializes search state', () => {
    expect(window.InputVim.lastSearch).toBe('');
    expect(window.InputVim.lastSearchWholeWord).toBe(false);
    expect(window.InputVim.lastSearchForward).toBe(true);
  });
});
