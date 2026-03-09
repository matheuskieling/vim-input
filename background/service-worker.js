(function () {
  'use strict';

  var defaultSettings = {
    enabled: true,
    startMode: 'INSERT',
    excludePatterns: [],
  };

  function getSettings(callback) {
    chrome.storage.sync.get(defaultSettings, function (items) {
      callback(items);
    });
  }

  function globToRegex(pattern) {
    var escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    var regex = escaped.replace(/\*/g, '.*');
    try {
      return new RegExp('^' + regex + '$', 'i');
    } catch (e) {
      return null;
    }
  }

  function isUrlExcluded(url, patterns) {
    for (var i = 0; i < patterns.length; i++) {
      var pattern = patterns[i].trim();
      if (!pattern) continue;
      var re = globToRegex(pattern);
      if (re && re.test(url)) return true;
    }
    return false;
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg.type === 'check-page') {
      getSettings(function (settings) {
        sendResponse({
          enabled: settings.enabled && !isUrlExcluded(msg.url, settings.excludePatterns),
          startMode: settings.startMode,
          excludePatterns: settings.excludePatterns,
        });
      });
      return true;
    }
  });

  chrome.storage.onChanged.addListener(function (changes) {
    getSettings(function (settings) {
      chrome.tabs.query({}, function (tabs) {
        for (var i = 0; i < tabs.length; i++) {
          chrome.tabs.sendMessage(tabs[i].id, {
            type: 'settings-changed',
            enabled: settings.enabled,
            startMode: settings.startMode,
            excludePatterns: settings.excludePatterns,
          }).catch(function () {});
        }
      });
    });
  });
})();
