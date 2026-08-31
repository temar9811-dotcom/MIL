// MIL preload v6 - adds browseWav
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getState: () => ipcRenderer.invoke('get-state'),
  getCharacters: () => ipcRenderer.invoke('get-characters'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  browseFolder: () => ipcRenderer.invoke('browse-folder'),
  browseWav: () => ipcRenderer.invoke('browse-wav'),
  popoutAlerts: () => ipcRenderer.invoke('popout-alerts'),
  setAlwaysOnTop: (on) => ipcRenderer.invoke('set-always-on-top'),
  onAlert: (cb) => ipcRenderer.on('alert', (event, data) => cb(data)),
  onEngineLog: (cb) => ipcRenderer.on('engine-log', (event, line) => cb(line)),
  onDebugLog: (cb) => ipcRenderer.on('engine-log', (event, line) => cb(line)),
  onEngineState: (cb) => ipcRenderer.on('engine-state', (event, data) => cb(data)),
  toggleDebug: (on) => ipcRenderer.invoke('toggle-debug', on),
});