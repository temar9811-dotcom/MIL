// src/main/intel/parser.js
const SHIP_ALIASES = { cni: 'Caracal Navy Issue' };

const IGNORE = new Set([
  'clr', 'clear', 'nv', 'loc', 'wh', 'whs', 'xl', 'x2', 'gate', 'on', 'in', 'at', 'to',
  'the', 'a', 'an', 'of', 'and', 'or', 'probably', 'still', 'cloaked', 'smartbomb',
  'smartbomber', 'gang', 'fleet', 'members', 'frat', 'jumping', 'jump', 'jumped',
  'jumpig', 'ty', 'fc', 'pvp', 'nice', 'wrong', 'chat', 'sorry', 'maybe', 'here',
  'docked', 'sitting', 'mins', 'minutes', 'hostiles', 'wtf', 'not', 'some', 'navy',
  'issue', 'combat', 'probes', 'out', 'left', 'ran', 'through', 'next', 'system',
  'large', 'group', 'likely', 'took', 'from', 'wormhole', 'bubble', 'drag',
  'burning', 'burn', 'buring', 'now', 'with', 'use', 'eyes', 'sb', 'somewhere',
  'think', 'they', 'have', 'consecutive', 'are', 'using', 'blue', 'alts', 'pretty',
  'sure', 'capsule', 'pod', 'signal', 'cartel', 'whatever', 'thanks', 'boosts',
  'compression', 'escalation', 'if', 'its', 'posted', 'dscan', 'has', 'been', 'go',
]);

class IntelParser {
  constructor(data, log) {
    this.data = data;
    this.log = log;
  }

  esc(name) {
    return String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  hasWord(text, name) {
    const re = new RegExp(`(^|[^a-z0-9])${this.esc(name)}([^a-z0-9]|$)`, 'i');
    return re.test(text);
  }

  removeWord(text, name) {
    const re = new RegExp(`(^|[^a-z0-9])${this.esc(name)}([^a-z0-9]|$)`, 'gi');
    return text.replace(re, ' ');
  }

  extractCount(text) {
    let m = text.match(/\+\s*(\d+)/);
    if (m) return parseInt(m[1], 10);
    m = text.match(/(\d+)\s*\+/);
    if (m) return parseInt(m[1], 10);
    m = text.match(/=\s*(\d+)/);
    if (m) return parseInt(m[1], 10);
    m = text.match(/(\d+)\s*=/);
    if (m) return parseInt(m[1], 10);
    return null;
  }

  parse(msg) {
    const rawText = String(msg.message || '').trim();
    if (!rawText) return null;

    const text = rawText
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/\*/g, ' ')
      .replace(/﻿/g, ' ');

    const systems = [];
    for (const name of this.data.systemNames) {
      if (this.hasWord(text, name)) systems.push(name);
    }

    const ships = [];
    for (const name of this.data.ships) {
      if (this.hasWord(text, name)) ships.push(name);
    }
    for (const [alias, ship] of Object.entries(SHIP_ALIASES)) {
      if (this.hasWord(text, alias) && !ships.includes(ship)) ships.push(ship);
    }
    for (const m of text.matchAll(/\(([^)）]+)\)/g)) {
      const inner = m[1].trim();
      const s = this.data.matchShip(inner) || (/级$/.test(inner) ? inner : null);
      if (s && !ships.includes(s)) ships.push(s);
    }

    const count = this.extractCount(text);
    const pilots = this.extractPilots(text, systems, ships, msg);

    if (!pilots.length && !systems.length && !ships.length && !count) return null;

    const list = pilots.length ? pilots : [null];
    return list.map((pilot) => ({
      type: 'report',
      timestamp: msg.timestamp || null,
      channel: msg.channelName || null,
      reporter: msg.author || null,
      pilot,
      count: pilot ? null : count,
      ship: ships[0] || null,
      system: systems[0] || null,
    }));
  }

  extractPilots(text, systems, ships, msg) {
    const pilots = [];
    const push = (name) => {
      let n = String(name || '').trim();
      n = n.replace(/[.,!?;:]+$/, '');
      if (n.length < 2 || n.length > 40) return;
      if (IGNORE.has(n.toLowerCase())) return;
      if (/^[A-Z0-9]{2,5}-[A-Z0-9]{2,5}$/.test(n)) return; // looks like a system code
      if (msg.author && n.toLowerCase() === String(msg.author).toLowerCase()) return;
      if (!pilots.includes(n)) pilots.push(n);
    };

    for (const m of text.matchAll(/击杀：\s*([^\s(（,，]+)/g)) push(m[1]);

    let work = text;
    work = work.replace(/击杀：[^\s(（,，]+(\s*\(([^)）]*)\))?/g, ' ');
    for (const s of systems) work = this.removeWord(work, s);
    for (const s of ships) work = this.removeWord(work, s);
    work = work.replace(/\(([^)）]*)\)/g, ' ');
    work = work.replace(/[+＝=]\s?\d+/g, ' ');
    work = work.replace(/\b\d+\s*[+=-]?\b/g, ' ');
    for (const w of IGNORE) work = this.removeWord(work, w);

    const runs = work.match(/[A-Z0-9][\w.'-]*(?:\s+[A-Z0-9][\w.'-]*){0,3}/g) || [];
    for (const run of runs) push(run.trim());

    const cjk = work.match(/[一-鿿]{2,}(?:\s+[一-鿿]{2,}){0,3}/g) || [];
    for (const run of cjk) push(run.trim());

    return pilots;
  }
}

module.exports = { IntelParser };