// Main-process client for zKillboard's rolling 90-day recent-activity set.
const RECENT_ACTIVITY_URL = 'https://zkillboard.com/api/recentactivity/';
const USER_AGENT = 'MRCHI Intel Lite (https://github.com/temar9811-dotcom/MIL)';
const REQUEST_TIMEOUT_MS = 10000;
const REFRESH_MS = 60 * 60 * 1000;
const INITIAL_DELAY_MS = 30000;
const RETRY_MS = 30000;

class ZkillActivity {
  constructor({ log, fetchImpl = globalThis.fetch, timeoutMs = REQUEST_TIMEOUT_MS,
    refreshMs = REFRESH_MS, initialDelayMs = INITIAL_DELAY_MS, retryMs = RETRY_MS }) {
    this.log = log || { info() {}, warn() {} };
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.refreshMs = refreshMs;
    this.initialDelayMs = initialDelayMs;
    this.retryMs = retryMs;
    this.activeCharacterIds = null;
    this.timer = null;
    this.running = false;
    this.refreshPromise = null;
  }

  async refresh() {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.fetchRecentActivity()
      .then((ids) => {
        this.activeCharacterIds = ids;
        this.log.info(`Loaded ${ids.size} active character IDs from zKillboard`);
        return true;
      })
      .catch((err) => {
        // Preserve a previous known set. A first-load failure remains unknown.
        this.log.warn(`zKillboard recent activity unavailable: ${err.message}`);
        return false;
      })
      .finally(() => { this.refreshPromise = null; });
    return this.refreshPromise;
  }

  async fetchRecentActivity() {
    if (typeof this.fetchImpl !== 'function') throw new Error('fetch is unavailable');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(RECENT_ACTIVITY_URL, {
        method: 'GET',
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response || !response.ok) throw new Error(`zKillboard ${response ? response.status : 'no response'}`);
      const body = await response.json();
      if (!body || !Array.isArray(body.characterID)) {
        throw new Error('zKillboard returned a malformed recent-activity response');
      }
      const ids = new Set();
      for (const id of body.characterID) {
        const numericId = Number(id);
        if (!Number.isSafeInteger(numericId) || numericId <= 0) {
          throw new Error('zKillboard returned a malformed character ID');
        }
        ids.add(numericId);
      }
      return ids;
    } finally {
      clearTimeout(timeout);
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.schedule(this.initialDelayMs);
  }

  schedule(delay) {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      this.timer = null;
      const succeeded = await this.refresh();
      this.schedule(succeeded ? this.refreshMs : this.retryMs);
    }, delay);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    this.running = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }
}

module.exports = {
  ZkillActivity,
  RECENT_ACTIVITY_URL,
  REFRESH_MS,
  INITIAL_DELAY_MS,
  RETRY_MS,
};
