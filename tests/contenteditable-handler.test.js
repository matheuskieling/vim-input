/**
 * @jest-environment jsdom
 */
const { loadUpTo } = require('./helpers/load-scripts');

let ContentEditableHandler, CT, MT, OT, IE, TO, Mode, Register;

beforeAll(() => {
  loadUpTo('contenteditable-handler');
  ContentEditableHandler = window.InputVim.ContentEditableHandler;
  CT = window.InputVim.CommandType;
  MT = window.InputVim.MotionType;
  OT = window.InputVim.OperatorType;
  IE = window.InputVim.InsertEntry;
  TO = window.InputVim.TextObject;
  Mode = window.InputVim.Mode;
  Register = window.InputVim.Register;
});

let handler, el, engine;

/**
 * Create a contenteditable div, append to body, set its text and cursor.
 * Uses the Selection/Range API so flatOffsetFromSelection works.
 */
function makeCE(text, cursorPos) {
  const div = document.createElement('div');
  div.contentEditable = 'true';
  div.textContent = text;
  document.body.appendChild(div);

  // Place the cursor at flatOffset = cursorPos
  if (text.length > 0 && cursorPos != null) {
    const walker = document.createTreeWalker(div, NodeFilter.SHOW_TEXT, null, false);
    let remaining = cursorPos;
    let node;
    while ((node = walker.nextNode())) {
      if (remaining <= node.textContent.length) {
        const sel = window.getSelection();
        const range = document.createRange();
        range.setStart(node, remaining);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        break;
      }
      remaining -= node.textContent.length;
    }
  }

  return div;
}

/** Read the flat text content from the element */
function getText(el) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
  let text = '';
  let node;
  while ((node = walker.nextNode())) text += node.textContent;
  return text;
}

/** Read current cursor position via Selection API */
function getCursorPos(el) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return 0;
  const range = sel.getRangeAt(0);
  const preRange = document.createRange();
  preRange.selectNodeContents(el);
  preRange.setEnd(range.startContainer, range.startOffset);
  return preRange.toString().length;
}

/** Read selection start/end as flat offsets */
function getSelectionRange(el) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return { start: 0, end: 0 };
  const range = sel.getRangeAt(0);

  const preStart = document.createRange();
  preStart.selectNodeContents(el);
  preStart.setEnd(range.startContainer, range.startOffset);
  const start = preStart.toString().length;

  const preEnd = document.createRange();
  preEnd.selectNodeContents(el);
  preEnd.setEnd(range.endContainer, range.endOffset);
  const end = preEnd.toString().length;

  return { start, end };
}

beforeEach(() => {
  handler = new ContentEditableHandler();
  engine = {
    mode: Mode.NORMAL,
    visualAnchor: 0,
    visualHead: 0,
    setMode(m) { this.mode = m; },
  };
  Register.clear();
});

afterEach(() => {
  if (el && el.parentNode) el.remove();
});

