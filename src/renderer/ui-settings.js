// src/renderer/ui-settings.js
const settingsForm = document.getElementById('settings-form');
const logPathInput = document.getElementById('log-path');
const proximityInput = document.getElementById('proximity-range');
const channelsInput = document.getElementById('intel-channels');
const soundCheckbox = document.getElementById('sound-enabled');
const notificationCheckbox = document.getElementById('notification-enabled');
const saveState = document.getElementById('save-state');

window.loadSettings = (settings) => {
  if (!settings) return;
  if (logPathInput) logPathInput.value = settings.logPath || '';
  if (proximityInput) proximityInput.value = settings.proximityRange ?? 2;
  if (channelsInput) channelsInput.value = settings.intelChannels || '';
  if (soundCheckbox) soundCheckbox.checked = settings.soundEnabled !== false;
  if (notificationCheckbox) notificationCheckbox.checked = settings.notificationEnabled !== false;
  
  if (settings.watchList && typeof window.renderWatchList === 'function') {
    window.renderWatchList(settings.watchList);
  }
};

if (settingsForm) {
  settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (saveState) saveState.textContent = 'Saving...';
    
    const settings = {
      logPath: logPathInput ? logPathInput.value : '',
      proximityRange: proximityInput ? parseInt(proximityInput.value) || 2 : 2,
      intelChannels: channelsInput ? channelsInput.value : '',
      soundEnabled: soundCheckbox ? soundCheckbox.checked : true,
      notificationEnabled: notificationCheckbox ? notificationCheckbox.checked : true,
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