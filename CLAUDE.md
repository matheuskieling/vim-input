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

5. **`content/vim-engine.js`** — `VimEngine` class. Owns current mode and delegates key processing to `KeyParser`. Handles mode transitions and visual mode operator dispatch.

6. **`content/overlay.js`** — `Overlay` class. Renders the mode badge, block cursor, pending-command display, and search bar. Uses a Shadow DOM host at z-index 2147483647 to avoid style conflicts with page CSS.

7. **`content/handlers/input-handler.js`** — `InputHandler` class. Implements all vim operations for `<input>` and `<textarea>` elements using `selectionStart`/`selectionEnd` and `.value` manipulation. Contains its own `UndoStack`, word/motion resolvers, text object resolver, and scroll jump logic.

8. **`content/handlers/contenteditable-handler.js`** — `ContentEditableHandler` class. Same operations but for contenteditable elements using `Selection`/`Range` APIs, TreeWalker for flat text traversal, and `document.execCommand` for some edits. Duplicates motion/text-object resolution logic from input-handler (both files have independent `resolveMotion`, `resolveTextObject`, word helpers, etc.).

9. **`content/main.js`** — Orchestrator. Wires together engine, handlers, and overlay. Manages focus tracking, keydown capture, search UI, bracket matching, tab insertion, and settings loading from `chrome.storage.sync`.

### Other components

- **`background/service-worker.js`** — Handles `check-page` messages and broadcasts settings changes to all tabs.
- **`popup/`** — Settings UI (enabled toggle, start mode, bracket matching, tab size, clipboard sync, highlight yank, Ctrl+D/U jump size, always-centered mode, site exclusion patterns).

### Key design patterns

- **Event interception**: `main.js` captures `keydown` on `window` (capture phase), blocks the event, then blocks follow-up `keypress`/`keyup`/`beforeinput` events using a `_blocked` flag.
- **Focus-blur detection**: Tracks `_recentFocusSteal` timestamp to distinguish user-initiated focus changes from Chrome swallowing Escape (e.g., Google Search autocomplete).
- **Handler selection**: `getHandler(el)` returns `InputHandler` or `ContentEditableHandler` based on element type. Both implement the same interface: `execute()`, `extendVisualSelection()`, `selectTextObject()`, `getCursorRect()`, `ensureCursorVisible()`, `flashYank()`.
- **Settings**: Stored in `chrome.storage.sync`. The `data-input-vim` attribute on active elements reflects the current mode.

### Duplicate code between handlers

`input-handler.js` and `contenteditable-handler.js` independently implement: word movement (`wordForward`, `wordBack`, `wordEnd`, big variants), line info, find/till char, paragraph movement, text object resolution (`resolveTextObject`, `findMatchingPair`, `findQuotePair`), and motion resolution (`resolveMotion`). Changes to motion/text-object logic must be applied to both files.