// =========================================================================
// Horizontal motions
// =========================================================================
describe('horizontal motions', () => {
  test('h moves cursor left', () => {
    el = makeCE('hello', 2);
    handler.execute(el, { type: CT.MOTION, motion: MT.CHAR_LEFT, count: 1 }, engine);
    expect(getCursorPos(el)).toBe(1);
  });

  test('h at position 0 stays', () => {
    el = makeCE('hello', 0);
    handler.execute(el, { type: CT.MOTION, motion: MT.CHAR_LEFT, count: 1 }, engine);
    expect(getCursorPos(el)).toBe(0);
  });

  test('l moves cursor right', () => {
    el = makeCE('hello', 2);
    handler.execute(el, { type: CT.MOTION, motion: MT.CHAR_RIGHT, count: 1 }, engine);
    expect(getCursorPos(el)).toBe(3);
  });

  test('l at line end stays', () => {
    el = makeCE('hello', 4);
    handler.execute(el, { type: CT.MOTION, motion: MT.CHAR_RIGHT, count: 1 }, engine);
    expect(getCursorPos(el)).toBe(4);
  });

  test('w moves to next word', () => {
    el = makeCE('hello world', 0);
    handler.execute(el, { type: CT.MOTION, motion: MT.WORD_FORWARD, count: 1 }, engine);
    expect(getCursorPos(el)).toBe(6);
  });

  test('b moves to previous word', () => {
    el = makeCE('hello world', 6);
    handler.execute(el, { type: CT.MOTION, motion: MT.WORD_BACK, count: 1 }, engine);
    expect(getCursorPos(el)).toBe(0);
  });

  test('e moves to word end', () => {
    el = makeCE('hello world', 0);
    handler.execute(el, { type: CT.MOTION, motion: MT.WORD_END, count: 1 }, engine);
    expect(getCursorPos(el)).toBe(4);
  });

  test('0 moves to line start', () => {
    el = makeCE('hello', 3);
    handler.execute(el, { type: CT.MOTION, motion: MT.LINE_START, count: 1 }, engine);
    expect(getCursorPos(el)).toBe(0);
  });

  test('$ moves to line end', () => {
    el = makeCE('hello', 0);
    handler.execute(el, { type: CT.MOTION, motion: MT.LINE_END, count: 1 }, engine);
    expect(getCursorPos(el)).toBe(4);
  });

  test('^ moves to first non-blank', () => {
    el = makeCE('  hello', 0);
    handler.execute(el, { type: CT.MOTION, motion: MT.FIRST_NON_BLANK, count: 1 }, engine);
    expect(getCursorPos(el)).toBe(2);
  });

  test('gg moves to document start', () => {
    el = makeCE('hello world', 8);
    handler.execute(el, { type: CT.MOTION, motion: MT.DOC_START, count: 1 }, engine);
    expect(getCursorPos(el)).toBe(0);
  });

  test('G moves to document end', () => {
    el = makeCE('hello', 0);
    handler.execute(el, { type: CT.MOTION, motion: MT.DOC_END, count: 1 }, engine);
    expect(getCursorPos(el)).toBe(4);
  });

  test('f finds char forward', () => {
    el = makeCE('hello', 0);
    handler.execute(el, { type: CT.MOTION, motion: MT.FIND_CHAR, count: 1, char: 'l' }, engine);
    expect(getCursorPos(el)).toBe(2);
  });

  test('F finds char backward', () => {
    el = makeCE('hello', 4);
    handler.execute(el, { type: CT.MOTION, motion: MT.FIND_CHAR_BACK, count: 1, char: 'l' }, engine);
    expect(getCursorPos(el)).toBe(3);
  });

  test('W moves to next WORD', () => {
    el = makeCE('hello.world next', 0);
    handler.execute(el, { type: CT.MOTION, motion: MT.WORD_FORWARD_BIG, count: 1 }, engine);
    expect(getCursorPos(el)).toBe(12);
  });

  test('B moves to previous WORD', () => {
    el = makeCE('hello.world next', 12);
    handler.execute(el, { type: CT.MOTION, motion: MT.WORD_BACK_BIG, count: 1 }, engine);
    expect(getCursorPos(el)).toBe(0);
  });

  test('2w moves two words forward', () => {
    el = makeCE('one two three', 0);
    handler.execute(el, { type: CT.MOTION, motion: MT.WORD_FORWARD, count: 2 }, engine);
    expect(getCursorPos(el)).toBe(8);
  });
});

