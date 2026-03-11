/**
 * @jest-environment jsdom
 */
const { loadUpTo } = require('./helpers/load-scripts');

let VimEngine, Mode, CT, OT;

beforeAll(() => {
  loadUpTo('vim-engine');
  VimEngine = window.InputVim.VimEngine;
  Mode = window.InputVim.Mode;
  CT = window.InputVim.CommandType;
  OT = window.InputVim.OperatorType;
});

let engine;
beforeEach(() => {
  engine = new VimEngine();
});

// =========================================================================
// Initial state
// =========================================================================
describe('initial state', () => {
  test('starts in NORMAL mode', () => {
    expect(engine.mode).toBe(Mode.NORMAL);
  });

  test('visualAnchor and visualHead are 0', () => {
    expect(engine.visualAnchor).toBe(0);
    expect(engine.visualHead).toBe(0);
  });
});

// =========================================================================
// Mode transitions from NORMAL
// =========================================================================
describe('NORMAL mode transitions', () => {
  test('i → INSERT', () => {
    const cmd = engine.handleKey('i');
    expect(engine.mode).toBe(Mode.INSERT);
    expect(cmd.type).toBe(CT.INSERT_ENTER);
  });

  test('a → INSERT', () => {
    engine.handleKey('a');
    expect(engine.mode).toBe(Mode.INSERT);
  });

  test('I → INSERT', () => {
    engine.handleKey('I');
    expect(engine.mode).toBe(Mode.INSERT);
  });

  test('A → INSERT', () => {
    engine.handleKey('A');
    expect(engine.mode).toBe(Mode.INSERT);
  });

  test('o → INSERT', () => {
    engine.handleKey('o');
    expect(engine.mode).toBe(Mode.INSERT);
  });

  test('O → INSERT', () => {
    engine.handleKey('O');
    expect(engine.mode).toBe(Mode.INSERT);
  });

  test('v → VISUAL', () => {
    const cmd = engine.handleKey('v');
    expect(engine.mode).toBe(Mode.VISUAL);
    expect(cmd.type).toBe(CT.VISUAL_ENTER);
  });

  test('V → VISUAL_LINE', () => {
    const cmd = engine.handleKey('V');
    expect(engine.mode).toBe(Mode.VISUAL_LINE);
    expect(cmd.type).toBe(CT.VISUAL_LINE_ENTER);
  });

  test('Escape in NORMAL returns escape with fromMode NORMAL', () => {
    const cmd = engine.handleKey('Escape');
    expect(cmd.type).toBe(CT.ESCAPE);
    expect(cmd.fromMode).toBe(Mode.NORMAL);
  });
});

// =========================================================================
// NORMAL → motion (stays in NORMAL)
// =========================================================================
describe('NORMAL mode motions', () => {
  test('w stays in NORMAL', () => {
    const cmd = engine.handleKey('w');
    expect(engine.mode).toBe(Mode.NORMAL);
    expect(cmd.type).toBe(CT.MOTION);
  });

  test('j stays in NORMAL', () => {
    engine.handleKey('j');
    expect(engine.mode).toBe(Mode.NORMAL);
  });
});

// =========================================================================
// NORMAL → operator → mode change
// =========================================================================
describe('change operator transitions to INSERT', () => {
  test('cw → INSERT', () => {
    engine.handleKey('c');
    engine.handleKey('w');
    expect(engine.mode).toBe(Mode.INSERT);
  });

  test('cc → INSERT', () => {
    engine.handleKey('c');
    engine.handleKey('c');
    expect(engine.mode).toBe(Mode.INSERT);
  });

  test('dw stays NORMAL', () => {
    engine.handleKey('d');
    engine.handleKey('w');
    expect(engine.mode).toBe(Mode.NORMAL);
  });

  test('yy stays NORMAL', () => {
    engine.handleKey('y');
    engine.handleKey('y');
    expect(engine.mode).toBe(Mode.NORMAL);
  });

  test('s (substitute) → INSERT', () => {
    engine.handleKey('s');
    expect(engine.mode).toBe(Mode.INSERT);
  });

  test('C (change to eol) → INSERT', () => {
    engine.handleKey('C');
    expect(engine.mode).toBe(Mode.INSERT);
  });
});

// =========================================================================
// INSERT mode
// =========================================================================
describe('INSERT mode', () => {
  beforeEach(() => {
    engine.handleKey('i'); // enter INSERT
  });

  test('Escape → NORMAL', () => {
    const cmd = engine.handleKey('Escape');
    expect(engine.mode).toBe(Mode.NORMAL);
    expect(cmd.type).toBe(CT.ESCAPE);
    expect(cmd.fromMode).toBe(Mode.INSERT);
  });

  test('non-Escape keys return null', () => {
    expect(engine.handleKey('a')).toBeNull();
    expect(engine.handleKey('w')).toBeNull();
    expect(engine.handleKey('d')).toBeNull();
  });
});

