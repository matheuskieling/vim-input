(function () {
  'use strict';

  var InputHandler = window.InputVim.InputHandler;
  var ContentEditableHandler = window.InputVim.ContentEditableHandler;

  var inputHandler = new InputHandler();
  var ceHandler = new ContentEditableHandler();

  function isTextInput(el) {
    if (!el) return false;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.tagName === 'INPUT') {
      var type = (el.type || '').toLowerCase();
      return !type || type === 'text' || type === 'search' || type === 'url' || type === 'tel' || type === 'password';
    }
    return false;
  }

  function isContentEditable(el) {
    if (!el) return false;
    return el.isContentEditable === true;
  }

  function isVimTarget(el) {
    return isTextInput(el) || isContentEditable(el);
  }

  function getHandler(el) {
    if (isTextInput(el)) return inputHandler;
    if (isContentEditable(el)) return ceHandler;
    return null;
  }

  window.InputVim = window.InputVim || {};
  window.InputVim.ElementDetector = {
    isTextInput: isTextInput,
    isContentEditable: isContentEditable,
    isVimTarget: isVimTarget,
    getHandler: getHandler,
  };
})();
