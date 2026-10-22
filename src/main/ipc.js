// # FILE: src/main/ipc.js
// # VERSION: 14
// MIL ipc v14 - `export-logs`: copies non-alerts.log and unverified-pilots.log
// from userData into a timestamped folder under the user's Documents.
// MIL ipc v13 - updater IPC (changelog, status, download, dismiss) and a
// live re-apply when `autoInstallUpdates` is saved.

const { ipcMain, app, dialog, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { SETTINGS_VERSION } = require('./config');
const { GROUPS } = require('./intel/groups');
const updater = require('./updater');

function registerIpc(configApi, engine, log, localMonitor, appUpdater) {
  const live = appUpdater || updater;
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

  ipcMain.handle('get-map-layout', (_e, kind) => (engine.getMapLayout ? engine.getMapLayout(kind) : { ok: false, error: 'unavailable' }));

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
    // Apply the merged, normalised config - not the payload the renderer sent,
    // which may be partial and would otherwise drop keys the engine holds.
    if (engine.applyConfig) engine.applyConfig(configApi.getConfig());
    log.info('Config saved');
    return { ok: true };
  });

  // The single stored settings object *is* the live config, and save-settings
  // writes it. Reading a second file here is what let a stale settings.json
  // shadow every save and made settings appear not to persist (see
  // src/main/config.js for the single-store rule).
  ipcMain.handle('get-settings', async () => configApi.getConfig() || {});

  ipcMain.handle('save-settings', async (_, settings) => {
    try {
      settings.settingsVersion = SETTINGS_VERSION;
      // One writer, one write. updateConfig -> saveConfig already persists this
      // object through the same defaults normalisation every other path uses.
      // Writing the file here as well raced that write and, because it skipped
      // normalisation, could leave the on-disk gates disagreeing with the live
      // config - which is what made the Intel Map read as disabled while
      // settings.json still said enabled.
      configApi.updateConfig(settings);
      // Same rule as save-config: the engine reads the merged config, never the
      // raw payload - a partial form would otherwise look like a switch-off.
      if (engine.applyConfig) engine.applyConfig(configApi.getConfig());
      // Re-apply the update mode straight away: switching it on while an update
      // is already waiting must raise the dialog now, not at the next poll.
      if (typeof settings.autoInstallUpdates === 'boolean') live.applyAutoInstallSetting();
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

  // --- export diagnostics ---------------------------------------------------
  // Copy the non-alert log and the unverified-pilot log into Documents so the
  // user can hand them over. A timestamped folder keeps repeat exports from
  // overwriting each other. Both files live beside pilots.json in userData.
  const documentsCandidates = () => {
    const docs = [];
    try { docs.push(app.getPath('documents')); } catch (_) { /* not ready */ }
    if (process.env.OneDrive) docs.push(path.join(process.env.OneDrive, 'Documents'));
    if (process.env.OneDriveDocuments) docs.push(process.env.OneDriveDocuments);
    if (process.env.USERPROFILE) docs.push(path.join(process.env.USERPROFILE, 'Documents'));
    return [...new Set(docs.filter(Boolean))];
  };

  const documentsDir = () => {
    for (const d of documentsCandidates()) {
      try {
        if (fs.existsSync(d)) return d;
      } catch (_) { /* try the next candidate */ }
    }
    try { return app.getPath('documents'); } catch (_) { return null; }
  };

  ipcMain.handle('export-logs', () => {
    try {
      const docs = documentsDir();
      if (!docs) return { ok: false, error: 'Could not find your Documents folder' };
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      let dir = path.join(docs, `MRCHI Intel Logs ${stamp}`);
      // A second export inside the same second must not reuse the folder.
      for (let n = 2; fs.existsSync(dir); n++) {
        dir = path.join(docs, `MRCHI Intel Logs ${stamp} (${n})`);
      }
      fs.mkdirSync(dir, { recursive: true });

      const source = path.dirname(path.join(app.getPath('userData'), 'pilots.json'));
      const wanted = [
        { name: 'non-alerts.log', file: 'non-alerts.log' },
        { name: 'unverified-pilots.log', file: 'unverified-pilots.log' },
      ];
      const written = [];
      for (const w of wanted) {
        const from = path.join(source, w.file);
        const to = path.join(dir, w.name);
        // A log that was never written still gets an empty file, so the export
        // always contains both and it is obvious which one had nothing.
        if (fs.existsSync(from)) fs.copyFileSync(from, to);
        else fs.writeFileSync(to, '');
        written.push(w.name);
      }
      log.info(`Exported logs to ${dir}`);
      return { ok: true, dir, files: written };
    } catch (err) {
      log.error(`Export logs failed: ${err.message}`);
      return { ok: false, error: err.message };
    }
  });

  // --- local monitor -------------------------------------------------------
  // The IPC surface is registered unconditionally but resolves the module on
  // every call. Gating has to work this way round: a monitor enabled after
  // launch must still be reachable, and one that is off has to report itself as
  // absent instead of leaving handlers bound to nothing.
  const getMonitor = () => (typeof localMonitor === 'function' ? localMonitor() : localMonitor);
  const gated = (name) => ({ ok: false, error: `Local Monitor is disabled (${name})` });
  const guarded = (name, fn) => ipcMain.handle(name, async (_e, ...args) => {
    const monitor = getMonitor();
    if (!monitor) return gated(name);
    try {
      return await fn(monitor, ...args);
    } catch (err) {
      log.error(`local monitor ${name} failed: ${err.message}`);
      return { ok: false, error: err.message };
    }
  });

  guarded('local-monitor-status', (m) => m.status());
  guarded('local-monitor-start', (m) => m.start());
  guarded('local-monitor-stop', (m) => {
    m.stop();
    return { ok: true };
  });
  // opts carries the renderer's "show boxes" toggle alongside the area id.
  guarded('local-monitor-preview', (m, area, opts) => m.preview(area, opts));
  guarded('local-monitor-snapshot', (m, area) => m.snapshot(area));
  guarded('local-monitor-test-alarm', (m) => m.testAlarm());
  guarded('pick-local-area', (m, area) => m.pickArea(area));

  // Fire-and-forget from the transparent region picker overlay.
  ipcMain.on('local-monitor-overlay-rect', (_e, rect) => {
    const monitor = getMonitor();
    if (monitor) monitor.resolveOverlayDrag(rect);
  });
  ipcMain.on('local-monitor-overlay-cancel', () => {
    const monitor = getMonitor();
    if (monitor) monitor.resolveOverlay(null);
  });

  // Fire-and-forget from the 1:1 preview popouts. These are tracked by window
  // rather than by module, so they keep working whatever the gate says.
  ipcMain.on('local-monitor-preview-close', (e) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.webContents && win.webContents.id === e.sender.id && !win.isDestroyed()) {
        win.close();
        return;
      }
    }
  });
  ipcMain.on('local-monitor-preview-report', (e, info) => {
    if (!info || typeof info !== 'object' || typeof info.width !== 'number') return;
    // The popout painted the capture; if the window it lives in is not the
    // same size, the image is being clipped or padded and the counts on screen
    // are not trustworthy. Say so rather than let it pass.
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win || win.isDestroyed()) return;
    const monitor = getMonitor();
    if (!monitor) return;
    const [w, h] = win.getContentSize();
    if (w !== info.width || h !== info.height) {
      monitor.log.warn(
        `[LocalMonitor] preview window is ${w}x${h} but the capture is ${info.width}x${info.height} - image is clipped`,
      );
    }
  });

  // --- updater --------------------------------------------------------------
  ipcMain.handle('updater:status', () => live.getUpdaterStatus());
  ipcMain.handle('updater:get-changelog', () => live.getChangelog());
  ipcMain.handle('updater:close-changelog', () => live.closeChangelog());
  ipcMain.handle('updater:fireNow', () => live.fireUpdaterNow());
  ipcMain.handle('updater:download', () => live.downloadUpdate());
  ipcMain.handle('updater:dismiss', () => live.dismissUpdate());
}

module.exports = { registerIpc };