// =========================================================================
// VISUAL mode
// =========================================================================
describe('VISUAL mode', () => {
  beforeEach(() => {
    engine.handleKey('v');
  });

  test('Escape → NORMAL', () => {
    const cmd = engine.handleKey('Escape');
    expect(engine.mode).toBe(Mode.NORMAL);
    expect(cmd.type).toBe(CT.ESCAPE);
    expect(cmd.fromMode).toBe(Mode.VISUAL);
  });

  test('v again → NORMAL (toggle off)', () => {
    const cmd = engine.handleKey('v');
    expect(engine.mode).toBe(Mode.NORMAL);
    expect(cmd.type).toBe(CT.ESCAPE);
    expect(cmd.fromMode).toBe(Mode.VISUAL);
  });

  test('V → VISUAL_LINE', () => {
    const cmd = engine.handleKey('V');
    expect(engine.mode).toBe(Mode.VISUAL_LINE);
    expect(cmd.type).toBe(CT.VISUAL_LINE_ENTER);
  });

  test('d → NORMAL (delete selection)', () => {
    const cmd = engine.handleKey('d');
    expect(engine.mode).toBe(Mode.NORMAL);
    expect(cmd.type).toBe(CT.VISUAL_OPERATOR);
    expect(cmd.operator).toBe(OT.DELETE);
  });

  test('c → INSERT (change selection)', () => {
    const cmd = engine.handleKey('c');
    expect(engine.mode).toBe(Mode.INSERT);
    expect(cmd.operator).toBe(OT.CHANGE);
  });

  test('y → NORMAL (yank selection)', () => {
    const cmd = engine.handleKey('y');
    expect(engine.mode).toBe(Mode.NORMAL);
    expect(cmd.operator).toBe(OT.YANK);
  });

  test('x → NORMAL (delete)', () => {
    const cmd = engine.handleKey('x');
    expect(engine.mode).toBe(Mode.NORMAL);
    expect(cmd.operator).toBe(OT.DELETE);
  });

  test('s → INSERT (change)', () => {
    engine.handleKey('s');
    expect(engine.mode).toBe(Mode.INSERT);
  });

  test('motions return command (extend selection)', () => {
    const cmd = engine.handleKey('w');
    expect(cmd.type).toBe(CT.MOTION);
    expect(engine.mode).toBe(Mode.VISUAL);
  });

  test('o swaps anchor and head', () => {
    engine.visualAnchor = 5;
    engine.visualHead = 10;
    const cmd = engine.handleKey('o');
    expect(cmd.type).toBe(CT.VISUAL_SWAP);
    expect(engine.visualAnchor).toBe(10);
    expect(engine.visualHead).toBe(5);
  });

  test('i starts text object pending (not insert)', () => {
    const cmd = engine.handleKey('i');
    expect(cmd).toBeNull();
    expect(engine.mode).toBe(Mode.VISUAL); // still visual
  });

  test('i then w returns text object', () => {
    engine.handleKey('i');
    const cmd = engine.handleKey('w');
    expect(cmd.type).toBe(CT.TEXT_OBJECT);
    expect(cmd.object).toBe(window.InputVim.TextObject.WORD);
  });
});

// =========================================================================
// VISUAL_LINE mode
// =========================================================================
describe('VISUAL_LINE mode', () => {
  beforeEach(() => {
    engine.handleKey('V');
  });

  test('Escape → NORMAL', () => {
    const cmd = engine.handleKey('Escape');
    expect(engine.mode).toBe(Mode.NORMAL);
    expect(cmd.fromMode).toBe(Mode.VISUAL_LINE);
  });

  test('V again → NORMAL (toggle off)', () => {
    const cmd = engine.handleKey('V');
    expect(engine.mode).toBe(Mode.NORMAL);
    expect(cmd.fromMode).toBe(Mode.VISUAL_LINE);
  });

  test('v → VISUAL (switch)', () => {
    const cmd = engine.handleKey('v');
    expect(engine.mode).toBe(Mode.VISUAL);
    expect(cmd.type).toBe(CT.VISUAL_ENTER);
  });

  test('d sets lineWise flag', () => {
    const cmd = engine.handleKey('d');
    expect(cmd.lineWise).toBe(true);
  });

  test('y in visual line sets lineWise', () => {
    const cmd = engine.handleKey('y');
    expect(cmd.lineWise).toBe(true);
  });
});

// =========================================================================
// Mode change listeners
// =========================================================================
describe('mode change listeners', () => {
  test('listener is called on mode change', () => {
    const listener = jest.fn();
    engine.onModeChange(listener);
    engine.handleKey('i');
    expect(listener).toHaveBeenCalledWith(Mode.INSERT);
  });

  test('multiple listeners are called', () => {
    const l1 = jest.fn();
    const l2 = jest.fn();
    engine.onModeChange(l1);
    engine.onModeChange(l2);
    engine.handleKey('v');
    expect(l1).toHaveBeenCalledWith(Mode.VISUAL);
    expect(l2).toHaveBeenCalledWith(Mode.VISUAL);
  });

  test('listener not called when mode stays the same', () => {
    const listener = jest.fn();
    engine.onModeChange(listener);
    engine.handleKey('w'); // motion, stays NORMAL
    expect(listener).not.toHaveBeenCalled();
  });

  test('setMode fires listener', () => {
    const listener = jest.fn();
    engine.onModeChange(listener);
    engine.setMode(Mode.INSERT);
    expect(listener).toHaveBeenCalledWith(Mode.INSERT);
  });

  test('setMode with same mode does not fire', () => {
    const listener = jest.fn();
    engine.onModeChange(listener);
    engine.setMode(Mode.NORMAL); // already NORMAL
    expect(listener).not.toHaveBeenCalled();
  });
});
