/**
 * @jest-environment jsdom
 */
const { loadUpTo } = require('./helpers/load-scripts');

let KeyParser, CT, MT, OT, IE, TO;

beforeAll(() => {
  loadUpTo('key-parser');
  KeyParser = window.InputVim.KeyParser;
  CT = window.InputVim.CommandType;
  MT = window.InputVim.MotionType;
  OT = window.InputVim.OperatorType;
  IE = window.InputVim.InsertEntry;
  TO = window.InputVim.TextObject;
});

let parser;
beforeEach(() => {
  parser = new KeyParser();
});

// =========================================================================
// Simple motions
// =========================================================================
describe('simple motions', () => {
  const MOTION_MAP = {
    h: 'CHAR_LEFT', l: 'CHAR_RIGHT', k: 'LINE_UP', j: 'LINE_DOWN',
    w: 'WORD_FORWARD', b: 'WORD_BACK', e: 'WORD_END',
    W: 'WORD_FORWARD_BIG', B: 'WORD_BACK_BIG', E: 'WORD_END_BIG',
    '0': 'LINE_START', $: 'LINE_END', '^': 'FIRST_NON_BLANK',
    G: 'DOC_END', '{': 'PARAGRAPH_BACK', '}': 'PARAGRAPH_FORWARD',
    n: 'SEARCH_NEXT', N: 'SEARCH_PREV', '*': 'SEARCH_WORD', '#': 'SEARCH_WORD_BACK',
  };

  test.each(Object.entries(MOTION_MAP))(
    'key "%s" → motion %s',
    (key, motionName) => {
      const cmd = parser.feed(key);
      expect(cmd).not.toBeNull();
      expect(cmd.type).toBe(CT.MOTION);
      expect(cmd.motion).toBe(MT[motionName]);
      expect(cmd.count).toBe(1);
    }
  );
});

// =========================================================================
// Count prefix
// =========================================================================
describe('count prefix', () => {
  test('3w = word forward with count 3', () => {
    expect(parser.feed('3')).toBeNull();
    const cmd = parser.feed('w');
    expect(cmd.count).toBe(3);
    expect(cmd.motion).toBe(MT.WORD_FORWARD);
  });

  test('12j = line down with count 12', () => {
    expect(parser.feed('1')).toBeNull();
    expect(parser.feed('2')).toBeNull();
    const cmd = parser.feed('j');
    expect(cmd.count).toBe(12);
  });

  test('0 at start is line_start, not count', () => {
    const cmd = parser.feed('0');
    expect(cmd.type).toBe(CT.MOTION);
    expect(cmd.motion).toBe(MT.LINE_START);
  });

  test('10 — 1 is count, 0 is count digit', () => {
    expect(parser.feed('1')).toBeNull();
    expect(parser.feed('0')).toBeNull();
    const cmd = parser.feed('j');
    expect(cmd.count).toBe(10);
  });
});

// =========================================================================
// Multi-key sequences: gg, ge, gE
// =========================================================================
describe('g-sequences', () => {
  test('gg = doc start', () => {
    expect(parser.feed('g')).toBeNull();
    const cmd = parser.feed('g');
    expect(cmd.type).toBe(CT.MOTION);
    expect(cmd.motion).toBe(MT.DOC_START);
  });

  test('ge = word end back', () => {
    expect(parser.feed('g')).toBeNull();
    const cmd = parser.feed('e');
    expect(cmd.type).toBe(CT.MOTION);
    expect(cmd.motion).toBe(MT.WORD_END_BACK);
  });

  test('gE = word end back big', () => {
    expect(parser.feed('g')).toBeNull();
    const cmd = parser.feed('E');
    expect(cmd.type).toBe(CT.MOTION);
    expect(cmd.motion).toBe(MT.WORD_END_BACK_BIG);
  });

  test('g + unrecognized key resets', () => {
    expect(parser.feed('g')).toBeNull();
    const cmd = parser.feed('z');
    expect(cmd).toBeNull();
  });

  test('5gg = doc start with count', () => {
    parser.feed('5');
    parser.feed('g');
    const cmd = parser.feed('g');
    expect(cmd.motion).toBe(MT.DOC_START);
    expect(cmd.count).toBe(5);
  });
});

