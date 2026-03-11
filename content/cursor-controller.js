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
        clampCursorToLine(el2);
        update();
      }, 0);
    }, true);
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
          if (Settings.get('alwaysCentered')) {
            var centerY = rect.y + rect.height / 2;
            var screenCenter = window.innerHeight / 2;
            var diff = centerY - screenCenter;
            if (Math.abs(diff) > 1) {
              window.scrollBy(0, diff);
              rect = handler.getCursorRect(el, visualPos);
              if (rect) _overlay.showCursor(rect.x, rect.y, rect.width, rect.height);
            }
          } else {
            var margin = 10;
            if (rect.y + rect.height > window.innerHeight) {
              window.scrollBy(0, rect.y + rect.height - window.innerHeight + margin);
            } else if (rect.y < 0) {
              window.scrollBy(0, rect.y - margin);
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
      var sel = window.getSelection();
      if (!sel.rangeCount) return;
      var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
      var flatText = '';
      var node;
      while ((node = walker.nextNode())) flatText += node.textContent;
      if (flatText.length === 0) return;

      var range = sel.getRangeAt(0);
      var preRange = document.createRange();
      preRange.selectNodeContents(el);
      preRange.setEnd(range.startContainer, range.startOffset);
      var pos2 = preRange.toString().length;

      var info2 = TU.getLineInfo(flatText, pos2);
      var max2 = info2.lineEnd > info2.lineStart ? info2.lineEnd - 1 : info2.lineStart;
      if (pos2 > max2) {
        var remaining = max2;
        walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
        while ((node = walker.nextNode())) {
          if (remaining <= node.textContent.length) {
            var r = document.createRange();
            r.setStart(node, remaining);
            r.collapse(true);
            sel.removeAllRanges();
            sel.addRange(r);
            return;
          }
          remaining -= node.textContent.length;
        }
      }
    }
  }

  window.InputVim = window.InputVim || {};
  window.InputVim.CursorController = {
    init: init,
    update: update,
  };
})();
