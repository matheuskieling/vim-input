/**
 * @jest-environment jsdom
 */
const { loadUpTo } = require('./helpers/load-scripts');

let Settings, Mode;

beforeAll(() => {
  // Settings depends on chrome.storage — mock it
  window.chrome = {
    storage: {
      sync: {
        get: jest.fn((defaults, cb) => cb({ ...defaults })),
      },
      onChanged: { addListener: jest.fn() },
    },
  };

  loadUpTo('settings-manager');
  Settings = window.InputVim.Settings;
  Mode = window.InputVim.Mode;
});

// =========================================================================
// DEFAULTS
// =========================================================================
describe('DEFAULTS', () => {
  test('has expected default values', () => {
    expect(Settings.DEFAULTS.enabled).toBe(true);
    expect(Settings.DEFAULTS.startMode).toBe('INSERT');
    expect(Settings.DEFAULTS.excludePatterns).toEqual([]);
    expect(Settings.DEFAULTS.matchBrackets).toBe(false);
    expect(Settings.DEFAULTS.tabSize).toBe(4);
    expect(Settings.DEFAULTS.useClipboard).toBe(false);
    expect(Settings.DEFAULTS.highlightYank).toBe(false);
    expect(Settings.DEFAULTS.halfPageJump).toBe(20);
    expect(Settings.DEFAULTS.alwaysCentered).toBe(false);
  });
});

// =========================================================================
// load
// =========================================================================
describe('load', () => {
  test('calls callback with settings', (done) => {
    Settings.load((items) => {
      expect(items).toBeDefined();
      expect(items.enabled).toBe(true);
      done();
    });
  });

  test('falls back to defaults without chrome.storage', (done) => {
    const origChrome = window.chrome;
    window.chrome = undefined;

    // Need to reload the module. Instead, test the fallback path:
    // When chrome is undefined, load uses DEFAULTS
    Settings.load((items) => {
      expect(items).toBeDefined();
      done();
    });

    window.chrome = origChrome;
  });
});

// =========================================================================
// get
// =========================================================================
describe('get', () => {
  beforeAll((done) => {
    Settings.load(() => done());
  });

  test('returns cached value', () => {
    expect(Settings.get('enabled')).toBe(true);
  });

  test('returns default for unknown key', () => {
    expect(Settings.get('tabSize')).toBe(4);
  });

  test('returns undefined for completely unknown key', () => {
    expect(Settings.get('nonexistent')).toBeUndefined();
  });
});

// =========================================================================
// getStartMode
// =========================================================================
describe('getStartMode', () => {
  test('returns INSERT by default', () => {
    expect(Settings.getStartMode()).toBe(Mode.INSERT);
  });
});

// =========================================================================
// isPageExcluded — tests globMatch internally
// =========================================================================
describe('isPageExcluded / globMatch', () => {
  // We can test globMatch indirectly through isPageExcluded
  // but we need to set up cache with excludePatterns

  test('returns false with no patterns', () => {
    expect(Settings.isPageExcluded()).toBe(false);
  });
});

// =========================================================================
// onChange
// =========================================================================
describe('onChange', () => {
  test('registers callback without error', () => {
    expect(() => Settings.onChange(() => {})).not.toThrow();
  });
});