// =========================================================================
// Find/till (f, F, t, T)
// =========================================================================
describe('find/till', () => {
  test('fa = find char forward', () => {
    expect(parser.feed('f')).toBeNull();
    const cmd = parser.feed('a');
    expect(cmd.type).toBe(CT.MOTION);
    expect(cmd.motion).toBe(MT.FIND_CHAR);
    expect(cmd.char).toBe('a');
  });

  test('Fa = find char backward', () => {
    parser.feed('F');
    const cmd = parser.feed('a');
    expect(cmd.motion).toBe(MT.FIND_CHAR_BACK);
  });

  test('ta = till char forward', () => {
    parser.feed('t');
    const cmd = parser.feed('a');
    expect(cmd.motion).toBe(MT.TILL_CHAR);
    expect(cmd.char).toBe('a');
  });

  test('Ta = till char backward', () => {
    parser.feed('T');
    const cmd = parser.feed('a');
    expect(cmd.motion).toBe(MT.TILL_CHAR_BACK);
  });

  test('3fa = find with count', () => {
    parser.feed('3');
    parser.feed('f');
    const cmd = parser.feed('x');
    expect(cmd.count).toBe(3);
    expect(cmd.char).toBe('x');
  });

  test('escape during find cancels', () => {
    parser.feed('f');
    const cmd = parser.feed('Escape');
    expect(cmd).toBeNull();
  });
});

// =========================================================================
// Repeat find (; and ,)
// =========================================================================
describe('repeat find', () => {
  test('; repeats last find forward', () => {
    parser.feed('f');
    parser.feed('x');
    const cmd = parser.feed(';');
    expect(cmd.type).toBe(CT.MOTION);
    expect(cmd.motion).toBe(MT.FIND_CHAR);
    expect(cmd.char).toBe('x');
  });

  test(', reverses last find', () => {
    parser.feed('f');
    parser.feed('x');
    const cmd = parser.feed(',');
    expect(cmd.motion).toBe(MT.FIND_CHAR_BACK);
    expect(cmd.char).toBe('x');
  });

  test('; with no previous find returns null', () => {
    const cmd = parser.feed(';');
    expect(cmd).toBeNull();
  });

  test(', reverses till', () => {
    parser.feed('t');
    parser.feed('y');
    const cmd = parser.feed(',');
    expect(cmd.motion).toBe(MT.TILL_CHAR_BACK);
  });

  test('; repeats backward find as backward', () => {
    parser.feed('F');
    parser.feed('z');
    const cmd = parser.feed(';');
    expect(cmd.motion).toBe(MT.FIND_CHAR_BACK);
  });

  test(', reverses backward find to forward', () => {
    parser.feed('F');
    parser.feed('z');
    const cmd = parser.feed(',');
    expect(cmd.motion).toBe(MT.FIND_CHAR);
  });
});

// =========================================================================
// Operators
// =========================================================================
describe('operators', () => {
  test('d starts operator, returns null', () => {
    expect(parser.feed('d')).toBeNull();
  });

  test('dw = delete word forward', () => {
    parser.feed('d');
    const cmd = parser.feed('w');
    expect(cmd.type).toBe(CT.OPERATOR_MOTION);
    expect(cmd.operator).toBe(OT.DELETE);
    expect(cmd.motion).toBe(MT.WORD_FORWARD);
  });

  test('cw = change word forward', () => {
    parser.feed('c');
    const cmd = parser.feed('w');
    expect(cmd.operator).toBe(OT.CHANGE);
  });

  test('ye = yank to word end', () => {
    parser.feed('y');
    const cmd = parser.feed('e');
    expect(cmd.operator).toBe(OT.YANK);
    expect(cmd.motion).toBe(MT.WORD_END);
  });

  test('d$ = delete to end of line', () => {
    parser.feed('d');
    const cmd = parser.feed('$');
    expect(cmd.operator).toBe(OT.DELETE);
    expect(cmd.motion).toBe(MT.LINE_END);
  });

  test('2dw = delete word with count 2', () => {
    parser.feed('2');
    parser.feed('d');
    const cmd = parser.feed('w');
    expect(cmd.count).toBe(2);
    expect(cmd.operator).toBe(OT.DELETE);
  });

  test('d + invalid key resets', () => {
    parser.feed('d');
    const cmd = parser.feed('z');
    expect(cmd).toBeNull();
  });
});

