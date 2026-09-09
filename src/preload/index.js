// # FILE: src/preload/index.js
// # VERSION: 14

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getState: () => ipcRenderer.invoke('get-state'),
  getGroups: () => ipcRenderer.invoke('get-groups'),
  getPyramid: () => ipcRenderer.invoke('get-pyramid'),
  setPyramid: (on) => ipcRenderer.invoke('set-pyramid', on),
  openPyramid: () => ipcRenderer.invoke('open-pyramid'),
  setPyramidTop: (on) => ipcRenderer.invoke('set-pyramid-top', on),
  resizePyramid: (size) => ipcRenderer.invoke('resize-pyramid', size),
  clearPyramid: () => ipcRenderer.invoke('clear-pyramid'),
  setPyramidCenter: (name) => ipcRenderer.invoke('set-pyramid-center', name),
  getCharacters: () => ipcRenderer.invoke('get-characters'),
  getSystemsAdjacency: () => ipcRenderer.invoke('get-systems-adjacency'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  browseFolder: () => ipcRenderer.invoke('browse-folder'),
  browseWav: () => ipcRenderer.invoke('browse-wav'),
  popoutAlerts: () => ipcRenderer.invoke('popout-alerts'),
  clearAlerts: () => ipcRenderer.invoke('clear-alerts'),
  setAlwaysOnTop: (on) => ipcRenderer.invoke('set-always-on-top'),
  processZkillKill: (kill) => ipcRenderer.invoke('process-zkill-kill', kill),
  onAlert: (cb) => ipcRenderer.on('alert', (event, data) => cb(data)),
  onAlertsCleared: (cb) => ipcRenderer.on('alerts-cleared', () => cb()),
  onEngineLog: (cb) => ipcRenderer.on('engine-log', (event, line) => cb(line)),
  onDebugLog: (cb) => ipcRenderer.on('engine-log', (event, line) => cb(line)),
  onEngineState: (cb) => ipcRenderer.on('engine-state', (event, data) => cb(data)),
  toggleDebug: (on) => ipcRenderer.invoke('toggle-debug', on),
});