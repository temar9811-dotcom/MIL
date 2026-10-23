// Single owner for pilots.json: normalization, TTL checks, merge, and writes.
const fs = require('fs');
const path = require('path');

const DAY_MS = 24 * 60 * 60 * 1000;
const STATUS_TTLS = {
  exists: 30 * DAY_MS,
  active: 30 * DAY_MS,
  inactive: 1 * DAY_MS,
  dormant: 7 * DAY_MS,
  missing: 7 * DAY_MS,
};

class CharacterCache {
  constructor({ cachePath, log, now = Date.now, saveDelayMs = 2000 }) {
    if (!cachePath) throw new Error('CharacterCache requires cachePath');
    this.cachePath = cachePath;
    this.log = log || { warn() {} };
    this.now = now;
    this.saveDelayMs = saveDelayMs;
    this.records = new Map();
    this.timer = null;
    this.load();
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.cachePath, 'utf8'));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
      for (const [name, value] of Object.entries(raw)) {
        if (!name || !value || typeof value !== 'object' || Array.isArray(value)) continue;
        const record = { ...value };
        // Upgrade the old id-only cache without treating it as fresh forever.
        if (!record.status && record.id != null) record.status = 'exists';
        if (record.status === 'exists' && !Number.isFinite(record.checkedAt)) record.checkedAt = 0;
        if (record.status === 'missing' && !Number.isFinite(record.checkedAt)) record.checkedAt = 0;
        if (!['exists', 'active', 'inactive', 'dormant', 'missing'].includes(record.status)) continue;
        this.records.set(name.toLowerCase(), { name, record });
      }
    } catch (err) {
      if (err.code !== 'ENOENT' && this.log && typeof this.log.warn === 'function') {
        this.log.warn(`pilot cache load failed; starting empty: ${err.message}`);
      }
    }
  }

  entry(name) {
    return this.records.get(String(name || '').toLowerCase());
  }

  getRecord(name, { includeExpired = false } = {}) {
    const entry = this.entry(name);
    if (!entry) return undefined;
    const record = entry.record;
    if (!includeExpired) {
      const ttl = STATUS_TTLS[record.status];
      if (!ttl || this.now() - Number(record.checkedAt || 0) >= ttl) return undefined;
    }
    return { ...record };
  }

  get(name) {
    const record = this.getRecord(name);
    return record ? record.status : undefined;
  }

  peek(name) {
    return this.get(name);
  }

  hasKnownId(name) {
    const record = this.getRecord(name, { includeExpired: true });
    return !!(record && record.id != null);
  }

  set(name, fields) {
    const keyName = String(name || '').trim();
    if (!keyName || !fields || typeof fields !== 'object') return undefined;

    const key = keyName.toLowerCase();
    const previous = this.records.get(key);
    const base = previous ? previous.record : {};
    const next = { ...base, ...fields };
    if (next.status === 'unknown') {
      delete next.status;
      delete next.checkedAt;
    }
    if (next.status === 'missing' && base.id != null) {
      // A stale or partial miss can never erase a previously verified identity.
      next.status = 'exists';
      next.id = base.id;
      next.checkedAt = base.checkedAt;
    }
    if (next.status && !Object.prototype.hasOwnProperty.call(STATUS_TTLS, next.status)) {
      delete next.status;
      delete next.checkedAt;
    }
    this.records.set(key, { name: previous ? previous.name : keyName, record: next });
    this.schedulePersist();
    return { ...next };
  }

  setMissing(name, checkedAt = this.now()) {
    if (this.hasKnownId(name)) return this.getRecord(name, { includeExpired: true });
    return this.set(name, { status: 'missing', checkedAt });
  }

  schedulePersist() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.persist();
    }, this.saveDelayMs);
    if (this.timer.unref) this.timer.unref();
  }

  persist() {
    const output = {};
    for (const { name, record } of this.records.values()) output[name] = record;
    const tempPath = `${this.cachePath}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.cachePath), { recursive: true });
      fs.writeFileSync(tempPath, JSON.stringify(output));
      fs.renameSync(tempPath, this.cachePath);
      return true;
    } catch (err) {
      try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_) { /* best effort */ }
      if (this.log && typeof this.log.warn === 'function') {
        this.log.warn(`pilot cache write failed: ${err.message}`);
      }
      return false;
    }
  }

  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    return this.persist();
  }
}

module.exports = { CharacterCache, STATUS_TTLS };
