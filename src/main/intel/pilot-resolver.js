// # FILE: src/main/intel/pilot-resolver.js
// # VERSION: 3
// Resolve reported pilot names to character IDs, cache them, and attach a
// zkillboard link. Runs in the main process only: the alerts pop-out has a
// 'self' CSP with no connect-src, and a renderer answer could not be persisted.
//
// Fire now, enrich after: every lookup is best-effort and fails open. A timeout,
// 429 or offline network leaves the alert exactly as it was.
//
// A *definitive* miss (ESI answered, no match) appends the alert's raw chat line
// to unverified-pilots.log, so a parser bug is reproducible offline.
const fs = require('fs');
const path = require('path');

const ESI_IDS = 'https://esi.evetech.net/latest/universe/ids/?datasource=tranquility';
const EVEWHO = 'https://evewho.com/api/character/';
const USER_AGENT = 'MRCHI-Intel-Lite/1.0';
const ZKILL_CHARACTER = 'https://zkillboard.com/character/';
const REQUEST_TIMEOUT_MS = 10000;
const BATCH_MAX = 500;
const MISS_LOG_MAX_BYTES = 5 * 1024 * 1024;

class PilotResolver {
  constructor({ log, cachePath, saveHistory }) {
    this.log = log;
    this.cachePath = cachePath;
    this.missLogPath = path.join(path.dirname(cachePath), 'unverified-pilots.log');
    this.saveHistory = typeof saveHistory === 'function' ? saveHistory : () => {};
    this.onUpdated = null;
    this.cache = this.loadCache();
    this.queue = [];
    this.timer = null;
    this.inFlight = false;
    this.dirty = false;
    this.saveTimer = null;
    this.evewhoTimes = [];
  }

  loadCache() {
    try {
      if (fs.existsSync(this.cachePath)) {
        const raw = JSON.parse(fs.readFileSync(this.cachePath, 'utf8'));
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
      }
    } catch (_) { /* corrupt cache starts empty, never crash */ }
    return {};
  }

  markDirty() {
    this.dirty = true;
    if (!this.saveTimer) {
      this.saveTimer = setTimeout(() => this.persist(), 2000);
    }
  }

  persist() {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    if (!this.dirty) return;
    try {
      fs.writeFileSync(this.cachePath, JSON.stringify(this.cache));
      this.dirty = false;
    } catch (err) {
      this.log.warn(`pilot cache write failed: ${err.message}`);
    }
  }

  // Queue a freshly fired alert for background enrichment. Never blocks.
  enrich(alert) {
    if (!alert || !alert.pilot || alert.pilotUrl) return;
    this.queue.push(alert);
    if (this.queue.length >= BATCH_MAX) this.processQueue();
    else this.schedule();
  }

  schedule() {
    if (this.timer || this.inFlight) return;
    this.timer = setTimeout(() => { this.timer = null; this.processQueue(); }, 1000);
  }

  // Drain the buffer now (used on quit): send anything pending and flush the cache.
  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.processQueue();
    this.persist();
  }

  async processQueue() {
    if (this.inFlight || !this.queue.length) return;
    this.inFlight = true;
    const batch = this.queue.splice(0, BATCH_MAX);
    try {
      const names = [...new Set(batch.map((a) => a.pilot))];
      const uncached = names.filter((n) => !(n in this.cache));
      if (uncached.length) {
        const found = await this.resolve(uncached);
        for (const n of uncached) {
          const hit = found.get(n);
          this.cache[n] = hit ? { id: hit.id } : null;
        }
        this.markDirty();
        for (const n of uncached) {
          const rec = this.cache[n];
          if (rec && rec.id && rec.corp === undefined) await this.fetchEvewho(rec);
        }
      }
      let changed = false;
      for (const alert of batch) {
        const rec = this.cache[alert.pilot];
        if (rec && rec.id) { this.apply(alert, rec); changed = true; }
        else if (rec === null) this.logMiss(alert);
      }
      if (changed) this.saveHistory();
    } catch (err) {
      this.log.warn(`pilot resolve failed: ${err.message}`);
    } finally {
      this.inFlight = false;
    }
    this.persist();
    if (this.queue.length) this.schedule();
  }

  apply(alert, rec) {
    alert.pilotId = rec.id;
    alert.pilotUrl = `${ZKILL_CHARACTER}${rec.id}/`;
    if (rec.corp != null) alert.pilotCorpId = rec.corp;
    if (rec.corpName) alert.pilotCorp = rec.corpName;
    if (rec.alliance != null) alert.pilotAllianceId = rec.alliance;
    if (rec.sec != null) alert.pilotSecStatus = rec.sec;
    if (this.onUpdated) this.onUpdated(alert);
  }

  // A name ESI answered "no such character" for: record the source chat line so
  // the parse that produced it can be replayed later. Cached misses land here
  // too, so a repeated bad name is logged on every occurrence, not once ever.
  // A zkill or local-monitor alert has no raw line and is skipped.
  logMiss(alert) {
    if (!alert || !alert.raw) return;
    try {
      if (fs.existsSync(this.missLogPath) && fs.statSync(this.missLogPath).size > MISS_LOG_MAX_BYTES) {
        fs.renameSync(this.missLogPath, path.join(path.dirname(this.missLogPath), 'unverified-pilots.1.log'));
      }
      fs.appendFileSync(this.missLogPath, alert.raw + '\n');
    } catch (_) { /* logging must never break alerting */ }
  }

  // Public name-level batch lookup: POST up to 500 names to ESI once and
  // return Map(name -> {id, name, category}) for those that matched. Names
  // absent from the map are a definitive miss (no match), not an error.
  // 500 is ESI's hard cap: 501+ returns 400 "too many items for 'names'".
  async resolve(names) {
    const out = new Map();
    for (let i = 0; i < names.length; i += BATCH_MAX) {
      const chunk = names.slice(i, i + BATCH_MAX);
      const res = await this.postJson(ESI_IDS, chunk);
      const chars = (res && res.characters) || [];
      const byLower = new Map();
      for (const c of chars) byLower.set(String(c.name).toLowerCase(), c);
      for (const n of chunk) {
        const c = byLower.get(n.toLowerCase());
        if (c) out.set(n, c);
      }
    }
    return out;
  }

  async fetchEvewho(rec) {
    await this.evewhoSlot();
    try {
      const res = await this.getJson(`${EVEWHO}${rec.id}`);
      const info = res && Array.isArray(res.info) ? res.info[0] : null;
      if (!info) return;
      if (info.corporation_id != null) rec.corp = info.corporation_id;
      if (info.corporation) rec.corpName = info.corporation;
      if (info.alliance_id != null) rec.alliance = info.alliance_id;
      if (info.sec_status != null) rec.sec = info.sec_status;
      this.markDirty();
    } catch (_) { /* evewho failure is a non-event: fail open */ }
  }

  // evewho allows ~10 requests / 30s; stay well under it at 3.
  async evewhoSlot() {
    for (;;) {
      const now = Date.now();
      this.evewhoTimes = this.evewhoTimes.filter((t) => now - t < 30000);
      if (this.evewhoTimes.length < 3) { this.evewhoTimes.push(now); return; }
      const wait = 30000 - (now - this.evewhoTimes[0]) + 10;
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  async postJson(url, body) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`ESI ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async getJson(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`evewho ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = { PilotResolver };
