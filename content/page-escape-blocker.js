(function () {
  'use strict';

  // This script runs in the page's MAIN world (not the extension's isolated world).
  // Content-script stopImmediatePropagation() does NOT cross world boundaries,
  // so site scripts (Google, GitHub, etc.) still see the Escape keydown and blur
  // the input.  This script runs in the same world as those site scripts, so
  // stopImmediatePropagation() here actually prevents them from firing.
  //
  // Communication with the content script: the content script sets
  // data-input-vim on the focused element while vim mode is active.

  window.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;

    var el = document.activeElement;
    if (!el || !el.hasAttribute('data-input-vim')) return;

    e.stopImmediatePropagation();
    e.preventDefault();
  }, true); // capture phase — runs before any page script listener
})();