// =========================================================================
// Line operators (dd, cc, yy)
// =========================================================================
describe('line operators', () => {
  test('dd = delete line', () => {
    parser.feed('d');
    const cmd = parser.feed('d');
    expect(cmd.type).toBe(CT.LINE_OPERATOR);
    expect(cmd.operator).toBe(OT.DELETE);
  });

  test('cc = change line', () => {
    parser.feed('c');
    const cmd = parser.feed('c');
    expect(cmd.operator).toBe(OT.CHANGE);
  });

  test('yy = yank line', () => {
    parser.feed('y');
    const cmd = parser.feed('y');
    expect(cmd.operator).toBe(OT.YANK);
  });

  test('3dd = delete 3 lines', () => {
    parser.feed('3');
    parser.feed('d');
    const cmd = parser.feed('d');
    expect(cmd.count).toBe(3);
  });
});

// =========================================================================
// Operator + text objects
// =========================================================================
describe('operator + text objects', () => {
  test('diw = delete inner word', () => {
    parser.feed('d');
    parser.feed('i');
    const cmd = parser.feed('w');
    expect(cmd.type).toBe(CT.OPERATOR_TEXT_OBJECT);
    expect(cmd.operator).toBe(OT.DELETE);
    expect(cmd.modifier).toBe('inner');
    expect(cmd.object).toBe(TO.WORD);
  });

  test('daw = delete around word', () => {
    parser.feed('d');
    parser.feed('a');
    const cmd = parser.feed('w');
    expect(cmd.modifier).toBe('around');
    expect(cmd.object).toBe(TO.WORD);
  });

  test('ci{ = change inner brace', () => {
    parser.feed('c');
    parser.feed('i');
    const cmd = parser.feed('{');
    expect(cmd.operator).toBe(OT.CHANGE);
    expect(cmd.object).toBe(TO.BRACE);
    expect(cmd.modifier).toBe('inner');
  });

  test('yi( = yank inner paren', () => {
    parser.feed('y');
    parser.feed('i');
    const cmd = parser.feed('(');
    expect(cmd.object).toBe(TO.PAREN);
  });

  const TEXT_OBJ_MAP = {
    '{': 'BRACE', '}': 'BRACE',
    '(': 'PAREN', ')': 'PAREN',
    '[': 'BRACKET', ']': 'BRACKET',
    '<': 'ANGLE', '>': 'ANGLE',
    '"': 'DOUBLE_QUOTE',
    "'": 'SINGLE_QUOTE',
    '`': 'BACKTICK',
    w: 'WORD',
    W: 'WORD_BIG',
    p: 'PARAGRAPH',
  };

  test.each(Object.entries(TEXT_OBJ_MAP))(
    'di%s resolves correct object',
    (key, objName) => {
      parser.feed('d');
      parser.feed('i');
      const cmd = parser.feed(key);
      expect(cmd.object).toBe(TO[objName]);
    }
  );

  test('di| = char pair text object', () => {
    parser.feed('d');
    parser.feed('i');
    const cmd = parser.feed('|');
    expect(cmd.object).toBe(TO.CHAR_PAIR);
    expect(cmd.char).toBe('|');
  });

  test('escape during text object cancels', () => {
    parser.feed('d');
    parser.feed('i');
    const cmd = parser.feed('Escape');
    expect(cmd).toBeNull();
  });

  test('invalid key after i/a resets', () => {
    parser.feed('d');
    parser.feed('i');
    const cmd = parser.feed('z');
    expect(cmd).toBeNull();
  });
});

