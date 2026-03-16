(function () {
  'use strict';

  // Runs in the page's MAIN world.
  //
  // Two protections against site scripts that blur inputs on Escape:
  //
  // 1. Override blur() — when vim is active in a non-NORMAL mode,
  //    programmatic blur() calls from site JS are silently ignored.
  //    (The content script's isolated world keeps the native blur().)
  //
  // 2. Override focus() on other elements — prevent site JS from
  //    stealing focus away from a vim-managed input.

  var origBlur = HTMLElement.prototype.blur;

  HTMLElement.prototype.blur = function () {
    // Block all programmatic blur() while vim is active on this element.
    // Focus out is only possible via :q / :q! which calls deactivate() directly.
    var mode = this.getAttribute('data-input-vim');
    if (mode) {
      return;
    }
    return origBlur.apply(this, arguments);
  };
})();
