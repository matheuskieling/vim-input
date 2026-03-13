(function () {
  'use strict';

  var Mode = window.InputVim.Mode;
  var Register = window.InputVim.Register;

  var DEFAULTS = {
    enabled: true,
    startMode: 'NORMAL',
    excludePatterns: [],
    matchBrackets: false,
    tabSize: 4,
    indentMode: 'smart',
    useClipboard: true,
    highlightYank: true,
    halfPageJump: 20,
    alwaysCentered: true,
  };

  var _cache = {};
  var _onChangeCallbacks = [];

  function load(callback) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.get(DEFAULTS, function (items) {
        _cache = items;
        Register.setUseClipboard(items.useClipboard || false);
        if (callback) callback(_cache);
      });
    } else {
      _cache = {};
      for (var k in DEFAULTS) _cache[k] = DEFAULTS[k];
      if (callback) callback(_cache);
    }
  }

  function get(key) {
    return _cache[key] !== undefined ? _cache[key] : DEFAULTS[key];
  }

  function getStartMode() {
    return _cache.startMode === 'NORMAL' ? Mode.NORMAL : Mode.INSERT;
  }

  function isPageExcluded() {
    var url = location.href;
    var patterns = _cache.excludePatterns || [];
    for (var i = 0; i < patterns.length; i++) {
      if (globMatch(patterns[i], url)) return true;
    }
    return false;
  }

  function globMatch(pattern, str) {
    var escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    var regex = escaped.replace(/\*/g, '.*');
    try {
      return new RegExp('^' + regex + '$', 'i').test(str);
    } catch (e) {
      return false;
    }
  }

  function onChange(cb) {
    _onChangeCallbacks.push(cb);
  }

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener(function () {
      load(function (items) {
        for (var i = 0; i < _onChangeCallbacks.length; i++) {
          _onChangeCallbacks[i](items);
        }
      });
    });
  }

  window.InputVim = window.InputVim || {};
  window.InputVim.Settings = {
    DEFAULTS: DEFAULTS,
    load: load,
    get: get,
    getStartMode: getStartMode,
    isPageExcluded: isPageExcluded,
    onChange: onChange,
  };
})();
