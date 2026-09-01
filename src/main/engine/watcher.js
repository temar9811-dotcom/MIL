// MIL watcher v13 - lock retry + intel replay for pyramid backfill
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const { TimeFilter } = require('../intel/timeFilter');
const {
  isLockError, readNewBytes, readTailBytes, detectEncoding, decodeChunk,
  readHeaderSync, LOCK_RETRY_MS, MAX_LOCK_RETRIES,
} = require('./logtail');

const STARTUP_ACTIVE_MS = 20 * 60 * 1000;
const SWEEP_MS = 30 * 1000;

class ChatLogWatcher {
  constructor(log) {
    this.log = log;
    this.chatWatcher = null;
    this.gameWatcher = null;
    this.handlers = null;
    this.registry = null;
    this.offsets = new Map();
    this.headers = new Map();
    this.encodings = new Map();
    this.timeFilter = new TimeFilter();
    this.activityInterval = null;
    this.sweepInterval = null;
    this.chatDir = null;
    this.gameDir = null;
    this.minDateStr = '00000000';
    this.presenceFromLogs = false;
  }

  setPresenceMode(fromLogs) {
    this.presenceFromLogs = !!fromLogs;
    this.log.info(`Presence source: ${fromLogs ? 'chat logs' : 'EVE windows'}`);
  }

  downtimeDateStr() {
    const c = this.timeFilter.getDowntimeCutoff();
    const mo = String(c.getUTCMonth() + 1).padStart(2, '0');
    const d = String(c.getUTCDate()).padStart(2, '0');
    return `${c.getUTCFullYear()}${mo}${d}`;
  }

  isOldByName(fileName) {
    const m = fileName.match(/(\d{8})/);
    return !!m && m[1] < this.minDateStr;
  }

  start(config, handlers, registry) {
    this.handlers = handlers;
    this.registry = registry;
    this.minDateStr = this.downtimeDateStr();
    this.stop();

    const chatDir = this.resolveChatDir(config.logsDirectory);
    if (!chatDir) {
      this.log.error('No chat logs directory found - set it manually via Browse…');
      return;
    }
    const gameDir = this.resolveGameDir(chatDir);
    this.chatDir = chatDir;
    this.gameDir = gameDir;

    this.log.watch(`Watching chat logs: ${chatDir}`);
    if (gameDir) this.log.watch(`Watching game logs: ${gameDir}`);

    this.scanDir(chatDir, 'chat', false);
    if (gameDir) this.scanDir(gameDir, 'game', false);

    this.chatWatcher = this.watchDir(chatDir, 'chat');
    if (gameDir) this.gameWatcher = this.watchDir(gameDir, 'game');

    this.activityInterval = setInterval(() => {
      if (this.registry) this.registry.checkOffline();
    }, 60000);

    this.sweepInterval = setInterval(() => this.sweep(), SWEEP_MS);
  }

  sweep() {
    if (this.chatDir) this.scanDir(this.chatDir, 'chat', true);
    if (this.gameDir) this.scanDir(this.gameDir, 'game', true);
  }

  watchDir(dir, type) {
    const isWin = process.platform === 'win32';
    const w = chokidar.watch(dir, {
      ignoreInitial: true,
      persistent: true,
      usePolling: !isWin,
      interval: 2000,
      depth: 0,
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
      ignored: (p) => {
        if (!p.toLowerCase().endsWith('.txt')) return false;
        return this.isOldByName(path.basename(p));
      },
    });
    w.on('add', (p) => this.tailFile(p, false, type));
    w.on('change', (p) => this.tailFile(p, false, type));
    return w;
  }

  scanDir(dir, type, quiet) {
    let entries = [];
    try { entries = fs.readdirSync(dir); } catch (_) { return; }
    let count = 0;
    let skipped = 0;
    for (const file of entries) {
      if (!file.toLowerCase().endsWith('.txt')) continue;
      if (this.isOldByName(file)) { skipped++; continue; }
      count++;
      this.tailFile(path.join(dir, file), true, type);
    }
    if (!quiet) {
      this.log.watch(`Initial scan (${type}): ${count} log files (skipped ${skipped} old)`);
    }
  }

  documentsCandidates() {
    const docs = [];
    try { docs.push(app.getPath('documents')); } catch (_) { /* not ready */ }
    if (process.env.OneDrive) docs.push(path.join(process.env.OneDrive, 'Documents'));
    if (process.env.OneDriveDocuments) docs.push(process.env.OneDriveDocuments);
    if (process.env.USERPROFILE) docs.push(path.join(process.env.USERPROFILE, 'Documents'));
    return [...new Set(docs.filter(Boolean))];
  }

  resolveChatDir(configured) {
    if (configured && fs.existsSync(configured)) return configured;
    for (const d of this.documentsCandidates()) {
      for (const sub of ['Chatlogs', 'ChatLogs']) {
        const p = path.join(d, 'EVE', 'logs', sub);
        if (fs.existsSync(p)) return p;
      }
    }
    return null;
  }

  resolveGameDir(chatDir) {
    const base = path.dirname(chatDir);
    const g = [path.join(base, 'Gamelogs'), path.join(base, 'GameLogs'), path.join(base, 'gamelogs')];
    return g.find((x) => fs.existsSync(x)) || null;
  }

