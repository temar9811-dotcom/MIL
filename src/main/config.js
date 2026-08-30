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

module.exports = { loadConfig, saveConfig, DEFAULTS };