// MIL renderer v9 - self-healing: alerts, roster, version, engine state, debug tab
const statusEl = document.getElementById('engine-status');
const versionEl = document.getElementById('app-version');
const dockedAlerts = document.getElementById('alerts');
const debugTabBtn = document.getElementById('debug-tab-btn');
const enableDebugCheckbox = document.getElementById('enable-debug');
const rosterList = document.getElementById('roster-list');

const STATUS_STYLES = {
  running: { bg: '#143a24', fg: '#4ade80', border: '#22c55e' },
  starting: { bg: '#3a2f14', fg: '#facc15', border: '#eab308' },
  stopped: { bg: '#3a1414', fg: '#f87171', border: '#ef4444' },
};

function appendDebugSafe(level, msg) {
  if (typeof window.appendDebug === 'function') window.appendDebug(level, msg);
}

function applyEngineState(data) {
  if (versionEl && data && data.version) versionEl.textContent = `v${data.version}`;
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

function updateDebugTabVisibility() {
  if (!debugTabBtn) return;
  const on = !!(enableDebugCheckbox && enableDebugCheckbox.checked);
  debugTabBtn.classList.toggle('hidden', !on);
  if (!on && debugTabBtn.classList.contains('active') && window.uiTabs) {
    window.uiTabs.show('alerts');
  }
}

if (enableDebugCheckbox) {
  enableDebugCheckbox.addEventListener('change', () => {
    updateDebugTabVisibility();
    if (window.electronAPI && typeof window.electronAPI.setDebug === 'function') {
      window.electronAPI.setDebug(enableDebugCheckbox.checked).catch(() => {});
    }
  });
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
  if (data && data.color) el.style.borderLeft = `4px solid ${data.color}`;
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

function renderRoster(chars) {
  if (!rosterList) return;
  rosterList.innerHTML = '';
  const list = Array.isArray(chars) ? chars : [];
  if (!list.length) {
    const li = document.createElement('li');
    li.className = 'roster-empty';
    li.textContent = 'No characters detected yet';
    rosterList.appendChild(li);
    return;
  }
  for (const c of list) {
    const li = document.createElement('li');
    li.className = 'roster-item';
    const name = document.createElement('span');
    name.className = 'roster-name';
    name.textContent = c.name || '?';
    const sys = document.createElement('span');
    sys.className = 'roster-system';
    sys.textContent = c.online === false ? 'offline' : (c.system || 'unknown');
    li.append(name, sys);
    rosterList.appendChild(li);
  }
}

async function refreshRoster() {
  if (!window.electronAPI || !window.electronAPI.getCharacters) return;
  try { renderRoster(await window.electronAPI.getCharacters()); } catch (_) { /* not ready */ }
}

async function init() {
  if (!window.electronAPI) {
    appendDebugSafe('ERROR', 'electronAPI missing - preload not loaded');
    return;
  }
  applyEngineState({ state: 'starting' });
  try {
    const settings = await window.electronAPI.getSettings();
    if (settings && enableDebugCheckbox) enableDebugCheckbox.checked = settings.enableDebug === true;
    if (typeof window.loadSettings === 'function') window.loadSettings(settings);
    updateDebugTabVisibility();
    appendDebugSafe('INFO', 'Settings loaded');
  } catch (err) {
    updateDebugTabVisibility();
    appendDebugSafe('WARN', `Could not load settings: ${err.message}`);
  }
  try {
    const state = await window.electronAPI.getState();
    applyEngineState(state);
    dockedRenderHistory(state && state.recents);
  } catch (err) {
    appendDebugSafe('WARN', `getState not available: ${err.message}`);
  }
  refreshRoster();
  setInterval(refreshRoster, 5000);
}

init();

if (window.electronAPI) {
  window.electronAPI.onEngineState(applyEngineState);
  window.electronAPI.onDebugLog((line) => {
    if (typeof window.appendDebugLine === 'function') window.appendDebugLine(line);
  });
  window.electronAPI.onAlert((alert) => dockedAddAlert(alert));
}