  encodingFor(filePath) {
    if (!this.encodings.has(filePath)) {
      this.encodings.set(filePath, detectEncoding(filePath));
    }
    return this.encodings.get(filePath);
  }

  readHeader(filePath) {
    return readHeaderSync(filePath, this.encodingFor(filePath));
  }

  metaFor(filePath, active) {
    if (!this.headers.has(filePath)) {
      const h = this.readHeader(filePath);
      this.headers.set(filePath, h);
      this.log.watch(
        `Header ${path.basename(filePath)}: enc=${this.encodingFor(filePath)} ` +
        `listener=${h.character || 'null'} channel=${h.channel || 'null'}`,
      );
      if (this.registry && h.character) {
        this.registry.updateFromHeader(filePath, h.character, h.channel, h.sessionStart, active);
      }
    }
    const header = this.headers.get(filePath);
    return { character: header.character, channel: header.channel };
  }

  // Locked file? wait 750ms and retry (x3), then defer to the 30s sweep.
  // Offsets only advance on success, so nothing is ever lost.
  tailFile(filePath, isInitial, type, attempt = 0) {
    let stat;
    try { stat = fs.statSync(filePath); } catch (_) { return; }

    if (!this.timeFilter.isAfterDowntime(stat.mtime)) return;

    if (!this.offsets.has(filePath)) {
      const start = isInitial ? Math.max(0, stat.size - 65536) : 0;
      this.offsets.set(filePath, start);
    }
    const offset = this.offsets.get(filePath);
    if (stat.size <= offset) return;

    let buf;
    try {
      buf = readNewBytes(filePath, offset, stat.size);
    } catch (err) {
      if (isLockError(err) && attempt < MAX_LOCK_RETRIES) {
        setTimeout(() => this.tailFile(filePath, isInitial, type, attempt + 1), LOCK_RETRY_MS);
      } else if (isLockError(err)) {
        this.log.warn(`Log locked, deferring to sweep: ${path.basename(filePath)}`);
      }
      return;
    }
    this.offsets.set(filePath, stat.size);

    const active = this.presenceFromLogs &&
      (!isInitial || (Date.now() - stat.mtimeMs) < STARTUP_ACTIVE_MS);
    const meta = this.metaFor(filePath, active);

    if (type === 'game') {
      if (active && meta.character && this.registry) {
        this.registry.recordActivity(meta.character);
      }
      return;
    }

    const text = decodeChunk(buf, this.encodingFor(filePath));
    for (const rawLine of text.split(/\r?\n/)) {
      const msg = this.parseLine(rawLine, filePath, meta);
      if (!msg) continue;

      if (active && meta.character && this.registry) {
        this.registry.recordActivity(meta.character);
      }

      if (msg.author === 'EVE System' && (msg.channelName || '').toLowerCase() === 'local') {
        const sys = msg.message.match(/Channel changed to Local\s*:\s*(.+)/i);
        if (sys && meta.character && this.registry) {
          this.registry.updateSystem(meta.character, sys[1].trim());
        }
      }

      if (this.handlers && this.handlers.onMessage) {
        this.handlers.onMessage(msg);
      }
    }
  }

  // Re-read recent tails WITHOUT touching offsets - used for pyramid backfill
  replayIntel(handler) {
    if (!this.chatDir || !handler) return 0;
    let entries = [];
    try { entries = fs.readdirSync(this.chatDir); } catch (_) { return 0; }
    let count = 0;
    for (const file of entries) {
      if (!file.toLowerCase().endsWith('.txt')) continue;
      if (this.isOldByName(file)) continue;
      const filePath = path.join(this.chatDir, file);
      let stat;
      try { stat = fs.statSync(filePath); } catch (_) { continue; }
      if (!this.timeFilter.isAfterDowntime(stat.mtime)) continue;
      let buf;
      try { buf = readTailBytes(filePath, 65536); } catch (_) { continue; }
      const meta = this.metaFor(filePath, false);
      const text = decodeChunk(buf, this.encodingFor(filePath));
      for (const rawLine of text.split(/\r?\n/)) {
        const msg = this.parseLine(rawLine, filePath, meta);
        if (!msg) continue;
        handler(msg);
        count++;
      }
    }
    return count;
  }

  parseLine(rawLine, filePath, meta) {
    const line = rawLine.trim();
    if (!line) return null;
    const m = line.match(/^\[\s*(\d{4}\.\d{2}\.\d{2}\s+\d{2}:\d{2}:\d{2})\s*\]\s+(.+?)\s+>\s+(.*)$/);
    if (!m) return null;
    const [, stamp, author, message] = m;
    return {
      timestamp: stamp,
      author: author.trim(),
      message: message.trim(),
      channelName: meta.channel,
      characterName: meta.character,
      filePath,
    };
  }

  stop() {
    if (this.chatWatcher) { this.chatWatcher.close(); this.chatWatcher = null; }
    if (this.gameWatcher) { this.gameWatcher.close(); this.gameWatcher = null; }
    if (this.activityInterval) { clearInterval(this.activityInterval); this.activityInterval = null; }
    if (this.sweepInterval) { clearInterval(this.sweepInterval); this.sweepInterval = null; }
    this.offsets.clear();
    this.headers.clear();
    this.encodings.clear();
  }
}

module.exports = { ChatLogWatcher };