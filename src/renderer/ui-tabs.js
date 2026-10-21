// # FILE: src/renderer/ui-tabs.js
// # VERSION: 10
// MIL ui-tabs v10 - data-driven panels + module gate visibility hook
(function() {
const tabButtons = document.querySelectorAll('.tab-btn');
const debugToggle = document.getElementById('debug-toggle');
const debugTabBtn = document.getElementById('debug-tab-btn');

// tab id -> panel id. The zkill panel additionally needs display:flex, which is
// kept as a per-panel quirk rather than by making every panel a special case.
const PANELS = {
  'alerts': 'alerts-panel',
  'intel-map': 'intel-map-panel',
  'zkill': 'zkill-panel',
  'local-monitor': 'local-monitor-panel',
  'alert-settings': 'alert-settings-panel',
  'watch-list': 'watch-list-panel',
  'other-settings': 'other-settings-panel',
  'debug': 'debug-panel-wrapper',
};

function panelFor(targetTab) {
  return document.getElementById(PANELS[targetTab]);
}

function switchTab(targetTab) {
  tabButtons.forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => {
    c.classList.remove('active');
    // Clear the inline display so CSS can hide non-active panels.
    c.style.display = '';
  });

  const targetBtn = document.querySelector(`.tab-btn[data-tab="${targetTab}"]`);
  if (targetBtn) targetBtn.classList.add('active');

  const panel = panelFor(targetTab);
  if (panel) {
    panel.classList.add('active');
    if (PANELS[targetTab] === 'zkill-panel') panel.style.display = 'flex';
  }

  // Tell the gates which module owns the window now. A module whose tab is not
  // on screen must not be polling: that is the point of the gate.
  // Compare against the tab each module declares, not its id - the ids are
  // short ('map', 'local') and the tab names are not ('intel-map',
  // 'local-monitor'), so matching the two directly silently reports the map as
  // hidden while its tab is the one on screen.
  if (window.ModuleGates) {
    for (const m of window.ModuleGates.register) {
      window.ModuleGates.setVisible(m.id, m.tab === targetTab);
    }
  }
}

tabButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    switchTab(btn.getAttribute('data-tab'));
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
window.updateDebugTabVisibility = updateDebugTabVisibility;
window.switchTab = switchTab;
})();
