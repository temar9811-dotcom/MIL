// # FILE: src/main/engine/index.js
// # VERSION: 24
// MIL engine v24 - bounded async name-validity gate before alert processing.
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

const MAX_PENDING_MESSAGES = 200;
const MAX_QUEUE_RESIDENCE_MS = 2 * 60 * 1000;
const MAX_MESSAGE_AGE_MINUTES = 5;

class Engine {
constructor(log) {
this.log = log;
this.config = null;
this.running = false;
this.recentAlerts = [];
this.onAlert = null;
this.alertSeq = 0;
this.seenMessages = new Map();
this.characterResolver = null;
this.messageQueue = [];
this.processingQueue = false;
this.pipeline = Promise.resolve();
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

setCharacterResolver(resolver) { this.characterResolver = resolver || null; }

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
if (channel === 'local' || !this.isIntelChannel(channel) || msg.author === 'EVE System') return Promise.resolve();
const arrivalAt = Date.now();
const timestamp = this.timeFilter.parseEVETimestamp(msg.timestamp);
const messageAt = timestamp ? timestamp.getTime() : null;
if (messageAt == null || !this.timeFilter.isFreshAt(messageAt, MAX_MESSAGE_AGE_MINUTES, arrivalAt)) {
  this.nonAlertLog.append(msg.raw, 'stale');
  return Promise.resolve();
}
if (this.isDuplicate(msg)) {
  this.nonAlertLog.append(msg.raw, 'duplicate');
  return Promise.resolve();
}
if (this.messageQueue.length >= MAX_PENDING_MESSAGES) {
  this.nonAlertLog.append(msg.raw, 'queue-full');
  return Promise.resolve();
}
this.messageQueue.push({ msg, arrivalAt, messageAt });
if (!this.processingQueue) this.startQueue();
return this.pipeline;
}

startQueue() {
if (this.processingQueue || !this.messageQueue.length) return;
this.processingQueue = true;
this.pipeline = this.pipeline.then(() => this.drainQueue()).catch((err) => {
  this.log.error(`Intel message sequencer failed: ${err.message}`);
}).finally(() => {
  this.processingQueue = false;
  if (this.messageQueue.length) this.startQueue();
});
}

async drainQueue() {
while (this.messageQueue.length) {
  const queued = this.messageQueue.shift();
  const residence = Date.now() - queued.arrivalAt;
  if (residence > MAX_QUEUE_RESIDENCE_MS) {
    this.nonAlertLog.append(queued.msg.raw, 'queue-expired');
    continue;
  }
  if (!this.timeFilter.isFreshAt(queued.messageAt, MAX_MESSAGE_AGE_MINUTES)) {
    this.nonAlertLog.append(queued.msg.raw, 'stale');
    continue;
  }
  try {
    await this.process(queued.msg, queued.messageAt);
  } catch (err) {
    this.log.error(`Intel message handler failed: ${err.message}`);
    this.nonAlertLog.append(queued.msg.raw, 'handler-error');
  }
}
}

async applyPilotGate(events, msg) {
const rows = Array.isArray(events) ? events : [];
const validator = this.parser.nameValidator;
const pilots = [];
const classifications = new Map();
let hadPilots = false;
for (const event of rows) {
  if (!event.pilot) continue;
  hadPilots = true;
  const classification = validator.classify(event.pilot);
  classifications.set(event, classification);
  if (classification.kind !== 'invalid' && !pilots.some((pilot) => pilot.toLowerCase() === event.pilot.toLowerCase())) pilots.push(event.pilot);
}
if (!hadPilots) return { events: rows, gated: false };
const statuses = this.characterResolver && pilots.length
  ? await this.characterResolver.resolve(pilots, { budgetMs: 850, rawLine: msg.raw })
  : new Map(pilots.map((pilot) => [pilot, 'unknown']));
const findStatus = (name) => statuses.get(name) || [...statuses].find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1] || 'unknown';
const kept = [];
for (const event of rows) {
  if (!event.pilot) { kept.push(event); continue; }
  const classification = classifications.get(event) || validator.classify(event.pilot);
  if (classification.kind === 'invalid') continue;
  const status = findStatus(event.pilot);
  if (classification.kind === 'type-name' && status === 'missing') {
    this.log.parse(`NAME GATE type-name rejected: ${event.pilot}`);
    continue;
  }
  if (classification.kind === 'type-name' && status !== 'active' && status !== 'inactive' && status !== 'unknown') continue;
  if (status === 'missing' || status === 'dormant') continue;
  if (status === 'inactive' && classification.kind === 'dictionary') continue;
  kept.push(event);
}
return { events: kept, gated: kept.length === 0 || (rows.some((event) => event.pilot) && !kept.some((event) => event.pilot)) };
}

async process(msg, messageAt) {
this.log.parse(`[${msg.channelName}] ${msg.author}: ${msg.message}`);
const events = this.parser.parse(msg) || [];
if (!events.length) {
  // Understood as a chat line but made nothing of: no pilot, system, ship,
  // count, activity ping or link. Record the raw line for offline review.
  this.nonAlertLog.append(msg.raw);
  return;
}
const gate = await this.applyPilotGate(events, msg);
if (gate.gated) {
  this.nonAlertLog.append(msg.raw, 'name-gated');
  return;
}
let firedAlert = false;
let sawOutOfRange = false;
for (const event of gate.events) {
  if (event.pilot && this.registry.get(event.pilot)) { firedAlert = true; continue; }
  this.tracker.record(event);
  this.pyramid.recordSystemIntel(event);
  this.log.parse(
    `INTEL pilot=${event.pilot || '?'} count=${event.count || '?'}` +
    `ship=${event.ship || '?'} system=${event.system || '?'}`,
  );
  const reason = { outOfRange: false };
  const alert = this.alerts.evaluate(event, reason, messageAt);
  if (alert) { this.fireAlert(alert, messageAt); firedAlert = true; }
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

fireAlert(alert, atTime) {
alert.id = this.nextAlertId();
alert.time = Number.isFinite(atTime) ? atTime : Date.now();
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
