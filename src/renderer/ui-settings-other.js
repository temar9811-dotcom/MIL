// # FILE: src/renderer/ui-settings-other.js
// # VERSION: 10
// v10 - the "Install updates automatically" toggle. It is emitted like the
// module gates: only when the form can actually see the checkbox, so a save
// from a form that cannot report on it leaves the stored value alone.
const otherSettingsForm = document.getElementById('other-settings-form');
const logPathInput = document.getElementById('log-path');
const browseLogsBtn = document.getElementById('browse-logs');
const presenceCheckbox = document.getElementById('presence-windows');
const primarySelect = document.getElementById('primary-char');
const bigTextCheckbox = document.getElementById('big-text');
const minimizeToTrayCheckbox = document.getElementById('minimize-to-tray');
const debugToggle = document.getElementById('debug-toggle');
const themeSelect = document.getElementById('theme-select');
const autoInstallCheckbox = document.getElementById('auto-install-updates');
const saveOtherState = document.getElementById('save-other-state');
// Module gates. These are the only place a gated module is switched on; the
// checkboxes are the module registry's on/off switch, and nothing else in the
// app is allowed to bring a module up.
const moduleMapCheckbox = document.getElementById('module-map');
const moduleZkillCheckbox = document.getElementById('module-zkill');
// The Local Monitor gate is dev-only. Outside a packaged build its checkbox is
// pulled out of the form entirely, which is what makes the guards below skip it
// on load and omit the key on save: the form must never report on a gate it
// cannot see, or saving any other setting would fabricate a value for it.
const localModuleInput = document.getElementById('module-local');
const moduleLocalCheckbox = (window.electronAPI && window.electronAPI.isDev)
  ? localModuleInput
  : null;
if (!moduleLocalCheckbox && localModuleInput) {
  const localModuleRow = localModuleInput.closest('label');
  if (localModuleRow) localModuleRow.remove();
}

function applyBigText(on) {
  if (on) {
    document.body.classList.add('big-text');
  } else {
    document.body.classList.remove('big-text');
  }
  if (bigTextCheckbox) bigTextCheckbox.checked = !!on;
}

function applyTheme(theme) {
  const validThemes = ['kick-mrchi', 'standout', 'lonely-night', 'shine-bright'];
  const safeTheme = validThemes.includes(theme) ? theme : 'kick-mrchi';
  document.body.setAttribute('data-theme', safeTheme);
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
  // A module that is not named in settings is off, not on. Reading it the other
  // way round would silently switch a module on for anyone upgrading.
  if (moduleMapCheckbox) moduleMapCheckbox.checked = settings.mapEnabled === true;
  if (moduleZkillCheckbox) moduleZkillCheckbox.checked = settings.zkillEnabled === true;
  if (moduleLocalCheckbox) moduleLocalCheckbox.checked = settings.localMonitorEnabled === true;
  // Missing means on: the shipped default is to install automatically.
  if (autoInstallCheckbox) autoInstallCheckbox.checked = settings.autoInstallUpdates !== false;

  const currentTheme = settings.theme || 'kick-mrchi';
  if (themeSelect) themeSelect.value = currentTheme;
  applyTheme(currentTheme);

  // Push the gates on every load, not just on save: this runs at startup and is
  // what makes a gated module's tab appear at all.
  if (window.ModuleGates) window.ModuleGates.applySettings(settings);

  renderPrimaryChar(settings);
};

window.collectOtherSettings = () => {
  const out = {
    logPath: logPathInput ? logPathInput.value.trim() : '',
    presenceSource: presenceCheckbox && !presenceCheckbox.checked ? 'logs' : 'window',
    primaryChar: primarySelect ? primarySelect.value : '',
    bigText: bigTextCheckbox ? bigTextCheckbox.checked : false,
    minimizeToTray: minimizeToTrayCheckbox ? minimizeToTrayCheckbox.checked : true,
    enableDebug: debugToggle ? debugToggle.checked : false,
    theme: themeSelect ? themeSelect.value : 'kick-mrchi',
  };
  // A gate this form cannot see is a gate it must not report on. Emitting a
  // fabricated `false` here is what silently switches the Intel Map off the
  // next time any settings form is saved: the checkbox is never populated on
  // some entry paths, and the save still carried the key. Omit instead, so
  // whatever is in settings survives untouched.
  if (moduleMapCheckbox) out.mapEnabled = moduleMapCheckbox.checked;
  if (moduleZkillCheckbox) out.zkillEnabled = moduleZkillCheckbox.checked;
  if (moduleLocalCheckbox) out.localMonitorEnabled = moduleLocalCheckbox.checked;
  if (autoInstallCheckbox) out.autoInstallUpdates = autoInstallCheckbox.checked;
  return out;
};

if (bigTextCheckbox) {
  bigTextCheckbox.addEventListener('change', () => applyBigText(bigTextCheckbox.checked));
}

if (themeSelect) {
  themeSelect.addEventListener('change', () => applyTheme(themeSelect.value));
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
      // The main process has already torn down / built whatever the gates
      // imply; this is the renderer's half - tab buttons and script injection.
      if (window.ModuleGates) window.ModuleGates.applySettings(settings);
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