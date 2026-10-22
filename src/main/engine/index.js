// # FILE: src/main/engine/index.js
// # VERSION: 23
// MIL engine v23 - lines that reach the pipeline but produce no alert (and are
// not merely out of range) are appended to non-alerts.log via NonAlertLog.
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const { ChatLogWatcher } = require('./watcher');
const { CharacterRegistry } = require('./registry');
const { IntelData } = require('../intel/data');
const { IntelParser } = require('../intel/parser');
const { IntelTracker } = require('../intel/tracker');
const { Alerts } = require('../intel/alerts');
const { NonAlertLog } = require('../intel/non-alert-log');
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
this.alertSeq = 0;
this.seenMessages = new Map();
this.registry = new CharacterRegistry(log);
this.watcher = new ChatLogWatcher(log);
this.data = new IntelData(log);
this.parser = new IntelParser(this.data, log);
this.tracker = new IntelTracker(log);
this.alerts = new Alerts({ presence: this.registry, data: this.data, log });
this.nonAlertLog = new NonAlertLog({ cachePath: path.join(app.getPath('userData'), 'pilots.json') });
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
this.alertSeq = Math.max(0, ...this.recentAlerts.map((a) => a.id || 0));
if (this.recentAlerts.length) {
this.log.info(`Restored ${this.recentAlerts.length} alerts from history`);
}
}

saveAlertHistory() {
try {
fs.writeFileSync(this.alertHistoryPath(), JSON.stringify(this.recentAlerts, null, 2));
} catch (_) { /* never crash on saving */ }
}

nextAlertId() {
return ++this.alertSeq;
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
if (!events.length) {
  // Understood as a chat line but made nothing of: no pilot, system, ship,
  // count, activity ping or link. Record the raw line for offline review.
  this.nonAlertLog.append(msg.raw);
  return;
}
let firedAlert = false;
let sawOutOfRange = false;
for (const event of events) {
  if (event.pilot && this.registry.get(event.pilot)) continue;
  this.tracker.record(event);
  this.pyramid.recordSystemIntel(event);
  this.log.parse(
    `INTEL pilot=${event.pilot || '?'} count=${event.count || '?'}` +
    `ship=${event.ship || '?'} system=${event.system || '?'}`,
  );
  const reason = { outOfRange: false };
  const alert = this.alerts.evaluate(event, reason);
  if (alert) { this.fireAlert(alert); firedAlert = true; }
  else if (reason.outOfRange) sawOutOfRange = true;
}
// No alert was raised. A report that was merely out of range is not a parse
// failure and is left out; anything else counts as a line we did not alert on.
if (!firedAlert && !sawOutOfRange) this.nonAlertLog.append(msg.raw);
}

processZkillKill(kill) {
if (!kill || !kill.system || kill.system === 'Unknown') return;
const event = {
pilot: kill.victim || null,
ship: null,
system: kill.system,
events: [],
count: kill.attackers || null,
timestamp: kill.time,
channel: 'zkill',
};
const alert = this.alerts.evaluate(event);
if (alert) {
alert.source = 'zkill';
alert.url = kill.url;
alert.finalBlowChar = kill.finalBlowChar || 'Unknown';
alert.finalBlowShip = kill.finalBlowShip || 'Unknown Ship';
alert.finalBlowCorp = kill.finalBlowCorp || 'Unknown Corp';
alert.attackers = kill.attackers || 0;
this.fireAlert(alert);
}
}

fireAlert(alert) {
alert.id = this.nextAlertId();
alert.time = Date.now();
this.recentAlerts.unshift(alert);
this.recentAlerts = this.recentAlerts.slice(0, 50);
this.saveAlertHistory();
const shipPart = alert.ship ? `in a ${alert.ship}` : '';
this.log.alert(
`${alert.type.toUpperCase()} ${alert.character} ${alert.jumps}j ${alert.pilot}${shipPart}`,
);
this.sounds.play(alert.type);
this.notifications.send(alert);
if (this.onAlert) this.onAlert(alert);
}

  // Alert raised outside the log pipeline (the local monitor), which has
  // already made its own noise: record it and push it to the UI only.
pushExternalAlert(alert) {
alert.id = this.nextAlertId();
alert.time = Date.now();
this.recentAlerts.unshift(alert);
    this.recentAlerts = this.recentAlerts.slice(0, 50);
    this.saveAlertHistory();
    this.log.alert(
      `${(alert.type || 'soft').toUpperCase()} ${alert.character || ''} ${alert.system || ''} ${alert.pilot || ''}`.replace(/\s+/g, ' ').trim(),
    );
    if (this.onAlert) this.onAlert(alert);
  }

  setPyramid(on) { this.pyramid.setPyramid(on); }
clearPyramid() { this.pyramid.clearPyramid(); }
getPyramid() { return this.pyramid.getPyramid(); }
setPyramidCenter(name) { this.pyramid.setPyramidCenter(name); }
getMapLayout(kind) { return this.data.getMapLayoutPayload(kind); }

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