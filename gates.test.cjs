const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { IntelParser } = require('./src/main/intel/parser');
const { NameValidator } = require('./src/main/intel/name-validator');

const root = __dirname;
const fixtureDir = path.join(root, 'test', 'fixtures');
const systemsRaw = JSON.parse(fs.readFileSync(path.join(root, 'resources/data/systems.json'), 'utf8'));
const shipsRaw = JSON.parse(fs.readFileSync(path.join(root, 'resources/data/ships.json'), 'utf8'));
const systems = systemsRaw.systems || systemsRaw;
const ships = Array.isArray(shipsRaw) ? shipsRaw : (shipsRaw.ships || []);

// Keep this small data adapter aligned with IntelData's parser-facing API while
// loading the production dictionaries from resources/data (without Electron).
const data = {
  systemNames: Object.keys(systems).sort((a, b) => b.length - a.length),
  ships: ships.slice().sort((a, b) => b.length - a.length),
  matchShip(text) {
    const lower = String(text || '').toLowerCase();
    return this.ships.find((ship) => ship.toLowerCase() === lower) || null;
  },
};
const log = { info() {}, warn() {}, error() {} };
const parser = new IntelParser(data, log);
const nameValidator = new NameValidator(data, log);

// Mirrors watcher.parseLine's accepted EVE chat log shape and returned fields.
function parseLine(rawLine, channelName = 'Intel') {
  const line = rawLine.trim();
  if (!line) return null;
  const match = line.match(/^\[\s*(\d{4}\.\d{2}\.\d{2}\s+\d{2}:\d{2}:\d{2})\s*\]\s+(.+?)\s+>\s+(.*)$/);
  if (!match || (match[3].match(/ > /g) || []).length >= 2) return null;
  const [, timestamp, author, message] = match;
  return {
    timestamp,
    author: author.trim(),
    message: message.trim(),
    channelName,
    raw: line,
  };
}

const fixtures = fs.readdirSync(fixtureDir)
  .filter((name) => name.endsWith('.txt'))
  .sort()
  .flatMap((name) => fs.readFileSync(path.join(fixtureDir, name), 'utf8').split(/\r?\n/))
  .filter(Boolean);

test('fixture chat lines pass through watcher-shaped parsing and IntelParser without throwing', () => {
  assert.ok(fixtures.length >= 4, 'expected chatter, report, CJK, and type-name fixture lines');
  for (const raw of fixtures) {
    const message = parseLine(raw);
    assert.ok(message, `fixture should be a valid chat line: ${raw}`);
    assert.doesNotThrow(() => parser.parse(message), raw);
  }
});

test('IntelParser recognizes production system and ship dictionary entries end-to-end', () => {
  const raw = '[2026.10.23 12:00:00] Scout > Kelon Darklight in Jita Loki';
  const parsed = parser.parse(parseLine(raw));
  assert.ok(Array.isArray(parsed) && parsed.length > 0);
  assert.equal(parsed[0].system, 'Jita');
  assert.equal(parsed[0].ship, 'Loki');
});

test('NameValidator applies EVE grammar and classifies ship, dictionary, and pilot names', () => {
  for (const invalid of ['-22466', '70.4', '---INTEL---', 'ab', "a'"]) {
    assert.equal(nameValidator.classify(invalid).kind, 'invalid', invalid);
  }

  assert.deepEqual(nameValidator.classify('Loki'), { kind: 'type-name', lowercase: false });
  assert.deepEqual(nameValidator.classify('anyone'), { kind: 'dictionary', lowercase: true });
  assert.deepEqual(nameValidator.classify('nice'), { kind: 'dictionary', lowercase: true });
  assert.deepEqual(nameValidator.classify('Nice'), { kind: 'dictionary', lowercase: false });
  assert.deepEqual(nameValidator.classify('Kelon Darklight'), { kind: 'candidate', lowercase: false });
});

test('parser omits invalid and CJK pilot candidates while keeping lexical classifications', () => {
  const parsed = parser.parse(parseLine('[2026.10.23 12:00:00] Scout > Kelon Darklight in Jita Loki'));
  assert.equal(parsed[0].pilot, 'Kelon Darklight');
  assert.equal(parsed[0].pilotKind, 'candidate');

  const cjk = parser.parse(parseLine('[2026.10.23 12:00:00] Scout > 短い名前 in Jita'));
  assert.ok(cjk.every((event) => !event.pilot));

  const prose = parser.parse(parseLine('[2026.10.23 12:00:00] Scout > Anyone in Jita'));
  assert.equal(prose[0].pilot, 'Anyone');
  assert.equal(prose[0].pilotKind, 'dictionary');
});
