// ESI-backed character existence lookup with cross-message batching.
const fs = require('fs');
const path = require('path');

const ESI_IDS = 'https://esi.evetech.net/latest/universe/ids/?datasource=tranquility';
const USER_AGENT = 'MRCHI-Intel-Lite/1.0';
const BATCH_MAX = 500;
const DEFAULT_COALESCE_MS = 150;
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_BREAKER_MS = 30000;
const MISS_LOG_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_ACTIVITY_CONCURRENCY = 8;

const ACTIVITY_STATUSES = new Set(['active', 'inactive', 'dormant']);

class CharacterResolver {
  constructor({ cache, cachePath, log, fetchImpl = globalThis.fetch, coalesceMs = DEFAULT_COALESCE_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS, breakerMs = DEFAULT_BREAKER_MS, now = Date.now,
    zkillActivity, portraitEtag, activityConcurrency = DEFAULT_ACTIVITY_CONCURRENCY }) {
    if (!cache) throw new Error('CharacterResolver requires a shared CharacterCache');
    this.cache = cache;
    this.cachePath = cachePath || cache.cachePath;
    this.missLogPath = this.cachePath
      ? path.join(path.dirname(this.cachePath), 'unverified-pilots.log')
      : null;
    this.log = log || { warn() {} };
    this.fetchImpl = fetchImpl;
    this.coalesceMs = coalesceMs;
    this.timeoutMs = timeoutMs;
    this.breakerMs = breakerMs;
    this.now = now;
    this.zkillActivity = zkillActivity || null;
    this.portraitEtag = portraitEtag || null;
    this.activityConcurrency = Math.max(1, Number(activityConcurrency) || DEFAULT_ACTIVITY_CONCURRENCY);
    this.inFlight = new Map();
    this.pending = [];
    this.timer = null;
    this.breakerUntil = 0;
  }

  peek(name) {
    const status = this.cache.peek(name);
    return status === 'exists' ? undefined : status;
  }

  async resolve(names, options = {}) {
    const input = Array.from(names || [], (name) => String(name || '').trim()).filter(Boolean);
    const entries = input.map((name) => ({ name, promise: this.resolveOne(name) }));
    const complete = Promise.all(entries.map((entry) => entry.promise));
    complete.then((statuses) => {
      const logged = new Set();
      for (let i = 0; i < entries.length; i++) {
        const key = entries[i].name.toLowerCase();
        if (statuses[i] === 'missing' && !logged.has(key)) {
          logged.add(key);
          const rawLines = this.rawLinesFor(options, entries[i].name);
          for (const rawLine of rawLines) this.logMiss(rawLine);
        }
      }
    }).catch(() => {});

    let statuses;
    const budgetMs = Number(options.budgetMs);
    if (Number.isFinite(budgetMs) && budgetMs >= 0) {
      let budgetTimer;
      try {
        statuses = await Promise.race([
          complete,
          new Promise((resolve) => { budgetTimer = setTimeout(() => resolve(input.map(() => 'unknown')), budgetMs); }),
        ]);
      } finally {
        if (budgetTimer) clearTimeout(budgetTimer);
      }
    } else {
      statuses = await complete;
    }
    const result = new Map();
    entries.forEach((entry, index) => result.set(entry.name, statuses[index] || 'unknown'));
    return result;
  }

  rawLinesFor(options, name) {
    if (typeof options.rawLine === 'string' && options.rawLine) return [options.rawLine];
    const rawLines = options.rawLines;
    if (!rawLines) return [];
    const value = rawLines instanceof Map
      ? (rawLines.get(name.toLowerCase()) ?? rawLines.get(name))
      : (rawLines[name.toLowerCase()] ?? rawLines[name]);
    if (Array.isArray(value)) return value.filter((line) => typeof line === 'string' && line);
    return typeof value === 'string' && value ? [value] : [];
  }

  resolveOne(name) {
    const cached = this.cache.getRecord(name);
    if (cached && (ACTIVITY_STATUSES.has(cached.status) || cached.status === 'missing')) {
      return Promise.resolve(cached.status);
    }

    const key = name.toLowerCase();
    const existing = this.inFlight.get(key);
    if (existing) return existing.promise;
    if (this.now() < this.breakerUntil) return Promise.resolve('unknown');

    let settle;
    const promise = new Promise((resolve) => { settle = resolve; });
    const entry = { name, key, promise, settle };
    this.inFlight.set(key, entry);
    this.pending.push(entry);
    this.scheduleFlush();
    return promise;
  }

