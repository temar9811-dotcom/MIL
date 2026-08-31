// MIL preload v3 - adds getCharacters
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getState: () => ipcRenderer.invoke('get-state'),
  getCharacters: () => ipcRenderer.invoke('get-characters'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  browseFolder: () => ipcRenderer.invoke('browse-folder'),
  onAlert: (cb) => ipcRenderer.on('alert', (event, data) => cb(data)),
  onEngineLog: (cb) => ipcRenderer.on('engine-log', (event, line) => cb(line)),
  onDebugLog: (cb) => ipcRenderer.on('engine-log', (event, line) => cb(line)),
  onEngineState: (cb) => ipcRenderer.on('engine-state', (event, data) => cb(data)),
  toggleDebug: (on) => ipcRenderer.invoke('toggle-debug', on),
});