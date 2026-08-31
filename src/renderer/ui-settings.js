// MIL ui-settings v6 - bigger text toggle
const settingsForm = document.getElementById('settings-form');
const logPathInput = document.getElementById('log-path') || document.getElementById('logs-dir');
const proximityInput = document.getElementById('proximity-range');
const channelsInput = document.getElementById('intel-channels') || document.getElementById('channels');
const soundCheckbox = document.getElementById('sound-enabled') || document.getElementById('sound');
const notificationCheckbox = document.getElementById('notification-enabled') || document.getElementById('notifications');
const saveState = document.getElementById('save-state');
const browseBtn = document.getElementById('browse-logs');
const imperiumBtn = document.getElementById('imperium-intel');
const bigTextCheckbox = document.getElementById('big-text');

const volumeRedInput = document.getElementById('volume-red');
const volumeRedLabel = document.getElementById('volume-red-label');
const volumeSoftInput = document.getElementById('volume-soft');
const volumeSoftLabel = document.getElementById('volume-soft-label');
const alertSoundInput = document.getElementById('alert-sound-path');
const softSoundInput = document.getElementById('soft-sound-path');
const browseAlertSound = document.getElementById('browse-alert-sound');
const browseSoftSound = document.getElementById('browse-soft-sound');

const IMPERIUM_INTEL = [
  'fareast.imperium',
  'east.imperium',
  'west.imperium',
  'southeast.imperium',
  'gem.imperium',
];

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

function updateVolumeLabels() {
  if (volumeRedLabel && volumeRedInput) volumeRedLabel.textContent = `${volumeRedInput.value}%`;
  if (volumeSoftLabel && volumeSoftInput) volumeSoftLabel.textContent = `${volumeSoftInput.value}%`;
}

window.loadSettings = (settings) => {
  if (!settings) return;
  if (logPathInput) logPathInput.value = settings.logPath || '';
  if (proximityInput) proximityInput.value = settings.proximityRange ?? 2;
  if (channelsInput) channelsInput.value = settings.intelChannels || '';
  if (soundCheckbox) soundCheckbox.checked = settings.soundEnabled !== false && settings.sound !== false;
  if (notificationCheckbox) notificationCheckbox.checked = settings.notificationEnabled !== false && settings.notifications !== false;

  const legacy = settings.volume == null ? 50 : settings.volume;
  if (volumeRedInput) volumeRedInput.value = settings.volumeRed == null ? legacy : settings.volumeRed;
  if (volumeSoftInput) volumeSoftInput.value = settings.volumeSoft == null ? legacy : settings.volumeSoft;
  updateVolumeLabels();

  if (alertSoundInput) alertSoundInput.value = settings.alertSoundPath || '';
  if (softSoundInput) softSoundInput.value = settings.softSoundPath || '';

  applyBigText(settings.bigText === true);

  if (settings.watchList && typeof window.renderWatchList === 'function') {
    window.renderWatchList(settings.watchList);
  }
};

if (volumeRedInput) volumeRedInput.addEventListener('input', updateVolumeLabels);
if (volumeSoftInput) volumeSoftInput.addEventListener('input', updateVolumeLabels);

if (browseAlertSound && alertSoundInput) {
  browseAlertSound.addEventListener('click', async () => {
    if (!window.electronAPI || !window.electronAPI.browseWav) return;
    const file = await window.electronAPI.browseWav();
    if (file) alertSoundInput.value = file;
  });
}

if (browseSoftSound && softSoundInput) {
  browseSoftSound.addEventListener('click', async () => {
    if (!window.electronAPI || !window.electronAPI.browseWav) return;
    const file = await window.electronAPI.browseWav();
    if (file) softSoundInput.value = file;
  });
}

if (imperiumBtn && channelsInput) {
  imperiumBtn.addEventListener('click', () => {
    const current = String(channelsInput.value || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const seen = new Set(current.map((s) => s.toLowerCase()));
    for (const ch of IMPERIUM_INTEL) {
      if (!seen.has(ch.toLowerCase())) {
        current.push(ch);
        seen.add(ch.toLowerCase());
      }
    }
    channelsInput.value = current.join(', ');
    if (typeof window.appendDebug === 'function') {
      window.appendDebug('INFO', 'Imperium Intel channels added - remember to Save');
    }
  });
}

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

    const settings = {
      logPath: logPathInput ? logPathInput.value : '',
      proximityRange: proximityInput ? parseInt(proximityInput.value) || 2 : 2,
      intelChannels: channelsInput ? channelsInput.value : '',
      soundEnabled: soundOn,
      notificationEnabled: notifOn,
      sound: soundOn,
      notifications: notifOn,
      volumeRed: volumeRedInput ? parseInt(volumeRedInput.value) || 0 : 50,
      volumeSoft: volumeSoftInput ? parseInt(volumeSoftInput.value) || 0 : 50,
      volume: volumeRedInput ? parseInt(volumeRedInput.value) || 0 : 50,
      alertSoundPath: alertSoundInput ? alertSoundInput.value.trim() : '',
      softSoundPath: softSoundInput ? softSoundInput.value.trim() : '',
      bigText: bigTextCheckbox ? bigTextCheckbox.checked : false,
      watchList: typeof window.getWatchListData === 'function' ? window.getWatchListData() : []
    };

    try {
      if (!window.electronAPI || !window.electronAPI.saveSettings) {
        throw new Error('electronAPI.saveSettings is not available. Check preload script.');
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