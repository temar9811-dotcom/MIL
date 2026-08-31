// MIL renderer v3 - restores alert history at startup
const statusEl = document.getElementById('engine-status');

const STATUS_STYLES = {
  running: { bg: '#143a24', fg: '#4ade80', border: '#22c55e' },
  starting: { bg: '#3a2f14', fg: '#facc15', border: '#eab308' },
  stopped: { bg: '#3a1414', fg: '#f87171', border: '#ef4444' },
};

function applyEngineState(data) {
  if (!statusEl) return;
  let state = 'stopped';
  if (data && typeof data.state === 'string') state = data.state;
  else if (data && data.running === true) state = 'running';
  if (!STATUS_STYLES[state]) state = 'stopped';

  const style = STATUS_STYLES[state];
  statusEl.textContent = state === 'starting' ? 'engine: starting…' : `engine: ${state}`;
  statusEl.style.background = style.bg;
  statusEl.style.color = style.fg;
  statusEl.style.borderColor = style.border;
}

function appendDebugSafe(level, msg) {
  if (typeof window.appendDebug === 'function') window.appendDebug(level, msg);
}

async function init() {
  if (!window.electronAPI) {
    appendDebugSafe('ERROR', 'electronAPI missing - preload not loaded');
    return;
  }
  applyEngineState({ state: 'starting' });
  try {
    const settings = await window.electronAPI.getSettings();
    if (typeof loadSettings === 'function') loadSettings(settings);
    appendDebugSafe('INFO', 'Settings loaded');
  } catch (err) {
    appendDebugSafe('WARN', `Could not load settings: ${err.message}`);
  }
  try {
    const state = await window.electronAPI.getState();
    applyEngineState(state);
    if (state && Array.isArray(state.recents) && typeof window.renderAlertHistory === 'function') {
      window.renderAlertHistory(state.recents);
    }
  } catch (err) {
    appendDebugSafe('WARN', `getState not available: ${err.message}`);
  }
}

init();

if (window.electronAPI) {
  window.electronAPI.onEngineState(applyEngineState);
  window.electronAPI.onDebugLog((line) => {
    if (typeof window.appendDebugLine === 'function') window.appendDebugLine(line);
  });
  window.electronAPI.onAlert((alert) => {
    if (typeof window.addAlert === 'function') window.addAlert(alert);
  });
}