// =========================================================================
// Operator + g sequences (dgg, yge, etc.)
// =========================================================================
describe('operator + g sequences', () => {
  test('dgg = delete to doc start', () => {
    parser.feed('d');
    parser.feed('g');
    const cmd = parser.feed('g');
    expect(cmd.type).toBe(CT.OPERATOR_MOTION);
    expect(cmd.operator).toBe(OT.DELETE);
    expect(cmd.motion).toBe(MT.DOC_START);
  });

  test('yge = yank to word end back', () => {
    parser.feed('y');
    parser.feed('g');
    const cmd = parser.feed('e');
    expect(cmd.operator).toBe(OT.YANK);
    expect(cmd.motion).toBe(MT.WORD_END_BACK);
  });

  test('cgE = change to word end back big', () => {
    parser.feed('c');
    parser.feed('g');
    const cmd = parser.feed('E');
    expect(cmd.operator).toBe(OT.CHANGE);
    expect(cmd.motion).toBe(MT.WORD_END_BACK_BIG);
  });
});

// =========================================================================
// Operator + find/till (df{char}, ct{char}, etc.)
// =========================================================================
describe('operator + find/till', () => {
  test('dfa = delete to find char', () => {
    parser.feed('d');
    parser.feed('f');
    const cmd = parser.feed('a');
    expect(cmd.type).toBe(CT.OPERATOR_MOTION);
    expect(cmd.operator).toBe(OT.DELETE);
    expect(cmd.motion).toBe(MT.FIND_CHAR);
    expect(cmd.char).toBe('a');
  });

  test('ct; = change to till char', () => {
    parser.feed('c');
    parser.feed('t');
    const cmd = parser.feed(';');
    expect(cmd.operator).toBe(OT.CHANGE);
    expect(cmd.motion).toBe(MT.TILL_CHAR);
  });
});

// =========================================================================
// Replace char (r)
// =========================================================================
describe('replace char', () => {
  test('rx = replace with x', () => {
    parser.feed('r');
    const cmd = parser.feed('x');
    expect(cmd.type).toBe(CT.REPLACE_CHAR);
    expect(cmd.char).toBe('x');
    expect(cmd.count).toBe(1);
  });

  test('3ra = replace 3 chars with a', () => {
    parser.feed('3');
    parser.feed('r');
    const cmd = parser.feed('a');
    expect(cmd.count).toBe(3);
    expect(cmd.char).toBe('a');
  });

  test('r + escape cancels', () => {
    parser.feed('r');
    const cmd = parser.feed('Escape');
    expect(cmd).toBeNull();
  });
});

// =========================================================================
// Shortcuts
// =========================================================================
describe('shortcuts', () => {
  test('x = delete char', () => {
    const cmd = parser.feed('x');
    expect(cmd.type).toBe(CT.DELETE_CHAR);
    expect(cmd.count).toBe(1);
  });

  test('3x = delete 3 chars', () => {
    parser.feed('3');
    const cmd = parser.feed('x');
    expect(cmd.count).toBe(3);
  });

  test('X = delete char left (dh)', () => {
    const cmd = parser.feed('X');
    expect(cmd.type).toBe(CT.OPERATOR_MOTION);
    expect(cmd.operator).toBe(OT.DELETE);
    expect(cmd.motion).toBe(MT.CHAR_LEFT);
  });

  test('D = d$ (delete to line end)', () => {
    const cmd = parser.feed('D');
    expect(cmd.operator).toBe(OT.DELETE);
    expect(cmd.motion).toBe(MT.LINE_END);
  });

  test('C = c$ (change to line end)', () => {
    const cmd = parser.feed('C');
    expect(cmd.operator).toBe(OT.CHANGE);
    expect(cmd.motion).toBe(MT.LINE_END);
  });

  test('Y = yank line', () => {
    const cmd = parser.feed('Y');
    expect(cmd.type).toBe(CT.LINE_OPERATOR);
    expect(cmd.operator).toBe(OT.YANK);
  });

  test('s = cl (substitute)', () => {
    const cmd = parser.feed('s');
    expect(cmd.operator).toBe(OT.CHANGE);
    expect(cmd.motion).toBe(MT.CHAR_RIGHT);
  });
});

