// MIL ipc v8 - pyramid get/set handlers
const { ipcMain, app, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { SETTINGS_VERSION } = require('./config');
const { GROUPS } = require('./intel/groups');

function registerIpc(configApi, engine, log) {
  const settingsPath = path.join(app.getPath('userData'), 'settings.json');

  ipcMain.handle('get-state', () => ({
    config: configApi.getConfig(),
    recents: engine.getRecentAlerts ? engine.getRecentAlerts() : [],
    running: engine.isRunning(),
    version: app.getVersion(),
  }));

  ipcMain.handle('get-groups', () => GROUPS.map((g) => ({
    id: g.id,
    label: g.label,
    color: g.color,
  })));

  ipcMain.handle('get-pyramid', () => (engine.getPyramid ? engine.getPyramid() : { enabled: false }));

  ipcMain.handle('set-pyramid', (_, on) => {
    if (engine.setPyramid) engine.setPyramid(!!on);
    return { ok: true, enabled: !!on };
  });

  ipcMain.handle('get-characters', () => {
    const list = engine.getCharacters ? engine.getCharacters() : [];
    return list.map((c) => ({
      name: c.name,
      system: c.system || null,
      online: !!c.online,
      lastSeen: c.lastSeen || null,
      channels: c.channels ? [...c.channels] : [],
    }));
  });

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
      settings.settingsVersion = SETTINGS_VERSION;
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

  ipcMain.handle('browse-folder', async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: 'Select EVE chat logs folder',
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      return result.filePaths[0];
    } catch (err) {
      log.error(`Browse folder failed: ${err.message}`);
      return null;
    }
  });

  ipcMain.handle('browse-wav', async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        title: 'Select alert sound',
        filters: [{ name: 'WAV audio', extensions: ['wav'] }],
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      return result.filePaths[0];
    } catch (err) {
      log.error(`Browse wav failed: ${err.message}`);
      return null;
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