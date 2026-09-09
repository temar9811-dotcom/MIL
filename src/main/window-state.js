// # FILE: src/main/window-state.js
// # VERSION: 1
// MIL window-state v1 - handles window position and size persistence
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class WindowStateManager {
  constructor() {
    this.statePath = path.join(app.getPath('userData'), 'window-state.json');
    this.saveTimer = null;
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
      if (raw && typeof raw.width === 'number' && typeof raw.height === 'number') return raw;
    } catch (_) { /* first run */ }
    return null;
  }

  scheduleSave(mainWindow) {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save(mainWindow);
    }, 500);
  }

  save(mainWindow) {
    if (!mainWindow) return;
    try {
      const b = mainWindow.getBounds();
      const state = {
        x: b.x, y: b.y, width: b.width, height: b.height,
        isMaximized: mainWindow.isMaximized(),
      };
      fs.writeFileSync(this.statePath, JSON.stringify(state));
    } catch (_) { /* never crash on saving */ }
  }
}

module.exports = { WindowStateManager };