// =========================================================================
// Operator + motion
// =========================================================================
describe('operator + motion', () => {
  test('dw deletes word', () => {
    el = makeCE('hello world', 0);
    handler.execute(el, { type: CT.OPERATOR_MOTION, operator: OT.DELETE, motion: MT.WORD_FORWARD, count: 1 }, engine);
    expect(getText(el)).toBe('world');
    expect(Register.get().content).toBe('hello ');
  });

  test('yw yanks word without deleting', () => {
    el = makeCE('hello world', 0);
    handler.execute(el, { type: CT.OPERATOR_MOTION, operator: OT.YANK, motion: MT.WORD_FORWARD, count: 1 }, engine);
    expect(getText(el)).toBe('hello world');
    expect(Register.get().content).toBe('hello ');
  });

  test('cw deletes word (change)', () => {
    el = makeCE('hello world', 0);
    handler.execute(el, { type: CT.OPERATOR_MOTION, operator: OT.CHANGE, motion: MT.WORD_FORWARD, count: 1 }, engine);
    expect(getText(el)).toBe('world');
  });

  test('d$ deletes to end of line', () => {
    el = makeCE('hello world', 5);
    handler.execute(el, { type: CT.OPERATOR_MOTION, operator: OT.DELETE, motion: MT.LINE_END, count: 1 }, engine);
    expect(getText(el)).toBe('hello');
  });

  test('d0 deletes to start of line', () => {
    el = makeCE('hello world', 6);
    handler.execute(el, { type: CT.OPERATOR_MOTION, operator: OT.DELETE, motion: MT.LINE_START, count: 1 }, engine);
    expect(getText(el)).toBe('world');
  });
});

// =========================================================================
// Operator + text object
// =========================================================================
describe('operator + text object', () => {
  test('diw deletes inner word', () => {
    el = makeCE('hello world', 2);
    handler.execute(el, { type: CT.OPERATOR_TEXT_OBJECT, operator: OT.DELETE, modifier: 'inner', object: TO.WORD, count: 1 }, engine);
    expect(getText(el)).toBe(' world');
  });

  test('daw deletes around word', () => {
    el = makeCE('hello world', 2);
    handler.execute(el, { type: CT.OPERATOR_TEXT_OBJECT, operator: OT.DELETE, modifier: 'around', object: TO.WORD, count: 1 }, engine);
    expect(getText(el)).toBe('world');
  });

  test('ci" changes inner double quotes', () => {
    el = makeCE('"hello"', 3);
    handler.execute(el, { type: CT.OPERATOR_TEXT_OBJECT, operator: OT.CHANGE, modifier: 'inner', object: TO.DOUBLE_QUOTE, count: 1 }, engine);
    expect(getText(el)).toBe('""');
  });

  test('di( deletes inner parens', () => {
    el = makeCE('(abc)', 2);
    handler.execute(el, { type: CT.OPERATOR_TEXT_OBJECT, operator: OT.DELETE, modifier: 'inner', object: TO.PAREN, count: 1 }, engine);
    expect(getText(el)).toBe('()');
  });

  test('da{ deletes around braces', () => {
    el = makeCE('{abc}', 2);
    handler.execute(el, { type: CT.OPERATOR_TEXT_OBJECT, operator: OT.DELETE, modifier: 'around', object: TO.BRACE, count: 1 }, engine);
    expect(getText(el)).toBe('');
  });

  test('di[ deletes inner brackets', () => {
    el = makeCE('[1,2,3]', 3);
    handler.execute(el, { type: CT.OPERATOR_TEXT_OBJECT, operator: OT.DELETE, modifier: 'inner', object: TO.BRACKET, count: 1 }, engine);
    expect(getText(el)).toBe('[]');
  });

  test("ci' changes inner single quotes", () => {
    el = makeCE("'test'", 3);
    handler.execute(el, { type: CT.OPERATOR_TEXT_OBJECT, operator: OT.CHANGE, modifier: 'inner', object: TO.SINGLE_QUOTE, count: 1 }, engine);
    expect(getText(el)).toBe("''");
  });

  test('yiw yanks without deleting', () => {
    el = makeCE('hello world', 2);
    handler.execute(el, { type: CT.OPERATOR_TEXT_OBJECT, operator: OT.YANK, modifier: 'inner', object: TO.WORD, count: 1 }, engine);
    expect(getText(el)).toBe('hello world');
    expect(Register.get().content).toBe('hello');
  });

  test('no-op when text object not found', () => {
    el = makeCE('hello', 2);
    handler.execute(el, { type: CT.OPERATOR_TEXT_OBJECT, operator: OT.DELETE, modifier: 'inner', object: TO.BRACE, count: 1 }, engine);
    expect(getText(el)).toBe('hello');
  });
});

