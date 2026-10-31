/**
 * Shared harness for EventInterceptor tests.
 *
 * EventInterceptor.init() registers window listeners, so it may run only once
 * per test file. Call createHarness() in beforeAll and reset() in beforeEach.
 */

const { loadUpTo } = require('./load-scripts');

function createHarness() {
  loadUpTo('event-interceptor');

  const VimEngine = window.InputVim.VimEngine;
  const Mode = window.InputVim.Mode;
  const EventInterceptor = window.InputVim.EventInterceptor;

  const el = document.createElement('textarea');
  document.body.appendChild(el);

  // Real handler: command objects are also executed against the textarea, so a
  // correct parser feeding a broken range still shows up.
  const handler = new window.InputVim.InputHandler();
  const realExecute = handler.execute.bind(handler);
  handler.execute = jest.fn(realExecute);

  const overlay = {
    updateCmd: jest.fn(),
    showCmdLine: jest.fn(),
    hideCmdLine: jest.fn(),
  };

  const engine = new VimEngine();
  EventInterceptor.init(engine, overlay, () => el, () => handler, () => {}, () => {});

  function press(key, opts) {
    const event = new KeyboardEvent('keydown', Object.assign({
      key: key,
      bubbles: true,
      cancelable: true,
    }, opts || {}));
    window.dispatchEvent(event);
    return event;
  }

  function reset(value, cursor) {
    EventInterceptor.clearTransientState();
    engine.setMode(Mode.NORMAL);
    engine.parser.reset();
    el.value = value === undefined ? 'hello world' : value;
    el.selectionStart = el.selectionEnd = cursor || 0;
    handler.execute.mockClear();
    overlay.showCmdLine.mockClear();
    overlay.updateCmd.mockClear();
  }

  function destroy() {
    if (el.parentNode) el.parentNode.removeChild(el);
  }

  return {
    engine: engine,
    el: el,
    handler: handler,
    overlay: overlay,
    press: press,
    reset: reset,
    destroy: destroy,
    Mode: Mode,
    CT: window.InputVim.CommandType,
    MT: window.InputVim.MotionType,
    OT: window.InputVim.OperatorType,
  };
}

module.exports = { createHarness };
