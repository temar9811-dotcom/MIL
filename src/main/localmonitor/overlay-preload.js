// # FILE: src/main/localmonitor/overlay-preload.js
// # VERSION: 1
// Preload for the transparent region picker (src/renderer/overlay.html).
// Deliberately narrow: the overlay window only reports a finished drag or a
// cancel, and never touches the main window's API surface.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  setOverlayRect: (rect) => ipcRenderer.send('local-monitor-overlay-rect', rect),
  cancelOverlay: () => ipcRenderer.send('local-monitor-overlay-cancel'),
});
