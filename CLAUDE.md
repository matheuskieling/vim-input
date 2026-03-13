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

## ⚠️ CRITICAL: Fix Comments and Code Awareness (MANDATORY)

**This is the highest-priority rule in this file. It overrides all other behavior guidelines.**

### When applying a fix requested by the user:

You MUST leave a comment directly above the changed code block explaining:
1. **WHAT** the fix does (brief)
2. **WHY** it was needed — the user-reported problem or bug that motivated it
3. **WHAT COULD BREAK** if this code is changed or removed

Format:
```js
// FIX: <what this does>
// WHY: <the problem the user reported that led to this fix>
// WARNING: Changing/removing this may cause <consequence>
```

### When modifying code that already has a fix comment:

Before making ANY change to code that has a `// FIX:` or `// WARNING:` comment, you MUST:
1. **Read** the existing fix comment in full
2. **Tell the user** explicitly: what the previous fix was, why it was put there, and what risks come from changing it
3. **ASK THE USER FOR EXPLICIT CONFIRMATION before proceeding** — even if the change seems safe. You MUST prompt with something like: *"This code has a FIX comment: [quote it]. Changing it could [risk]. Do you want me to proceed?"* — and WAIT for the user's answer. Do NOT proceed without a "yes".
4. **Preserve or update** the fix comment — never silently delete it. If the fix is no longer needed, explain why to the user and get confirmation before removing the comment.

### ⛔ NEVER delete a FIX/WARNING comment without prompting:

**You MUST prompt the user before deleting, moving, or replacing ANY `// FIX:` or `// WARNING:` comment.** These comments represent deliberate decisions the user made. Deleting one without asking is treated as destructive — equivalent to deleting code. Even if you are rewriting the surrounding code, the comment must be preserved in the correct location or the user must explicitly approve its removal. This is NON-NEGOTIABLE.

### Why this matters:

Fixes in this codebase often address subtle browser-specific bugs, focus-steal edge cases, and contenteditable quirks that are extremely hard to reproduce and debug. Silently overwriting a fix causes regressions that waste hours of the user's time. The comments are the project's institutional memory — treat them as load-bearing. Every time a comment is silently removed, context is permanently lost and the same bug WILL resurface.
