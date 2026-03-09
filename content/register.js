(function () {
  'use strict';

  const Register = {
    _content: '',
    _type: 'char', // 'char' or 'line'

    set(content, type) {
      this._content = content;
      this._type = type || 'char';
    },

    get() {
      return { content: this._content, type: this._type };
    },

    clear() {
      this._content = '';
      this._type = 'char';
    },
  };

  window.InputVim = window.InputVim || {};
  window.InputVim.Register = Register;
})();
