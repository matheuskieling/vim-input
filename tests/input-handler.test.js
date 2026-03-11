/**
 * @jest-environment jsdom
 */
const { loadUpTo } = require('./helpers/load-scripts');

let InputHandler, CT, MT, OT, IE, TO, Mode, Register;

beforeAll(() => {
  loadUpTo('input-handler');
  InputHandler = window.InputVim.InputHandler;
  CT = window.InputVim.CommandType;
  MT = window.InputVim.MotionType;
  OT = window.InputVim.OperatorType;
  IE = window.InputVim.InsertEntry;
  TO = window.InputVim.TextObject;
  Mode = window.InputVim.Mode;
  Register = window.InputVim.Register;
});

let handler, el, engine;

function makeInput(value, cursorPos) {
  const input = document.createElement('textarea');
  input.value = value;
  input.selectionStart = cursorPos;
  input.selectionEnd = cursorPos;
  document.body.appendChild(input);
  return input;
}

beforeEach(() => {
  handler = new InputHandler();
  engine = {
    mode: Mode.NORMAL,
    visualAnchor: 0,
    visualHead: 0,
    setMode: function (m) { this.mode = m; },
  };
  Register.clear();
});

afterEach(() => {
  if (el && el.parentNode) el.remove();
});

// =========================================================================
// Motions
// =========================================================================
describe('motions', () => {
  test('h moves cursor left', () => {
    el = makeInput('hello', 2);
    handler.execute(el, { type: CT.MOTION, motion: MT.CHAR_LEFT, count: 1 }, engine);
    expect(el.selectionStart).toBe(1);
  });

  test('l moves cursor right', () => {
    el = makeInput('hello', 2);
    handler.execute(el, { type: CT.MOTION, motion: MT.CHAR_RIGHT, count: 1 }, engine);
    expect(el.selectionStart).toBe(3);
  });

  test('w moves to next word', () => {
    el = makeInput('hello world', 0);
    handler.execute(el, { type: CT.MOTION, motion: MT.WORD_FORWARD, count: 1 }, engine);
    expect(el.selectionStart).toBe(6);
  });

  test('b moves to previous word', () => {
    el = makeInput('hello world', 6);
    handler.execute(el, { type: CT.MOTION, motion: MT.WORD_BACK, count: 1 }, engine);
    expect(el.selectionStart).toBe(0);
  });

  test('e moves to word end', () => {
    el = makeInput('hello world', 0);
    handler.execute(el, { type: CT.MOTION, motion: MT.WORD_END, count: 1 }, engine);
    expect(el.selectionStart).toBe(4);
  });

  test('0 moves to line start', () => {
    el = makeInput('hello', 3);
    handler.execute(el, { type: CT.MOTION, motion: MT.LINE_START, count: 1 }, engine);
    expect(el.selectionStart).toBe(0);
  });

  test('$ moves to line end', () => {
    el = makeInput('hello', 0);
    handler.execute(el, { type: CT.MOTION, motion: MT.LINE_END, count: 1 }, engine);
    expect(el.selectionStart).toBe(4);
  });

  test('^ moves to first non-blank', () => {
    el = makeInput('  hello', 0);
    handler.execute(el, { type: CT.MOTION, motion: MT.FIRST_NON_BLANK, count: 1 }, engine);
    expect(el.selectionStart).toBe(2);
  });

  test('gg moves to document start', () => {
    el = makeInput('hello\nworld', 8);
    handler.execute(el, { type: CT.MOTION, motion: MT.DOC_START, count: 1 }, engine);
    expect(el.selectionStart).toBe(0);
  });

  test('G moves to document end', () => {
    el = makeInput('hello', 0);
    handler.execute(el, { type: CT.MOTION, motion: MT.DOC_END, count: 1 }, engine);
    expect(el.selectionStart).toBe(4);
  });

  test('f finds char forward', () => {
    el = makeInput('hello', 0);
    handler.execute(el, { type: CT.MOTION, motion: MT.FIND_CHAR, count: 1, char: 'l' }, engine);
    expect(el.selectionStart).toBe(2);
  });

  test('j moves down one line', () => {
    el = makeInput('hello\nworld', 2);
    // Mock clientWidth so visual lines compute correctly (wide enough for no wrap)
    Object.defineProperty(el, 'clientWidth', { value: 1000 });
    handler.execute(el, { type: CT.MOTION, motion: MT.LINE_DOWN, count: 1 }, engine);
    expect(el.selectionStart).toBe(8);
  });

  test('k moves up one line', () => {
    el = makeInput('hello\nworld', 8);
    Object.defineProperty(el, 'clientWidth', { value: 1000 });
    handler.execute(el, { type: CT.MOTION, motion: MT.LINE_UP, count: 1 }, engine);
    expect(el.selectionStart).toBe(2);
  });

  test('2w moves two words forward', () => {
    el = makeInput('one two three', 0);
    handler.execute(el, { type: CT.MOTION, motion: MT.WORD_FORWARD, count: 2 }, engine);
    expect(el.selectionStart).toBe(8);
  });

  test('cursor clamped to line end', () => {
    el = makeInput('hello', 4);
    handler.execute(el, { type: CT.MOTION, motion: MT.CHAR_RIGHT, count: 1 }, engine);
    expect(el.selectionStart).toBe(4); // can't go past last char in normal mode
  });
});

