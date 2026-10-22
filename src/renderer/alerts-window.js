// MIL alerts-window v3 - solid by default: only an explicit `alertsTransparent`
// true turns the chrome see-through.
// MIL alerts-window v2 - renderer for the popped-out alerts window
const aotCheckbox = document.getElementById('always-on-top');
const transparentCheckbox = document.getElementById('transparent-alerts');

// The window is always constructed transparent; this class is what makes its
// chrome see-through. Solid mode is the same window with the class removed, so
// toggling never needs a new window.
function applyTransparency(on) {
  document.body.classList.toggle('alerts-solid', !on);
}

if (aotCheckbox) {
  aotCheckbox.addEventListener('change', () => {
    if (window.electronAPI && window.electronAPI.setAlwaysOnTop) {
      window.electronAPI.setAlwaysOnTop(aotCheckbox.checked);
    }
  });
}

if (transparentCheckbox) {
  transparentCheckbox.addEventListener('change', () => {
    const on = transparentCheckbox.checked;
    applyTransparency(on);
    if (window.electronAPI && window.electronAPI.setAlertsTransparent) {
      window.electronAPI.setAlertsTransparent(on);
    }
  });
}

// The window is frameless, so this button is the only close affordance besides
// closing it from the main window.
const closeBtn = document.getElementById('close-alerts');
if (closeBtn) {
  closeBtn.addEventListener('click', () => window.close());
}

async function init() {
  if (!window.electronAPI) return;
  try {
    const state = await window.electronAPI.getState();
    if (state && state.config && transparentCheckbox) {
      // Solid by default: only an explicit true turns transparency on.
      const on = state.config.alertsTransparent === true;
      transparentCheckbox.checked = on;
      applyTransparency(on);
    }
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
  // The setting can be changed while this window is open, so follow the push.
  if (window.electronAPI.onAlertsTransparent) {
    window.electronAPI.onAlertsTransparent((on) => {
      if (transparentCheckbox) transparentCheckbox.checked = on;
      applyTransparency(on);
    });
  }
}