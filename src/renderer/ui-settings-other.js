// # FILE: src/renderer/ui-settings-other.js
// # VERSION: 3
const otherSettingsForm = document.getElementById('other-settings-form');
const presenceCheckbox = document.getElementById('presence-windows');
const primarySelect = document.getElementById('primary-char');
const bigTextCheckbox = document.getElementById('big-text');
const saveOtherState = document.getElementById('save-other-state');

function applyBigText(on) {
  const panel = document.getElementById('settings-panel');
  if (panel) {
    panel.style.zoom = on ? 2 : 1;
    panel.style.overflowY = on ? 'auto' : '';
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
  if (presenceCheckbox) presenceCheckbox.checked = (settings.presenceSource || 'window') === 'window';
  applyBigText(settings.bigText === true);
  renderPrimaryChar(settings);
};

window.collectOtherSettings = () => {
  return {
    presenceSource: presenceCheckbox && !presenceCheckbox.checked ? 'logs' : 'window',
    primaryChar: primarySelect ? primarySelect.value : '',
    bigText: bigTextCheckbox ? bigTextCheckbox.checked : false,
  };
};

if (bigTextCheckbox) {
  bigTextCheckbox.addEventListener('change', () => applyBigText(bigTextCheckbox.checked));
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