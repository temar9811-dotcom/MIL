// src/renderer/renderer.js
const statusEl = document.getElementById('engine-status');
const alertsList = document.getElementById('alerts-list');

function applyEngineState(data) {
  if (!statusEl) return;
  if (data && data.running) {
    statusEl.textContent = 'engine: running';
    statusEl.className = 'status-badge running';
  } else {
    statusEl.textContent = 'engine: stopped';
    statusEl.className = 'status-badge stopped';
  }
}

function addAlert(type, message) {
  if (!alertsList) return;
  const alert = document.createElement('div');
  alert.className = `alert alert-${type || 'soft'}`;
  alert.textContent = message || String(type);
  alertsList.insertBefore(alert, alertsList.firstChild);
  
  while (alertsList.children.length > 10) {
    alertsList.removeChild(alertsList.lastChild);
  }
}

async function init() {
  try {
    const settings = await window.electronAPI.getSettings();
    if (typeof loadSettings === 'function') {
      loadSettings(settings);
    }
    appendDebug('INFO', 'Settings loaded');
  } catch (err) {
    appendDebug('WARN', 'Could not load settings');
  }

  try {
    const state = await window.electronAPI.getState();
    applyEngineState(state);
  } catch (err) {
    appendDebug('WARN', 'getState not available');
  }
}

window.electronAPI.onEngineState(applyEngineState);

window.electronAPI.onDebugLog((line) => {
  appendDebugLine(line);
});

window.electronAPI.onAlert((alert) => {
  addAlert(alert.type, alert.message);
});

init();