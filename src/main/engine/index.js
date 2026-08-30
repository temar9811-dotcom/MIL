// MIL engine v3 - intel restricted to configured channels
const { ChatLogWatcher } = require('./watcher');
const { CharacterRegistry } = require('./registry');
const { IntelData } = require('../intel/data');
const { IntelParser } = require('../intel/parser');
const { IntelTracker } = require('../intel/tracker');
const { Alerts } = require('../intel/alerts');
const { TimeFilter } = require('../intel/timeFilter');

class Engine {
  constructor(log) {
    this.log = log;
    this.config = null;
    this.running = false;
    this.recentAlerts = [];
    this.onAlert = null;

    this.registry = new CharacterRegistry(log);
    this.watcher = new ChatLogWatcher(log);
    this.data = new IntelData(log);
    this.parser = new IntelParser(this.data, log);
    this.tracker = new IntelTracker(log);
    this.alerts = new Alerts({ presence: this.registry, data: this.data, log });
    this.timeFilter = new TimeFilter();
  }

  handlers() {
    return { onMessage: (msg) => this.handleMessage(msg) };
  }

  start(config) {
    this.config = config;
    this.alerts.setConfig(config);
    this.running = true;
    this.watcher.start(config, this.handlers(), this.registry);
    this.log.info('Engine started');
  }

  intelChannels() {
    const raw = (this.config && this.config.intelChannels) || '';
    return String(raw).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  }

  isIntelChannel(channel) {
    return this.intelChannels().includes(String(channel || '').trim().toLowerCase());
  }

  handleMessage(msg) {
    const channel = String(msg.channelName || '').trim().toLowerCase();
    if (channel === 'local') return;
    if (!this.isIntelChannel(channel)) return;
    if (msg.author === 'EVE System') return;
    if (!this.timeFilter.isFresh(msg.timestamp, 5)) return;

    this.log.parse(`[${msg.channelName}] ${msg.author}: ${msg.message}`);

    const events = this.parser.parse(msg) || [];
    for (const event of events) {
      if (event.pilot && this.registry.get(event.pilot)) continue;
      this.tracker.record(event);
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
    this.recentAlerts = this.recentAlerts.slice(0, 20);
    const shipPart = alert.ship ? ` in a ${alert.ship}` : '';
    this.log.alert(
      `${alert.type.toUpperCase()} ${alert.character} ${alert.jumps}j ${alert.pilot}${shipPart}`,
    );
    if (this.onAlert) this.onAlert(alert);
  }

  stop() {
    this.watcher.stop();
    this.running = false;
    this.log.info('Engine stopped');
  }

  applyConfig(config) {
    const oldDir = (this.config && this.config.logsDirectory) || null;
    const newDir = config.logsDirectory || null;
    this.config = config;
    this.alerts.setConfig(config);
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