// =========================================================================
// Line operator
// =========================================================================
describe('line operator', () => {
  test('dd deletes current line', () => {
    el = makeCE('hello\nworld', 2);
    handler.execute(el, { type: CT.LINE_OPERATOR, operator: OT.DELETE, count: 1 }, engine);
    expect(getText(el)).toBe('world');
    expect(Register.get().content).toBe('hello\n');
    expect(Register.get().type).toBe('line');
  });

  test('yy yanks current line without deleting', () => {
    el = makeCE('hello\nworld', 2);
    handler.execute(el, { type: CT.LINE_OPERATOR, operator: OT.YANK, count: 1 }, engine);
    expect(getText(el)).toBe('hello\nworld');
    expect(Register.get().content).toBe('hello\n');
    expect(Register.get().type).toBe('line');
  });

  test('dd on last line removes trailing newline', () => {
    el = makeCE('hello\nworld', 8);
    handler.execute(el, { type: CT.LINE_OPERATOR, operator: OT.DELETE, count: 1 }, engine);
    expect(getText(el)).toBe('hello');
  });

  test('2dd deletes two lines', () => {
    el = makeCE('one\ntwo\nthree', 0);
    handler.execute(el, { type: CT.LINE_OPERATOR, operator: OT.DELETE, count: 2 }, engine);
    expect(getText(el)).toBe('three');
  });

  test('dd on single line empties', () => {
    el = makeCE('hello', 2);
    handler.execute(el, { type: CT.LINE_OPERATOR, operator: OT.DELETE, count: 1 }, engine);
    expect(getText(el)).toBe('');
  });

  test('cc changes current line', () => {
    el = makeCE('hello\nworld', 2);
    handler.execute(el, { type: CT.LINE_OPERATOR, operator: OT.CHANGE, count: 1 }, engine);
    expect(getText(el)).toBe('world');
    expect(Register.get().content).toBe('hello\n');
  });
});

// =========================================================================
// Insert entry
// =========================================================================
describe('insert entry', () => {
  test('i keeps cursor at current position', () => {
    el = makeCE('hello', 2);
    handler.execute(el, { type: CT.INSERT_ENTER, entry: IE.I_LOWER }, engine);
    expect(getCursorPos(el)).toBe(2);
  });

  test('a moves cursor one right', () => {
    el = makeCE('hello', 2);
    handler.execute(el, { type: CT.INSERT_ENTER, entry: IE.A_LOWER }, engine);
    expect(getCursorPos(el)).toBe(3);
  });

  test('I moves to first non-blank', () => {
    el = makeCE('  hello', 4);
    handler.execute(el, { type: CT.INSERT_ENTER, entry: IE.I_UPPER }, engine);
    expect(getCursorPos(el)).toBe(2);
  });

  test('A moves to end of line', () => {
    el = makeCE('hello', 0);
    handler.execute(el, { type: CT.INSERT_ENTER, entry: IE.A_UPPER }, engine);
    expect(getCursorPos(el)).toBe(5);
  });

  test('o opens line below', () => {
    el = makeCE('hello\nworld', 2);
    handler.execute(el, { type: CT.INSERT_ENTER, entry: IE.O_LOWER }, engine);
    expect(getText(el)).toBe('hello\n\nworld');
    expect(getCursorPos(el)).toBe(6);
  });

  test('O opens line above', () => {
    el = makeCE('hello\nworld', 8);
    handler.execute(el, { type: CT.INSERT_ENTER, entry: IE.O_UPPER }, engine);
    expect(getText(el)).toBe('hello\n\nworld');
    expect(getCursorPos(el)).toBe(6);
  });
});

