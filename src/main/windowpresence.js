// MIL windowpresence v3 - window gone = offline immediately
const { spawn } = require('child_process');

const POLL_MS = 20000;
const KILL_MS = 10000;
const TITLE_RE = /^\s*EVE\s*-\s*(.+?)\s*$/i;

const PS_CMD = "Get-Process | Where-Object { $_.MainWindowTitle -like 'EVE -*' } | Select-Object -ExpandProperty MainWindowTitle";

class WindowPresence {
  constructor(log, registry) {
    this.log = log;
    this.registry = registry;
    this.timer = null;
    this.lastNames = new Set();
  }

  start() {
    this.stop();
    this.poll();
    this.timer = setInterval(() => this.poll(), POLL_MS);
    this.log.info('Window presence polling started (20s)');
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  poll() {
    let child;
    try {
      child = spawn('powershell.exe', ['-NoProfile', '-Command', PS_CMD], { windowsHide: true });
    } catch (err) {
      this.log.warn(`Window presence spawn failed: ${err.message}`);
      return;
    }

    let stdout = '';
    let stderr = '';
    const killer = setTimeout(() => { try { child.kill(); } catch (_) { /* already dead */ } }, KILL_MS);

    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => {
      clearTimeout(killer);
      this.log.warn(`Window presence spawn failed: ${err.message}`);
    });
    child.on('close', (code) => {
      clearTimeout(killer);
      if (code !== 0) {
        this.log.warn(`Window presence poll exit ${code}: ${stderr.trim() || 'no stderr'}`);
        return;
      }

      const names = new Set();
      for (const line of stdout.split(/\r?\n/)) {
        const m = line.match(TITLE_RE);
        if (!m) continue;
        const name = m[1].trim();
        if (!name || /launcher/i.test(name)) continue;
        names.add(name);
      }

      for (const name of names) {
        const known = this.registry.all().find((c) => c.name.toLowerCase() === name.toLowerCase());
        this.registry.recordActivity(known ? known.name : name);
        if (!this.lastNames.has(name)) {
          this.log.watch(`Window presence: ${known ? known.name : name} is online (EVE client window)`);
        }
      }

      for (const name of this.lastNames) {
        if (names.has(name)) continue;
        const known = this.registry.all().find((c) => c.name.toLowerCase() === name.toLowerCase());
        if (known) this.registry.setOffline(known.name);
        this.log.watch(`Window presence: ${name} client window gone`);
      }

      this.lastNames = names;
    });
  }
}

module.exports = { WindowPresence };