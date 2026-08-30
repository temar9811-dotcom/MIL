const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');

class ChatLogWatcher {
  constructor(log) {
    this.log = log;
    this.watcher = null;
    this.onMessage = null;
    this.offsets = new Map();
  }

  start(directory, onMessage) {
    this.onMessage = onMessage;
    this.stop();

    const dir = this.resolveDir(directory);
    if (!dir) {
      this.log.error('No chat logs directory found');
      return;
    }

    this.log.watch(`Watching chat logs: ${dir}`);

    // Initial scan: tail the last 64KB of existing files
    for (const file of fs.readdirSync(dir)) {
      if (file.toLowerCase().endsWith('.txt')) {
        this.tailFile(path.join(dir, file), true);
      }
    }

    this.watcher = chokidar.watch(dir, {
      ignoreInitial: true,
      persistent: true,
      usePolling: true,
      interval: 1000,
      depth: 0,
    });

    this.watcher.on('add', (p) => this.tailFile(p, false));
    this.watcher.on('change', (p) => this.tailFile(p, false));
  }

  resolveDir(configured) {
    if (configured && fs.existsSync(configured)) return configured;
    const candidates = [
      path.join(process.env.USERPROFILE, 'Documents', 'EVE', 'logs', 'Chatlogs'),
      path.join(process.env.USERPROFILE, 'Documents', 'EVE', 'logs', 'ChatLogs'),
    ];
    return candidates.find((c) => fs.existsSync(c)) || null;
  }

  tailFile(filePath, isInitial) {
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch (_) { return; }

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

    for (const rawLine of buf.toString('utf8').split(/\r?\n/)) {
      const msg = this.parseLine(rawLine, filePath);
      if (msg && this.onMessage) this.onMessage(msg);
    }
  }

  parseLine(rawLine, filePath) {
    const line = rawLine.replace(/^﻿/, '').trim();
    if (!line) return null;
    const m = line.match(/^\[\s*(\d{4}\.\d{2}\.\d{2}\s+\d{2}:\d{2}:\d{2})\s*\]\s+(.+?)\s+>\s+(.*)$/);
    if (!m) return null;
    const [, stamp, author, message] = m;
    const meta = this.fileMeta(filePath);
    return {
      timestamp: stamp,
      author: author.trim(),
      message: message.trim(),
      channelName: meta.channel,
      characterName: meta.character,
      filePath,
    };
  }

  fileMeta(filePath) {
    // EVE filename format: Character_Channel_YYYYMMDD_HHMMSS.txt
    const base = path.basename(filePath, '.txt');
    const parts = base.split('_');
    if (parts.length >= 2) {
      return { character: parts[0], channel: parts.slice(1, -2).join('_') || parts[1] };
    }
    return { character: null, channel: base };
  }

  stop() {
    if (this.watcher) { this.watcher.close(); this.watcher = null; }
    this.offsets.clear();
  }
}

module.exports = { ChatLogWatcher };