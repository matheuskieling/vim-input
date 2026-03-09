# Input Vim

A Chrome extension that brings Vim keybindings to every text input, textarea, and contenteditable element in the browser.

## Why

Browser inputs are painful for anyone used to Vim. Moving by word, deleting to end of line, or selecting a paragraph all require reaching for the mouse or memorising OS-specific shortcuts. Input Vim drops a lightweight Vim layer on top of any text field so you can stay on the home row.

## Install

1. Clone or download this repo
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the project folder
5. The Input Vim icon appears in the toolbar

## How it works

Focus any text input, textarea, or contenteditable on any page. You start in **INSERT** mode — type normally. Press **Escape** to enter **NORMAL** mode, where single keys become Vim commands. Press **Escape** again in NORMAL mode to blur the input.

A small badge next to the input shows the current mode.

## Keybindings

### Mode switching

| Key | Action |
|-----|--------|
| `Esc` | INSERT → NORMAL → blur |
| `i` | Insert before cursor |
| `a` | Insert after cursor |
| `I` | Insert at start of line |
| `A` | Insert at end of line |
| `o` | Open new line below |
| `O` | Open new line above |
| `v` | Enter VISUAL mode |
| `V` | Enter VISUAL LINE mode |

### Motions (NORMAL and VISUAL)

| Key | Motion |
|-----|--------|
| `h` `j` `k` `l` | Left, down, up, right |
| `w` / `b` / `e` | Word forward / back / end |
| `W` / `B` / `E` | WORD forward / back / end (whitespace-delimited) |
| `0` | Start of line |
| `$` | End of line |
| `^` | First non-blank character |
| `gg` | Start of input |
| `G` | End of input |
| `f{char}` / `F{char}` | Find char forward / backward |
| `t{char}` / `T{char}` | Till char forward / backward |

### Operators

| Key | Action |
|-----|--------|
| `d{motion}` | Delete (e.g. `dw`, `d$`) |
| `dd` | Delete line |
| `c{motion}` | Change (delete + enter INSERT) |
| `cc` | Change line |
| `y{motion}` | Yank (copy) |
| `yy` | Yank line |

### Text objects (with `d`, `c`, `y`, or in VISUAL)

| Key | Object |
|-----|--------|
| `iw` / `aw` | Inner / around word |
| `iW` / `aW` | Inner / around WORD |
| `i{` / `a{` | Inner / around `{}` |
| `i(` / `a(` | Inner / around `()` |
| `i[` / `a[` | Inner / around `[]` |

### Other

| Key | Action |
|-----|--------|
| `x` | Delete character under cursor |
| `X` | Delete character before cursor |
| `r{char}` | Replace character under cursor |
| `p` / `P` | Paste after / before |
| `u` | Undo |
| `Ctrl+R` | Redo |
| `Tab` | Insert spaces (configurable width) |

Count prefixes work: `3w`, `2dd`, `5j`, etc.

## Settings

Click the extension icon to open the popup:

- **Enabled** — toggle the extension on/off
- **Start in** — choose whether inputs start in INSERT or NORMAL mode
- **Match brackets** — auto-close `()`, `{}`, `[]` in INSERT mode
- **Tab spaces** — number of spaces inserted by Tab (2, 4, or 8)
- **Exclude sites** — disable the extension on specific sites (glob patterns)

Settings sync across Chrome devices.

## Compatibility

Works on `<input>` (text, search, url, tel, password), `<textarea>`, and `contenteditable` elements. Excluded types: `email` and `number` (Chrome doesn't expose the selection API for these).

On sites where Chrome's native UI swallows the Escape key (Google Search autocomplete, GitHub), the extension detects the resulting focus loss and treats it as an Escape press.

## Development

Open `test.html` in Chrome with the extension loaded to test all input types and keybindings.

## License

MIT
