// MIL main v5 - collapsed menu bar (main) / no menu bar (pop-out)
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { DebugLog } = require('./debug');
const { loadConfig, saveConfig } = require('./config');
const { registerIpc } = require('./ipc');
const { Engine } = require('./engine');

const DEBUG = process.env.DEBUG === '1';
const log = new DebugLog(DEBUG);
let mainWindow = null;
let alertsWindow = null;
let config = null;
let engine = null;
let saveTimer = null;

function windowStatePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
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
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (state && state.isMaximized) mainWindow.maximize();

  // Collapse the menu bar: hidden by default, Alt still summons it
  mainWindow.setAutoHideMenuBar(true);
  mainWindow.setMenuBarVisibility(false);

  mainWindow.on('move', scheduleSaveWindowState);
  mainWindow.on('resize', scheduleSaveWindowState);
  mainWindow.on('close', saveWindowState);
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

  // No menu bar at all in the pop-out
  alertsWindow.setMenu(null);

  alertsWindow.loadFile(path.join(__dirname, '..', 'renderer', 'alerts.html'));
  alertsWindow.on('closed', () => { alertsWindow = null; });
  log.info('Alerts pop-out window opened');
}

function sendEngineState(state) {
  if (mainWindow) mainWindow.webContents.send('engine-state', state);
}

app.whenReady().then(() => {
  log.setLogFile(path.join(app.getPath('userData'), 'debug.log'));
  log.info('App ready');

  config = loadConfig();
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

  ipcMain.handle('set-always-on-top', (_, on) => {
    if (alertsWindow) alertsWindow.setAlwaysOnTop(!!on);
    return { ok: true };
  });

  engine.onAlert = (alert) => {
    if (mainWindow) mainWindow.webContents.send('alert', alert);
    if (alertsWindow) alertsWindow.webContents.send('alert', alert);
  };

  log.onLog((level, msg, ts) => {
    if (mainWindow) mainWindow.webContents.send('engine-log', `[${level}] ${msg}`);
  });

  createWindow();
  engine.start(config);
  sendEngineState({ running: engine.isRunning() });
});

app.on('window-all-closed', () => {
  if (engine && engine.stop) engine.stop();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});