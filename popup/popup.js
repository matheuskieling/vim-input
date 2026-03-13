(function () {
  'use strict';

  var enabledToggle = document.getElementById('enabled-toggle');
  var startModeSelect = document.getElementById('start-mode');
  var matchBracketsToggle = document.getElementById('match-brackets');
  var tabSizeSelect = document.getElementById('tab-size');
  var indentModeSelect = document.getElementById('indent-mode');
  var useClipboardToggle = document.getElementById('use-clipboard');
  var highlightYankToggle = document.getElementById('highlight-yank');
  var halfPageJumpInput = document.getElementById('half-page-jump');
  var alwaysCenteredToggle = document.getElementById('always-centered');
  var lineNumbersSelect = document.getElementById('line-numbers');
  var excludeBtn = document.getElementById('exclude-btn');
  var currentUrlText = document.getElementById('current-url-text');
  var excludeList = document.getElementById('exclude-list');
  var noExcludes = document.getElementById('no-excludes');
  var statusEl = document.getElementById('status');

  var listView = document.getElementById('list-view');
  var bulkView = document.getElementById('bulk-view');
  var bulkEditBtn = document.getElementById('bulk-edit-btn');
  var bulkCancelBtn = document.getElementById('bulk-cancel-btn');
  var bulkSaveBtn = document.getElementById('bulk-save-btn');
  var excludeTextarea = document.getElementById('exclude-textarea');

  var currentPattern = '';
  var excludePatterns = [];

  // ── Get current tab URL and derive pattern ──────────

  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (!tabs[0] || !tabs[0].url) {
      currentUrlText.textContent = '(no active page)';
      excludeBtn.disabled = true;
      return;
    }
    try {
      var url = new URL(tabs[0].url);
      currentPattern = '*://' + url.hostname + '/*';
      currentUrlText.textContent = currentPattern;
      updateExcludeBtn();
    } catch (e) {
      currentUrlText.textContent = tabs[0].url;
      currentPattern = tabs[0].url;
      updateExcludeBtn();
    }
  });

  // ── Load settings ───────────────────────────────────

  chrome.storage.sync.get(
    { enabled: true, startMode: 'NORMAL', excludePatterns: [], matchBrackets: false, tabSize: 4, indentMode: 'smart', useClipboard: true, highlightYank: true, halfPageJump: 20, alwaysCentered: true, lineNumbers: 'relative' },
    function (items) {
      enabledToggle.checked = items.enabled;
      startModeSelect.value = items.startMode || 'INSERT';
      matchBracketsToggle.checked = items.matchBrackets || false;
      tabSizeSelect.value = String(items.tabSize || 4);
      indentModeSelect.value = items.indentMode || 'smart';
      useClipboardToggle.checked = items.useClipboard || false;
      highlightYankToggle.checked = items.highlightYank || false;
      halfPageJumpInput.value = String(items.halfPageJump || 20);
      alwaysCenteredToggle.checked = items.alwaysCentered || false;
      lineNumbersSelect.value = items.lineNumbers || 'relative';
      excludePatterns = items.excludePatterns || [];
      renderExcludeList();
      updateExcludeBtn();
    }
  );

  // ── Auto-save on toggle / select change ─────────────

  enabledToggle.addEventListener('change', saveSettings);
  startModeSelect.addEventListener('change', saveSettings);
  matchBracketsToggle.addEventListener('change', saveSettings);
  tabSizeSelect.addEventListener('change', saveSettings);
  indentModeSelect.addEventListener('change', saveSettings);
  useClipboardToggle.addEventListener('change', saveSettings);
  highlightYankToggle.addEventListener('change', saveSettings);
  halfPageJumpInput.addEventListener('change', saveSettings);
  alwaysCenteredToggle.addEventListener('change', saveSettings);
  lineNumbersSelect.addEventListener('change', saveSettings);

  // ── Exclude current site ────────────────────────────

  excludeBtn.addEventListener('click', function () {
    if (!currentPattern) return;
    if (excludePatterns.indexOf(currentPattern) !== -1) return;
    excludePatterns.push(currentPattern);
    saveSettings();
    renderExcludeList();
    updateExcludeBtn();
  });

  // ── Render exclude list ─────────────────────────────

  function renderExcludeList() {
    excludeList.innerHTML = '';

    if (excludePatterns.length === 0) {
      noExcludes.style.display = '';
      return;
    }

    noExcludes.style.display = 'none';

    for (var i = 0; i < excludePatterns.length; i++) {
      (function (idx) {
        var li = document.createElement('li');

        var span = document.createElement('span');
        span.className = 'pattern-text';
        span.textContent = excludePatterns[idx];
        span.title = excludePatterns[idx];
        li.appendChild(span);

        var btn = document.createElement('button');
        btn.className = 'remove-btn';
        btn.textContent = '\u00d7'; // x
        btn.title = 'Remove';
        btn.addEventListener('click', function () {
          excludePatterns.splice(idx, 1);
          saveSettings();
          renderExcludeList();
          updateExcludeBtn();
        });
        li.appendChild(btn);

        excludeList.appendChild(li);
      })(i);
    }
  }

  function updateExcludeBtn() {
    if (!currentPattern) return;
    if (excludePatterns.indexOf(currentPattern) !== -1) {
      excludeBtn.textContent = 'Site excluded';
      excludeBtn.classList.add('excluded');
    } else {
      excludeBtn.textContent = 'Exclude this site';
      excludeBtn.classList.remove('excluded');
    }
  }

  // ── Bulk edit ────────────────────────────────────────

  bulkEditBtn.addEventListener('click', function () {
    excludeTextarea.value = excludePatterns.join('\n');
    listView.classList.add('hidden');
    bulkView.classList.remove('hidden');
    bulkEditBtn.classList.add('hidden');
    excludeTextarea.focus();
  });

  bulkCancelBtn.addEventListener('click', function () {
    bulkView.classList.add('hidden');
    listView.classList.remove('hidden');
    bulkEditBtn.classList.remove('hidden');
  });

  bulkSaveBtn.addEventListener('click', function () {
    var lines = excludeTextarea.value.split('\n');
    excludePatterns = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line) excludePatterns.push(line);
    }
    saveSettings();
    renderExcludeList();
    updateExcludeBtn();
    bulkView.classList.add('hidden');
    listView.classList.remove('hidden');
    bulkEditBtn.classList.remove('hidden');
  });

  // ── Save ────────────────────────────────────────────

  function saveSettings() {
    chrome.storage.sync.set({
      enabled: enabledToggle.checked,
      startMode: startModeSelect.value,
      matchBrackets: matchBracketsToggle.checked,
      tabSize: parseInt(tabSizeSelect.value, 10) || 4,
      indentMode: indentModeSelect.value,
      useClipboard: useClipboardToggle.checked,
      highlightYank: highlightYankToggle.checked,
      halfPageJump: parseInt(halfPageJumpInput.value, 10) || 20,
      alwaysCentered: alwaysCenteredToggle.checked,
      lineNumbers: lineNumbersSelect.value,
      excludePatterns: excludePatterns,
    }, function () {
      statusEl.textContent = 'Saved!';
      setTimeout(function () {
        statusEl.textContent = '';
      }, 1500);
    });
  }
})();
