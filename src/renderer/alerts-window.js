// MIL alerts-window v1 - renderer for the popped-out alerts window
const aotCheckbox = document.getElementById('always-on-top');

if (aotCheckbox) {
  aotCheckbox.addEventListener('change', () => {
    if (window.electronAPI && window.electronAPI.setAlwaysOnTop) {
      window.electronAPI.setAlwaysOnTop(aotCheckbox.checked);
    }
  });
}

async function init() {
  if (!window.electronAPI) return;
  try {
    const state = await window.electronAPI.getState();
    if (state && Array.isArray(state.recents) && typeof window.renderAlertHistory === 'function') {
      window.renderAlertHistory(state.recents);
    }
  } catch (_) { /* history optional */ }
}

init();

if (window.electronAPI) {
  window.electronAPI.onAlert((alert) => {
    if (typeof window.addAlert === 'function') window.addAlert(alert);
  });
}