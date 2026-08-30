const { ipcMain, app } = require('electron');
const path = require('path');
const fs = require('fs');

function registerIpc(configApi, engine, log) {
  const settingsPath = path.join(app.getPath('userData'), 'settings.json');

  ipcMain.handle('get-state', () => ({
    config: configApi.getConfig(),
    recents: engine.getRecentAlerts ? engine.getRecentAlerts() : [],
    running: engine.isRunning(),
  }));

  ipcMain.handle('save-config', (_, newConfig) => {
    configApi.updateConfig(newConfig);
    if (engine.applyConfig) engine.applyConfig(newConfig);
    log.info('Config saved');
    return { ok: true };
  });

  ipcMain.handle('get-settings', async () => {
    try {
      if (fs.existsSync(settingsPath)) {
        return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      }
    } catch (err) {
      log.error(`Failed to load settings: ${err.message}`);
    }
    return configApi.getConfig() || {};
  });

  ipcMain.handle('save-settings', async (_, settings) => {
    try {
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      configApi.updateConfig(settings);
      if (engine.applyConfig) engine.applyConfig(settings);
      log.info('Settings saved to disk');
      return { ok: true };
    } catch (err) {
      log.error(`Failed to save settings: ${err.message}`);
      throw new Error(`Failed to save settings: ${err.message}`);
    }
  });

  ipcMain.handle('toggle-debug', (_, enabled) => {
    if (enabled) log.enable();
    else log.disable();
    log.info(`Debug toggled: ${enabled}`);
    return { debug: log.isEnabled() };
  });
}

module.exports = { registerIpc };