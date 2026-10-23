const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'electron') return { app: { getPath: () => require('node:os').tmpdir() } };
  return originalLoad.call(this, request, parent, isMain);
};
const { Engine } = require('../src/main/engine');
Module._load = originalLoad;

function makeEngine() {
  const engine = Object.create(Engine.prototype);
  engine.log = { parse() {}, error() {} };
  engine.config = { intelChannels: 'intel' };
  engine.timeFilter = new (require('../src/main/intel/timeFilter').TimeFilter)();
  engine.nonAlertLog = { rows: [], append(raw, reason) { this.rows.push({ raw, reason }); } };
  engine.seenMessages = new Map();
  engine.messageQueue = [];
  engine.processingQueue = false;
  engine.pipeline = Promise.resolve();
  engine.parser = { parse: (msg) => msg.events || [], nameValidator: { classify: (pilot) => ({ kind: pilot === 'Dictionary' ? 'dictionary' : pilot === 'Loki' ? 'type-name' : 'candidate' }) } };
  engine.characterResolver = null;
  engine.registry = { get: () => null };
  engine.tracker = { record() {} };
  engine.pyramid = { recordSystemIntel() {} };
  engine.alerts = { evaluate(event, reason, atTime) { this.calls.push({ event, atTime }); return { pilot: event.pilot, type: 'red' }; }, calls: [] };
  engine.fireAlert = function(alert, atTime) { (this.fired || (this.fired = [])).push({ alert, atTime }); };
  return engine;
}
function message(n, events = [{ pilot: `Pilot ${n}`, system: 'Jita' }]) {
  return { channelName: 'Intel', author: 'Scout', timestamp: new Date(Date.now() - 1000).toISOString().replace(/-/g, '.').replace('T', ' ').slice(0, 19), message: `report ${n}`, raw: `raw ${n}`, events };
}

test('async gate serializes a burst and passes arrival epoch to alert history', async () => {
  const engine = makeEngine();
  engine.characterResolver = { async resolve(names) { await new Promise((r) => setTimeout(r, 2)); return new Map(names.map((n) => [n, 'unknown'])); } };
  const msgs = Array.from({ length: 30 }, (_, i) => message(i));
  for (const msg of msgs) engine.handleMessage(msg);
  await engine.pipeline;
  assert.deepEqual(engine.fired.map((x) => x.alert.pilot), msgs.map((m) => m.events[0].pilot));
  assert.ok(engine.fired.every((x, i) => x.atTime === engine.alerts.calls[i].atTime));
  assert.equal(engine.messageQueue.length, 0);
});

test('name-gated missing and dormant pilots do not reach alerts or map', async () => {
  const engine = makeEngine();
  engine.characterResolver = { async resolve(names) { return new Map(names.map((n) => [n, 'missing'])); } };
  let mapped = 0;
  engine.pyramid.recordSystemIntel = () => mapped++;
  const msg = message('bad');
  await engine.process(msg, Date.now());
  assert.equal(engine.alerts.calls.length, 0);
  assert.equal(mapped, 0);
  assert.deepEqual(engine.nonAlertLog.rows.at(-1), { raw: msg.raw, reason: 'name-gated' });
});

test('resolver outage fails open and thrown item does not block later item', async () => {
  const engine = makeEngine();
  engine.characterResolver = { async resolve() { return new Map([['Pilot 1', 'unknown']]); } };
  const first = message(1);
  const second = message(2);
  engine.process = async (msg, at) => { if (msg === first) throw new Error('expected test error'); engine.alerts.evaluate(msg.events[0], {}, at); engine.fireAlert({ pilot: msg.events[0].pilot }, at); };
  engine.handleMessage(first);
  engine.handleMessage(second);
  await engine.pipeline;
  assert.deepEqual(engine.fired.map((x) => x.alert.pilot), ['Pilot 2']);
  assert.ok(engine.nonAlertLog.rows.some((row) => row.reason === 'handler-error'));
});
