// MIL config v6 - settings schema v5 (primaryChar)
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
const SETTINGS_VERSION = 5;

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
};

function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch (_) {
    return { ...DEFAULTS };
  }
}

function saveConfig(config) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));
}

module.exports = { loadConfig, saveConfig, DEFAULTS, SETTINGS_VERSION, SETTINGS_DEFAULTS };