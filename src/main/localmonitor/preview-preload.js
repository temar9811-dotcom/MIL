// # FILE: src/main/localmonitor/preview-preload.js
// # VERSION: 1
// Preload for the 1:1 preview popout (src/renderer/preview.html).
// Deliberately narrow, like the overlay's: the popout paints pixels and
// reports its own size, and can ask to be closed. It never sees the main
// window's API surface or the settings store.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onRender: (fn) => ipcRenderer.on('local-monitor-preview-render', (_e, payload) => fn(payload)),
  close: () => ipcRenderer.send('local-monitor-preview-close'),
  // Either a {width, height, count} report or an error string.
  report: (info) => ipcRenderer.send('local-monitor-preview-report', info),
});
