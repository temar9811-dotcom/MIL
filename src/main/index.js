// # FILE: src/main/index.js
// # VERSION: 16
// MIL main v16 - debug logger always enabled + branding & tray
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { DebugLog } = require('./debug');
const { loadConfig, saveConfig, SETTINGS_VERSION, SETTINGS_DEFAULTS } = require('./config');
const { registerIpc } = require('./ipc');
const { Engine } = require('./engine');
const { AppUpdater } = require('./updater');
const { TrayManager } = require('./tray');

// Always enable debug logging
const log = new DebugLog(true);

let mainWindow = null;
let alertsWindow = null;
let intelWindow = null;
let config = null;
let engine = null;
let saveTimer = null;
let appUpdater = null;
let trayManager = null;

function windowStatePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function migrateSettings() {
  let src = null;
  try { src = JSON.parse(fs.readFileSync(settingsPath(), 'utf8')); } catch (_) { src = null; }
  if (!src || typeof src !== 'object') src = {};

  const out = {};
  for (const [key, def] of Object.entries(SETTINGS_DEFAULTS)) {
    out[key] = (key in src) ? src[key] : def;
  }
  out.settingsVersion = SETTINGS_VERSION;

  const added = Object.keys(SETTINGS_DEFAULTS).filter((k) => !(k in src));
  const removed = Object.keys(src).filter((k) => !(k in SETTINGS_DEFAULTS));
  const versionChanged = src.settingsVersion !== SETTINGS_VERSION;

  if (added.length || removed.length || versionChanged) {
    try {
      fs.writeFileSync(settingsPath(), JSON.stringify(out, null, 2));
      log.info(
        `Settings migrated to v${SETTINGS_VERSION}` +
        `(added: ${added.join(', ') || 'none'}; removed: ${removed.join(', ') || 'none'})`,
      );
    } catch (err) {
      log.error(`Settings migration failed: ${err.message}`);
    }
  }
  return out;
}

function loadWindowState() {
  try {
    const raw = JSON.parse(fs.readFileSync(windowStatePath(), 'utf8'));
    if (raw && typeof raw.width === 'number' && typeof raw.height === 'number') return raw;
  } catch (_) { /* first run */ }
  return null;
}

function saveWindowState() {
  if (!mainWindow) return;
  try {
    const b = mainWindow.getBounds();
    const state = {
      x: b.x, y: b.y, width: b.width, height: b.height,
      isMaximized: mainWindow.isMaximized(),
    };
    fs.writeFileSync(windowStatePath(), JSON.stringify(state));
  } catch (_) { /* never crash on saving */ }
}

function scheduleSaveWindowState() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; saveWindowState(); }, 500);
}

