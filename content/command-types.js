(function () {
  'use strict';

  const Mode = Object.freeze({
    NORMAL: 'NORMAL',
    INSERT: 'INSERT',
    VISUAL: 'VISUAL',
    VISUAL_LINE: 'VISUAL_LINE',
  });

  const MotionType = Object.freeze({
    CHAR_LEFT: 'char_left',       // h
    CHAR_RIGHT: 'char_right',     // l
    LINE_UP: 'line_up',           // k
    LINE_DOWN: 'line_down',       // j
    WORD_FORWARD: 'word_forward', // w
    WORD_BACK: 'word_back',       // b
    WORD_END: 'word_end',         // e
    LINE_START: 'line_start',     // 0
    LINE_END: 'line_end',         // $
    FIRST_NON_BLANK: 'first_non_blank', // ^
    WORD_FORWARD_BIG: 'word_forward_big', // W
    WORD_BACK_BIG: 'word_back_big',       // B
    WORD_END_BIG: 'word_end_big',         // E
    FIND_CHAR: 'find_char',       // f{char}
    FIND_CHAR_BACK: 'find_char_back', // F{char}
    TILL_CHAR: 'till_char',       // t{char}
    TILL_CHAR_BACK: 'till_char_back', // T{char}
    DOC_START: 'doc_start',       // gg
    DOC_END: 'doc_end',           // G
  });

  const OperatorType = Object.freeze({
    DELETE: 'delete',   // d
    CHANGE: 'change',   // c
    YANK: 'yank',       // y
  });

  const TextObject = Object.freeze({
    WORD: 'word',
    WORD_BIG: 'word_big',
    BRACE: 'brace',
    PAREN: 'paren',
    BRACKET: 'bracket',
    ANGLE: 'angle',
    DOUBLE_QUOTE: 'double_quote',
    SINGLE_QUOTE: 'single_quote',
  });

  const CommandType = Object.freeze({
    MOTION: 'motion',
    OPERATOR_MOTION: 'operator_motion',
    OPERATOR_TEXT_OBJECT: 'operator_text_object',
    TEXT_OBJECT: 'text_object',
    LINE_OPERATOR: 'line_operator',
    INSERT_ENTER: 'insert_enter',
    VISUAL_ENTER: 'visual_enter',
    VISUAL_LINE_ENTER: 'visual_line_enter',
    VISUAL_OPERATOR: 'visual_operator',
    PASTE: 'paste',
    PASTE_BEFORE: 'paste_before',
    UNDO: 'undo',
    REDO: 'redo',
    ESCAPE: 'escape',
    REPLACE_CHAR: 'replace_char',
    DELETE_CHAR: 'delete_char',
  });

  const InsertEntry = Object.freeze({
    I_LOWER: 'i',  // before cursor
    A_LOWER: 'a',  // after cursor
    I_UPPER: 'I',  // start of line
    A_UPPER: 'A',  // end of line
    O_LOWER: 'o',  // new line below
    O_UPPER: 'O',  // new line above
  });

  window.InputVim = window.InputVim || {};
  window.InputVim.Mode = Mode;
  window.InputVim.MotionType = MotionType;
  window.InputVim.OperatorType = OperatorType;
  window.InputVim.TextObject = TextObject;
  window.InputVim.CommandType = CommandType;
  window.InputVim.InsertEntry = InsertEntry;
})();