// =========================================================================
// Operator + motion
// =========================================================================
describe('operator + motion', () => {
  test('dw deletes word', () => {
    el = makeInput('hello world', 0);
    handler.execute(el, { type: CT.OPERATOR_MOTION, operator: OT.DELETE, motion: MT.WORD_FORWARD, count: 1 }, engine);
    expect(el.value).toBe('world');
    expect(Register.get().content).toBe('hello ');
  });

  test('de deletes to word end position (exclusive)', () => {
    el = makeInput('hello world', 0);
    handler.execute(el, { type: CT.OPERATOR_MOTION, operator: OT.DELETE, motion: MT.WORD_END, count: 1 }, engine);
    // resolveMotion returns {from:0, to:4}, substring(0,4)="hell" deleted
    expect(el.value).toBe('o world');
  });

  test('yw yanks word without deleting', () => {
    el = makeInput('hello world', 0);
    handler.execute(el, { type: CT.OPERATOR_MOTION, operator: OT.YANK, motion: MT.WORD_FORWARD, count: 1 }, engine);
    expect(el.value).toBe('hello world'); // unchanged
    expect(Register.get().content).toBe('hello ');
  });

  test('cw deletes word (handler only — mode set by engine)', () => {
    el = makeInput('hello world', 0);
    handler.execute(el, { type: CT.OPERATOR_MOTION, operator: OT.CHANGE, motion: MT.WORD_FORWARD, count: 1 }, engine);
    expect(el.value).toBe('world');
  });

  test('d$ deletes to end of line', () => {
    el = makeInput('hello world', 5);
    handler.execute(el, { type: CT.OPERATOR_MOTION, operator: OT.DELETE, motion: MT.LINE_END, count: 1 }, engine);
    expect(el.value).toBe('hello');
  });
});

