(function () {
  'use strict';

  var Mode = window.InputVim.Mode;

  var MODE_COLORS = {};
  MODE_COLORS[Mode.NORMAL] = { bg: '#4a90d9', text: '#ffffff' };
  MODE_COLORS[Mode.INSERT] = { bg: '#50c878', text: '#ffffff' };
  MODE_COLORS[Mode.VISUAL] = { bg: '#ff8c00', text: '#ffffff' };
  MODE_COLORS[Mode.VISUAL_LINE] = { bg: '#ff8c00', text: '#ffffff' };

  function Overlay() {
    this._host = null;
    this._shadow = null;
    this._badge = null;
    this._cmdBox = null;
    this._cursor = null;
    this._currentTarget = null;
    this._repositionBound = this._reposition.bind(this);
  }

  Overlay.prototype.init = function () {
    this._host = document.createElement('div');
    this._host.id = 'input-vim-overlay-host';
    this._host.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
    document.documentElement.appendChild(this._host);

    this._shadow = this._host.attachShadow({ mode: 'closed' });

    var style = document.createElement('style');
    style.textContent = [
      '.iv-badge {',
      '  position: fixed;',
      '  font-family: monospace;',
      '  font-size: 11px;',
      '  font-weight: 700;',
      '  line-height: 1;',
      '  padding: 2px 6px;',
      '  border-radius: 3px;',
      '  pointer-events: none;',
      '  opacity: 0.9;',
      '  z-index: 2147483647;',
      '  display: none;',
      '  white-space: nowrap;',
      '}',
      '.iv-cmd {',
      '  position: fixed;',
      '  font-family: monospace;',
      '  font-size: 11px;',
      '  font-weight: 700;',
      '  line-height: 1;',
      '  padding: 2px 6px;',
      '  border-radius: 3px;',
      '  pointer-events: none;',
      '  opacity: 0.85;',
      '  z-index: 2147483647;',
      '  display: none;',
      '  white-space: nowrap;',
      '  background: #313244;',
      '  color: #cdd6f4;',
      '}',
      '.iv-cursor {',
      '  position: fixed;',
      '  pointer-events: none;',
      '  z-index: 2147483647;',
      '  display: none;',
      '  background: rgba(100, 150, 255, 0.5);',
      '  animation: iv-blink 1s step-end infinite;',
      '}',
      '@keyframes iv-blink {',
      '  0%, 100% { opacity: 1; }',
      '  50% { opacity: 0; }',
      '}',
    ].join('\n');
    this._shadow.appendChild(style);

    this._badge = document.createElement('div');
    this._badge.className = 'iv-badge';
    this._shadow.appendChild(this._badge);

    this._cmdBox = document.createElement('div');
    this._cmdBox.className = 'iv-cmd';
    this._shadow.appendChild(this._cmdBox);

    this._cursor = document.createElement('div');
    this._cursor.className = 'iv-cursor';
    this._shadow.appendChild(this._cursor);
  };

  var MODE_LABEL = {};
  MODE_LABEL[Mode.NORMAL] = 'NORMAL';
  MODE_LABEL[Mode.INSERT] = 'INSERT';
  MODE_LABEL[Mode.VISUAL] = 'VISUAL';
  MODE_LABEL[Mode.VISUAL_LINE] = 'V-LINE';

  Overlay.prototype.show = function (mode, targetEl) {
    if (!this._badge) return;
    this._currentTarget = targetEl;
    this._updateStyle(mode);
    this._badge.textContent = '-- ' + (MODE_LABEL[mode] || mode) + ' --';
    this._badge.style.display = 'block';
    this._reposition();
    window.addEventListener('scroll', this._repositionBound, true);
    window.addEventListener('resize', this._repositionBound);
  };

  Overlay.prototype.update = function (mode) {
    if (!this._badge) return;
    this._updateStyle(mode);
    this._badge.textContent = '-- ' + (MODE_LABEL[mode] || mode) + ' --';
    this._reposition();
  };

  Overlay.prototype.hide = function () {
    if (!this._badge) return;
    this._badge.style.display = 'none';
    this.updateCmd('');
    this.hideCursor();
    this._currentTarget = null;
    window.removeEventListener('scroll', this._repositionBound, true);
    window.removeEventListener('resize', this._repositionBound);
  };

  Overlay.prototype.updateCmd = function (text) {
    if (!this._cmdBox) return;
    if (!text) {
      this._cmdBox.style.display = 'none';
      return;
    }
    this._cmdBox.textContent = text;
    this._cmdBox.style.display = 'block';
    this._reposition();
  };

  Overlay.prototype.showCursor = function (x, y, w, h) {
    if (!this._cursor) return;
    var s = this._cursor.style;
    s.left = x + 'px';
    s.top = y + 'px';
    s.width = Math.max(w, 2) + 'px';
    s.height = h + 'px';
    // Reset animation so it always starts at the visible phase
    s.animation = 'none';
    this._cursor.offsetHeight; // force reflow
    s.animation = '';
    s.display = 'block';
  };

  Overlay.prototype.hideCursor = function () {
    if (!this._cursor) return;
    this._cursor.style.display = 'none';
  };

  Overlay.prototype._updateStyle = function (mode) {
    var colors = MODE_COLORS[mode] || MODE_COLORS[Mode.NORMAL];
    this._badge.style.backgroundColor = colors.bg;
    this._badge.style.color = colors.text;
  };

  Overlay.prototype._reposition = function () {
    if (!this._currentTarget || !this._badge) return;
    var rect = this._currentTarget.getBoundingClientRect();
    var badgeTop = rect.top - 20;
    this._badge.style.left = (rect.right - this._badge.offsetWidth) + 'px';
    this._badge.style.top = badgeTop + 'px';

    // If badge would go off-screen top, put it below
    if (badgeTop < 0) {
      badgeTop = rect.bottom + 2;
      this._badge.style.top = badgeTop + 'px';
    }

    // Position cmd box to the left of the badge
    if (this._cmdBox && this._cmdBox.style.display !== 'none') {
      this._cmdBox.style.top = badgeTop + 'px';
      this._cmdBox.style.left = (rect.right - this._badge.offsetWidth - this._cmdBox.offsetWidth - 4) + 'px';
    }
  };

  window.InputVim = window.InputVim || {};
  window.InputVim.Overlay = Overlay;
})();
