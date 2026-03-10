# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Input Vim is a Chrome extension (Manifest V3) that adds Vim keybindings to every `<input>`, `<textarea>`, and `contenteditable` element in the browser. It supports NORMAL, INSERT, VISUAL, and VISUAL_LINE modes with motions, operators, text objects, search, and count prefixes.

## Development

No build step — plain vanilla JavaScript. Load as an unpacked extension in `chrome://extensions` with Developer mode enabled. Test with `test.html` loaded in Chrome with the extension active.

## Architecture

All content scripts share state via `window.InputVim` namespace. Scripts are loaded in order defined in `manifest.json` — order matters because each script depends on types/classes registered by previous ones.

### Content script load order and responsibilities

1. **`content/page-escape-blocker.js`** — Runs in `MAIN` world (page context). Overrides `HTMLElement.prototype.blur` to prevent site JS from stealing focus when vim is in a non-NORMAL mode.

2. **`content/command-types.js`** — Defines all enums: `Mode`, `MotionType`, `OperatorType`, `TextObject`, `CommandType`, `InsertEntry`. These are the shared vocabulary used by all other modules.

3. **`content/register.js`** — Singleton yank/paste register with optional system clipboard sync.

4. **`content/key-parser.js`** — `KeyParser` class. State machine that accumulates keystrokes and emits command objects. Handles count prefixes, multi-key sequences (`gg`, `f{char}`, `r{char}`, operator+motion), and text objects (`iw`, `a{`). Uses a 1-second timeout to auto-reset incomplete sequences.

5. **`content/vim-engine.js`** — `VimEngine` class. Owns current mode and delegates key processing to `KeyParser`. Handles mode transitions and visual mode operator dispatch. Supports multiple `onModeChange` listeners.

6. **`content/overlay.js`** — `Overlay` class. Renders the mode badge, block cursor, pending-command display, and search bar. Uses a Shadow DOM host at z-index 2147483647 to avoid style conflicts with page CSS.

7. **`content/shared/text-utils.js`** — `TextUtils` namespace. Pure text functions with zero DOM dependencies: word motions (`wordForward/Back/End`, big variants, `wordEndBack`), line helpers (`getLineInfo`, `getLineNumber`, `getLineStartOffset`), char classification (`charClass`, `isWhitespace`), find/till (`findCharForward/Backward`), visual line lookup (`findVisualLine`), `clamp`, and `fireInputEvent`.

8. **`content/shared/motion-resolver.js`** — `MotionResolver` namespace. Depends on `TextUtils`. Contains `resolveMotion(text, pos, ...)`, `resolveTextObject`, `findMatchingPair`, `findQuotePair`, and `resolveWordTextObject`. Single source of truth for all motion and text object resolution — both handlers delegate to these functions.

9. **`content/handlers/input-handler.js`** — `InputHandler` class. Implements vim operations for `<input>` and `<textarea>` elements using `selectionStart`/`selectionEnd` and `.value` manipulation. Contains its own `UndoStack` (stores value/selection state), canvas-based visual line computation for soft-wrap-aware vertical motions, and caret coordinate measurement.

10. **`content/handlers/contenteditable-handler.js`** — `ContentEditableHandler` class. Same interface for contenteditable elements using `Selection`/`Range` APIs, TreeWalker for flat text traversal. Contains its own `UndoStack` (stores innerHTML/offset) and Range-based visual line computation.

11. **`content/settings-manager.js`** — `Settings` namespace. Single source of truth for all settings with `DEFAULTS` object. Provides `load(callback)`, `get(key)`, `getStartMode()`, `isPageExcluded()`, and `onChange(callback)`. Listens to `chrome.storage.onChanged` internally.

12. **`content/element-detector.js`** — `ElementDetector` namespace. Owns the singleton handler instances. Provides `isTextInput(el)`, `isContentEditable(el)`, `isVimTarget(el)`, `getHandler(el)`.

13. **`content/cursor-controller.js`** — `CursorController` namespace. Manages overlay block cursor positioning, scroll-into-view, always-centered mode, and cursor clamping after mouse clicks.

14. **`content/focus-manager.js`** — `FocusManager` namespace. Manages `focusin`/`focusout`/`mousedown` listeners, element activation/deactivation, focus-steal detection, and existing-focus detection on page load.

15. **`content/event-interceptor.js`** — `EventInterceptor` namespace. Keydown capture handler and event blocking (`_blocked` flag). Insert-mode helpers: tab insertion, bracket pair matching, closing bracket skip.

16. **`content/main.js`** — Slim orchestrator (~68 lines). Creates engine and overlay instances, initializes all modules, wires them together, and registers the `onModeChange` callback.

### Other components

- **`background/service-worker.js`** — Minimal stub (content scripts use `chrome.storage.onChanged` directly).
- **`popup/`** — Settings UI (enabled toggle, start mode, bracket matching, tab size, clipboard sync, highlight yank, Ctrl+D/U jump size, always-centered mode, site exclusion patterns).

### Key design patterns

- **Event interception**: `EventInterceptor` captures `keydown` on `window` (capture phase), blocks the event, then blocks follow-up `keypress`/`keyup`/`beforeinput` events using a `_blocked` flag.
- **Focus-blur detection**: `FocusManager` tracks `_recentFocusSteal` timestamp to distinguish user-initiated focus changes from Chrome swallowing Escape (e.g., Google Search autocomplete).
- **Handler selection**: `ElementDetector.getHandler(el)` returns `InputHandler` or `ContentEditableHandler` based on element type. Both implement the same interface: `execute()`, `extendVisualSelection()`, `selectTextObject()`, `getCursorRect()`, `ensureCursorVisible()`, `flashYank()`.
- **Settings**: `Settings` module is single source of truth. Stored in `chrome.storage.sync`. The `data-input-vim` attribute on active elements reflects the current mode.
- **Shared text logic**: All word motions, text objects, and motion resolution live in `TextUtils` and `MotionResolver`. Changes to motion/text-object logic only need to be made once.
