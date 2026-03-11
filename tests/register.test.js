/**
 * @jest-environment jsdom
 */
const { loadUpTo } = require('./helpers/load-scripts');

let Register;

beforeAll(() => {
  loadUpTo('register');
  Register = window.InputVim.Register;
});

beforeEach(() => {
  Register.clear();
  Register.setUseClipboard(false);
});

describe('Register', () => {
  describe('set / get', () => {
    test('stores content and type', () => {
      Register.set('hello', 'char');
      expect(Register.get()).toEqual({ content: 'hello', type: 'char' });
    });

    test('defaults type to char', () => {
      Register.set('world');
      expect(Register.get().type).toBe('char');
    });

    test('stores line type', () => {
      Register.set('full line\n', 'line');
      expect(Register.get()).toEqual({ content: 'full line\n', type: 'line' });
    });

    test('overwrites previous content', () => {
      Register.set('first');
      Register.set('second');
      expect(Register.get().content).toBe('second');
    });
  });

  describe('clear', () => {
    test('resets to empty char', () => {
      Register.set('data', 'line');
      Register.clear();
      expect(Register.get()).toEqual({ content: '', type: 'char' });
    });
  });

  describe('clipboard integration', () => {
    test('does not write to clipboard when disabled', () => {
      const writeText = jest.fn().mockResolvedValue(undefined);
      navigator.clipboard = { writeText, readText: jest.fn() };

      Register.setUseClipboard(false);
      Register.set('test');
      expect(writeText).not.toHaveBeenCalled();
    });

    test('writes to clipboard when enabled', () => {
      const writeText = jest.fn().mockResolvedValue(undefined);
      navigator.clipboard = { writeText, readText: jest.fn() };

      Register.setUseClipboard(true);
      Register.set('clipboard text');
      expect(writeText).toHaveBeenCalledWith('clipboard text');
    });
  });

  describe('syncFromClipboard', () => {
    test('calls callback immediately when clipboard disabled', (done) => {
      Register.setUseClipboard(false);
      Register.set('local');
      Register.syncFromClipboard(() => {
        expect(Register.get().content).toBe('local');
        done();
      });
    });

    test('updates register from clipboard', (done) => {
      const readText = jest.fn().mockResolvedValue('from clipboard');
      navigator.clipboard = { readText, writeText: jest.fn().mockResolvedValue(undefined) };

      Register.setUseClipboard(true);
      Register.set('old');
      Register.syncFromClipboard(() => {
        expect(Register.get().content).toBe('from clipboard');
        expect(Register.get().type).toBe('char');
        done();
      });
    });

    test('normalizes CRLF to LF', (done) => {
      const readText = jest.fn().mockResolvedValue('line1\r\nline2\r\n');
      navigator.clipboard = { readText, writeText: jest.fn().mockResolvedValue(undefined) };

      Register.setUseClipboard(true);
      Register.syncFromClipboard(() => {
        expect(Register.get().content).toBe('line1\nline2\n');
        done();
      });
    });

    test('does not change type if clipboard content matches', (done) => {
      const readText = jest.fn().mockResolvedValue('same');
      navigator.clipboard = { readText, writeText: jest.fn().mockResolvedValue(undefined) };

      Register.setUseClipboard(true);
      Register.set('same', 'line');
      Register.syncFromClipboard(() => {
        // content matches, so type should remain 'line'
        expect(Register.get().type).toBe('line');
        done();
      });
    });

    test('calls callback even on clipboard read failure', (done) => {
      const readText = jest.fn().mockRejectedValue(new Error('denied'));
      navigator.clipboard = { readText, writeText: jest.fn().mockResolvedValue(undefined) };

      Register.setUseClipboard(true);
      Register.set('fallback');
      Register.syncFromClipboard(() => {
        expect(Register.get().content).toBe('fallback');
        done();
      });
    });
  });
});
