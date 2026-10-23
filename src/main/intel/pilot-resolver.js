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
const EVEWHO = 'https://evewho.com/api/character/';
const USER_AGENT = 'MRCHI-Intel-Lite/1.0';
const ZKILL_CHARACTER = 'https://zkillboard.com/character/';
const REQUEST_TIMEOUT_MS = 10000;
const BATCH_MAX = 500;

class PilotResolver {
  constructor({ log, cache, characterResolver, saveHistory, fetchImpl = globalThis.fetch }) {
    if (!cache || !characterResolver) {
      throw new Error('PilotResolver requires the shared CharacterCache and CharacterResolver');
    }
    this.log = log;
    this.cache = cache;
    this.characterResolver = characterResolver;
    this.saveHistory = typeof saveHistory === 'function' ? saveHistory : () => {};
    this.fetchImpl = fetchImpl;
    this.onUpdated = null;
    this.queue = [];
    this.timer = null;
    this.inFlight = false;
    this.evewhoTimes = [];
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
    this.cache.flush();
  }

  async processQueue() {
    if (this.inFlight || !this.queue.length) return;
    this.inFlight = true;
    const batch = this.queue.splice(0, BATCH_MAX);
    try {
      const names = [...new Set(batch.map((a) => a.pilot))];
      const rawLines = new Map();
      for (const alert of batch) {
        if (!alert.raw) continue;
        const key = alert.pilot.toLowerCase();
        if (!rawLines.has(key)) rawLines.set(key, []);
        rawLines.get(key).push(alert.raw);
      }
      await this.characterResolver.resolve(names, { rawLines });
      const records = new Map(names.map((name) => [name, this.cache.getRecord(name, { includeExpired: true })]));
      const enrichment = new Map();
      for (const name of names) {
        const rec = records.get(name);
        if (rec && rec.id != null && rec.corp === undefined) {
          enrichment.set(String(rec.id), { name, rec });
        }
      }
      for (const { name, rec } of enrichment.values()) await this.fetchEvewho(name, rec);

      let changed = false;
      for (const alert of batch) {
        const rec = this.cache.getRecord(alert.pilot, { includeExpired: true });
        if (rec && rec.id != null) {
          this.apply(alert, rec);
          changed = true;
        }
      }
      if (changed) this.saveHistory();
    } catch (err) {
      this.log.warn(`pilot resolve failed: ${err.message}`);
    } finally {
      this.inFlight = false;
    }
    this.cache.flush();
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

  async fetchEvewho(name, currentRecord) {
    await this.evewhoSlot();
    try {
      const res = await this.getJson(`${EVEWHO}${currentRecord.id}`);
      const info = res && Array.isArray(res.info) ? res.info[0] : null;
      if (!info) return;
      const fields = {};
      if (info.corporation_id != null) fields.corp = info.corporation_id;
      if (info.corporation) fields.corpName = info.corporation;
      if (info.alliance_id != null) fields.alliance = info.alliance_id;
      if (info.sec_status != null) fields.sec = info.sec_status;
      if (Object.keys(fields).length) this.cache.set(name, fields);
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

  async getJson(url) {
    if (typeof this.fetchImpl !== 'function') throw new Error('fetch is unavailable');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await this.fetchImpl(url, {
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
