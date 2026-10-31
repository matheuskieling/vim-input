/**
 * @jest-environment jsdom
 */
const { createHarness } = require('./helpers/interceptor-harness');

let h, CT, MT, OT;

beforeAll(() => {
  h = createHarness();
  CT = h.CT;
  MT = h.MT;
  OT = h.OT;
});

beforeEach(() => {
  h.reset();
});

afterAll(() => {
  h.destroy();
});

// =========================================================================
// A pending literal character argument must consume the next key verbatim
// =========================================================================
describe('literal char arguments are not mode triggers', () => {
  test('F/ uses "/" as the target instead of starting a search', () => {
    h.reset('ab/cd', 4);
    h.press('F');
    h.press('/');
    expect(h.overlay.showCmdLine).not.toHaveBeenCalled();
    expect(h.handler.execute).toHaveBeenCalledTimes(1);
    expect(h.handler.execute.mock.calls[0][1]).toMatchObject({
      type: CT.MOTION, motion: MT.FIND_CHAR_BACK, char: '/',
    });
  });

  test('cF/ changes back to "/" instead of dropping the operator', () => {
    h.reset('ab/cd', 3);
    h.press('c');
    h.press('F');
    h.press('/');
    expect(h.overlay.showCmdLine).not.toHaveBeenCalled();
    expect(h.handler.execute).toHaveBeenCalledTimes(1);
    expect(h.handler.execute.mock.calls[0][1]).toMatchObject({
      type: CT.OPERATOR_MOTION, operator: OT.CHANGE, motion: MT.FIND_CHAR_BACK, char: '/',
    });
    expect(h.engine.mode).toBe(h.Mode.INSERT);
  });

  test('dF! uses "!" as the target', () => {
    h.reset('ab!cd', 3);
    h.press('d');
    h.press('F');
    h.press('!');
    expect(h.handler.execute.mock.calls[0][1]).toMatchObject({
      type: CT.OPERATOR_MOTION, operator: OT.DELETE, motion: MT.FIND_CHAR_BACK, char: '!',
    });
  });

  test('cT? uses "?" as the target instead of starting a backwards search', () => {
    h.reset('ab?cd', 4);
    h.press('c');
    h.press('T');
    h.press('?');
    expect(h.overlay.showCmdLine).not.toHaveBeenCalled();
    expect(h.handler.execute.mock.calls[0][1]).toMatchObject({
      type: CT.OPERATOR_MOTION, operator: OT.CHANGE, motion: MT.TILL_CHAR_BACK, char: '?',
    });
  });

  test('r: replaces the character with a colon instead of opening cmdline', () => {
    h.reset('ab', 0);
    h.press('r');
    h.press(':');
    expect(h.overlay.showCmdLine).not.toHaveBeenCalled();
    expect(h.handler.execute.mock.calls[0][1]).toMatchObject({
      type: CT.REPLACE_CHAR, char: ':',
    });
  });

  test('di/ resolves the char-pair text object', () => {
    h.press('d');
    h.press('i');
    h.press('/');
    expect(h.overlay.showCmdLine).not.toHaveBeenCalled();
    expect(h.handler.execute.mock.calls[0][1]).toMatchObject({
      type: CT.OPERATOR_TEXT_OBJECT, object: 'char_pair', char: '/',
    });
  });

  test('a bare "/" still starts a search', () => {
    h.press('/');
    expect(h.overlay.showCmdLine).toHaveBeenCalledWith('/');
    expect(h.handler.execute).not.toHaveBeenCalled();
  });

  test('a bare ":" still opens the command line', () => {
    h.press(':');
    expect(h.overlay.showCmdLine).toHaveBeenCalledWith(':');
    expect(h.handler.execute).not.toHaveBeenCalled();
  });

  test('"/" after a bare operator still opens a search', () => {
    h.press('d');
    h.press('/');
    expect(h.overlay.showCmdLine).toHaveBeenCalledWith('/');
  });
});

// =========================================================================
// End to end: keys in, buffer out
// =========================================================================
describe('end to end find and till', () => {
  test('df! deletes through the target character', () => {
    h.reset('ab!cd', 0);
    h.press('d');
    h.press('f');
    h.press('!');
    expect(h.el.value).toBe('cd');
  });

  test('dt! deletes up to the target character', () => {
    h.reset('ab!cd', 0);
    h.press('d');
    h.press('t');
    h.press('!');
    expect(h.el.value).toBe('!cd');
  });

  test('df/ deletes through a slash', () => {
    h.reset('abc/def', 0);
    h.press('d');
    h.press('f');
    h.press('/');
    expect(h.el.value).toBe('def');
  });

  test('dF/ deletes back to a slash but keeps the cursor character', () => {
    // Vim 9.2: "abc/def" with the cursor on 'e' gives "abcef".
    h.reset('abc/def', 5);
    h.press('d');
    h.press('F');
    h.press('/');
    expect(h.el.value).toBe('abcef');
  });

  test('cF/ changes text and enters insert mode', () => {
    h.reset('abc/def', 5);
    h.press('c');
    h.press('F');
    h.press('/');
    expect(h.el.value).toBe('abcef');
    expect(h.engine.mode).toBe(h.Mode.INSERT);
  });
});

// =========================================================================
// A missing f/F/t/T target cancels the operator (no edit, no mode change)
// =========================================================================
describe('missing char target cancels the command', () => {
  test('dt with a missing target leaves the buffer alone', () => {
    h.reset('abc def', 0);
    h.press('d'); h.press('t'); h.press('z');
    expect(h.el.value).toBe('abc def');
    expect(h.engine.mode).toBe(h.Mode.NORMAL);
  });

  test('cF with a missing target does not enter insert mode', () => {
    h.reset('abc def', 3);
    h.press('c'); h.press('F'); h.press('z');
    expect(h.el.value).toBe('abc def');
    expect(h.engine.mode).toBe(h.Mode.NORMAL);
  });

  test('an unsatisfiable count deletes nothing', () => {
    // Vim: d2t, on "a,b c" (one comma) leaves the buffer untouched.
    h.reset('a,b c', 0);
    h.press('d'); h.press('2'); h.press('t'); h.press(',');
    expect(h.el.value).toBe('a,b c');
    expect(h.engine.mode).toBe(h.Mode.NORMAL);
  });

  test('a successful target still applies the operator', () => {
    h.reset('abc def', 0);
    h.press('d'); h.press('t'); h.press(' ');
    expect(h.el.value).toBe(' def');
  });
});
