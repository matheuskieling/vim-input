(function () {
  'use strict';

  // ── Framework editor bridge (MAIN world) ──────────────
  // Receives commands from the ISOLATED world content script via
  // DOM attribute + Event, and executes them through the framework
  // editor's JavaScript API.  Currently supports CKEditor 5.

  function _getCKEditor(el) {
    while (el) {
      if (el.ckeditorInstance) return el.ckeditorInstance;
      el = el.parentElement;
    }
    return null;
  }

  // Sync DOM selection → CKEditor model selection so the bridge operates
  // on whatever the content script selected via Selection/Range APIs.
  function _syncSelection(editor) {
    var domSel = window.getSelection();
    if (!domSel.rangeCount) return;
    try {
      var domRange = domSel.getRangeAt(0);
      var viewRange = editor.editing.view.domConverter.domRangeToView(domRange);
      if (!viewRange) return;
      var modelRange = editor.editing.mapper.toModelRange(viewRange);
      editor.model.change(function (writer) {
        writer.setSelection(modelRange);
      });
    } catch (ex) { /* ignore sync failures */ }
  }

  document.addEventListener('input-vim-bridge', function (e) {
    var target = e.target;
    var cmdStr = target.getAttribute('data-input-vim-bridge-cmd');
    if (!cmdStr) return;

    var cmd;
    try { cmd = JSON.parse(cmdStr); } catch (ex) { return; }

    var editor = _getCKEditor(target);
    if (!editor) return;

    var success = false;
    try {
      switch (cmd.action) {
        case 'insertText':
          _syncSelection(editor);
          editor.model.change(function (writer) {
            var sel = editor.model.document.selection;
            if (!sel.isCollapsed) editor.model.deleteContent(sel);
            writer.insertText(cmd.text,
              editor.model.document.selection.getFirstPosition());
          });
          success = true;
          break;

        case 'insertParagraph':
          _syncSelection(editor);
          // Use writer.split() instead of editor.execute('enter') because
          // apps like Teams override the 'enter' command to send messages.
          editor.model.change(function (writer) {
            var sel = editor.model.document.selection;
            if (!sel.isCollapsed) editor.model.deleteContent(sel);
            // FIX: Move cursor to the new paragraph after split
            // WHY: writer.split() does not move the model selection — it stays
            //   at the end of the first fragment, so `o` left the cursor on the
            //   current line instead of the newly created one.
            // WARNING: Removing setSelection will break o/O and Enter cursor positioning
            var splitResult = writer.split(editor.model.document.selection.getFirstPosition());
            // splitResult.position is BETWEEN the two blocks (parent scope),
            // not inside the new paragraph — nodeAfter is the new block.
            var newBlock = splitResult.position.nodeAfter;
            if (newBlock) {
              writer.setSelection(newBlock, 0);
            } else {
              writer.setSelection(splitResult.position);
            }
          });
          success = true;
          break;

        case 'insertLineBreak':
          _syncSelection(editor);
          editor.execute('shiftEnter');
          success = true;
          break;

        case 'deleteSelection':
          _syncSelection(editor);
          editor.model.change(function () {
            editor.model.deleteContent(editor.model.document.selection);
          });
          success = true;
          break;

        case 'deleteBackward':
          _syncSelection(editor);
          for (var i = 0; i < (cmd.count || 1); i++) {
            editor.execute('delete');
          }
          success = true;
          break;

        case 'deleteForward':
          _syncSelection(editor);
          for (var j = 0; j < (cmd.count || 1); j++) {
            editor.execute('forwardDelete');
          }
          success = true;
          break;

        case 'removeBlock':
          // Remove the entire block element(s) containing the current selection.
          // Used by visual line delete so the <p> structure is removed, not just
          // its text content (which is all deleteContent does).
          _syncSelection(editor);
          editor.model.change(function (writer) {
            var sel = editor.model.document.selection;
            var blocks = [];
            var iter = sel.getSelectedBlocks();
            var item = iter.next();
            while (!item.done) {
              blocks.push(item.value);
              item = iter.next();
            }
            // Don't remove the very last block in the editor (CKEditor requires
            // at least one block element to exist).
            var root = editor.model.document.getRoot();
            if (blocks.length >= root.childCount) {
              // Keep the last block but clear its content
              for (var bi = blocks.length - 1; bi > 0; bi--) {
                writer.remove(blocks[bi]);
              }
              // Clear the remaining block
              var remaining = blocks[0];
              if (remaining.childCount > 0) {
                writer.remove(writer.createRangeIn(remaining));
              }
            } else {
              for (var bj = blocks.length - 1; bj >= 0; bj--) {
                writer.remove(blocks[bj]);
              }
            }
          });
          success = true;
          break;

        case 'undo':
          for (var u = 0; u < (cmd.count || 1); u++) {
            editor.execute('undo');
          }
          success = true;
          break;

        case 'redo':
          for (var r = 0; r < (cmd.count || 1); r++) {
            editor.execute('redo');
          }
          success = true;
          break;
      }
    } catch (ex) {
      success = false;
    }

    target.setAttribute('data-input-vim-bridge-result', success ? 'ok' : 'fail');
  }, true);
})();
