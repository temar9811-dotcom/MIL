// # FILE: src/renderer/ui-settings-other.js
// # VERSION: 5

const otherSettingsForm = document.getElementById('other-settings-form');
const logPathInput = document.getElementById('log-path');
const browseLogsBtn = document.getElementById('browse-logs');
const presenceCheckbox = document.getElementById('presence-windows');
const primarySelect = document.getElementById('primary-char');
const bigTextCheckbox = document.getElementById('big-text');
const minimizeToTrayCheckbox = document.getElementById('minimize-to-tray');
const debugToggle = document.getElementById('debug-toggle');
const saveOtherState = document.getElementById('save-other-state');

function applyBigText(on) {
  if (on) {
    document.body.classList.add('big-text');
  } else {
    document.body.classList.remove('big-text');
  }
  if (bigTextCheckbox) bigTextCheckbox.checked = !!on;
}

async function renderPrimaryChar(settings) {
  if (!primarySelect || !window.electronAPI || !window.electronAPI.getCharacters) return;
  let chars = [];
  try { chars = await window.electronAPI.getCharacters(); } catch (_) { return; }
  primarySelect.innerHTML = '';
  const auto = document.createElement('option');
  auto.value = '';
  auto.textContent = 'Auto (first online)';
  primarySelect.appendChild(auto);
  for (const c of chars) {
    const o = document.createElement('option');
    o.value = c.name;
    o.textContent = c.name;
    primarySelect.appendChild(o);
  }
  primarySelect.value = settings.primaryChar || '';
}

window.loadOtherSettings = (settings) => {
  if (!settings) return;
  if (logPathInput) logPathInput.value = settings.logPath || '';
  if (presenceCheckbox) presenceCheckbox.checked = (settings.presenceSource || 'window') === 'window';
  applyBigText(settings.bigText === true);
  if (minimizeToTrayCheckbox) minimizeToTrayCheckbox.checked = settings.minimizeToTray !== false;
  if (debugToggle) debugToggle.checked = settings.enableDebug === true;
  renderPrimaryChar(settings);
};

window.collectOtherSettings = () => {
  return {
    logPath: logPathInput ? logPathInput.value.trim() : '',
    presenceSource: presenceCheckbox && !presenceCheckbox.checked ? 'logs' : 'window',
    primaryChar: primarySelect ? primarySelect.value : '',
    bigText: bigTextCheckbox ? bigTextCheckbox.checked : false,
    minimizeToTray: minimizeToTrayCheckbox ? minimizeToTrayCheckbox.checked : true,
    enableDebug: debugToggle ? debugToggle.checked : false,
  };
};

if (bigTextCheckbox) {
  bigTextCheckbox.addEventListener('change', () => applyBigText(bigTextCheckbox.checked));
}

if (browseLogsBtn && logPathInput) {
  browseLogsBtn.addEventListener('click', async () => {
    if (!window.electronAPI || !window.electronAPI.browseFolder) return;
    const folder = await window.electronAPI.browseFolder();
    if (folder) {
      logPathInput.value = folder;
      if (typeof window.appendDebug === 'function') {
        window.appendDebug('INFO', `Log folder selected: ${folder}`);
      }
    }
  });
}

if (otherSettingsForm) {
  otherSettingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (saveOtherState) saveOtherState.textContent = 'Saving...';
    
    const otherSettings = window.collectOtherSettings();
    let existingSettings = {};
    try {
      if (window.electronAPI && window.electronAPI.getSettings) {
        existingSettings = await window.electronAPI.getSettings();
      }
    } catch (_) {}
    
    const settings = { ...existingSettings, ...otherSettings };
    
    try {
      if (!window.electronAPI || !window.electronAPI.saveSettings) {
        throw new Error('electronAPI.saveSettings is not available.');
      }
      await window.electronAPI.saveSettings(settings);
      
      if (window.electronAPI && window.electronAPI.toggleDebug) {
        window.electronAPI.toggleDebug(otherSettings.enableDebug);
      }
      
      if (saveOtherState) {
        saveOtherState.textContent = 'Saved!';
        setTimeout(() => { saveOtherState.textContent = ''; }, 2000);
      }
      if (typeof window.appendDebug === 'function') {
        window.appendDebug('INFO', 'Other settings saved successfully');
      }
    } catch (err) {
      if (saveOtherState) saveOtherState.textContent = 'Error!';
      if (typeof window.appendDebug === 'function') {
        window.appendDebug('ERROR', `Failed to save settings: ${err.message}`);
      }
    }
  });
}