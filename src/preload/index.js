// # FILE: src/preload/index.js
// # VERSION: 20
// preload v20 - the alerts pop-out's transparency toggle, plus the fix that
// lets `setAlwaysOnTop` actually pass its argument through (v19 dropped it).
// preload v19 - updater surface: status polling, download/dismiss/fire-now,
// changelog fetch and close, and the push listeners that drive the dialog.

const { contextBridge, ipcRenderer } = require('electron');

// Set by the main process via webPreferences.additionalArguments only when the
// app is running from source. Dev-only settings hang off this flag.
const isDev = process.argv.includes('--is-dev');

contextBridge.exposeInMainWorld('electronAPI', {
  isDev,
  getState: () => ipcRenderer.invoke('get-state'),
  getGroups: () => ipcRenderer.invoke('get-groups'),
  getPyramid: () => ipcRenderer.invoke('get-pyramid'),
  getMapLayout: (map) => ipcRenderer.invoke('get-map-layout', map),
  setPyramid: (on) => ipcRenderer.invoke('set-pyramid', on),
  openPyramid: () => ipcRenderer.invoke('open-pyramid'),
  // The Intel Map pop-out claims/releases the work so the tab can stop
  // refreshing while it is open.
  intelMapPopout: (on) => ipcRenderer.invoke('intel-map-popout', on),
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
  setAlwaysOnTop: (on) => ipcRenderer.invoke('set-always-on-top', on),
  setAlertsTransparent: (on) => ipcRenderer.invoke('set-alerts-transparent', on),
  onAlertsTransparent: (cb) => ipcRenderer.on('alerts-transparent', (event, on) => cb(on)),
  processZkillKill: (kill) => ipcRenderer.invoke('process-zkill-kill', kill),
  localMonitorStatus: () => ipcRenderer.invoke('local-monitor-status'),
  localMonitorStart: () => ipcRenderer.invoke('local-monitor-start'),
  localMonitorStop: () => ipcRenderer.invoke('local-monitor-stop'),
  localMonitorPreview: (area, opts) => ipcRenderer.invoke('local-monitor-preview', area, opts),
  saveLocalSnapshot: (area) => ipcRenderer.invoke('local-monitor-snapshot', area),
  testLocalAlarm: () => ipcRenderer.invoke('local-monitor-test-alarm'),
  pickLocalArea: (area) => ipcRenderer.invoke('pick-local-area', area),
  onLocalMonitorStatus: (cb) => ipcRenderer.on('local-monitor-status', (event, data) => cb(data)),
  onAlert: (cb) => ipcRenderer.on('alert', (event, data) => cb(data)),
  onAlertUpdated: (cb) => ipcRenderer.on('alert-updated', (event, data) => cb(data)),
  onAlertsCleared: (cb) => ipcRenderer.on('alerts-cleared', () => cb()),
  onEngineLog: (cb) => ipcRenderer.on('engine-log', (event, line) => cb(line)),
  onDebugLog: (cb) => ipcRenderer.on('engine-log', (event, line) => cb(line)),
  onEngineState: (cb) => ipcRenderer.on('engine-state', (event, data) => cb(data)),
  onIntelMapPopout: (cb) => ipcRenderer.on('intel-map-popout', (event, open) => cb(open)),
  toggleDebug: (on) => ipcRenderer.invoke('toggle-debug', on),
  // --- updater -------------------------------------------------------------
  getUpdaterStatus: () => ipcRenderer.invoke('updater:status'),
  fireUpdaterNow: () => ipcRenderer.invoke('updater:fireNow'),
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  dismissUpdate: () => ipcRenderer.invoke('updater:dismiss'),
  getChangelog: () => ipcRenderer.invoke('updater:get-changelog'),
  closeChangelog: () => ipcRenderer.invoke('updater:close-changelog'),
  onUpdateAvailable: (cb) => ipcRenderer.on('updater:available', (event, data) => cb(data)),
  onUpdateStatus: (cb) => ipcRenderer.on('updater:status', (event, data) => cb(data)),
  onShowChangelog: (cb) => ipcRenderer.on('updater:show-changelog', (event, data) => cb(data)),
});