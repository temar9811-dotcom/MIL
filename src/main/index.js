// # FILE: src/main/index.js
// # VERSION: 24
// MIL main v24 - the engine's non-alert log is cleared on every launch, so a
// restart always starts the diagnostic log from empty.
// MIL main v23 - the alerts pop-out gains a persisted transparency toggle
// (`set-alerts-transparent`), and `set-always-on-top` now honours the value it
// is sent - the preload had been dropping it, so that checkbox never worked.
// MIL main v22 - updater rewritten to the ESP model: hourly check, changelog
// popup, `autoInstallUpdates` on/off setting, dotted installer names, and an
// explicit pre-install shutdown so the engine never outlives the quit.
// MIL main v21 - one settings store (config.json); the old settings.json is
// imported once inside loadConfig() and no longer shadows saves at startup.
// MIL main v20 - module gates: map/zkill/local monitor are opt-in and their
// main-process code is only constructed when the user enables them. The log
// reader and the alert system are always loaded.
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { DebugLog } = require('./debug');
const { loadConfig, saveConfig, normalizeConfig } = require('./config');
const { registerIpc } = require('./ipc');
const { Engine } = require('./engine');
const updater = require('./updater');
const { TrayManager } = require('./tray');
const { AlertsBus } = require('./alerts-bus');
const { PilotResolver } = require('./intel/pilot-resolver');

// Always enable debug logging
const log = new DebugLog(true);

// The Local Monitor is a dev-only module. Outside a packaged build it must not
// come up at all, whatever the saved setting says, so every gate that could
// raise it is qualified with this rather than with the raw config key.
const IS_DEV = !app.isPackaged;

let mainWindow = null;
let alertsWindow = null;
let intelWindow = null;
let config = null;
let engine = null;
let saveTimer = null;
let trayManager = null;
let localMonitor = null;
let alertsBus = null;
let pilotResolver = null;

// --- module gates ----------------------------------------------------------
// Optional modules are not merely hidden when off: they are never required and
// never constructed. That is the whole point of the gate, so the cost of a
// module the user did not ask for is a config lookup, not a live object with
// timers and a template directory scan behind it.
function moduleEnabled(key) {
  return !!(config && config[key]);
}

// The local monitor is the one module with a main-process half that must exist
// for its UI to work at all, so it is built on first enable and torn down on
// disable. Requiring it lazily is deliberate: `require` at module scope would
// load its capture/vision code on every launch regardless of the gate.
function getLocalMonitor() {
  if (!localMonitor) {
    const { LocalMonitor } = require('./localmonitor');
    localMonitor = new LocalMonitor(log, {
      // The alert bus is the only thing it is given. It has no reference to the
      // engine, the map or zkill, and cannot acquire one.
      alerts: alertsBus,
      onStatus: sendLocalMonitorStatus,
      onAlarm: (alert) => {
        if (alertsBus) alertsBus.push(alert);
      },
    });
    localMonitor.applySettings(config || {});
    log.info('Local Monitor module instantiated');
  }
  return localMonitor;
}

function dropLocalMonitor() {
  if (!localMonitor) return;
  localMonitor.dispose();
  localMonitor = null;
  log.info('Local Monitor module torn down');
}

// Called after settings change. Each module gets told to come up or go away.
function applyModuleGates(previous) {
  const wasLocal = !!(previous && previous.localMonitorEnabled);
  // Dev-only: a packaged build forces the gate off instead of reading it, so a
  // setting flipped during development cannot bring the module up in production.
  const isLocal = IS_DEV && moduleEnabled('localMonitorEnabled');
  if (isLocal && !wasLocal) {
    getLocalMonitor();
  } else if (!isLocal && wasLocal) {
    dropLocalMonitor();
  }
  if (localMonitor) localMonitor.applySettings(config || {});

  // A disabled map must not be reachable through the pop-out either, and a
  // pop-out left open across a disable has to be closed.
  if (!moduleEnabled('mapEnabled') && intelWindow) {
    intelWindow.close();
  }
  if (engine) {
    engine.setPyramid(moduleEnabled('mapEnabled'));
  }
}

