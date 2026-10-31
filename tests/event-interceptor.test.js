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
    h.press('F');
    h.press('/');
    expect(h.overlay.showCmdLine).not.toHaveBeenCalled();
    expect(h.handler.execute).toHaveBeenCalledTimes(1);
    expect(h.handler.execute.mock.calls[0][1]).toMatchObject({
      type: CT.MOTION, motion: MT.FIND_CHAR_BACK, char: '/',
    });
  });

  test('cF/ changes back to "/" instead of dropping the operator', () => {
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
    h.press('d');
    h.press('F');
    h.press('!');
    expect(h.handler.execute.mock.calls[0][1]).toMatchObject({
      type: CT.OPERATOR_MOTION, operator: OT.DELETE, motion: MT.FIND_CHAR_BACK, char: '!',
    });
  });

  test('cT? uses "?" as the target instead of starting a backwards search', () => {
    h.press('c');
    h.press('T');
    h.press('?');
    expect(h.overlay.showCmdLine).not.toHaveBeenCalled();
    expect(h.handler.execute.mock.calls[0][1]).toMatchObject({
      type: CT.OPERATOR_MOTION, operator: OT.CHANGE, motion: MT.TILL_CHAR_BACK, char: '?',
    });
  });

  test('r: replaces the character with a colon instead of opening cmdline', () => {
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

  test('dF/ deletes back through a slash and the cursor character', () => {
    h.reset('abc/def', 5);
    h.press('d');
    h.press('F');
    h.press('/');
    expect(h.el.value).toBe('abcf');
  });

  test('cF/ changes text and enters insert mode', () => {
    h.reset('abc/def', 5);
    h.press('c');
    h.press('F');
    h.press('/');
    expect(h.el.value).toBe('abcf');
    expect(h.engine.mode).toBe(h.Mode.INSERT);
  });
});