// =========================================================================
// Paste
// =========================================================================
describe('paste', () => {
  test('p pastes after cursor (char type)', () => {
    Register.set('xyz', 'char');
    el = makeCE('hello', 2);
    handler.execute(el, { type: CT.PASTE }, engine);
    expect(getText(el)).toBe('helxyzlo');
  });

  test('P pastes before cursor (char type)', () => {
    Register.set('xyz', 'char');
    el = makeCE('hello', 2);
    handler.execute(el, { type: CT.PASTE_BEFORE }, engine);
    expect(getText(el)).toBe('hexyzllo');
  });

  test('p pastes line below (line type)', () => {
    Register.set('new\n', 'line');
    el = makeCE('hello\nworld', 2);
    handler.execute(el, { type: CT.PASTE }, engine);
    expect(getText(el)).toBe('hello\nnew\nworld');
  });

  test('P pastes line above (line type)', () => {
    Register.set('new\n', 'line');
    el = makeCE('hello\nworld', 2);
    handler.execute(el, { type: CT.PASTE_BEFORE }, engine);
    expect(getText(el)).toBe('new\nhello\nworld');
  });

  test('no-op when register is empty', () => {
    el = makeCE('hello', 2);
    handler.execute(el, { type: CT.PASTE }, engine);
    expect(getText(el)).toBe('hello');
  });
});

// =========================================================================
// Undo / Redo
// =========================================================================
describe('undo / redo', () => {
  test('undo restores previous state', () => {
    el = makeCE('hello world', 0);
    handler.execute(el, { type: CT.OPERATOR_MOTION, operator: OT.DELETE, motion: MT.WORD_FORWARD, count: 1 }, engine);
    expect(getText(el)).toBe('world');
    handler.execute(el, { type: CT.UNDO, count: 1 }, engine);
    expect(getText(el)).toBe('hello world');
  });

  test('redo after undo', () => {
    el = makeCE('hello world', 0);
    handler.execute(el, { type: CT.OPERATOR_MOTION, operator: OT.DELETE, motion: MT.WORD_FORWARD, count: 1 }, engine);
    handler.execute(el, { type: CT.UNDO, count: 1 }, engine);
    expect(getText(el)).toBe('hello world');
    handler.execute(el, { type: CT.REDO, count: 1 }, engine);
    expect(getText(el)).toBe('world');
  });

  test('multiple undos', () => {
    el = makeCE('abc', 0);
    handler.execute(el, { type: CT.OPERATOR_MOTION, operator: OT.DELETE, motion: MT.CHAR_RIGHT, count: 1 }, engine);
    expect(getText(el)).toBe('bc');
    handler.execute(el, { type: CT.OPERATOR_MOTION, operator: OT.DELETE, motion: MT.CHAR_RIGHT, count: 1 }, engine);
    expect(getText(el)).toBe('c');
    handler.execute(el, { type: CT.UNDO, count: 2 }, engine);
    expect(getText(el)).toBe('abc');
  });
});

// =========================================================================
// Replace char
// =========================================================================
describe('replace char', () => {
  test('replaces char under cursor', () => {
    el = makeCE('hello', 0);
    handler.execute(el, { type: CT.REPLACE_CHAR, char: 'x', count: 1 }, engine);
    expect(getText(el)).toBe('xello');
  });

  test('replaces multiple chars', () => {
    el = makeCE('hello', 0);
    handler.execute(el, { type: CT.REPLACE_CHAR, char: 'x', count: 3 }, engine);
    expect(getText(el)).toBe('xxxlo');
  });

  test('no-op at end of text', () => {
    el = makeCE('hello', 5);
    handler.execute(el, { type: CT.REPLACE_CHAR, char: 'x', count: 1 }, engine);
    expect(getText(el)).toBe('hello');
  });
});

