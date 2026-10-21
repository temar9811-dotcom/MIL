// src/main/updater.js
// MIL updater v2 - hourly check, changelog popup, and an on/off setting that
// decides who starts the install (download dialog when on, header button when
// off). The hourly check itself is never gated by the setting.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { autoUpdater } = require('electron-updater');

const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const CHECK_TIMEOUT_MS = 120000;

// How many `## x.y.z` sections the changelog popup shows: the current version
// plus this many older ones. Falls back to the newest N when the current
// version has no section (a build cut without a changelog entry).
const CHANGELOG_SECTIONS = 4;

let mainWindow = null;
let initialized = false;
let checking = false;
let intervalHandle = null;
let availableVersion = null;
let pendingNotes = null;
let lastState = 'unavailable';
let deps = { log: null, getSettings: null, setLastSeenVersion: null, shutdownForInstall: null };

function isPackaged() {
  return app.isPackaged === true;
}

function isAutoInstallEnabled() {
  const s = typeof deps.getSettings === 'function' ? deps.getSettings() : null;
  return !s || s.autoInstallUpdates !== false;
}

function setWindow(win) {
  mainWindow = win || null;
}

function sendToRenderer(channel, payload) {
  if (
    mainWindow &&
    !mainWindow.isDestroyed() &&
    mainWindow.webContents &&
    !mainWindow.webContents.isDestroyed()
  ) {
    mainWindow.webContents.send(channel, payload);
  }
}

function sendState(state) {
  lastState = state;
  sendToRenderer('updater:status', {
    state,
    supported: isPackaged(),
    autoInstall: isAutoInstallEnabled(),
    available: !!availableVersion,
    version: availableVersion,
    intervalMs: CHECK_INTERVAL_MS,
  });
}

function getUpdaterStatus() {
  return {
    state: isPackaged() ? lastState : 'unavailable',
    supported: isPackaged(),
    autoInstall: isAutoInstallEnabled(),
    available: !!availableVersion,
    version: availableVersion,
    intervalMs: CHECK_INTERVAL_MS,
  };
}

function stopAutoCheck() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

function startAutoCheck() {
  if (intervalHandle) return;
  intervalHandle = setInterval(() => {
    checkForUpdates().catch(() => {});
  }, CHECK_INTERVAL_MS);
}

async function checkForUpdates() {
  if (!isPackaged()) {
    lastState = 'unavailable';
    return;
  }
  // A check that never settles used to be able to leave the updater wedged;
  // the latch is also released on a hard timeout.
  if (checking) {
    deps.log && deps.log.info('Update check already in progress');
    return;
  }
  checking = true;
  const timer = setTimeout(() => {
    if (checking) {
      checking = false;
      deps.log && deps.log.warn('Update check timed out; releasing latch');
    }
  }, CHECK_TIMEOUT_MS);
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    deps.log && deps.log.error(`Update check failed: ${err.message}`);
    sendState('error');
  } finally {
    clearTimeout(timer);
    checking = false;
  }
}

// The user hit "Update Now" (or the dialog path asked for it): download now.
async function downloadUpdate() {
  if (!isPackaged()) return { ok: false, reason: 'not-packaged' };
  sendState('downloading');
  try {
    await autoUpdater.downloadUpdate();
    return { ok: true };
  } catch (err) {
    deps.log && deps.log.error(`Update download failed: ${err.message}`);
    sendState('error');
    return { ok: false, reason: err.message };
  }
}

// "Remind me later". The dialog is renderer-side state; main keeps
// `availableVersion` so the header button stays offered until the user acts.
async function dismissUpdate() {
  deps.log && deps.log.info('Update dismissed by user');
  return { ok: true };
}

// Mirrors ESP's fireNow: an out-of-band check, used by the header button and
// by the debug tooling.
async function fireUpdaterNow() {
  await checkForUpdates();
  return getUpdaterStatus();
}

// Re-apply after the settings form saves `autoInstallUpdates`: if the user
// just turned it back on while an update is already waiting, raise the dialog
// now rather than at the next poll.
function applyAutoInstallSetting() {
  if (!initialized || !isPackaged()) return;
  if (isAutoInstallEnabled() && availableVersion) {
    sendToRenderer('updater:available', { version: availableVersion });
  }
  sendState('setting');
}

