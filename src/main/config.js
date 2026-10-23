// # FILE: src/main/config.js
// # VERSION: 14
// MIL config v14 - `alertsTransparent` now defaults to false: the alerts
// pop-out opens solid, and the see-through look is opt-in.
// MIL config v13 - adds `alertsTransparent`, the alerts pop-out's see-through
// toggle, so the choice persists across a reopen (SETTINGS_VERSION 10).
// MIL config v12 - one settings store: config.json (v10), plus the chat-log
// folder bridge: the UI writes `logPath`, the engine watches `logsDirectory`,
// so normalizeConfig() derives the engine key from the UI key. v12 adds the
// updater keys (`autoInstallUpdates`, `lastSeenVersion`).
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULTS = {
  logsDirectory: null,
  channels: ['Local'],
  watchList: [],
  sound: true,
  notifications: true,
  alertSoundPath: null,
  softSoundPath: null,
  proximityRange: 2,
  characters: [],
};

// Bump by 1 whenever SETTINGS_DEFAULTS gains or loses a key.
const SETTINGS_VERSION = 11;

// How much slower the local monitor runs, as an exclusive multiplier.
// Every gated module defaults to off, so a fresh install loads only the log
// reader and the alert system.
const CHECK_RATES = [1, 2, 5, 8, 10];

const SETTINGS_DEFAULTS = {
  logPath: '',
  proximityRange: 2,
  intelChannels: '',
  soundEnabled: true,
  notificationEnabled: true,
  sound: true,
  notifications: true,
  volumeRed: 50,
  volumeSoft: 50,
  volume: 50,
  alertSoundPath: '',
  softSoundPath: '',
  bigText: false,
  presenceSource: 'window',
  primaryChar: '',
  intelTimeout: 10,
  eventPings: {
    ess: true,
    bubble: true,
    drag: true,
    ansiblex: true,
    camping: true,
  },
  groupAlerts: {},
  watchList: [],
  zkillStreamRange: 5,
  zkillCharFilter: '',
  // --- module gates: every one of these defaults to off ---
  mapEnabled: false,
  zkillEnabled: false,
  localMonitorEnabled: false,
  // Exclusive check-rate multiplier for the local monitor. 1 is the shipped
  // cadence; 2/5/8/10 scale both the vision pass and the alarm check pass.
  localCheckRate: 1,
  localTemplateScale: '100',
  localThreshold: 60,
  localCooldown: 60,
  localMute: false,
  localArea1: { enabled: false, x: 0, y: 0, x2: 0, y2: 0 },
  localArea2: { enabled: false, x: 0, y: 0, x2: 0, y2: 0 },
  // --- updater: `true` means the download dialog drives the update; `false`
  // leaves a "Update Now" button in the header. The hourly check is never
  // gated by this - it only decides who starts the install. `lastSeenVersion`
  // is stamped by the changelog popup so it shows once per version.
  autoInstallUpdates: true,
  lastSeenVersion: '',
  // The alerts pop-out is created transparent so it can float over the game.
  // This decides whether its chrome stays that way (desktop shows through) or
  // is filled in solid - the window itself is always constructed transparent,
  // since Electron cannot change that at runtime. Solid is the default: the
  // see-through look is opt-in.
  alertsTransparent: false,
};

function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

// The old, second settings store. Read once - and only when config.json is
// missing - so an install that predates the single-store fix keeps its values.
function legacySettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function readJson(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data && typeof data === 'object' ? data : null;
  } catch (_) {
    return null;
  }
}

// Merge a stored object over the full default shape. Both default maps apply:
// DEFAULTS holds engine-only keys (logsDirectory, channels, characters) and
// SETTINGS_DEFAULTS holds the settings-UI keys. Unknown keys are kept, so a
// field the UI writes but no default declares is not silently dropped.
function normalizeConfig(stored) {
  const merged = {
    ...DEFAULTS,
    ...SETTINGS_DEFAULTS,
    ...(stored && typeof stored === 'object' ? stored : {}),
  };
  // The settings UI browses and saves the chat-log folder as `logPath`, but the
  // engine watches `logsDirectory` - nothing else maps one to the other, so a
  // chosen folder was silently ignored and the watcher always auto-detected.
  // Deriving it on every normalise means it is honoured both at startup and
  // after a save (which is what makes applyConfig() restart the watcher).
  // An empty `logPath` keeps any hand-edited `logsDirectory` for back-compat.
  const folder = typeof merged.logPath === 'string' ? merged.logPath.trim() : '';
  merged.logsDirectory = folder || merged.logsDirectory || null;
  merged.settingsVersion = SETTINGS_VERSION;
  return merged;
}

function loadConfig() {
  const exists = fs.existsSync(configPath());
  const stored = exists ? readJson(configPath()) : readJson(legacySettingsPath());
  const config = normalizeConfig(stored);

  // Write back only when config.json is missing (first run, or the one-time
  // import from settings.json) or the stored object predates the current
  // defaults/version - so a schema bump is materialised once, not every launch.
  const missingKeys = !stored || Object.keys(SETTINGS_DEFAULTS).some((k) => !(k in stored));
  if (!exists || missingKeys || stored.settingsVersion !== SETTINGS_VERSION) {
    try {
      saveConfig(config);
    } catch (_) {
      // A read-only profile still runs, just with defaults on the next launch.
    }
  }
  return config;
}

function saveConfig(config) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));
}

module.exports = { loadConfig, saveConfig, normalizeConfig, DEFAULTS, SETTINGS_VERSION, SETTINGS_DEFAULTS, CHECK_RATES };
