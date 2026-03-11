/**
 * @jest-environment jsdom
 */
const { loadAll } = require('./helpers/load-scripts');

let isTextInput, isContentEditable, isVimTarget, getHandler;

beforeAll(() => {
  loadAll();
  ({ isTextInput, isContentEditable, isVimTarget, getHandler } =
    window.InputVim.ElementDetector);
});

function makeInput(attrs = {}) {
  const el = document.createElement('input');
  for (const [k, v] of Object.entries(attrs)) {
    el[k] = v;
  }
  return el;
}

function makeCE() {
  const div = document.createElement('div');
  div.contentEditable = 'true';
  document.body.appendChild(div);
  return div;
}

// ---------------------------------------------------------------------------
// isTextInput
// ---------------------------------------------------------------------------
describe('isTextInput', () => {
  test('returns false for null/undefined', () => {
    expect(isTextInput(null)).toBe(false);
    expect(isTextInput(undefined)).toBe(false);
  });

  test('accepts regular text input', () => {
    expect(isTextInput(makeInput({ type: 'text' }))).toBe(true);
  });

  test('accepts input with no type (defaults to text)', () => {
    expect(isTextInput(document.createElement('input'))).toBe(true);
  });

  test.each(['text', 'search', 'url', 'tel', 'password', 'email'])(
    'accepts input type="%s"',
    (type) => {
      expect(isTextInput(makeInput({ type }))).toBe(true);
    }
  );

  test('accepts textarea', () => {
    expect(isTextInput(document.createElement('textarea'))).toBe(true);
  });

  // --- readonly exclusion ---
  test('rejects readonly text input', () => {
    expect(isTextInput(makeInput({ type: 'text', readOnly: true }))).toBe(false);
  });

  test('rejects readonly input with no explicit type', () => {
    const el = document.createElement('input');
    el.readOnly = true;
    expect(isTextInput(el)).toBe(false);
  });

  test('rejects readonly textarea', () => {
    const ta = document.createElement('textarea');
    ta.readOnly = true;
    expect(isTextInput(ta)).toBe(false);
  });

  test('rejects readonly search input (e.g. Mantine Select)', () => {
    expect(isTextInput(makeInput({ type: 'search', readOnly: true }))).toBe(false);
  });

  test.each(['text', 'search', 'url', 'tel', 'password', 'email'])(
    'rejects readonly input type="%s"',
    (type) => {
      expect(isTextInput(makeInput({ type, readOnly: true }))).toBe(false);
    }
  );

  // --- non-text input types ---
  test.each(['checkbox', 'radio', 'range', 'file', 'hidden', 'submit', 'button', 'color', 'date'])(
    'rejects input type="%s"',
    (type) => {
      expect(isTextInput(makeInput({ type }))).toBe(false);
    }
  );

  // --- non-input elements ---
  test('rejects div', () => {
    expect(isTextInput(document.createElement('div'))).toBe(false);
  });

  test('rejects span', () => {
    expect(isTextInput(document.createElement('span'))).toBe(false);
  });

  test('rejects select', () => {
    expect(isTextInput(document.createElement('select'))).toBe(false);
  });

  test('rejects button element', () => {
    expect(isTextInput(document.createElement('button'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isContentEditable
// ---------------------------------------------------------------------------
describe('isContentEditable', () => {
  test('returns false for null/undefined', () => {
    expect(isContentEditable(null)).toBe(false);
    expect(isContentEditable(undefined)).toBe(false);
  });

  test('returns true for contenteditable element', () => {
    const div = makeCE();
    expect(isContentEditable(div)).toBe(true);
    div.remove();
  });

  test('returns false for regular div', () => {
    expect(isContentEditable(document.createElement('div'))).toBe(false);
  });

  test('returns false for contenteditable="false"', () => {
    const div = document.createElement('div');
    div.contentEditable = 'false';
    document.body.appendChild(div);
    expect(isContentEditable(div)).toBe(false);
    div.remove();
  });

  test('works with contenteditable span', () => {
    const span = document.createElement('span');
    span.contentEditable = 'true';
    document.body.appendChild(span);
    expect(isContentEditable(span)).toBe(true);
    span.remove();
  });

  test('returns false for input elements', () => {
    expect(isContentEditable(document.createElement('input'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isVimTarget
// ---------------------------------------------------------------------------
describe('isVimTarget', () => {
  test('true for text input', () => {
    expect(isVimTarget(makeInput({ type: 'text' }))).toBe(true);
  });

  test('true for textarea', () => {
    expect(isVimTarget(document.createElement('textarea'))).toBe(true);
  });

  test('true for contenteditable', () => {
    const div = makeCE();
    expect(isVimTarget(div)).toBe(true);
    div.remove();
  });

  test('false for readonly input', () => {
    expect(isVimTarget(makeInput({ type: 'text', readOnly: true }))).toBe(false);
  });

  test('false for regular div', () => {
    expect(isVimTarget(document.createElement('div'))).toBe(false);
  });

  test('false for non-text input', () => {
    expect(isVimTarget(makeInput({ type: 'checkbox' }))).toBe(false);
  });

  test('false for null', () => {
    expect(isVimTarget(null)).toBe(false);
  });

  test('false for readonly textarea', () => {
    const ta = document.createElement('textarea');
    ta.readOnly = true;
    expect(isVimTarget(ta)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getHandler
// ---------------------------------------------------------------------------
describe('getHandler', () => {
  test('returns input handler for text input', () => {
    const h = getHandler(makeInput({ type: 'text' }));
    expect(h).not.toBeNull();
  });

  test('returns same handler instance for all text inputs', () => {
    const h1 = getHandler(makeInput({ type: 'text' }));
    const h2 = getHandler(makeInput({ type: 'email' }));
    expect(h1).toBe(h2);
  });

  test('returns input handler for textarea', () => {
    const h = getHandler(document.createElement('textarea'));
    expect(h).not.toBeNull();
  });

  test('returns contenteditable handler for contenteditable', () => {
    const div = makeCE();
    const h = getHandler(div);
    expect(h).not.toBeNull();
    div.remove();
  });

  test('input handler and ce handler are different instances', () => {
    const inputH = getHandler(makeInput({ type: 'text' }));
    const div = makeCE();
    const ceH = getHandler(div);
    expect(inputH).not.toBe(ceH);
    div.remove();
  });

  test('returns null for readonly input', () => {
    expect(getHandler(makeInput({ type: 'text', readOnly: true }))).toBeNull();
  });

  test('returns null for non-vim-target element', () => {
    expect(getHandler(document.createElement('div'))).toBeNull();
  });

  test('returns null for null', () => {
    expect(getHandler(null)).toBeNull();
  });
});
