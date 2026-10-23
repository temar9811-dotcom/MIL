const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { CharacterCache, STATUS_TTLS } = require('../src/main/intel/character-cache');
const { CharacterResolver } = require('../src/main/intel/character-resolver');
const { PilotResolver } = require('../src/main/intel/pilot-resolver');

function setup(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mil-character-resolver-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cachePath = path.join(dir, 'pilots.json');
  const warnings = [];
  const log = { warn(message) { warnings.push(message); } };
  const cache = new CharacterCache({ cachePath, log, saveDelayMs: 60000, ...(options.cacheOptions || {}) });
  const resolver = new CharacterResolver({
    cache,
    log,
    coalesceMs: 0,
    ...(options.resolverOptions || {}),
  });
  return { dir, cachePath, cache, resolver, log, warnings };
}

function response(body, ok = true, status = 200) {
  return { ok, status, async json() { return body; } };
}

test('fresh cache hits for active and missing avoid ESI', async (t) => {
  const { cache, resolver } = setup(t, { resolverOptions: { fetchImpl: async () => { throw Error('unexpected fetch'); } } });
  cache.set('Known Pilot', { status: 'active', id: 101, checkedAt: Date.now() });
  cache.setMissing('Not A Pilot', Date.now());
  const result = await resolver.resolve(['Known Pilot', 'Not A Pilot']);
  assert.equal(result.get('Known Pilot'), 'active');
  assert.equal(result.get('Not A Pilot'), 'missing');
});

