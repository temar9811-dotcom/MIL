const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { CharacterCache, STATUS_TTLS } = require('../src/main/intel/character-cache');
const { CharacterResolver } = require('../src/main/intel/character-resolver');
const { ZkillActivity, RECENT_ACTIVITY_URL } = require('../src/main/intel/zkill-activity');
const { PortraitEtag, IMAGE_SERVER } = require('../src/main/intel/portrait-etag');

function response(body, { ok = true, status = 200, headers = {} } = {}) {
  return {
    ok,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] || null },
    async json() { return body; },
  };
}

function activityResolver(t, { characters, activeCharacterIds = null, etags = {}, etagFailure = false }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mil-activity-resolver-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cache = new CharacterCache({ cachePath: path.join(dir, 'pilots.json'), log: { warn() {} }, saveDelayMs: 60000 });
  const zkillActivity = { activeCharacterIds };
  const portraitEtag = {
    async get(id) {
      if (etagFailure) return null;
      return etags[id] || null;
    },
  };
  const resolver = new CharacterResolver({
    cache,
    log: { warn() {} },
    coalesceMs: 0,
    zkillActivity,
    portraitEtag,
    fetchImpl: async () => response({ characters }),
  });
  return { resolver, cache };
}

test('classifies zKillboard-active, inactive, and dormant pilots and stores the result', async (t) => {
  const { resolver, cache } = activityResolver(t, {
    characters: [
      { id: 11, name: 'Active Pilot' },
      { id: 22, name: 'Inactive Pilot' },
      { id: 33, name: 'Dormant Pilot' },
    ],
    activeCharacterIds: new Set([11]),
    etags: { 1: 'empty', 22: 'changed', 33: 'empty' },
  });
  // The active-set match wins without needing a portrait request.
  const result = await resolver.resolve(['Active Pilot', 'Inactive Pilot', 'Dormant Pilot']);
  assert.equal(result.get('Active Pilot'), 'active');
  assert.equal(result.get('Inactive Pilot'), 'inactive');
  assert.equal(result.get('Dormant Pilot'), 'dormant');
  assert.equal(cache.getRecord('Active Pilot').status, 'active');
  assert.equal(cache.getRecord('Inactive Pilot').status, 'inactive');
  assert.equal(STATUS_TTLS.active, 30 * 24 * 60 * 60 * 1000);
  assert.equal(STATUS_TTLS.inactive, 24 * 60 * 60 * 1000);
  assert.equal(STATUS_TTLS.dormant, 7 * 24 * 60 * 60 * 1000);
});

test('changed portrait plus known zKillboard set means inactive', async (t) => {
  const { resolver, cache } = activityResolver(t, {
    characters: [{ id: 42, name: 'Inactive Example' }],
    activeCharacterIds: new Set([999]),
    etags: { 1: 'empty-etag', 42: 'new-etag' },
  });
  const result = await resolver.resolve(['Inactive Example']);
  assert.equal(result.get('Inactive Example'), 'inactive');
  assert.equal(cache.getRecord('Inactive Example').status, 'inactive');
});

test('zKillboard outage fails open for changed portraits; matching empty portrait remains dormant', async (t) => {
  const changed = activityResolver(t, {
    characters: [{ id: 43, name: 'Recent Portrait' }],
    activeCharacterIds: null,
    etags: { 1: 'empty-etag', 43: 'new-etag' },
  });
  assert.equal((await changed.resolver.resolve(['Recent Portrait'])).get('Recent Portrait'), 'active');

  const unchanged = activityResolver(t, {
    characters: [{ id: 44, name: 'Old Portrait' }],
    activeCharacterIds: null,
    etags: { 1: 'empty-etag', 44: 'empty-etag' },
  });
  assert.equal((await unchanged.resolver.resolve(['Old Portrait'])).get('Old Portrait'), 'dormant');
});

test('image-server failures fail open to active and ESI misses stay missing', async (t) => {
  const unavailable = activityResolver(t, {
    characters: [{ id: 45, name: 'Image Failure' }],
    activeCharacterIds: new Set(),
    etagFailure: true,
  });
  assert.equal((await unavailable.resolver.resolve(['Image Failure'])).get('Image Failure'), 'active');
  assert.equal(unavailable.cache.getRecord('Image Failure').status, 'active');

  const missing = activityResolver(t, { characters: [], activeCharacterIds: new Set() });
  assert.equal((await missing.resolver.resolve(['Missing Pilot'])).get('Missing Pilot'), 'missing');
  assert.equal(missing.cache.getRecord('Missing Pilot').status, 'missing');
});

test('zKillboard client parses characterID, bounds the request, and preserves last known set on failure', async () => {
  let fail = false;
  let calls = 0;
  const client = new ZkillActivity({
    log: { info() {}, warn() {} },
    timeoutMs: 500,
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, RECENT_ACTIVITY_URL);
      assert.equal(options.method, 'GET');
      assert.ok(options.signal);
      return fail
        ? response({}, { ok: false, status: 503 })
        : response({ characterID: [123, 456, 123], corporationID: [99] });
    },
  });
  assert.equal(await client.refresh(), true);
  assert.deepEqual([...client.activeCharacterIds], [123, 456]);
  fail = true;
  assert.equal(await client.refresh(), false);
  assert.deepEqual([...client.activeCharacterIds], [123, 456]);
  assert.equal(calls, 2);
  client.stop();
});

test('portrait client issues HEAD, reads ETags, and memoizes the empty portrait', async () => {
  const calls = [];
  const client = new PortraitEtag({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const id = Number(url.match(/characters\/(\d+)\//)[1]);
      return response(null, { headers: { etag: id === 1 ? 'empty-tag' : 'pilot-tag' } });
    },
  });
  assert.equal(await client.get(1), 'empty-tag');
  assert.equal(await client.get(1), 'empty-tag');
  assert.equal(await client.get(77), 'pilot-tag');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, `${IMAGE_SERVER}1/portrait?size=32`);
  assert.equal(calls[0].options.method, 'HEAD');
  assert.ok(calls[0].options.signal);
});
