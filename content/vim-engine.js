(function () {
  'use strict';

  var Mode = window.InputVim.Mode;
  var CommandType = window.InputVim.CommandType;
  var OperatorType = window.InputVim.OperatorType;
  var KeyParser = window.InputVim.KeyParser;

  function VimEngine() {
    this.mode = Mode.NORMAL;
    this.parser = new KeyParser();
    this.visualAnchor = 0;
    this.visualHead = 0;
    this._onModeChangeListeners = [];
  }

  VimEngine.prototype.onModeChange = function (cb) {
    this._onModeChangeListeners.push(cb);
  };

  VimEngine.prototype.setMode = function (newMode) {
    if (this.mode !== newMode) {
      this.mode = newMode;
      for (var i = 0; i < this._onModeChangeListeners.length; i++) {
        this._onModeChangeListeners[i](newMode);
      }
    }
  };

  VimEngine.prototype.handleKey = function (key) {
    if (this.mode === Mode.INSERT) {
      if (key === 'Escape') {
        this.setMode(Mode.NORMAL);
        return { type: CommandType.ESCAPE, fromMode: Mode.INSERT };
      }
      return null;
    }

    // Visual char and visual line share operator/motion logic
    if (this.mode === Mode.VISUAL || this.mode === Mode.VISUAL_LINE) {
      if (key === 'Escape') {
        this.parser.reset();
        var fromMode = this.mode;
        var head = this.visualHead;
        this.setMode(Mode.NORMAL);
        return { type: CommandType.ESCAPE, fromMode: fromMode, visualHead: head };
      }

      // Switch between visual modes
      if (key === 'v' && this.mode === Mode.VISUAL_LINE) {
        this.parser.reset();
        this.setMode(Mode.VISUAL);
        return { type: CommandType.VISUAL_ENTER };
      }
      if (key === 'V' && this.mode === Mode.VISUAL) {
        this.parser.reset();
        this.setMode(Mode.VISUAL_LINE);
        return { type: CommandType.VISUAL_LINE_ENTER };
      }
      // Same key exits visual
      if (key === 'v' && this.mode === Mode.VISUAL) {
        this.parser.reset();
        var head2 = this.visualHead;
        this.setMode(Mode.NORMAL);
        return { type: CommandType.ESCAPE, fromMode: Mode.VISUAL, visualHead: head2 };
      }
      if (key === 'V' && this.mode === Mode.VISUAL_LINE) {
        this.parser.reset();
        var head3 = this.visualHead;
        this.setMode(Mode.NORMAL);
        return { type: CommandType.ESCAPE, fromMode: Mode.VISUAL_LINE, visualHead: head3 };
      }

      // Operators act on selection
      var VISUAL_OPS = {
        d: OperatorType.DELETE, x: OperatorType.DELETE,
        D: OperatorType.DELETE, X: OperatorType.DELETE,
        y: OperatorType.YANK, Y: OperatorType.YANK,
        c: OperatorType.CHANGE, s: OperatorType.CHANGE,
        C: OperatorType.CHANGE, S: OperatorType.CHANGE,
      };
      if (VISUAL_OPS[key]) {
        this.parser.reset();
        var opCmd = { type: CommandType.VISUAL_OPERATOR, operator: VISUAL_OPS[key], lineWise: this.mode === Mode.VISUAL_LINE };
        this.setMode(VISUAL_OPS[key] === OperatorType.CHANGE ? Mode.INSERT : Mode.NORMAL);
        return opCmd;
      }

      // Paste replaces the visual selection
      if (key === 'p' || key === 'P') {
        this.parser.reset();
        var pasteCmd = { type: CommandType.VISUAL_PASTE, lineWise: this.mode === Mode.VISUAL_LINE };
        this.setMode(Mode.NORMAL);
        return pasteCmd;
      }

      // 'o' swaps cursor between anchor and head
      if (key === 'o') {
        var tmp = this.visualAnchor;
        this.visualAnchor = this.visualHead;
        this.visualHead = tmp;
        this.parser.reset();
        return { type: CommandType.VISUAL_SWAP };
      }

      // i/a in visual mode start text object selection (not insert)
      if (key === 'i' || key === 'a') {
        this.parser.setPendingTextObj(key);
        return null;
      }

      // Motions extend the selection, text objects set it
      var parsed = this.parser.feed(key);
      if (parsed && (parsed.type === CommandType.MOTION || parsed.type === CommandType.TEXT_OBJECT)) {
        return parsed;
      }
      return null;
    }

    // Normal mode
    var command = this.parser.feed(key);
    if (!command) return null;

    switch (command.type) {
      case CommandType.INSERT_ENTER:
        this.setMode(Mode.INSERT);
        return command;

      case CommandType.VISUAL_ENTER:
        this.setMode(Mode.VISUAL);
        return command;

      case CommandType.VISUAL_LINE_ENTER:
        this.setMode(Mode.VISUAL_LINE);
        return command;

      case CommandType.ESCAPE:
        return { type: CommandType.ESCAPE, fromMode: Mode.NORMAL };

      case CommandType.OPERATOR_MOTION:
      case CommandType.LINE_OPERATOR:
      case CommandType.OPERATOR_TEXT_OBJECT:
        if (command.operator === OperatorType.CHANGE) {
          this.setMode(Mode.INSERT);
        }
        return command;

      default:
        return command;
    }
  };

  window.InputVim = window.InputVim || {};
  window.InputVim.VimEngine = VimEngine;
})();
