// MIL watcher v8 - header regexes tolerate EVE's indented header block
const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const { TimeFilter } = require('../intel/timeFilter');

const STARTUP_ACTIVE_MS = 20 * 60 * 1000;

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
  }

  start(config, handlers, registry) {
    this.handlers = handlers;
    this.registry = registry;
    this.stop();

    const chatDir = this.resolveChatDir(config.logsDirectory);
    if (!chatDir) {
      this.log.error('No chat logs directory found');
      return;
    }
    const gameDir = this.resolveGameDir(chatDir);

    this.log.watch(`Watching chat logs: ${chatDir}`);
    if (gameDir) this.log.watch(`Watching game logs: ${gameDir}`);

    this.scanDir(chatDir, 'chat');
    if (gameDir) this.scanDir(gameDir, 'game');

    this.chatWatcher = this.watchDir(chatDir, 'chat');
    if (gameDir) this.gameWatcher = this.watchDir(gameDir, 'game');

    this.activityInterval = setInterval(() => {
      if (this.registry) this.registry.checkOffline();
    }, 60000);
  }

  watchDir(dir, type) {
    const w = chokidar.watch(dir, {
      ignoreInitial: true, persistent: true, usePolling: true, interval: 1000, depth: 0,
    });
    w.on('add', (p) => this.tailFile(p, false, type));
    w.on('change', (p) => this.tailFile(p, false, type));
    return w;
  }

  scanDir(dir, type) {
    let entries = [];
    try { entries = fs.readdirSync(dir); } catch (_) { return; }
    for (const file of entries) {
      if (file.toLowerCase().endsWith('.txt')) {
        this.tailFile(path.join(dir, file), true, type);
      }
    }
  }

  resolveChatDir(configured) {
    if (configured && fs.existsSync(configured)) return configured;
    const c = [
      path.join(process.env.USERPROFILE, 'Documents', 'EVE', 'logs', 'Chatlogs'),
      path.join(process.env.USERPROFILE, 'Documents', 'EVE', 'logs', 'ChatLogs'),
    ];
    return c.find((x) => fs.existsSync(x)) || null;
  }

  resolveGameDir(chatDir) {
    const base = path.dirname(chatDir);
    const g = [path.join(base, 'Gamelogs'), path.join(base, 'GameLogs'), path.join(base, 'gamelogs')];
    return g.find((x) => fs.existsSync(x)) || null;
  }

  encodingFor(filePath) {
    if (!this.encodings.has(filePath)) {
      let enc = 'utf8';
      try {
        const fd = fs.openSync(filePath, 'r');
        const b = Buffer.alloc(2);
        fs.readSync(fd, b, 0, 2, 0);
        fs.closeSync(fd);
        if (b[0] === 0xFF && b[1] === 0xFE) enc = 'utf16le';
      } catch (_) { /* default utf8 */ }
      this.encodings.set(filePath, enc);
    }
    return this.encodings.get(filePath);
  }

  decodeChunk(buf, enc) {
    const text = enc === 'utf16le' ? buf.toString('utf16le') : buf.toString('utf8');
    return text.replace(/\uFEFF/g, '');
  }

  readHeader(filePath) {
    try {
      const fd = fs.openSync(filePath, 'r');
      const size = fs.fstatSync(fd).size;
      const buf = Buffer.alloc(Math.min(8192, size));
      fs.readSync(fd, buf, 0, buf.length, 0);
      fs.closeSync(fd);
      const lines = this.decodeChunk(buf, this.encodingFor(filePath)).split(/\r?\n/);
      let character = null, channel = null, sessionStart = null;
      for (const raw of lines) {
        const line = raw.trim();
        const cm = line.match(/^Channel Name:\s*(.+)$/i);
        if (cm) channel = cm[1].trim();
        const lm = line.match(/^Listener:\s*(.+)$/i);
        if (lm) character = lm[1].trim();
        const sm = line.match(/^Session started:\s*(.+)$/i);
        if (sm) sessionStart = sm[1].trim();
      }
      return { character, channel, sessionStart };
    } catch (_) {
      return { character: null, channel: null, sessionStart: null };
    }
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

  tailFile(filePath, isInitial, type) {
    let stat;
    try { stat = fs.statSync(filePath); } catch (_) { return; }

    if (!this.timeFilter.isAfterDowntime(stat.mtime)) return;

    if (!this.offsets.has(filePath)) {
      const start = isInitial ? Math.max(0, stat.size - 65536) : 0;
      this.offsets.set(filePath, start);
    }
    const offset = this.offsets.get(filePath);
    if (stat.size <= offset) return;

    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(stat.size - offset);
    fs.readSync(fd, buf, 0, buf.length, offset);
    fs.closeSync(fd);
    this.offsets.set(filePath, stat.size);

    const active = !isInitial || (Date.now() - stat.mtimeMs) < STARTUP_ACTIVE_MS;
    const meta = this.metaFor(filePath, active);

    if (type === 'game') {
      if (active && meta.character && this.registry) {
        this.registry.recordActivity(meta.character);
      }
      return;
    }

    const text = this.decodeChunk(buf, this.encodingFor(filePath));
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
    this.offsets.clear();
    this.headers.clear();
    this.encodings.clear();
  }
}

module.exports = { ChatLogWatcher };