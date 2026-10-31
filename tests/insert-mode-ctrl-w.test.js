/**
 * @jest-environment jsdom
 */
const { createHarness } = require('./helpers/interceptor-harness');

let h, CT;

beforeAll(() => {
  h = createHarness();
  CT = h.CT;
});

beforeEach(() => {
  h.reset();
});

afterAll(() => {
  h.destroy();
});

// =========================================================================
// Ctrl-W in insert mode deletes the word before the cursor (i_CTRL-W)
// =========================================================================
describe('Ctrl-W in insert mode', () => {
  test('deletes the word before the cursor', () => {
    h.engine.setMode(h.Mode.INSERT);
    const event = h.press('w', { ctrlKey: true });
    expect(event.defaultPrevented).toBe(true);
    expect(h.handler.execute).toHaveBeenCalledTimes(1);
    expect(h.handler.execute.mock.calls[0][1]).toMatchObject({
      type: CT.DELETE_WORD_BACK, count: 1,
    });
  });

  test('is ignored outside insert mode', () => {
    const event = h.press('w', { ctrlKey: true });
    expect(event.defaultPrevented).toBe(false);
    expect(h.handler.execute).not.toHaveBeenCalled();
  });

  test('is still handled when a previous key was plain text', () => {
    h.engine.setMode(h.Mode.INSERT);
    h.press('d');
    // 'd' in insert mode is plain text — the parser must not accumulate it
    expect(h.engine.parser.getPending()).toBe('');
    h.press('w', { ctrlKey: true });
    expect(h.handler.execute.mock.calls[0][1]).toMatchObject({ type: CT.DELETE_WORD_BACK });
  });

  test('deletes the word before the cursor end to end', () => {
    h.reset('foo bar', 7);
    h.engine.setMode(h.Mode.INSERT);
    h.press('w', { ctrlKey: true });
    expect(h.el.value).toBe('foo ');
    expect(h.el.selectionStart).toBe(4);
  });

  test('twice removes the following word too', () => {
    h.reset('foo bar', 7);
    h.engine.setMode(h.Mode.INSERT);
    h.press('w', { ctrlKey: true });
    h.press('w', { ctrlKey: true });
    expect(h.el.value).toBe('');
  });

  test('does not modify the register', () => {
    h.reset('foo bar', 7);
    h.engine.setMode(h.Mode.INSERT);
    window.InputVim.Register.set('keep me', 'char');
    h.press('w', { ctrlKey: true });
    expect(window.InputVim.Register.get().content).toBe('keep me');
  });
});