function sendLocalMonitorStatus(status) {
  if (mainWindow) mainWindow.webContents.send('local-monitor-status', status);
}

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
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // How the renderer learns it is running from source: the flag is only
      // passed in dev, and the preload exposes it as electronAPI.isDev.
      additionalArguments: IS_DEV ? ['--is-dev'] : [],
    },
  });

  if (state && state.isMaximized) mainWindow.maximize();
  mainWindow.setAutoHideMenuBar(true);
  mainWindow.setMenuBarVisibility(false);

  // Every window recreation (including `activate` on macOS) must rebind the
  // updater, or pushes go to a destroyed webContents and updates go quiet.
  updater.setWindow(mainWindow);

  mainWindow.on('move', scheduleSaveWindowState);
  mainWindow.on('resize', scheduleSaveWindowState);
  
  // Intercept minimize event to hide to tray if enabled
  mainWindow.on('minimize', (e) => {
    if (config && config.minimizeToTray !== false) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('close', () => {
    saveWindowState();
    if (alertsWindow) alertsWindow.close();
    if (intelWindow) intelWindow.close();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
    // Never let a stray region picker keep the app alive with no main window.
    if (localMonitor) localMonitor.closeOverlay();
  });

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
    // The alerts window floats over the game with only its cards and text solid.
    // Electron requires a transparent window to be non-resizable - resizable with
    // transparent can stop a window working at all - and nothing resizes this one
    // programmatically, so pinning its size costs nothing. frame:false removes the
    // native title bar, so alerts.html supplies its own close button and drag
    // region. hasShadow is left alone: the caveat for it is macOS-only.
    transparent: true,
    frame: false,
    resizable: false,
    backgroundColor: '#00000000',
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
  // The pop-out is a way to see the map, not a way to switch it on. If the
  // module is gated off there is nothing to look at, so refuse rather than
  // open an empty window.
  if (!moduleEnabled('mapEnabled')) {
    log.warn('Intel Map pop-out refused: the module is disabled in settings');
    return false;
  }
  if (intelWindow) {
    if (intelWindow.isMinimized()) intelWindow.restore();
    intelWindow.focus();
    return true;
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
  // The window closing is the release half of the handshake; the open half is
  // the pop-out telling us it has taken the work. Either way the tab is told,
  // so it can stop and then resume refreshing.
  intelWindow.on('closed', () => {
    intelWindow = null;
    if (mainWindow) mainWindow.webContents.send('intel-map-popout', false);
  });
  log.info('Intel Map pop-out window opened');
  return true;
}

function sendEngineState(state) {
  if (mainWindow) mainWindow.webContents.send('engine-state', state);
}

// One teardown path, reachable from both `window-all-closed` and the updater
// (which must stop the engine and the tray *before* handing the app to the
// installer - `quitAndInstall` does not wait for this event, and it is not
// idempotent on its own). Idempotent so whichever runs second is a no-op.
let shutdownDone = false;
function shutdownForInstall() {
  if (shutdownDone) return;
  shutdownDone = true;
  try {
    if (engine && engine.stop) engine.stop();
  } catch (err) {
    log.warn(`Engine stop during shutdown failed: ${err.message}`);
  }
  try {
    if (localMonitor) localMonitor.dispose();
  } catch (err) {
    log.warn(`Local monitor dispose during shutdown failed: ${err.message}`);
  }
  try {
    if (trayManager) trayManager.destroy();
  } catch (err) {
    log.warn(`Tray destroy during shutdown failed: ${err.message}`);
  }
}

app.whenReady().then(() => {
  log.setLogFile(path.join(app.getPath('userData'), 'debug.log'));
  log.info('App ready');

  // One store, read once. loadConfig() also performs the one-time import of a
  // legacy settings.json and writes the normalised config.json back.
  config = loadConfig();

  engine = new Engine(log);
  // Start each launch with a clean non-alert log: the previous one is deleted.
  engine.nonAlertLog.reset();
  alertsBus = new AlertsBus(log, engine);
  pilotResolver = new PilotResolver({
    log,
    cachePath: path.join(app.getPath('userData'), 'pilots.json'),
    saveHistory: () => engine.saveAlertHistory(),
  });

  // Gates are applied before any window is created, so a module that is off is
  // never constructed in the first place.
  applyModuleGates(null);

  registerIpc(
    {
      getConfig: () => config,
      updateConfig: (c) => {
        const previous = config;
        // Merge over the live config, not over the defaults. `normalizeConfig`
        // only guarantees unknown keys are kept; a partial payload would still
        // send every omitted key back to its default and silently discard the
        // user's stored value.
        config = normalizeConfig({ ...config, ...(c && typeof c === 'object' ? c : {}) });
        applyModuleGates(previous);
        saveConfig(config);
      },
    },
    engine,
    log,
    // A thunk, not the instance: the ipc layer resolves the monitor per request,
    // so it always sees the current one and sees null while the module is gated
    // off. It must not be getLocalMonitor - that would quietly construct a
    // disabled module the first time the settings tab asks for its status.
    () => localMonitor,
    updater,
  );

  ipcMain.handle('popout-alerts', () => {
    createAlertsWindow();
    return { ok: true };
  });

  ipcMain.handle('open-pyramid', () => {
    const opened = createIntelWindow();
    return { ok: !!opened, error: opened ? null : 'Intel Map is disabled in settings' };
  });

  // The pop-out claims the map so the tab stops refreshing while it is open.
  // Only the pop-out is allowed to make this claim - the tab asking for it
  // would be asking to pause itself, which is never what anyone means.
  ipcMain.handle('intel-map-popout', (e, open) => {
    const fromIntel = intelWindow && !intelWindow.isDestroyed()
      && intelWindow.webContents.id === e.sender.id;
    if (!fromIntel) return { ok: false };
    if (mainWindow) mainWindow.webContents.send('intel-map-popout', !!open);
    return { ok: true };
  });

  ipcMain.handle('set-always-on-top', (_, on) => {
    if (alertsWindow) alertsWindow.setAlwaysOnTop(!!on);
    return { ok: true, on: !!on };
  });

  // Transparency cannot be changed on a live window - Electron only takes it at
  // construction - so the window is always created transparent and this swaps
  // its chrome between see-through and solid by flipping a body class in the
  // renderer. The choice is persisted so it survives a reopen.
  ipcMain.handle('set-alerts-transparent', (_, on) => {
    const value = !!on;
    config = normalizeConfig({ ...config, alertsTransparent: value });
    saveConfig(config);
    if (alertsWindow && !alertsWindow.isDestroyed()) {
      alertsWindow.webContents.send('alerts-transparent', value);
    }
    return { ok: true, on: value };
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
    if (pilotResolver) pilotResolver.enrich(alert);
  };

  pilotResolver.onUpdated = (alert) => {
    if (mainWindow) mainWindow.webContents.send('alert-updated', alert);
    if (alertsWindow) alertsWindow.webContents.send('alert-updated', alert);
  };

  log.onLog((level, msg, ts) => {
    if (mainWindow) mainWindow.webContents.send('engine-log', `[${level}] ${msg}`);
  });

  createWindow();
  engine.start(config);
  sendEngineState({ running: engine.isRunning() });

  // The gate says the module is available, not that it is running. Enabling the
  // module must never start detection on its own: the monitor stays stopped
  // across every launch, including one right after a crash, until the user
  // presses Start. Autostarting here also fired before any area was picked and
  // logged a hard error on every single launch.

  trayManager = new TrayManager(log, () => mainWindow);
  trayManager.create();

  // The updater owns its own hourly timer; the only thing done here is the
  // startup check. `getSettings` reads the live config, and `setLastSeenVersion`
  // writes through saveConfig directly - routing it through updateConfig would
  // fire applyModuleGates and engine.applyConfig for a cosmetic key.
  updater.initUpdater({
    log,
    getSettings: () => config,
    setLastSeenVersion: (v) => {
      if (!config) return;
      config.lastSeenVersion = v;
      saveConfig(config);
    },
    shutdownForInstall,
  });
  updater.checkForUpdates();
});

app.on('before-quit', () => {
  if (pilotResolver) pilotResolver.flush();
});

app.on('window-all-closed', () => {
  shutdownForInstall();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});