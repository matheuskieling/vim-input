(function () {
  'use strict';

  var Mode = window.InputVim.Mode;
  var TU = window.InputVim.TextUtils;

  var _overlay = null;
  var _engine = null;
  var _getActiveElement = null;
  var _getHandler = null;

  function init(overlay, engine, getActiveElement, getHandler) {
    _overlay = overlay;
    _engine = engine;
    _getActiveElement = getActiveElement;
    _getHandler = getHandler;

    window.addEventListener('scroll', function () {
      update(true);
    }, true);

    _overlay.onReposition(function () {
      update(true);
    });

    document.addEventListener('mouseup', function () {
      var el = _getActiveElement();
      if (!el || _engine.mode === Mode.INSERT) return;
      setTimeout(function () {
        var el2 = _getActiveElement();
        if (!el2 || _engine.mode === Mode.INSERT) return;

        var handler = _getHandler(el2);
        if (handler && handler.getMouseSelection) {
          var sel = handler.getMouseSelection(el2);
          if (sel) {
            _engine.visualAnchor = sel.anchor;
            _engine.visualHead = sel.head;
            if (_engine.mode !== Mode.VISUAL) {
              _engine.setMode(Mode.VISUAL);
            }
            update();
            return;
          }
        }

        // No selection — exit visual if was in visual mode
        if (_engine.mode === Mode.VISUAL || _engine.mode === Mode.VISUAL_LINE) {
          _engine.setMode(Mode.NORMAL);
        }
        clampCursorToLine(el2);
        update();
      }, 0);
    }, true);
  }

  // Find the nearest scrollable ancestor of el.
  // For textareas/inputs, the element itself is the scroll container.
  // For contenteditables, walk up to find a parent with overflow scroll/auto.
  // Returns null if only the window is scrollable.
  function _getScrollContainer(el) {
    var tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'INPUT') return el;

    var node = el;
    while (node && node !== document.body && node !== document.documentElement) {
      var style = getComputedStyle(node);
      var ov = style.overflowY;
      if ((ov === 'auto' || ov === 'scroll') && node.scrollHeight > node.clientHeight) {
        return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  function update(skipScroll) {
    var el = _getActiveElement();
    if (!el) return;
    var handler = _getHandler(el);
    if (!handler) return;

    var Settings = window.InputVim.Settings;

    if (_engine.mode !== Mode.INSERT) {
      if (!skipScroll && handler.ensureCursorVisible) {
        handler.ensureCursorVisible(el);
      }
      el.style.caretColor = 'transparent';
      var visualPos = (_engine.mode === Mode.VISUAL || _engine.mode === Mode.VISUAL_LINE)
        ? _engine.visualHead : undefined;
      var rect = handler.getCursorRect(el, visualPos);
      if (rect) {
        _overlay.showCursor(rect.x, rect.y, rect.width, rect.height);
        if (!skipScroll) {
          var sc = _getScrollContainer(el);
          var SB = window.InputVim.ScratchBuffer;
          var _scratchOpen = SB && SB.isActive && SB.isActive();
          if (Settings.get('alwaysCentered')) {
            // Step 1: center within the scroll container (if any)
            if (sc) {
              var scRect = sc.getBoundingClientRect();
              var cursorInSc = rect.y - scRect.top;
              var scCenter = scRect.height / 2;
              var sDiff = cursorInSc - scCenter;
              if (Math.abs(sDiff) > 1) {
                sc.scrollTop += sDiff;
                rect = handler.getCursorRect(el, visualPos);
                if (rect) _overlay.showCursor(rect.x, rect.y, rect.width, rect.height);
              }
            }
            // Step 2: center on screen — skip when scratch buffer is open
            // (the overlay covers the full viewport, nothing behind it to scroll)
            if (rect && !_scratchOpen) {
              var centerY = rect.y + rect.height / 2;
              var screenCenter = window.innerHeight / 2;
              var diff = centerY - screenCenter;
              if (Math.abs(diff) > 1) {
                window.scrollBy(0, diff);
                rect = handler.getCursorRect(el, visualPos);
                if (rect) _overlay.showCursor(rect.x, rect.y, rect.width, rect.height);
              }
            }
          } else {
            var margin = 10;
            // Step 1: keep visible within scroll container
            if (sc) {
              var scRect2 = sc.getBoundingClientRect();
              if (rect.y + rect.height > scRect2.bottom) {
                sc.scrollTop += rect.y + rect.height - scRect2.bottom + margin;
              } else if (rect.y < scRect2.top) {
                sc.scrollTop += rect.y - scRect2.top - margin;
              }
              rect = handler.getCursorRect(el, visualPos);
            }
            // Step 2: keep visible on screen — skip when scratch buffer is open
            if (rect && !_scratchOpen) {
              if (rect.y + rect.height > window.innerHeight) {
                window.scrollBy(0, rect.y + rect.height - window.innerHeight + margin);
              } else if (rect.y < 0) {
                window.scrollBy(0, rect.y - margin);
              }
            }
          }
        }
      } else {
        _overlay.hideCursor();
      }
    } else {
      el.style.caretColor = '';
      _overlay.hideCursor();
    }
  }

  function clampCursorToLine(el) {
    var ED = window.InputVim.ElementDetector;
    if (ED.isTextInput(el)) {
      try {
        var text = el.value;
        var pos = el.selectionStart;
        if (text.length === 0) return;
        var info = TU.getLineInfo(text, pos);
        var maxPos = info.lineEnd > info.lineStart ? info.lineEnd - 1 : info.lineStart;
        if (pos > maxPos) {
          el.selectionStart = maxPos;
          el.selectionEnd = maxPos;
        }
      } catch (e) {}
    } else if (ED.isContentEditable(el)) {
      var handler = _getHandler(el);
      if (!handler) return;
      // Delegate to handler which has proper flat-text / DOM-position logic
      if (handler.clampCursorToLine) handler.clampCursorToLine(el);
    }
  }

  window.InputVim = window.InputVim || {};
  window.InputVim.CursorController = {
    init: init,
    update: update,
  };
})();