// =========================================================================
// Operator + text object
// =========================================================================
describe('operator + text object', () => {
  test('diw deletes inner word', () => {
    el = makeInput('hello world', 2);
    handler.execute(el, { type: CT.OPERATOR_TEXT_OBJECT, operator: OT.DELETE, modifier: 'inner', object: TO.WORD, count: 1 }, engine);
    expect(el.value).toBe(' world');
  });

  test('daw deletes around word', () => {
    el = makeInput('hello world', 2);
    handler.execute(el, { type: CT.OPERATOR_TEXT_OBJECT, operator: OT.DELETE, modifier: 'around', object: TO.WORD, count: 1 }, engine);
    expect(el.value).toBe('world');
  });

  test('ci" changes inner double quotes', () => {
    el = makeInput('"hello"', 3);
    handler.execute(el, { type: CT.OPERATOR_TEXT_OBJECT, operator: OT.CHANGE, modifier: 'inner', object: TO.DOUBLE_QUOTE, count: 1 }, engine);
    expect(el.value).toBe('""');
  });

  test('di( deletes inner parens', () => {
    el = makeInput('(abc)', 2);
    handler.execute(el, { type: CT.OPERATOR_TEXT_OBJECT, operator: OT.DELETE, modifier: 'inner', object: TO.PAREN, count: 1 }, engine);
    expect(el.value).toBe('()');
  });

  test('da{ deletes around braces', () => {
    el = makeInput('{abc}', 2);
    handler.execute(el, { type: CT.OPERATOR_TEXT_OBJECT, operator: OT.DELETE, modifier: 'around', object: TO.BRACE, count: 1 }, engine);
    expect(el.value).toBe('');
  });

  test('yiw yanks without deleting', () => {
    el = makeInput('hello world', 2);
    handler.execute(el, { type: CT.OPERATOR_TEXT_OBJECT, operator: OT.YANK, modifier: 'inner', object: TO.WORD, count: 1 }, engine);
    expect(el.value).toBe('hello world');
    expect(Register.get().content).toBe('hello');
  });

  test('no-op when text object not found', () => {
    el = makeInput('hello', 2);
    handler.execute(el, { type: CT.OPERATOR_TEXT_OBJECT, operator: OT.DELETE, modifier: 'inner', object: TO.BRACE, count: 1 }, engine);
    expect(el.value).toBe('hello');
  });
});

// =========================================================================
// Line operator
// =========================================================================
describe('line operator', () => {
  test('dd deletes current line', () => {
    el = makeInput('hello\nworld', 2);
    handler.execute(el, { type: CT.LINE_OPERATOR, operator: OT.DELETE, count: 1 }, engine);
    expect(el.value).toBe('world');
    expect(Register.get().content).toBe('hello\n');
    expect(Register.get().type).toBe('line');
  });

  test('yy yanks current line', () => {
    el = makeInput('hello\nworld', 2);
    handler.execute(el, { type: CT.LINE_OPERATOR, operator: OT.YANK, count: 1 }, engine);
    expect(el.value).toBe('hello\nworld');
    expect(Register.get().content).toBe('hello\n');
    expect(Register.get().type).toBe('line');
  });

  test('dd on last line removes trailing newline', () => {
    el = makeInput('hello\nworld', 8);
    handler.execute(el, { type: CT.LINE_OPERATOR, operator: OT.DELETE, count: 1 }, engine);
    expect(el.value).toBe('hello');
  });

  test('2dd deletes two lines', () => {
    el = makeInput('one\ntwo\nthree', 0);
    handler.execute(el, { type: CT.LINE_OPERATOR, operator: OT.DELETE, count: 2 }, engine);
    expect(el.value).toBe('three');
  });

  test('dd on single line empties', () => {
    el = makeInput('hello', 2);
    handler.execute(el, { type: CT.LINE_OPERATOR, operator: OT.DELETE, count: 1 }, engine);
    expect(el.value).toBe('');
  });
});

// =========================================================================
// Insert entry
// =========================================================================
describe('insert entry', () => {
  test('i keeps cursor at current position', () => {
    el = makeInput('hello', 2);
    handler.execute(el, { type: CT.INSERT_ENTER, entry: IE.I_LOWER }, engine);
    expect(el.selectionStart).toBe(2);
  });

  test('a moves cursor one right', () => {
    el = makeInput('hello', 2);
    handler.execute(el, { type: CT.INSERT_ENTER, entry: IE.A_LOWER }, engine);
    expect(el.selectionStart).toBe(3);
  });

  test('I moves to first non-blank', () => {
    el = makeInput('  hello', 4);
    handler.execute(el, { type: CT.INSERT_ENTER, entry: IE.I_UPPER }, engine);
    expect(el.selectionStart).toBe(2);
  });

  test('A moves to end of line', () => {
    el = makeInput('hello', 0);
    handler.execute(el, { type: CT.INSERT_ENTER, entry: IE.A_UPPER }, engine);
    expect(el.selectionStart).toBe(5);
  });

  test('o opens line below', () => {
    el = makeInput('hello\nworld', 2);
    handler.execute(el, { type: CT.INSERT_ENTER, entry: IE.O_LOWER }, engine);
    expect(el.value).toBe('hello\n\nworld');
    expect(el.selectionStart).toBe(6);
  });

  test('O opens line above', () => {
    el = makeInput('hello\nworld', 8);
    handler.execute(el, { type: CT.INSERT_ENTER, entry: IE.O_UPPER }, engine);
    expect(el.value).toBe('hello\n\nworld');
    expect(el.selectionStart).toBe(6);
  });
});