test('ESI confirms hits and definitive misses, and logs missing raw lines', async (t) => {
  let calls = 0;
  const { resolver, cache, cachePath } = setup(t, {
    resolverOptions: {
      fetchImpl: async (_url, request) => {
        calls++;
        assert.equal(request.method, 'POST');
        assert.deepEqual(JSON.parse(request.body), ['Found Pilot', 'No Such Pilot']);
        return response({ characters: [{ id: 202, name: 'Found Pilot', category: 'character' }] });
      },
    },
  });
  const result = await resolver.resolve(['Found Pilot', 'No Such Pilot'], {
    rawLines: new Map([['no such pilot', ['raw miss line']]]),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(result.get('Found Pilot'), 'active');
  assert.equal(result.get('No Such Pilot'), 'missing');
  assert.equal(cache.getRecord('Found Pilot').id, 202);
  assert.match(fs.readFileSync(path.join(path.dirname(cachePath), 'unverified-pilots.log'), 'utf8'), /raw miss line/);
});

test('network and malformed/partial response failures fail open and never persist missing', async (t) => {
  const { resolver, cache } = setup(t, {
    resolverOptions: { fetchImpl: async () => response({ error: 'bad gateway' }, false, 502) },
  });
  const result = await resolver.resolve(['Uncertain Pilot']);
  assert.equal(result.get('Uncertain Pilot'), 'unknown');
  assert.equal(cache.getRecord('Uncertain Pilot', { includeExpired: true }), undefined);

  const other = setup(t, { resolverOptions: { fetchImpl: async () => response({}) } });
  const malformed = await other.resolver.resolve(['Also Uncertain']);
  assert.equal(malformed.get('Also Uncertain'), 'unknown');
  assert.equal(other.cache.getRecord('Also Uncertain', { includeExpired: true }), undefined);
});

test('expired entries re-resolve while a later ESI miss cannot overwrite a known id', async (t) => {
  let now = 10 * STATUS_TTLS.exists;
  let calls = 0;
  const { cache, resolver } = setup(t, {
    cacheOptions: { now: () => now },
    resolverOptions: {
      now: () => now,
      fetchImpl: async () => { calls++; return response({ characters: [] }); },
    },
  });
  cache.set('Stale Pilot', { status: 'exists', id: 303, checkedAt: now - STATUS_TTLS.exists });
  const result = await resolver.resolve(['Stale Pilot']);
  assert.equal(calls, 1);
  assert.equal(result.get('Stale Pilot'), 'active');
  assert.equal(cache.getRecord('Stale Pilot', { includeExpired: true }).id, 303);
  assert.equal(cache.getRecord('Stale Pilot').status, 'active');
});

test('concurrent same-name requests coalesce into one ESI POST', async (t) => {
  let calls = 0;
  const { resolver } = setup(t, {
    resolverOptions: {
      coalesceMs: 15,
      fetchImpl: async () => {
        calls++;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return response({ characters: [{ id: 404, name: 'Shared Pilot' }] });
      },
    },
  });
  const [a, b] = await Promise.all([
    resolver.resolve(['Shared Pilot']),
    resolver.resolve(['shared pilot']),
  ]);
  assert.equal(calls, 1);
  assert.equal(a.get('Shared Pilot'), 'active');
  assert.equal(b.get('shared pilot'), 'active');
});

test('resolve budget returns unknown promptly while allowing a successful lookup to warm cache', async (t) => {
  let finishFetch;
  let markFetchStarted;
  const fetchStarted = new Promise((resolve) => { markFetchStarted = resolve; });
  const { resolver, cache } = setup(t, {
    resolverOptions: {
      fetchImpl: async () => {
        markFetchStarted();
        return new Promise((resolve) => { finishFetch = resolve; });
      },
    },
  });
  const resolving = resolver.resolve(['Slow Pilot'], { budgetMs: 0 });
  await fetchStarted;
  const result = await resolving;
  assert.equal(result.get('Slow Pilot'), 'unknown');
  finishFetch(response({ characters: [{ id: 414, name: 'Slow Pilot' }] }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cache.getRecord('Slow Pilot').id, 414);
  assert.equal(cache.getRecord('Slow Pilot').status, 'active');
});

test('ESI outage breaker bypasses later requests until its window expires', async (t) => {
  let now = 1000;
  let calls = 0;
  const { resolver } = setup(t, {
    resolverOptions: {
      now: () => now,
      breakerMs: 30000,
      fetchImpl: async () => { calls++; return response({}, false, 503); },
    },
  });
  assert.equal((await resolver.resolve(['First Failure'])).get('First Failure'), 'unknown');
  assert.equal((await resolver.resolve(['Breaker Hit'])).get('Breaker Hit'), 'unknown');
  assert.equal(calls, 1);
  now += 30001;
  assert.equal((await resolver.resolve(['After Breaker'])).get('After Breaker'), 'unknown');
  assert.equal(calls, 2);
});

test('PilotResolver enrichment merges into the shared cache without losing ESI status/id', async (t) => {
  const { cachePath, cache, resolver } = setup(t, {
    resolverOptions: {
      fetchImpl: async () => response({ characters: [{ id: 505, name: 'Enriched Pilot' }] }),
    },
  });
  const pilotResolver = new PilotResolver({
    log: { warn() {} },
    cache,
    characterResolver: resolver,
    fetchImpl: async (url) => {
      if (url.startsWith('https://evewho.com/')) {
        return response({ info: [{ corporation_id: 606, corporation: 'Example Corp', sec_status: 2.5 }] });
      }
      throw Error(`unexpected URL ${url}`);
    },
  });
  const alert = { pilot: 'Enriched Pilot', raw: 'raw intel line' };
  pilotResolver.enrich(alert);
  clearTimeout(pilotResolver.timer);
  pilotResolver.timer = null;
  await pilotResolver.processQueue();
  const reloaded = new CharacterCache({ cachePath, log: { warn() {} }, saveDelayMs: 60000 });
  const record = reloaded.getRecord('Enriched Pilot');
  assert.equal(record.status, 'active');
  assert.equal(record.id, 505);
  assert.equal(record.corp, 606);
  assert.equal(record.corpName, 'Example Corp');
  assert.equal(record.sec, 2.5);
  assert.equal(alert.pilotId, 505);
  reloaded.flush();
});