// =========================================================================
// Delete char (x)
// =========================================================================
describe('delete char', () => {
  test('deletes char under cursor', () => {
    el = makeCE('hello', 0);
    handler.execute(el, { type: CT.DELETE_CHAR, count: 1 }, engine);
    expect(getText(el)).toBe('ello');
    expect(Register.get().content).toBe('h');
  });

  test('deletes multiple chars', () => {
    el = makeCE('hello', 0);
    handler.execute(el, { type: CT.DELETE_CHAR, count: 3 }, engine);
    expect(getText(el)).toBe('lo');
    expect(Register.get().content).toBe('hel');
  });
});

// =========================================================================
// Escape
// =========================================================================
describe('escape', () => {
  test('from INSERT moves cursor left', () => {
    el = makeCE('hello', 3);
    handler.execute(el, { type: CT.ESCAPE, fromMode: 'INSERT' }, engine);
    expect(getCursorPos(el)).toBe(2);
  });

  test('from INSERT at line start stays', () => {
    el = makeCE('hello', 0);
    handler.execute(el, { type: CT.ESCAPE, fromMode: 'INSERT' }, engine);
    expect(getCursorPos(el)).toBe(0);
  });

  test('from VISUAL restores head position', () => {
    el = makeCE('hello', 0);
    handler.execute(el, { type: CT.ESCAPE, fromMode: 'VISUAL', visualHead: 2 }, engine);
    expect(getCursorPos(el)).toBe(2);
  });
});

// =========================================================================
// Visual mode
// =========================================================================
describe('visual mode', () => {
  test('entering visual sets anchor and selects one char', () => {
    el = makeCE('hello', 2);
    handler.execute(el, { type: CT.VISUAL_ENTER }, engine);
    expect(engine.visualAnchor).toBe(2);
    expect(engine.visualHead).toBe(2);
    const sel = getSelectionRange(el);
    expect(sel.start).toBe(2);
    expect(sel.end).toBe(3);
  });

  test('extend visual selection forward', () => {
    el = makeCE('hello world', 0);
    engine.visualAnchor = 0;
    engine.visualHead = 0;
    engine.mode = Mode.VISUAL;
    handler.extendVisualSelection(el, { type: CT.MOTION, motion: MT.WORD_FORWARD, count: 1 }, engine);
    expect(engine.visualHead).toBe(6);
    const sel = getSelectionRange(el);
    expect(sel.start).toBe(0);
    expect(sel.end).toBe(7);
  });

  test('extend visual selection backward', () => {
    el = makeCE('hello world', 6);
    engine.visualAnchor = 6;
    engine.visualHead = 6;
    engine.mode = Mode.VISUAL;
    handler.extendVisualSelection(el, { type: CT.MOTION, motion: MT.WORD_BACK, count: 1 }, engine);
    expect(engine.visualHead).toBe(0);
    const sel = getSelectionRange(el);
    expect(sel.start).toBe(0);
    expect(sel.end).toBe(7);
  });

  test('visual operator deletes selection', () => {
    el = makeCE('hello world', 0);
    // Manually select "hello "
    const textNode = el.firstChild;
    const sel = window.getSelection();
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 6);
    sel.removeAllRanges();
    sel.addRange(range);

    handler.execute(el, { type: CT.VISUAL_OPERATOR, operator: OT.DELETE, lineWise: false }, engine);
    expect(getText(el)).toBe('world');
    expect(Register.get().content).toBe('hello ');
  });

  test('visual yank does not delete', () => {
    el = makeCE('hello world', 0);
    const textNode = el.firstChild;
    const sel = window.getSelection();
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 5);
    sel.removeAllRanges();
    sel.addRange(range);

    handler.execute(el, { type: CT.VISUAL_OPERATOR, operator: OT.YANK, lineWise: false }, engine);
    expect(getText(el)).toBe('hello world');
    expect(Register.get().content).toBe('hello');
  });
});