  scheduleFlush() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flushPending();
    }, this.coalesceMs);
  }

  async flushPending() {
    const entries = this.pending.splice(0);
    if (!entries.length) return;
    for (let offset = 0; offset < entries.length; offset += BATCH_MAX) {
      const batch = entries.slice(offset, offset + BATCH_MAX);
      try {
        const response = await this.postNames(batch.map((entry) => entry.name));
        const byLower = new Map();
        for (const character of response.characters) {
          byLower.set(character.name.toLowerCase(), character);
        }
        const results = await this.mapLimit(batch, this.activityConcurrency, async (entry) => {
          const character = byLower.get(entry.key);
          if (character) {
            const id = Number(character.id);
            const status = await this.classifyActivity(id);
            return { entry, status, id };
          } else if (this.cache.hasKnownId(entry.name)) {
            const record = this.cache.getRecord(entry.name, { includeExpired: true });
            const id = Number(record && record.id);
            const status = Number.isSafeInteger(id) && id > 0
              ? await this.classifyActivity(id)
              : 'active';
            return { entry, status, id: Number.isSafeInteger(id) && id > 0 ? id : undefined };
          }
          return { entry, status: 'missing' };
        });
        for (const { entry, status, id } of results) {
          if (status === 'missing') this.cache.setMissing(entry.name, this.now());
          else this.cache.set(entry.name, { status, ...(id ? { id } : {}), checkedAt: this.now() });
          this.complete(entry, status);
        }
      } catch (err) {
        this.breakerUntil = Math.max(this.breakerUntil, this.now() + this.breakerMs);
        this.log.warn(`ESI character resolution failed: ${err.message}`);
        for (const entry of batch) this.complete(entry, 'unknown');
      }
    }
  }

  complete(entry, status) {
    if (this.inFlight.get(entry.key) === entry) this.inFlight.delete(entry.key);
    entry.settle(status);
  }

  async mapLimit(items, limit, mapper) {
    const results = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await mapper(items[index]);
      }
    });
    await Promise.all(workers);
    return results;
  }

  async classifyActivity(characterId) {
    const activeIds = this.zkillActivity && this.zkillActivity.activeCharacterIds;
    if (activeIds instanceof Set && activeIds.has(Number(characterId))) return 'active';

    if (!this.portraitEtag || typeof this.portraitEtag.get !== 'function') return 'active';
    try {
      const [emptyEtag, characterEtag] = await Promise.all([
        this.portraitEtag.get(1),
        this.portraitEtag.get(characterId),
      ]);
      if (!emptyEtag || !characterEtag) return 'active';
      if (characterEtag === emptyEtag) return 'dormant';
      // Without a known zKillboard set, a changed portrait alone is not enough
      // to classify a pilot as inactive; RIFT's rule fails open to active.
      if (activeIds instanceof Set) return 'inactive';
      return 'active';
    } catch (err) {
      this.log.warn(`Character activity check failed for ${characterId}: ${err.message}`);
      return 'active';
    }
  }

  async postNames(names) {
    if (typeof this.fetchImpl !== 'function') throw new Error('fetch is unavailable');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(ESI_IDS, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
        body: JSON.stringify(names),
        signal: controller.signal,
      });
      if (!response || !response.ok) throw new Error(`ESI ${response ? response.status : 'no response'}`);
      const body = await response.json();
      if (!body || !Array.isArray(body.characters)) throw new Error('ESI returned an incomplete character response');
      for (const character of body.characters) {
        if (!character || typeof character.name !== 'string' || !Number.isSafeInteger(Number(character.id)) || Number(character.id) <= 0) {
          throw new Error('ESI returned a malformed character result');
        }
      }
      return body;
    } finally {
      clearTimeout(timer);
    }
  }

  logMiss(rawLine) {
    if (!this.missLogPath || !rawLine) return;
    try {
      if (fs.existsSync(this.missLogPath) && fs.statSync(this.missLogPath).size > MISS_LOG_MAX_BYTES) {
        fs.renameSync(this.missLogPath, path.join(path.dirname(this.missLogPath), 'unverified-pilots.1.log'));
      }
      fs.appendFileSync(this.missLogPath, rawLine + '\n');
    } catch (_) { /* diagnostic logging never interrupts resolution */ }
  }
}

module.exports = { CharacterResolver, ESI_IDS, BATCH_MAX, ACTIVITY_STATUSES };
