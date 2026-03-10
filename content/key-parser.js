(function () {
  'use strict';

  var MotionType = window.InputVim.MotionType;
  var OperatorType = window.InputVim.OperatorType;
  var CommandType = window.InputVim.CommandType;
  var InsertEntry = window.InputVim.InsertEntry;
  var TextObject = window.InputVim.TextObject;

  var TEXT_OBJ_KEYS = {
    w: TextObject.WORD, W: TextObject.WORD_BIG,
    p: TextObject.PARAGRAPH,
    '{': TextObject.BRACE, '}': TextObject.BRACE,
    '(': TextObject.PAREN, ')': TextObject.PAREN,
    '[': TextObject.BRACKET, ']': TextObject.BRACKET,
    '<': TextObject.ANGLE, '>': TextObject.ANGLE,
    '"': TextObject.DOUBLE_QUOTE,
    "'": TextObject.SINGLE_QUOTE,
    '`': TextObject.BACKTICK,
  };

  // Characters that act as quote-like delimiters for text objects (ci|, ci*, etc.)
  var CHAR_PAIR_KEYS = { '|': 1, '*': 1, '/': 1, '\\': 1 };

  var MOTION_KEYS = {
    h: MotionType.CHAR_LEFT,
    l: MotionType.CHAR_RIGHT,
    k: MotionType.LINE_UP,
    j: MotionType.LINE_DOWN,
    w: MotionType.WORD_FORWARD,
    b: MotionType.WORD_BACK,
    e: MotionType.WORD_END,
    W: MotionType.WORD_FORWARD_BIG,
    B: MotionType.WORD_BACK_BIG,
    E: MotionType.WORD_END_BIG,
    '0': MotionType.LINE_START,
    $: MotionType.LINE_END,
    '^': MotionType.FIRST_NON_BLANK,
    G: MotionType.DOC_END,
    '{': MotionType.PARAGRAPH_BACK,
    '}': MotionType.PARAGRAPH_FORWARD,
  };

  var OPERATOR_KEYS = {
    d: OperatorType.DELETE,
    c: OperatorType.CHANGE,
    y: OperatorType.YANK,
  };

  var INSERT_KEYS = {
    i: InsertEntry.I_LOWER,
    a: InsertEntry.A_LOWER,
    I: InsertEntry.I_UPPER,
    A: InsertEntry.A_UPPER,
    o: InsertEntry.O_LOWER,
    O: InsertEntry.O_UPPER,
  };

  var _REVERSE_FIND = {};
  _REVERSE_FIND[MotionType.FIND_CHAR] = MotionType.FIND_CHAR_BACK;
  _REVERSE_FIND[MotionType.FIND_CHAR_BACK] = MotionType.FIND_CHAR;
  _REVERSE_FIND[MotionType.TILL_CHAR] = MotionType.TILL_CHAR_BACK;
  _REVERSE_FIND[MotionType.TILL_CHAR_BACK] = MotionType.TILL_CHAR;

  function KeyParser() {
    this._lastFind = null; // { motion, char } for ; and , repeat
    this.reset();
  }

  KeyParser.prototype.reset = function () {
    this._count = '';
    this._operator = null;
    this._pendingG = false;
    this._pendingR = false;
    this._pendingFind = null; // 'f', 'F', 't', or 'T'
    this._pendingTextObj = null; // 'i' or 'a'
    this._keys = '';
    this._clearTimeout();
  };

  KeyParser.prototype._clearTimeout = function () {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  };

  KeyParser.prototype._startTimeout = function () {
    var self = this;
    this._clearTimeout();
    this._timer = setTimeout(function () {
      self.reset();
    }, 1000);
  };

  /**
   * Feed a key into the parser.
   * Returns a command object when a sequence is complete, or null if still accumulating.
   */
  KeyParser.prototype.feed = function (key) {
    if (key !== 'Escape') this._keys += key;

    // Handle pending f/F/t/T char
    if (this._pendingFind) {
      var findType = this._pendingFind;
      this._pendingFind = null;
      this._clearTimeout();
      if (key === 'Escape') {
        this.reset();
        return null;
      }
      var motionMap = {
        f: MotionType.FIND_CHAR,
        F: MotionType.FIND_CHAR_BACK,
        t: MotionType.TILL_CHAR,
        T: MotionType.TILL_CHAR_BACK,
      };
      var count = this._parseCount();
      var op = this._operator;
      this.reset();
      var motion = motionMap[findType];
      // Store for ; and , repeat
      this._lastFind = { motion: motion, char: key };
      if (op) {
        return { type: CommandType.OPERATOR_MOTION, operator: op, motion: motion, char: key, count: count };
      }
      return { type: CommandType.MOTION, motion: motion, char: key, count: count };
    }

    // Handle pending text object (i/a + object key)
    if (this._pendingTextObj) {
      var mod = this._pendingTextObj;
      this._pendingTextObj = null;
      this._clearTimeout();
      if (key === 'Escape') { this.reset(); return null; }
      var obj = TEXT_OBJ_KEYS[key];
      var charPairChar = null;
      if (!obj && CHAR_PAIR_KEYS[key]) {
        obj = TextObject.CHAR_PAIR;
        charPairChar = key;
      }
      if (obj) {
        var cnt = this._parseCount();
        var pendingOp = this._operator;
        this.reset();
        var modifier = mod === 'i' ? 'inner' : 'around';
        if (pendingOp) {
          return { type: CommandType.OPERATOR_TEXT_OBJECT, operator: pendingOp, modifier: modifier, object: obj, count: cnt, char: charPairChar };
        }
        return { type: CommandType.TEXT_OBJECT, modifier: modifier, object: obj, count: cnt, char: charPairChar };
      }
      this.reset();
      return null;
    }

    // Handle pending replace char
    if (this._pendingR) {
      this._pendingR = false;
      this._clearTimeout();
      if (key === 'Escape') {
        this.reset();
        return null;
      }
      var cmd = {
        type: CommandType.REPLACE_CHAR,
        char: key,
        count: this._parseCount(),
      };
      this.reset();
      return cmd;
    }

    // Handle pending 'g' for 'gg', 'ge', 'gE'
    if (this._pendingG) {
      this._pendingG = false;
      this._clearTimeout();
      var gCount = this._parseCount();
      var gOp = this._operator;
      if (key === 'g') {
        this.reset();
        if (gOp) {
          return { type: CommandType.OPERATOR_MOTION, operator: gOp, motion: MotionType.DOC_START, count: gCount };
        }
        return { type: CommandType.MOTION, motion: MotionType.DOC_START, count: gCount };
      }
      if (key === 'e') {
        this.reset();
        if (gOp) {
          return { type: CommandType.OPERATOR_MOTION, operator: gOp, motion: MotionType.WORD_END_BACK, count: gCount };
        }
        return { type: CommandType.MOTION, motion: MotionType.WORD_END_BACK, count: gCount };
      }
      if (key === 'E') {
        this.reset();
        if (gOp) {
          return { type: CommandType.OPERATOR_MOTION, operator: gOp, motion: MotionType.WORD_END_BACK_BIG, count: gCount };
        }
        return { type: CommandType.MOTION, motion: MotionType.WORD_END_BACK_BIG, count: gCount };
      }
      // Not a recognized g-sequence, reset
      this.reset();
      return null;
    }

    // Escape always resets
    if (key === 'Escape') {
      this.reset();
      return { type: CommandType.ESCAPE };
    }

    // Accumulate count digits (but '0' at the start is a motion, not a count)
    if (key >= '1' && key <= '9' || (key === '0' && this._count.length > 0)) {
      this._count += key;
      this._startTimeout();
      return null;
    }

    // 'g' — start of multi-key
    if (key === 'g' && !this._operator) {
      this._pendingG = true;
      this._startTimeout();
      return null;
    }

    // 'r' — replace char
    if (key === 'r' && !this._operator) {
      this._pendingR = true;
      this._startTimeout();
      return null;
    }

    // f/F/t/T — find/till char (works standalone and after operator)
    if (key === 'f' || key === 'F' || key === 't' || key === 'T') {
      this._pendingFind = key;
      this._startTimeout();
      return null;
    }

    // ; and , — repeat last f/F/t/T
    if (key === ';' || key === ',') {
      var lf = this._lastFind;
      if (lf) {
        var mot = key === ';' ? lf.motion : _REVERSE_FIND[lf.motion];
        var cnt = this._parseCount();
        var pendingOp = this._operator;
        this.reset();
        if (pendingOp) {
          return { type: CommandType.OPERATOR_MOTION, operator: pendingOp, motion: mot, char: lf.char, count: cnt };
        }
        return { type: CommandType.MOTION, motion: mot, char: lf.char, count: cnt };
      }
      this.reset();
      return null;
    }

    var count = this._parseCount();

    // If we have a pending operator, the next key must be a motion or same-operator (line op)
    if (this._operator) {
      var op = this._operator;

      // Double operator → line operation (dd, yy, cc)
      if (OPERATOR_KEYS[key] === op) {
        this.reset();
        return { type: CommandType.LINE_OPERATOR, operator: op, count: count };
      }

      // Text object after operator (di{, ciw, etc.)
      if (key === 'i' || key === 'a') {
        this._pendingTextObj = key;
        this._startTimeout();
        return null;
      }

      // 'g' after operator → wait for 'gg'
      if (key === 'g') {
        this._pendingG = true;
        this._startTimeout();
        return null;
      }

      // Motion after operator
      if (MOTION_KEYS[key]) {
        var motion = MOTION_KEYS[key];
        this.reset();
        return { type: CommandType.OPERATOR_MOTION, operator: op, motion: motion, count: count };
      }

      // Invalid key after operator, reset
      this.reset();
      return null;
    }

    // Operator start
    if (OPERATOR_KEYS[key]) {
      this._operator = OPERATOR_KEYS[key];
      this._startTimeout();
      return null;
    }

    // Simple motion
    if (MOTION_KEYS[key]) {
      this.reset();
      return { type: CommandType.MOTION, motion: MOTION_KEYS[key], count: count };
    }

    // Insert entry commands
    if (INSERT_KEYS[key]) {
      this.reset();
      return { type: CommandType.INSERT_ENTER, entry: INSERT_KEYS[key], count: count };
    }

    // Visual mode
    if (key === 'v') {
      this.reset();
      return { type: CommandType.VISUAL_ENTER };
    }

    // Visual line mode
    if (key === 'V') {
      this.reset();
      return { type: CommandType.VISUAL_LINE_ENTER };
    }

    // Paste
    if (key === 'p') {
      this.reset();
      return { type: CommandType.PASTE, count: count };
    }
    if (key === 'P') {
      this.reset();
      return { type: CommandType.PASTE_BEFORE, count: count };
    }

    // Undo
    if (key === 'u') {
      this.reset();
      return { type: CommandType.UNDO, count: count };
    }

    // 'x' = delete char under cursor
    if (key === 'x') {
      this.reset();
      return { type: CommandType.DELETE_CHAR, count: count };
    }

    // 'X' = delete char before cursor (shortcut for dh)
    if (key === 'X') {
      this.reset();
      return { type: CommandType.OPERATOR_MOTION, operator: OperatorType.DELETE, motion: MotionType.CHAR_LEFT, count: count };
    }

    // 'D' = d$ (delete to end of line)
    if (key === 'D') {
      this.reset();
      return { type: CommandType.OPERATOR_MOTION, operator: OperatorType.DELETE, motion: MotionType.LINE_END, count: 1 };
    }

    // 'C' = c$ (change to end of line)
    if (key === 'C') {
      this.reset();
      return { type: CommandType.OPERATOR_MOTION, operator: OperatorType.CHANGE, motion: MotionType.LINE_END, count: 1 };
    }

    // 'Y' = yy (yank line)
    if (key === 'Y') {
      this.reset();
      return { type: CommandType.LINE_OPERATOR, operator: OperatorType.YANK, count: count };
    }

    // 's' = cl (substitute char)
    if (key === 's') {
      this.reset();
      return { type: CommandType.OPERATOR_MOTION, operator: OperatorType.CHANGE, motion: MotionType.CHAR_RIGHT, count: count };
    }

    // Unrecognized key, reset
    this.reset();
    return null;
  };

  KeyParser.prototype._parseCount = function () {
    var n = parseInt(this._count, 10);
    return isNaN(n) ? 1 : n;
  };

  KeyParser.prototype.setPendingTextObj = function (key) {
    this._pendingTextObj = key;
  };

  KeyParser.prototype.getPending = function () {
    return this._keys;
  };

  window.InputVim = window.InputVim || {};
  window.InputVim.KeyParser = KeyParser;
})();
