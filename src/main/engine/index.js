// MIL engine v18 - slim engine, pyramid delegated
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const { ChatLogWatcher } = require('./watcher');
const { CharacterRegistry } = require('./registry');
const { IntelData } = require('../intel/data');
const { IntelParser } = require('../intel/parser');
const { IntelTracker } = require('../intel/tracker');
const { Alerts } = require('../intel/alerts');
const { TimeFilter } = require('../intel/timeFilter');
const { PyramidFeed } = require('./pyramid');
const { SoundPlayer } = require('../sounds');
const { NotificationSender } = require('../notifications');
const { WindowPresence } = require('../windowpresence');

class Engine {
  constructor(log) {
    this.log = log;
    this.config = null;
    this.running = false;
    this.recentAlerts = [];
    this.onAlert = null;
    this.seenMessages = new Map();

    this.registry = new CharacterRegistry(log);
    this.watcher = new ChatLogWatcher(log);
    this.data = new IntelData(log);
    this.parser = new IntelParser(this.data, log);
    this.tracker = new IntelTracker(log);
    this.alerts = new Alerts({ presence: this.registry, data: this.data, log });
    this.timeFilter = new TimeFilter();
    this.sounds = new SoundPlayer(log);
    this.notifications = new NotificationSender(log);
    this.windowPresence = new WindowPresence(log, this.registry);
    this.pyramid = new PyramidFeed(this);
  }

  handlers() {
    return { onMessage: (msg) => this.handleMessage(msg) };
  }

  alertHistoryPath() {
    return path.join(app.getPath('userData'), 'alerts.json');
  }

  loadAlertHistory() {
    try {
      const p = this.alertHistoryPath();
      if (fs.existsSync(p)) {
        const list = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (Array.isArray(list)) this.recentAlerts = list.slice(0, 50);
      }
    } catch (_) { /* corrupt history ignored */ }
    if (this.recentAlerts.length) {
      this.log.info(`Restored ${this.recentAlerts.length} alerts from history`);
    }
  }

  saveAlertHistory() {
    try {
      fs.writeFileSync(this.alertHistoryPath(), JSON.stringify(this.recentAlerts, null, 2));
    } catch (_) { /* never crash on saving */ }
  }

  clearAlerts() {
    this.recentAlerts = [];
    this.saveAlertHistory();
    this.log.info('Alert history cleared');
  }

  applyPresenceConfig(config) {
    const useWindows = (config.presenceSource || 'window') === 'window';
    this.watcher.setPresenceMode(!useWindows);
    if (useWindows) this.windowPresence.start();
    else this.windowPresence.stop();
  }

  start(config) {
    this.config = config;
    this.alerts.setConfig(config);
    this.applySoundConfig(config);
    this.loadAlertHistory();
    this.running = true;
    this.watcher.start(config, this.handlers(), this.registry);
    this.applyPresenceConfig(config);
    this.log.info('Engine started');
  }

  applySoundConfig(config) {
    const soundEnabled = config.soundEnabled !== false && config.sound !== false;
    const notifEnabled = config.notificationEnabled !== false && config.notifications !== false;
    this.sounds.setEnabled(soundEnabled);
    this.notifications.setEnabled(notifEnabled);

    const legacy = config.volume == null ? 50 : config.volume;
    const red = config.volumeRed == null ? legacy : config.volumeRed;
    const soft = config.volumeSoft == null ? legacy : config.volumeSoft;
    this.sounds.setVolumes(red, soft);
    this.sounds.setCustomPaths(config.alertSoundPath || null, config.softSoundPath || null);
  }

  intelChannels() {
    const raw = (this.config && this.config.intelChannels) || '';
    return String(raw).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  }

  isIntelChannel(channel) {
    return this.intelChannels().includes(String(channel || '').trim().toLowerCase());
  }

  isDuplicate(msg) {
    const key = [msg.channelName, msg.timestamp, msg.author, msg.message].join('|');
    const now = Date.now();
    if (this.seenMessages.has(key)) return true;
    this.seenMessages.set(key, now);
    if (this.seenMessages.size > 5000) {
      for (const [k, t] of this.seenMessages) {
        if (now - t > 120000) this.seenMessages.delete(k);
      }
    }
    return false;
  }

  handleMessage(msg) {
    const channel = String(msg.channelName || '').trim().toLowerCase();
    if (channel === 'local') return;
    if (!this.isIntelChannel(channel)) return;
    if (msg.author === 'EVE System') return;
    if (!this.timeFilter.isFresh(msg.timestamp, 5)) return;
    if (this.isDuplicate(msg)) return;

    this.log.parse(`[${msg.channelName}] ${msg.author}: ${msg.message}`);

    const events = this.parser.parse(msg) || [];
    for (const event of events) {
      if (event.pilot && this.registry.get(event.pilot)) continue;
      this.tracker.record(event);
      this.pyramid.recordSystemIntel(event);
      this.log.parse(
        `INTEL pilot=${event.pilot || '?'} count=${event.count || '?'} ` +
        `ship=${event.ship || '?'} system=${event.system || '?'}`,
      );
      const alert = this.alerts.evaluate(event);
      if (alert) this.fireAlert(alert);
    }
  }

  fireAlert(alert) {
    this.recentAlerts.unshift(alert);
    this.recentAlerts = this.recentAlerts.slice(0, 50);
    this.saveAlertHistory();

    const shipPart = alert.ship ? ` in a ${alert.ship}` : '';
    this.log.alert(
      `${alert.type.toUpperCase()} ${alert.character} ${alert.jumps}j ${alert.pilot}${shipPart}`,
    );

    this.sounds.play(alert.type);
    this.notifications.send(alert);

    if (this.onAlert) this.onAlert(alert);
  }

  // ---- pyramid proxies ----
  setPyramid(on) { this.pyramid.setPyramid(on); }
  clearPyramid() { this.pyramid.clearPyramid(); }
  getPyramid() { return this.pyramid.getPyramid(); }
  setPyramidCenter(name) { this.pyramid.setPyramidCenter(name); }

  stop() {
    this.watcher.stop();
    this.windowPresence.stop();
    this.running = false;
    this.log.info('Engine stopped');
  }

  applyConfig(config) {
    const oldDir = (this.config && this.config.logsDirectory) || null;
    const newDir = config.logsDirectory || null;
    this.config = config;
    this.alerts.setConfig(config);
    this.applySoundConfig(config);
    this.applyPresenceConfig(config);
    if (this.running && oldDir !== newDir) {
      this.watcher.start(config, this.handlers(), this.registry);
    }
    this.log.info('Config applied to engine');
  }

  isRunning() { return this.running; }
  getRecentAlerts() { return this.recentAlerts; }
  getCharacters() { return this.registry.all(); }
  getOnlineCharacters() { return this.registry.getOnline(); }
}

module.exports = { Engine };