// =========================================================================
// Paste
// =========================================================================
describe('paste', () => {
  test('p pastes after cursor (char type)', () => {
    Register.set('xyz', 'char');
    el = makeInput('hello', 2);
    handler.execute(el, { type: CT.PASTE }, engine);
    expect(el.value).toBe('helxyzlo');
  });

  test('P pastes before cursor (char type)', () => {
    Register.set('xyz', 'char');
    el = makeInput('hello', 2);
    handler.execute(el, { type: CT.PASTE_BEFORE }, engine);
    expect(el.value).toBe('hexyzllo');
  });

  test('p pastes line below (line type)', () => {
    Register.set('new\n', 'line');
    el = makeInput('hello\nworld', 2);
    handler.execute(el, { type: CT.PASTE }, engine);
    expect(el.value).toBe('hello\nnew\nworld');
  });

  test('P pastes line above (line type)', () => {
    Register.set('new\n', 'line');
    el = makeInput('hello\nworld', 2);
    handler.execute(el, { type: CT.PASTE_BEFORE }, engine);
    expect(el.value).toBe('new\nhello\nworld');
  });

  test('no-op when register is empty', () => {
    el = makeInput('hello', 2);
    handler.execute(el, { type: CT.PASTE }, engine);
    expect(el.value).toBe('hello');
  });
});

// =========================================================================
// Undo / Redo
// =========================================================================
describe('undo / redo', () => {
  test('undo restores previous state', () => {
    el = makeInput('hello world', 0);
    handler.execute(el, { type: CT.OPERATOR_MOTION, operator: OT.DELETE, motion: MT.WORD_FORWARD, count: 1 }, engine);
    expect(el.value).toBe('world');
    handler.execute(el, { type: CT.UNDO, count: 1 }, engine);
    expect(el.value).toBe('hello world');
  });

  test('redo after undo', () => {
    el = makeInput('hello world', 0);
    handler.execute(el, { type: CT.OPERATOR_MOTION, operator: OT.DELETE, motion: MT.WORD_FORWARD, count: 1 }, engine);
    handler.execute(el, { type: CT.UNDO, count: 1 }, engine);
    expect(el.value).toBe('hello world');
    handler.execute(el, { type: CT.REDO, count: 1 }, engine);
    expect(el.value).toBe('world');
  });

  test('multiple undos', () => {
    el = makeInput('abc', 0);
    // delete 'a'
    handler.execute(el, { type: CT.OPERATOR_MOTION, operator: OT.DELETE, motion: MT.CHAR_RIGHT, count: 1 }, engine);
    expect(el.value).toBe('bc');
    // delete 'b'
    handler.execute(el, { type: CT.OPERATOR_MOTION, operator: OT.DELETE, motion: MT.CHAR_RIGHT, count: 1 }, engine);
    expect(el.value).toBe('c');
    // undo both
    handler.execute(el, { type: CT.UNDO, count: 2 }, engine);
    expect(el.value).toBe('abc');
  });
});

// =========================================================================
// Replace char
// =========================================================================
describe('replace char', () => {
  test('replaces char under cursor', () => {
    el = makeInput('hello', 0);
    handler.execute(el, { type: CT.REPLACE_CHAR, char: 'x', count: 1 }, engine);
    expect(el.value).toBe('xello');
  });

  test('replaces multiple chars', () => {
    el = makeInput('hello', 0);
    handler.execute(el, { type: CT.REPLACE_CHAR, char: 'x', count: 3 }, engine);
    expect(el.value).toBe('xxxlo');
  });

  test('no-op at end of text', () => {
    el = makeInput('hello', 5);
    handler.execute(el, { type: CT.REPLACE_CHAR, char: 'x', count: 1 }, engine);
    expect(el.value).toBe('hello');
  });
});