function readChangelogFile() {
  const candidates = [
    path.join(app.getAppPath(), 'CHANGELOG.md'),
    path.join(__dirname, '..', '..', 'CHANGELOG.md'),
  ];
  for (const file of candidates) {
    try {
      const text = fs.readFileSync(file, 'utf8');
      if (text && text.trim()) return text;
    } catch (_) {
      // Missing file is normal in dev checkouts; fall through.
    }
  }
  return '';
}

// Slice `CHANGELOG.md` down to the current version plus the few before it, so
// the popup never dumps the whole file into a scroller.
function windowChangelog(text, version) {
  if (!text) return '';
  const sections = [];
  const chunks = text.split(/^## /m);
  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    const heading = trimmed.split('\n')[0].trim();
    // The preamble above the first `## ` carries the `# Changelog` title and
    // is not a version section.
    if (!/^\d+\.\d+/.test(heading)) continue;
    sections.push(trimmed);
  }
  if (!sections.length) return text.trim();
  const idx = sections.findIndex((s) => s.split('\n')[0].trim() === version);
  const start = idx === -1 ? 0 : idx;
  return sections
    .slice(start, start + CHANGELOG_SECTIONS)
    .map((s) => `## ${s}`)
    .join('\n\n');
}

function getChangelog() {
  const current = app.getVersion();
  const last = (deps.getSettings() && deps.getSettings().lastSeenVersion) || '';
  if (last === current) return { show: false, version: current, notes: '' };
  if (typeof deps.setLastSeenVersion === 'function') deps.setLastSeenVersion(current);
  const notes =
    windowChangelog(readChangelogFile(), current) ||
    pendingNotes ||
    'Welcome to the new version!';
  return { show: true, version: current, notes };
}

// The renderer closes its own dialog; this exists so the channel has a main
// side and the debug tooling can poke it.
async function closeChangelog() {
  return { ok: true };
}

function initUpdater(options) {
  deps = { ...deps, ...(options || {}) };
  if (initialized) return;
  initialized = true;

  if (!isPackaged()) {
    deps.log && deps.log.info('Auto-updater disabled in development mode');
    lastState = 'unavailable';
    return;
  }

  autoUpdater.logger = deps.log || null;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    deps.log && deps.log.info('Checking for update...');
  });

  autoUpdater.on('update-available', (info) => {
    pendingNotes = (info && info.releaseNotes) || 'No release notes available.';
    availableVersion = info && info.version;
    deps.log && deps.log.info(`Update available: v${availableVersion}`);
    if (isAutoInstallEnabled()) {
      sendToRenderer('updater:available', { version: availableVersion });
    }
    sendState('available');
  });

  autoUpdater.on('update-not-available', () => {
    availableVersion = null;
    deps.log && deps.log.info('No update available');
    sendState('current');
  });

  autoUpdater.on('download-progress', (progress) => {
    deps.log &&
      deps.log.info(
        `Update download: ${Math.round(progress.percent)}% at ${progress.bytesPerSecond} B/s`,
      );
  });

  autoUpdater.on('update-downloaded', (info) => {
    deps.log && deps.log.info(`Update downloaded: v${info && info.version}`);
    stopAutoCheck();
    // Stop the engine and the tray before handing the app to the installer -
    // `quitAndInstall` does not wait for `window-all-closed`'s teardown, and
    // that teardown is not idempotent, so it runs here under our control.
    if (typeof deps.shutdownForInstall === 'function') {
      try {
        deps.shutdownForInstall();
      } catch (err) {
        deps.log && deps.log.warn(`Pre-install shutdown failed: ${err.message}`);
      }
    }
    autoUpdater.quitAndInstall(false, true);
  });

  autoUpdater.on('error', (err) => {
    deps.log && deps.log.error(`Updater error: ${err.message}`);
    sendState('error');
  });

  startAutoCheck();
}

module.exports = {
  initUpdater,
  setWindow,
  stopAutoCheck,
  checkForUpdates,
  downloadUpdate,
  dismissUpdate,
  fireUpdaterNow,
  applyAutoInstallSetting,
  getUpdaterStatus,
  getChangelog,
  closeChangelog,
};
