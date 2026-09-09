// # FILE: src/renderer/renderer.js
// # VERSION: 15

const statusEl = document.getElementById('engine-status');
const versionEl = document.getElementById('app-version');
const dockedAlerts = document.getElementById('alerts');

const STATUS_STYLES = {
  running:  { bg: '#143a24', fg: '#4ade80', border: '#22c55e' },
  starting: { bg: '#3a2f14', fg: '#facc15', border: '#eab308' },
  stopped:  { bg: '#3a1414', fg: '#f87171', border: '#ef4444' },
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

function makeAlertCard(data) {
  const el = document.createElement('div');
  el.className = `alert alert-${data && data.type === 'red' ? 'red' : 'soft'}`;
  const parts = [
    data.character || '?',
    data.jumps == null ? '?' : `${data.jumps} jumps`,
    data.system || '?',
    data.pilot || '?',
  ];
  if (data.ship) parts.push(data.ship);
  const line = parts.join(' > ');
  el.textContent = line;
  el.title = line;
  el.style.whiteSpace = 'nowrap';
  el.style.overflow = 'hidden';
  el.style.textOverflow = 'ellipsis';
  if (data && data.color) {
    el.style.borderLeft = `4px solid ${data.color}`;
  }
  return el;
}

function dockedAddAlert(data) {
  if (!dockedAlerts || !data) return;
  dockedAlerts.insertBefore(makeAlertCard(data), dockedAlerts.firstChild);
  while (dockedAlerts.children.length > 50) {
    dockedAlerts.removeChild(dockedAlerts.lastChild);
  }
}

function dockedRenderHistory(list) {
  if (!dockedAlerts || !Array.isArray(list)) return;
  dockedAlerts.innerHTML = '';
  for (let i = list.length - 1; i >= 0; i--) {
    dockedAlerts.insertBefore(makeAlertCard(list[i]), dockedAlerts.firstChild);
  }
}

async function init() {
  if (!window.electronAPI) {
    appendDebugSafe('ERROR', 'electronAPI missing - preload not loaded');
    return;
  }

  applyEngineState({ state: 'starting' });

  try {
    const settings = await window.electronAPI.getSettings();
    if (typeof window.loadAlertSettings === 'function') window.loadAlertSettings(settings);
    if (typeof window.loadOtherSettings === 'function') window.loadOtherSettings(settings);
    if (typeof window.loadZkillSettings === 'function') window.loadZkillSettings(settings);
    if (typeof window.updateDebugTabVisibility === 'function') {
      window.updateDebugTabVisibility();
    }
    appendDebugSafe('INFO', 'Settings loaded');
  } catch (err) {
    appendDebugSafe('WARN', `Could not load settings: ${err.message}`);
  }

  try {
    const state = await window.electronAPI.getState();
    applyEngineState(state);
    if (versionEl && state && state.version) {
      versionEl.textContent = `v${state.version}`;
    }
    dockedRenderHistory(state.recents);
  } catch (err) {
    appendDebugSafe('WARN', `getState not available: ${err.message}`);
  }
}

init();

if (window.electronAPI) {
  window.electronAPI.onEngineState(applyEngineState);

  window.electronAPI.onDebugLog((line) => {
    if (typeof window.appendDebugLine === 'function') {
      window.appendDebugLine(line);
    }
  });

  window.electronAPI.onAlert((alert) => dockedAddAlert(alert));
}