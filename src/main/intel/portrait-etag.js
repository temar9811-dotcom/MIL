// Main-process HEAD client for the EVE image server's character portrait ETag.
const IMAGE_SERVER = 'https://images.evetech.net/characters/';
const USER_AGENT = 'MRCHI Intel Lite (https://github.com/temar9811-dotcom/MIL)';
const REQUEST_TIMEOUT_MS = 10000;

class PortraitEtag {
  constructor({ log, fetchImpl = globalThis.fetch, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
    this.log = log || { warn() {} };
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.emptyEtag = null;
    this.emptyRequest = null;
  }

  async get(characterId) {
    const id = Number(characterId);
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    if (id === 1 && this.emptyEtag) return this.emptyEtag;
    if (id === 1 && this.emptyRequest) return this.emptyRequest;

    const request = this.fetchEtag(id);
    if (id === 1) {
      this.emptyRequest = request;
      try {
        const etag = await request;
        if (etag) this.emptyEtag = etag;
        return etag;
      } finally {
        this.emptyRequest = null;
      }
    }
    return request;
  }

  async fetchEtag(id) {
    if (typeof this.fetchImpl !== 'function') {
      this.log.warn('EVE image server unavailable: fetch is unavailable');
      return null;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${IMAGE_SERVER}${id}/portrait?size=32`, {
        method: 'HEAD',
        headers: { 'User-Agent': USER_AGENT },
        signal: controller.signal,
      });
      if (!response || !response.ok) return null;
      const etag = response.headers && typeof response.headers.get === 'function'
        ? response.headers.get('etag')
        : response.headers && (response.headers.etag || response.headers.ETag);
      return typeof etag === 'string' && etag ? etag : null;
    } catch (err) {
      this.log.warn(`EVE portrait ETag unavailable for character ${id}: ${err.message}`);
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}

module.exports = { PortraitEtag, IMAGE_SERVER };