// =========================================================================
// select text object (visual mode)
// =========================================================================
describe('selectTextObject (visual mode)', () => {
  test('selects inner word', () => {
    el = makeCE('hello world', 2);
    handler.selectTextObject(el, { type: CT.TEXT_OBJECT, modifier: 'inner', object: TO.WORD, count: 1 }, engine);
    const sel = getSelectionRange(el);
    expect(sel.start).toBe(0);
    expect(sel.end).toBe(5);
  });

  test('selects inner double quote', () => {
    el = makeCE('"hello"', 3);
    handler.selectTextObject(el, { type: CT.TEXT_OBJECT, modifier: 'inner', object: TO.DOUBLE_QUOTE, count: 1 }, engine);
    const sel = getSelectionRange(el);
    expect(sel.start).toBe(1);
    expect(sel.end).toBe(6);
  });

  test('selects around paren', () => {
    el = makeCE('(abc)', 2);
    handler.selectTextObject(el, { type: CT.TEXT_OBJECT, modifier: 'around', object: TO.PAREN, count: 1 }, engine);
    const sel = getSelectionRange(el);
    expect(sel.start).toBe(0);
    expect(sel.end).toBe(5);
  });
});

// =========================================================================
// Integration: combined operations
// =========================================================================
describe('combined operations', () => {
  test('delete word then undo restores it', () => {
    el = makeCE('hello world', 0);
    handler.execute(el, { type: CT.OPERATOR_MOTION, operator: OT.DELETE, motion: MT.WORD_FORWARD, count: 1 }, engine);
    expect(getText(el)).toBe('world');
    handler.execute(el, { type: CT.UNDO, count: 1 }, engine);
    expect(getText(el)).toBe('hello world');
  });

  test('yank then paste', () => {
    el = makeCE('hello world', 0);
    handler.execute(el, { type: CT.OPERATOR_MOTION, operator: OT.YANK, motion: MT.WORD_FORWARD, count: 1 }, engine);
    expect(Register.get().content).toBe('hello ');
    // Paste at end
    el.remove();
    el = makeCE('test', 3);
    handler.execute(el, { type: CT.PASTE }, engine);
    expect(getText(el)).toBe('testhello ');
  });

  test('delete inside quotes then paste elsewhere', () => {
    el = makeCE('"hello" world', 3);
    handler.execute(el, { type: CT.OPERATOR_TEXT_OBJECT, operator: OT.DELETE, modifier: 'inner', object: TO.DOUBLE_QUOTE, count: 1 }, engine);
    expect(getText(el)).toBe('"" world');
    expect(Register.get().content).toBe('hello');

    // Paste at end of "target" (pos 5 = 't', paste after = pos 6 = end)
    el.remove();
    el = makeCE('target', 5);
    handler.execute(el, { type: CT.PASTE }, engine);
    expect(getText(el)).toBe('targethello');
  });

  test('dd then p pastes deleted line', () => {
    el = makeCE('first\nsecond\nthird', 0);
    handler.execute(el, { type: CT.LINE_OPERATOR, operator: OT.DELETE, count: 1 }, engine);
    expect(getText(el)).toBe('second\nthird');
    expect(Register.get().type).toBe('line');
    handler.execute(el, { type: CT.PASTE }, engine);
    expect(getText(el)).toBe('second\nfirst\nthird');
  });

  test('multiple operations with undo chain', () => {
    el = makeCE('abc def ghi', 0);
    // Delete first word
    handler.execute(el, { type: CT.OPERATOR_MOTION, operator: OT.DELETE, motion: MT.WORD_FORWARD, count: 1 }, engine);
    expect(getText(el)).toBe('def ghi');
    // Delete second word
    handler.execute(el, { type: CT.OPERATOR_MOTION, operator: OT.DELETE, motion: MT.WORD_FORWARD, count: 1 }, engine);
    expect(getText(el)).toBe('ghi');
    // Undo one
    handler.execute(el, { type: CT.UNDO, count: 1 }, engine);
    expect(getText(el)).toBe('def ghi');
    // Undo two
    handler.execute(el, { type: CT.UNDO, count: 1 }, engine);
    expect(getText(el)).toBe('abc def ghi');
  });
});
