const { app, BrowserWindow } = require('electron');
const path = require('path');
const { DebugLog } = require('./debug');
const { loadConfig, saveConfig } = require('./config');
const { registerIpc } = require('./ipc');
const { Engine } = require('./engine');

const DEBUG = process.env.DEBUG === '1';
const log = new DebugLog(DEBUG);
let mainWindow = null;
let config = null;
let engine = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 750,
    title: 'MRCHI Intel Lite',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
  log.info('Window created');
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

  engine.onAlert = (alert) => {
    if (mainWindow) mainWindow.webContents.send('alert', alert);
  };

  log.onLog((level, msg, ts) => {
    if (mainWindow) mainWindow.webContents.send('engine-log', `[${level}] ${msg}`);
  });

  createWindow();
  sendEngineState({ state: 'starting' });

  try {
    engine.start(config);
    sendEngineState({ state: engine.isRunning() ? 'running' : 'stopped' });
  } catch (err) {
    log.error(`Engine start failed: ${err.message}`);
    sendEngineState({ state: 'stopped' });
  }
});

app.on('window-all-closed', () => {
  if (engine) engine.stop();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});