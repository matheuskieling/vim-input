(function () {
  'use strict';

  var Register = {
    _content: '',
    _type: 'char', // 'char' or 'line'
    _useClipboard: false,

    setUseClipboard: function (val) {
      this._useClipboard = !!val;
    },

    set: function (content, type) {
      this._content = content;
      this._type = type || 'char';
      if (this._useClipboard && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(content).catch(function () {});
      }
    },

    get: function () {
      return { content: this._content, type: this._type };
    },

    // Reads from system clipboard if enabled, updating internal state,
    // then calls callback. Handlers use Register.get() as usual after this.
    syncFromClipboard: function (callback) {
      var self = this;
      if (this._useClipboard && navigator.clipboard && navigator.clipboard.readText) {
        navigator.clipboard.readText().then(function (text) {
          if (text != null) {
            var normalized = text.replace(/\r\n/g, '\n');
            if (normalized !== self._content) {
              self._content = normalized;
              self._type = 'char';
            }
          }
          callback();
        }).catch(function () {
          callback();
        });
      } else {
        callback();
      }
    },

    clear: function () {
      this._content = '';
      this._type = 'char';
    },
  };

  window.InputVim = window.InputVim || {};
  window.InputVim.Register = Register;
})();
