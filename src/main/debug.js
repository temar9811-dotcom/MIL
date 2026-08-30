const fs = require('fs');

class DebugLog {
  constructor(enabled) {
    this.enabled = enabled;
    this.logFile = null;
    this.listeners = [];
  }

  setLogFile(filePath) {
    this.logFile = filePath;
  }

  enable() { this.enabled = true; }
  disable() { this.enabled = false; }
  isEnabled() { return this.enabled; }

  onLog(cb) {
    this.listeners.push(cb);
  }

  _write(level, msg) {
    if (!this.enabled) return;
    const ts = new Date().toISOString();
    const line = `[${ts}] [${level}] ${msg}`;
    console.log(line);
    if (this.logFile) {
      try {
        fs.appendFileSync(this.logFile, line + '\n');
      } catch (_) { /* never crash on logging */ }
    }
    this.listeners.forEach(cb => cb(level, msg, ts));
  }

  info(msg) { this._write('INFO', msg); }
  warn(msg) { this._write('WARN', msg); }
  error(msg) { this._write('ERROR', msg); }
  debug(msg) { this._write('DEBUG', msg); }
  alert(msg) { this._write('ALERT', msg); }
  parse(msg) { this._write('PARSE', msg); }
  watch(msg) { this._write('WATCH', msg); }
}

module.exports = { DebugLog };