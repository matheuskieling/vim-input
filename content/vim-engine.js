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
    this._onModeChange = null;
  }

  VimEngine.prototype.onModeChange = function (cb) {
    this._onModeChange = cb;
  };

  VimEngine.prototype.setMode = function (newMode) {
    if (this.mode !== newMode) {
      this.mode = newMode;
      if (this._onModeChange) {
        this._onModeChange(newMode);
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
      if (key === 'd' || key === 'x' || key === 'D' || key === 'X') {
        this.parser.reset();
        var cmd = { type: CommandType.VISUAL_OPERATOR, operator: OperatorType.DELETE, lineWise: this.mode === Mode.VISUAL_LINE };
        this.setMode(Mode.NORMAL);
        return cmd;
      }
      if (key === 'y' || key === 'Y') {
        this.parser.reset();
        var cmd2 = { type: CommandType.VISUAL_OPERATOR, operator: OperatorType.YANK, lineWise: this.mode === Mode.VISUAL_LINE };
        this.setMode(Mode.NORMAL);
        return cmd2;
      }
      if (key === 'c' || key === 's' || key === 'C' || key === 'S') {
        this.parser.reset();
        var cmd3 = { type: CommandType.VISUAL_OPERATOR, operator: OperatorType.CHANGE, lineWise: this.mode === Mode.VISUAL_LINE };
        this.setMode(Mode.INSERT);
        return cmd3;
      }

      // i/a in visual mode start text object selection (not insert)
      if (key === 'i' || key === 'a') {
        this.parser._pendingTextObj = key;
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
        if (command.operator === OperatorType.CHANGE) {
          this.setMode(Mode.INSERT);
        }
        return command;

      case CommandType.LINE_OPERATOR:
        if (command.operator === OperatorType.CHANGE) {
          this.setMode(Mode.INSERT);
        }
        return command;

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
