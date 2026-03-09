(function () {
  'use strict';

  var enabledToggle = document.getElementById('enabled-toggle');
  var startModeSelect = document.getElementById('start-mode');
  var matchBracketsToggle = document.getElementById('match-brackets');
  var tabSizeSelect = document.getElementById('tab-size');
  var excludeBtn = document.getElementById('exclude-btn');
  var currentUrlText = document.getElementById('current-url-text');
  var excludeList = document.getElementById('exclude-list');
  var noExcludes = document.getElementById('no-excludes');
  var statusEl = document.getElementById('status');

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
    { enabled: true, startMode: 'INSERT', excludePatterns: [], matchBrackets: false, tabSize: 4 },
    function (items) {
      enabledToggle.checked = items.enabled;
      startModeSelect.value = items.startMode || 'INSERT';
      matchBracketsToggle.checked = items.matchBrackets || false;
      tabSizeSelect.value = String(items.tabSize || 4);
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
        btn.textContent = '\u00d7'; // ×
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

  // ── Save ────────────────────────────────────────────

  function saveSettings() {
    chrome.storage.sync.set({
      enabled: enabledToggle.checked,
      startMode: startModeSelect.value,
      matchBrackets: matchBracketsToggle.checked,
      tabSize: parseInt(tabSizeSelect.value, 10) || 4,
      excludePatterns: excludePatterns,
    }, function () {
      statusEl.textContent = 'Saved!';
      setTimeout(function () {
        statusEl.textContent = '';
      }, 1500);
    });
  }
})();
