// src/renderer/ui-settings.js
const settingsForm = document.getElementById('settings-form');
const logPathInput = document.getElementById('log-path');
const proximityInput = document.getElementById('proximity-range');
const channelsInput = document.getElementById('intel-channels');
const soundCheckbox = document.getElementById('sound-enabled');
const notificationCheckbox = document.getElementById('notification-enabled');

window.loadSettings = (settings) => {
  if (!settings) return;
  logPathInput.value = settings.logPath || '';
  proximityInput.value = settings.proximityRange || 5;
  channelsInput.value = settings.intelChannels || '';
  soundCheckbox.checked = settings.soundEnabled !== false;
  notificationCheckbox.checked = settings.notificationEnabled !== false;
  
  if (settings.watchList) {
    window.renderWatchList(settings.watchList);
  }
};

settingsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const settings = {
    logPath: logPathInput.value,
    proximityRange: parseInt(proximityInput.value) || 5,
    intelChannels: channelsInput.value,
    soundEnabled: soundCheckbox.checked,
    notificationEnabled: notificationCheckbox.checked,
    watchList: window.getWatchListData()
  };
  
  try {
    await window.electronAPI.saveSettings(settings);
    appendDebug('INFO', 'Settings saved successfully');
  } catch (err) {
    appendDebug('ERROR', `Failed to save settings: ${err.message}`);
  }
});