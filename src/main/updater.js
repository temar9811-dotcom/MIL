// src/main/updater.js
const { app, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');

class AppUpdater {
  constructor(log) {
    this.log = log;
    this.isDev = !app.isPackaged;

    // Configure autoUpdater
    autoUpdater.logger = this.log;
    autoUpdater.autoDownload = true; // Download silently in the background
    autoUpdater.autoInstallOnAppQuit = true; // Install automatically when the app quits

    // Only check for updates in production (packaged app)
    if (this.isDev) {
      this.log.info('Auto-updater disabled in development mode.');
      return;
    }

    this.setupListeners();
  }

  setupListeners() {
    autoUpdater.on('checking-for-update', () => {
      this.log.info('Checking for update...');
    });

    autoUpdater.on('update-available', (info) => {
      this.log.info(`Update available: v${info.version}`);
    });

    autoUpdater.on('update-not-available', (info) => {
      this.log.info('Update not available.');
    });

    autoUpdater.on('error', (err) => {
      this.log.error(`Error in auto-updater: ${err.message}`);
    });

    autoUpdater.on('download-progress', (progressObj) => {
      const logMessage = `Download speed: ${progressObj.bytesPerSecond} - Downloaded ${progressObj.percent}%`;
      this.log.info(logMessage);
    });

    autoUpdater.on('update-downloaded', (info) => {
      this.log.info(`Update downloaded: v${info.version}`);
      
      // Prompt the user to restart
      const dialogOpts = {
        type: 'info',
        buttons: ['Restart', 'Later'],
        title: 'Application Update',
        message: process.platform === 'win32' ? info.releaseNotes : info.releaseName,
        detail: `A new version (v${info.version}) has been downloaded. Restart the application to apply the updates.`
      };

      dialog.showMessageBox(dialogOpts).then((returnValue) => {
        if (returnValue.response === 0) {
          autoUpdater.quitAndInstall();
        }
      });
    });
  }

  checkForUpdates() {
    if (!this.isDev) {
      this.log.info('Triggering manual update check...');
      autoUpdater.checkForUpdates().catch(err => {
        this.log.error(`Update check failed: ${err.message}`);
      });
    }
  }
}

module.exports = { AppUpdater };