// # FILE: src/main/tray.js
// # VERSION: 1
// MIL tray v1 - system tray icon and context menu
const { Tray, Menu, app } = require('electron');
const path = require('path');

class TrayManager {
  constructor(log, mainWindowGetter) {
    this.log = log;
    this.getMainWindow = mainWindowGetter;
    this.tray = null;
  }

  create() {
    if (this.tray) return;
    const iconPath = path.join(__dirname, '..', '..', 'assets', 'tray.png');
    this.tray = new Tray(iconPath);
    this.tray.setToolTip('MRCHI Intel Lite');

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Show MRCHI Intel Lite',
        click: () => {
          const win = this.getMainWindow();
          if (win) {
            win.show();
            win.focus();
          }
        }
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => app.quit()
      }
    ]);

    this.tray.setContextMenu(contextMenu);

    // Click tray icon to toggle window visibility
    this.tray.on('click', () => {
      const win = this.getMainWindow();
      if (win) {
        if (win.isVisible()) win.hide();
        else { win.show(); win.focus(); }
      }
    });

    this.log.info('System tray initialized');
  }

  destroy() {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}

module.exports = { TrayManager };