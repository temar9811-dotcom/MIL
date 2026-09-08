// # FILE: src/renderer/ui-tabs.js
// # VERSION: 6
// MIL ui-tabs v6 - expose updateDebugTabVisibility to window
(function() {
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  const debugToggle = document.getElementById('debug-toggle');
  const debugTabBtn = document.getElementById('debug-tab-btn');

  function switchTab(targetTab) {
    tabButtons.forEach(b => b.classList.remove('active'));
    tabContents.forEach(c => c.classList.remove('active'));

    const targetBtn = document.querySelector(`.tab-btn[data-tab="${targetTab}"]`);
    if (targetBtn) targetBtn.classList.add('active');

    if (targetTab === 'alerts') {
      document.getElementById('alerts-panel').classList.add('active');
    } else if (targetTab === 'alert-settings') {
      document.getElementById('alert-settings-panel').classList.add('active');
    } else if (targetTab === 'other-settings') {
      document.getElementById('other-settings-panel').classList.add('active');
    } else if (targetTab === 'debug') {
      document.getElementById('debug-panel-wrapper').classList.add('active');
    }
  }

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      switchTab(targetTab);
    });
  });

  function updateDebugTabVisibility() {
    if (debugToggle && debugTabBtn) {
      if (debugToggle.checked) {
        debugTabBtn.classList.remove('hidden');
      } else {
        debugTabBtn.classList.add('hidden');
        if (debugTabBtn.classList.contains('active')) {
          switchTab('alerts');
        }
      }
    }
  }

  if (debugToggle) {
    debugToggle.addEventListener('change', updateDebugTabVisibility);
  }

  // Expose to window so renderer.js can call it after loading settings
  window.updateDebugTabVisibility = updateDebugTabVisibility;
})();