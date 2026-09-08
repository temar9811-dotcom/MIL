// # FILE: src/renderer/ui-settings-core.js
// # VERSION: 2

const settingsForm = document.getElementById('settings-form');
const logPathInput = document.getElementById('log-path') || document.getElementById('logs-dir');
const proximityInput = document.getElementById('proximity-range');
const channelsInput = document.getElementById('intel-channels') || document.getElementById('channels');
const soundCheckbox = document.getElementById('sound-enabled') || document.getElementById('sound');
const notificationCheckbox = document.getElementById('notification-enabled') || document.getElementById('notifications');
const presenceCheckbox = document.getElementById('presence-windows');
const saveState = document.getElementById('save-state');
const browseBtn = document.getElementById('browse-logs');
const bigTextCheckbox = document.getElementById('big-text');
const intelTimeoutInput = document.getElementById('intel-timeout');
const primarySelect = document.getElementById('primary-char');
const enableDebugCheckbox = document.getElementById('enable-debug');

// RESTORED: Original zoom logic for bigger text
function applyBigText(on) {
  const panel = document.getElementById('settings-panel');
  if (panel) {
    panel.style.zoom = on ? 2 : 1;
    panel.style.overflowY = on ? 'auto' : '';
  }
  if (bigTextCheckbox) bigTextCheckbox.checked = !!on;
}

if (bigTextCheckbox) {
  bigTextCheckbox.addEventListener('change', () => applyBigText(bigTextCheckbox.checked));
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

window.loadSettings = (settings) => {
  if (!settings) return;
  if (logPathInput) logPathInput.value = settings.logPath || '';
  if (proximityInput) proximityInput.value = settings.proximityRange ?? 2;
  if (channelsInput) channelsInput.value = settings.intelChannels || '';
  if (soundCheckbox) soundCheckbox.checked = settings.soundEnabled !== false && settings.sound !== false;
  if (notificationCheckbox) notificationCheckbox.checked = settings.notificationEnabled !== false && settings.notifications !== false;
  if (presenceCheckbox) presenceCheckbox.checked = (settings.presenceSource || 'window') === 'window';
  if (intelTimeoutInput) intelTimeoutInput.value = settings.intelTimeout ?? 10;
  
  applyBigText(settings.bigText === true);
  if (enableDebugCheckbox) enableDebugCheckbox.checked = settings.enableDebug === true;
  
  renderPrimaryChar(settings);
  
  if (typeof window.loadGroupSettings === 'function') window.loadGroupSettings(settings);
  if (typeof window.loadEventSettings === 'function') window.loadEventSettings(settings);
  
  if (settings.watchList && typeof window.renderWatchList === 'function') {
    window.renderWatchList(settings.watchList);
  }
};

if (browseBtn && logPathInput) {
  browseBtn.addEventListener('click', async () => {
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

if (settingsForm) {
  settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (saveState) saveState.textContent = 'Saving...';

    const soundOn = soundCheckbox ? soundCheckbox.checked : true;
    const notifOn = notificationCheckbox ? notificationCheckbox.checked : true;
    const eventSettings = typeof window.collectEventSettings === 'function' ? window.collectEventSettings() : {};

    const settings = {
      logPath: logPathInput ? logPathInput.value : '',
      proximityRange: proximityInput ? parseInt(proximityInput.value) || 2 : 2,
      intelChannels: channelsInput ? channelsInput.value : '',
      soundEnabled: soundOn,
      notificationEnabled: notifOn,
      sound: soundOn,
      notifications: notifOn,
      presenceSource: presenceCheckbox && !presenceCheckbox.checked ? 'logs' : 'window',
      primaryChar: primarySelect ? primarySelect.value : '',
      intelTimeout: intelTimeoutInput ? parseInt(intelTimeoutInput.value, 10) || 10 : 10,
      bigText: bigTextCheckbox ? bigTextCheckbox.checked : false,
      enableDebug: enableDebugCheckbox ? enableDebugCheckbox.checked : false,
      groupAlerts: typeof window.collectGroupAlerts === 'function' ? window.collectGroupAlerts() : {},
      eventPings: eventSettings.eventPings || { ess: true, bubble: true, drag: true, ansiblex: true, camping: true },
      volumeRed: eventSettings.volumeRed || 50,
      volumeSoft: eventSettings.volumeSoft || 50,
      volume: eventSettings.volumeRed || 50,
      alertSoundPath: eventSettings.alertSoundPath || '',
      softSoundPath: eventSettings.softSoundPath || '',
      watchList: typeof window.getWatchListData === 'function' ? window.getWatchListData() : []
    };

    try {
      if (!window.electronAPI || !window.electronAPI.saveSettings) {
        throw new Error('electronAPI.saveSettings is not available.');
      }
      await window.electronAPI.saveSettings(settings);
      if (saveState) {
        saveState.textContent = 'Saved!';
        setTimeout(() => { saveState.textContent = ''; }, 2000);
      }
      if (typeof window.appendDebug === 'function') {
        window.appendDebug('INFO', 'Settings saved successfully');
      }
    } catch (err) {
      if (saveState) saveState.textContent = 'Error!';
      if (typeof window.appendDebug === 'function') {
        window.appendDebug('ERROR', `Failed to save settings: ${err.message}`);
      }
    }
  });
}