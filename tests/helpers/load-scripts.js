/**
 * Shared test helper: loads content scripts in correct order into jsdom's window.
 *
 * Usage (in a test file):
 *   const { loadAll, loadUpTo } = require('./helpers/load-scripts');
 *   beforeAll(() => loadAll());          // loads every module
 *   beforeAll(() => loadUpTo('text-utils')); // loads only up to TextUtils
 */

const fs = require('fs');
const path = require('path');

const CONTENT = path.join(__dirname, '..', '..', 'content');

const SCRIPT_ORDER = [
  'command-types.js',
  'register.js',
  'shared/text-utils.js',
  'shared/motion-resolver.js',
  'key-parser.js',
  'vim-engine.js',
  'handlers/input-handler.js',
  'handlers/contenteditable-handler.js',
  'settings-manager.js',
  'element-detector.js',
];

const STOP_AFTER = {
  'command-types': 'command-types.js',
  'register': 'register.js',
  'text-utils': 'shared/text-utils.js',
  'motion-resolver': 'shared/motion-resolver.js',
  'key-parser': 'key-parser.js',
  'vim-engine': 'vim-engine.js',
  'input-handler': 'handlers/input-handler.js',
  'contenteditable-handler': 'handlers/contenteditable-handler.js',
  'settings-manager': 'settings-manager.js',
  'element-detector': 'element-detector.js',
};

function polyfillJsdom() {
  // isContentEditable not implemented in jsdom
  if (typeof HTMLElement !== 'undefined' && !('isContentEditable' in HTMLElement.prototype)) {
    Object.defineProperty(HTMLElement.prototype, 'isContentEditable', {
      get() {
        return this.contentEditable === 'true' || this.contentEditable === '';
      },
    });
  }

  // Canvas context not available in jsdom — provide a mock
  if (typeof HTMLCanvasElement !== 'undefined') {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type) {
      if (type === '2d') {
        return {
          font: '',
          letterSpacing: '0px',
          wordSpacing: '0px',
          measureText(text) {
            return { width: text.length * 8 }; // approximate 8px per char
          },
        };
      }
      return orig ? orig.call(this, type) : null;
    };
  }
}

function loadScripts(stopAfterFile) {
  polyfillJsdom();
  window.InputVim = window.InputVim || {};

  for (const file of SCRIPT_ORDER) {
    const code = fs.readFileSync(path.join(CONTENT, file), 'utf8');
    eval(code);
    if (file === stopAfterFile) break;
  }
}

function loadAll() {
  loadScripts(SCRIPT_ORDER[SCRIPT_ORDER.length - 1]);
}

function loadUpTo(moduleName) {
  const file = STOP_AFTER[moduleName];
  if (!file) throw new Error(`Unknown module: ${moduleName}`);
  loadScripts(file);
}

module.exports = { loadAll, loadUpTo };