function createWindow() {
  const state = loadWindowState();
  mainWindow = new BrowserWindow({
    width: state ? state.width : 1000,
    height: state ? state.height : 750,
    x: state ? state.x : undefined,
    y: state ? state.y : undefined,
    title: 'MRCHI Intel Lite',
    // App icon for taskbar and window
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (state && state.isMaximized) mainWindow.maximize();
  mainWindow.setAutoHideMenuBar(true);
  mainWindow.setMenuBarVisibility(false);

  mainWindow.on('move', scheduleSaveWindowState);
  mainWindow.on('resize', scheduleSaveWindowState);
  mainWindow.on('close', () => {
    saveWindowState();
    if (alertsWindow) alertsWindow.close();
    if (intelWindow) intelWindow.close();
  });
  mainWindow.on('closed', () => { mainWindow = null; });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  log.info('Window created');
}

function createAlertsWindow() {
  if (alertsWindow) {
    if (alertsWindow.isMinimized()) alertsWindow.restore();
    alertsWindow.focus();
    return;
  }
  alertsWindow = new BrowserWindow({
    width: 520,
    height: 640,
    title: 'MRCHI Alerts',
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  alertsWindow.setMenu(null);
  alertsWindow.loadFile(path.join(__dirname, '..', 'renderer', 'alerts.html'));
  alertsWindow.on('closed', () => { alertsWindow = null; });
  log.info('Alerts pop-out window opened');
}

function createIntelWindow() {
  if (intelWindow) {
    if (intelWindow.isMinimized()) intelWindow.restore();
    intelWindow.focus();
    return;
  }
  intelWindow = new BrowserWindow({
    width: 960,
    height: 720,
    title: 'MRCHI Intel Map',
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  intelWindow.setMenu(null);
  intelWindow.loadFile(path.join(__dirname, '..', 'renderer', 'pyramid.html'));
  intelWindow.on('closed', () => { intelWindow = null; });
  log.info('Intel Map pop-out window opened');
}

function sendEngineState(state) {
  if (mainWindow) mainWindow.webContents.send('engine-state', state);
}

app.whenReady().then(() => {
  log.setLogFile(path.join(app.getPath('userData'), 'debug.log'));
  log.info('App ready');

  config = loadConfig();
  config = { ...config, ...migrateSettings() };

  engine = new Engine(log);

  registerIpc(
    {
      getConfig: () => config,
      updateConfig: (c) => { config = c; saveConfig(c); },
    },
    engine,
    log,
  );

  ipcMain.handle('popout-alerts', () => {
    createAlertsWindow();
    return { ok: true };
  });

  ipcMain.handle('open-pyramid', () => {
    createIntelWindow();
    return { ok: true };
  });

  ipcMain.handle('set-always-on-top', (_, on) => {
    if (alertsWindow) alertsWindow.setAlwaysOnTop(!!on);
    return { ok: true };
  });

  ipcMain.handle('set-pyramid-top', (_, on) => {
    if (intelWindow) intelWindow.setAlwaysOnTop(!!on);
    return { ok: true };
  });

  ipcMain.handle('resize-pyramid', (_, size) => {
    if (!intelWindow || !size) return { ok: false };
    const { workArea } = screen.getPrimaryDisplay();
    const w = Math.max(480, Math.min(Math.round(size.w || 960) + 60, workArea.width - 20));
    const h = Math.max(360, Math.min(Math.round(size.h || 720) + 120, workArea.height - 20));
    intelWindow.setSize(w, h);
    return { ok: true };
  });

  ipcMain.handle('clear-pyramid', () => {
    if (engine.clearPyramid) engine.clearPyramid();
    return { ok: true };
  });

  ipcMain.handle('set-pyramid-center', (_, name) => {
    if (engine.setPyramidCenter) engine.setPyramidCenter(name || '');
    return { ok: true };
  });

  ipcMain.handle('clear-alerts', () => {
    if (engine.clearAlerts) engine.clearAlerts();
    if (mainWindow) mainWindow.webContents.send('alerts-cleared');
    if (alertsWindow) alertsWindow.webContents.send('alerts-cleared');
    return { ok: true };
  });

  engine.onAlert = (alert) => {
    if (mainWindow) mainWindow.webContents.send('alert', alert);
    if (alertsWindow) alertsWindow.webContents.send('alert', alert);
  };

  // Register log listener BEFORE creating window
  log.onLog((level, msg, ts) => {
    if (mainWindow) mainWindow.webContents.send('engine-log', `[${level}] ${msg}`);
  });

  createWindow();
  engine.start(config);
  sendEngineState({ running: engine.isRunning() });

  // Initialize system tray
  trayManager = new TrayManager(log, () => mainWindow);
  trayManager.create();

  // --- Auto-Updater Initialization ---
  appUpdater = new AppUpdater(log);
  appUpdater.checkForUpdates();
  setInterval(() => {
    appUpdater.checkForUpdates();
  }, 4 * 60 * 60 * 1000);
});

app.on('window-all-closed', () => {
  if (engine && engine.stop) engine.stop();
  if (trayManager) trayManager.destroy();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});