// # FILE: src/main/ipc.js
// # VERSION: 9

const { ipcMain, app, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { SETTINGS_VERSION } = require('./config');
const { GROUPS } = require('./intel/groups');
const { pickRegion } = require('./localmonitor/overlay');

function registerIpc(configApi, engine, log, localMonitor) {
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

  ipcMain.handle('get-systems-adjacency', () => {
    try {
      const sysPath = path.join(app.getAppPath(), 'resources', 'data', 'systems.json');
      const raw = JSON.parse(fs.readFileSync(sysPath, 'utf8'));
      return raw.systems || raw;
    } catch (err) {
      log.error(`Failed to load systems adjacency: ${err.message}`);
      return {};
    }
  });

  ipcMain.handle('process-zkill-kill', async (event, killData) => {
    try {
      if (engine.processZkillKill) {
        engine.processZkillKill(killData);
      }
      return { ok: true };
    } catch (err) {
      log.error(`Zkill kill processing failed: ${err.message}`);
      return { ok: false, error: err.message };
    }
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

  if (localMonitor) {
    ipcMain.handle('local-monitor-start', () => localMonitor.start());

    ipcMain.handle('local-monitor-stop', () => {
      localMonitor.stop();
      return { ok: true };
    });

    ipcMain.handle('local-monitor-status', () => localMonitor.status());

    ipcMain.handle('local-monitor-preview', (_, areaIndex) => {
      const index = areaIndex === 2 ? 2 : 1;
      return localMonitor.preview(index);
    });

    ipcMain.handle('test-local-alarm', () => localMonitor.testAlarm());

    ipcMain.handle('pick-local-area', async (_, areaIndex) => {
      const key = `localArea${areaIndex === 2 ? 2 : 1}`;
      const result = await pickRegion();
      if (!result.ok) {
        const out = { ok: false, canceled: true };
        if (result.reason) out.reason = result.reason;
        return out;
      }
      try {
        let settings;
        try {
          settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        } catch (_) {
          settings = { ...configApi.getConfig() };
        }
        const area = { enabled: true, x: result.x, y: result.y, x2: result.x2, y2: result.y2 };
        settings[key] = area;
        settings.settingsVersion = SETTINGS_VERSION;
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
        configApi.updateConfig(settings);
        if (engine.applyConfig) engine.applyConfig(settings);
        if (localMonitor.emitStatus) localMonitor.emitStatus();
        log.info(`Local monitor: ${key} set to ${JSON.stringify(area)}`);
        return { ok: true, areaIndex: areaIndex === 2 ? 2 : 1, area };
      } catch (err) {
        log.error(`Failed to save local area: ${err.message}`);
        return { ok: false, canceled: false, error: err.message };
      }
    });
  }
}

module.exports = { registerIpc };