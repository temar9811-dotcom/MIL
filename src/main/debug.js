// src/main/debug.js
const fs = require('fs');

class DebugLog {
  constructor(enabled) {
    this.enabled = enabled;
    this.logFile = null;
    this.listeners = [];
    this.buffer = [];
    this.bufferMax = 500;
  }

  setLogFile(filePath) {
    this.logFile = filePath;
  }

  enable() {
    this.enabled = true;
    for (const entry of this.buffer) {
      this.listeners.forEach((cb) => cb(entry.level, entry.msg, entry.ts));
    }
  }

  disable() { this.enabled = false; }
  isEnabled() { return this.enabled; }

  onLog(cb) {
    this.listeners.push(cb);
  }

  write(level, msg) {
    const ts = new Date().toISOString();
    this.buffer.push({ level, msg, ts });
    if (this.buffer.length > this.bufferMax) {
      this.buffer.splice(0, this.buffer.length - this.bufferMax);
    }
    if (!this.enabled) return;

    const line = `[${ts}] [${level}] ${msg}`;
    console.log(line);
    if (this.logFile) {
      try {
        fs.appendFileSync(this.logFile, line + '\n');
      } catch (_) { /* never crash on logging */ }
    }
    this.listeners.forEach((cb) => cb(level, msg, ts));
  }

  info(msg) { this.write('INFO', msg); }
  warn(msg) { this.write('WARN', msg); }
  error(msg) { this.write('ERROR', msg); }
  debug(msg) { this.write('DEBUG', msg); }
  alert(msg) { this.write('ALERT', msg); }
  parse(msg) { this.write('PARSE', msg); }
  watch(msg) { this.write('WATCH', msg); }
}

module.exports = { DebugLog };