// =========================================================================
// Insert entry commands
// =========================================================================
describe('insert entry', () => {
  const INSERT_MAP = { i: 'I_LOWER', a: 'A_LOWER', I: 'I_UPPER', A: 'A_UPPER', o: 'O_LOWER', O: 'O_UPPER' };

  test.each(Object.entries(INSERT_MAP))(
    'key "%s" enters insert mode',
    (key, entryName) => {
      const cmd = parser.feed(key);
      expect(cmd.type).toBe(CT.INSERT_ENTER);
      expect(cmd.entry).toBe(IE[entryName]);
    }
  );
});

// =========================================================================
// Visual mode
// =========================================================================
describe('visual mode', () => {
  test('v = visual enter', () => {
    const cmd = parser.feed('v');
    expect(cmd.type).toBe(CT.VISUAL_ENTER);
  });

  test('V = visual line enter', () => {
    const cmd = parser.feed('V');
    expect(cmd.type).toBe(CT.VISUAL_LINE_ENTER);
  });
});

// =========================================================================
// Paste
// =========================================================================
describe('paste', () => {
  test('p = paste after', () => {
    const cmd = parser.feed('p');
    expect(cmd.type).toBe(CT.PASTE);
    expect(cmd.count).toBe(1);
  });

  test('P = paste before', () => {
    const cmd = parser.feed('P');
    expect(cmd.type).toBe(CT.PASTE_BEFORE);
  });

  test('3p = paste with count', () => {
    parser.feed('3');
    const cmd = parser.feed('p');
    expect(cmd.count).toBe(3);
  });
});

// =========================================================================
// Undo
// =========================================================================
describe('undo', () => {
  test('u = undo', () => {
    const cmd = parser.feed('u');
    expect(cmd.type).toBe(CT.UNDO);
  });

  test('3u = undo 3 times', () => {
    parser.feed('3');
    const cmd = parser.feed('u');
    expect(cmd.count).toBe(3);
  });
});

// =========================================================================
// Escape
// =========================================================================
describe('escape', () => {
  test('Escape returns escape command', () => {
    const cmd = parser.feed('Escape');
    expect(cmd.type).toBe(CT.ESCAPE);
  });

  test('Escape resets pending operator', () => {
    parser.feed('d');
    parser.feed('Escape');
    // Parser is reset, next key should be fresh
    const cmd = parser.feed('w');
    expect(cmd.type).toBe(CT.MOTION);
  });
});

// =========================================================================
// getPending
// =========================================================================
describe('getPending', () => {
  test('empty initially', () => {
    expect(parser.getPending()).toBe('');
  });

  test('accumulates keys', () => {
    parser.feed('d');
    expect(parser.getPending()).toBe('d');
  });

  test('does not include Escape in keys', () => {
    parser.feed('d');
    parser.feed('Escape');
    // After escape, reset clears _keys
    expect(parser.getPending()).toBe('');
  });

  test('shows count + operator', () => {
    parser.feed('3');
    parser.feed('d');
    expect(parser.getPending()).toBe('3d');
  });
});

// =========================================================================
// reset
// =========================================================================
describe('reset', () => {
  test('clears all state', () => {
    parser.feed('3');
    parser.feed('d');
    parser.reset();
    expect(parser.getPending()).toBe('');
    // Fresh state — 'w' should be a simple motion
    const cmd = parser.feed('w');
    expect(cmd.type).toBe(CT.MOTION);
    expect(cmd.count).toBe(1);
  });
});

// =========================================================================
// Unrecognized keys
// =========================================================================
describe('unrecognized keys', () => {
  test('unknown key resets and returns null', () => {
    const cmd = parser.feed('z');
    expect(cmd).toBeNull();
  });

  test('unknown key after count resets', () => {
    parser.feed('3');
    const cmd = parser.feed('z');
    expect(cmd).toBeNull();
    // Parser should be reset
    const next = parser.feed('w');
    expect(next.type).toBe(CT.MOTION);
    expect(next.count).toBe(1);
  });
});