// =========================================================================
// Delete char (x)
// =========================================================================
describe('delete char', () => {
  test('deletes char under cursor', () => {
    el = makeInput('hello', 0);
    handler.execute(el, { type: CT.DELETE_CHAR, count: 1 }, engine);
    expect(el.value).toBe('ello');
    expect(Register.get().content).toBe('h');
  });

  test('deletes multiple chars', () => {
    el = makeInput('hello', 0);
    handler.execute(el, { type: CT.DELETE_CHAR, count: 3 }, engine);
    expect(el.value).toBe('lo');
    expect(Register.get().content).toBe('hel');
  });
});

// =========================================================================
// Escape
// =========================================================================
describe('escape', () => {
  test('from INSERT moves cursor left', () => {
    el = makeInput('hello', 3);
    handler.execute(el, { type: CT.ESCAPE, fromMode: 'INSERT' }, engine);
    expect(el.selectionStart).toBe(2);
  });

  test('from INSERT at line start stays', () => {
    el = makeInput('hello', 0);
    handler.execute(el, { type: CT.ESCAPE, fromMode: 'INSERT' }, engine);
    expect(el.selectionStart).toBe(0);
  });

  test('from VISUAL restores head position', () => {
    el = makeInput('hello', 0);
    el.selectionStart = 0;
    el.selectionEnd = 3;
    handler.execute(el, { type: CT.ESCAPE, fromMode: 'VISUAL', visualHead: 2 }, engine);
    expect(el.selectionStart).toBe(2);
  });
});

// =========================================================================
// Visual mode
// =========================================================================
describe('visual mode', () => {
  test('entering visual sets anchor and selects one char', () => {
    el = makeInput('hello', 2);
    handler.execute(el, { type: CT.VISUAL_ENTER }, engine);
    expect(engine.visualAnchor).toBe(2);
    expect(engine.visualHead).toBe(2);
    expect(el.selectionStart).toBe(2);
    expect(el.selectionEnd).toBe(3);
  });

  test('extend visual selection forward', () => {
    el = makeInput('hello world', 0);
    engine.visualAnchor = 0;
    engine.visualHead = 0;
    engine.mode = Mode.VISUAL;
    handler.extendVisualSelection(el, { type: CT.MOTION, motion: MT.WORD_FORWARD, count: 1 }, engine);
    expect(engine.visualHead).toBe(6);
    expect(el.selectionStart).toBe(0);
    expect(el.selectionEnd).toBe(7);
  });

  test('visual operator deletes selection', () => {
    el = makeInput('hello world', 0);
    el.selectionStart = 0;
    el.selectionEnd = 6;
    handler.execute(el, { type: CT.VISUAL_OPERATOR, operator: OT.DELETE, lineWise: false }, engine);
    expect(el.value).toBe('world');
    expect(Register.get().content).toBe('hello ');
  });

  test('visual yank does not delete', () => {
    el = makeInput('hello world', 0);
    el.selectionStart = 0;
    el.selectionEnd = 5;
    handler.execute(el, { type: CT.VISUAL_OPERATOR, operator: OT.YANK, lineWise: false }, engine);
    expect(el.value).toBe('hello world');
    expect(Register.get().content).toBe('hello');
  });
});

// =========================================================================
// Visual line mode
// =========================================================================
describe('visual line mode', () => {
  test('entering visual line selects full line', () => {
    el = makeInput('hello\nworld', 2);
    Object.defineProperty(el, 'clientWidth', { value: 1000 });
    handler.execute(el, { type: CT.VISUAL_LINE_ENTER }, engine);
    expect(el.selectionStart).toBe(0);
    expect(el.selectionEnd).toBe(5); // visual line ends before \n
  });
});

// =========================================================================
// select text object (visual mode)
// =========================================================================
describe('selectTextObject (visual mode)', () => {
  test('selects inner word', () => {
    el = makeInput('hello world', 2);
    handler.selectTextObject(el, { type: CT.TEXT_OBJECT, modifier: 'inner', object: TO.WORD, count: 1 }, engine);
    expect(el.selectionStart).toBe(0);
    expect(el.selectionEnd).toBe(5);
  });
});
