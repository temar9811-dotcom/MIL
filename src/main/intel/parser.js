// MIL parser v4 - ualx alias + strip alias tokens from pilot extraction
const SHIP_ALIASES = {
  cni: 'Caracal Navy Issue',
  eni: 'Exequror Navy Issue',
  exeq: 'Exequror',
  sfi: 'Stabber Fleet Issue',
  vni: 'Vexor Navy Issue',
  'vexor navy': 'Vexor Navy Issue',
  'exeq navy': 'Exequror Navy Issue',
  'stabber fleet': 'Stabber Fleet Issue',
  'harbinger navy': 'Harbinger Navy Issue',
  'drake navy': 'Drake Navy Issue',
  'caracal navy': 'Caracal Navy Issue',
  'imus navy': 'Imicus Navy Issue',
  stileto: 'Stiletto',
  stilleto: 'Stiletto',
  stilletto: 'Stiletto',
  prorator: 'Prorator',
  proratror: 'Prorator',
  cenotapf: 'Cenotaph',
  ikinursa: 'Ikitursa',
  ikatursa: 'Ikitursa',
  huggn: 'Huginn',
  hugin: 'Huginn',
  lokii: 'Loki',
};

const SYSTEM_ALIASES = {
  '78': '78-0R6',
  'c-j': 'C-J6MT',
  '4nd': '4NDT-W',
  'gm-50': 'GM-50Y',
  'ualx': 'UALX-3',
};

// Hostile-activity event pings (user-toggleable in settings)
const EVENT_PINGS = [
  { id: 'ess', label: 'Hostiles in ESS', color: '#fde047',
    re: /\b(e{1,2}ss|in\s+ess|towards\s+ess)\b/i },
  { id: 'bubble', label: 'Bubbles reported', color: '#fb923c',
    re: /\b(bub+les?|buble)\b/i },
  { id: 'drag', label: 'Drag bubble', color: '#f97316',
    re: /\bdrag(ged|ging)?\b/i },
  { id: 'ansiblex', label: 'Ansiblex activity', color: '#a78bfa',
    re: /\bansiblex?\b/i },
  { id: 'camping', label: 'Camping reported', color: '#34d399',
    re: /\bcamp(ing|ed)?\b|\bgatecamp\b/i },
];

const IGNORE = new Set([
  'clr', 'clear', 'clrear', 'ckr', 'lr', 'cleared', 'nv', 'loc', 'wh', 'whs', 'xl', 'x2',
  'gate', 'on', 'in', 'at', 'to', 'the', 'a', 'an', 'of', 'and', 'or', 'probably', 'still',
  'cloaked', 'cloaky', 'smartbomb', 'smartbomber', 'gang', 'fleet', 'members', 'frat',
  'jumping', 'jump', 'jumped', 'jumpig', 'jmpd', 'ty', 'tyty', 'thx', 'fc', 'pvp', 'nice',
  'wrong', 'chat', 'sorry', 'maybe', 'here', 'docked', 'sitting', 'mins', 'minutes',
  'hostiles', 'wtf', 'not', 'some', 'navy', 'issue', 'combat', 'probes', 'out', 'left',
  'ran', 'through', 'next', 'system', 'large', 'group', 'likely', 'took', 'from',
  'wormhole', 'bubble', 'bubbles', 'buble', 'drag', 'burning', 'burn', 'buring', 'now',
  'with', 'use', 'eyes', 'sb', 'somewhere', 'think', 'they', 'have', 'consecutive',
  'are', 'is', 'was', 'were', 'be', 'using', 'blue', 'alts', 'pretty', 'sure', 'capsule',
  'pod', 'signal', 'cartel', 'whatever', 'thanks', 'boosts', 'compression',
  'escalation', 'if', 'its', 'posted', 'dscan', 'has', 'been', 'go', 'goto', 'towards',
  'ess', 'iness', 'eess', 'rn', 'plz', 'status', 'visual', 'numbers', 'names', 'usually',
  'possible', 'might', 'back', 'again', 'others', 'nearby', 'camping', 'camped', 'camp',
  'gatecamp', 'ansiblex', 'ansible', 'freighter', 'transportships', 'active', 'don',
  't', 'dont', 'betwin', 'take', 'carefull', 'careful', 'reprocessing', 'plant',
  'capital', 'capitals', 'ceptor', 't3c', 'kill', 'killed', 'for', 'that', 'comes',
  'after', 'before', 'when', 'need', 'backup', 'up', 'halted', 'link',
  'bloodthirsty', 'machinist', 'operator', 'technician', 'scientist', 'drifter',
  'sleepers', 'sleeper', 'drifters',
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
      .replace(/﻿/g, ' ')
      .replace(/\d+\s*[xх]\s*/gi, ' ');

    const systems = [];
    for (const name of this.data.systemNames) {
      if (this.hasWord(text, name)) systems.push(name);
    }
    for (const [alias, sys] of Object.entries(SYSTEM_ALIASES)) {
      if (this.hasWord(text, alias) && !systems.includes(sys)) systems.push(sys);
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

    const events = [];
    for (const ep of EVENT_PINGS) {
      if (ep.re.test(text)) events.push({ id: ep.id, label: ep.label, color: ep.color });
    }

    const count = this.extractCount(text);
    const pilots = this.extractPilots(text, systems, ships, msg);
    if (!pilots.length && !systems.length && !ships.length && !count && !events.length) return null;

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
      events,
    }));
  }

  extractPilots(text, systems, ships, msg) {
    const pilots = [];
    const push = (name) => {
      let n = String(name || '').trim();
      n = n.replace(/[.,!?;:]+$/, '');
      if (n.length < 2 || n.length > 40) return;
      if (IGNORE.has(n.toLowerCase())) return;
      if (/^[A-Z0-9]{2,5}-[A-Z0-9]{2,5}$/i.test(n)) return;
      if (msg.author && n.toLowerCase() === String(msg.author).toLowerCase()) return;
      if (!pilots.includes(n)) pilots.push(n);
    };

    for (const m of text.matchAll(/击杀：\s*([^\s(（,，]+)/g)) push(m[1]);
    for (const m of text.matchAll(/Kill:\s*([A-Z0-9][\w.'-]*(?:\s+[A-Z0-9][\w.'-]*){0,3})/gi)) {
      push(m[1].trim());
      const shipInKill = m[0].match(/\(([^)]+)\)/);
      if (shipInKill) {
        const s = this.data.matchShip(shipInKill[1]);
        if (s && !ships.includes(s)) ships.push(s);
      }
    }

    let work = text;
    work = work.replace(/击杀：[^\s(（,，]+(\s*\(([^)）]*)\))?/g, ' ');
    work = work.replace(/Kill:[^(]*(\([^)]*\))?/gi, ' ');
    for (const s of systems) work = this.removeWord(work, s);
    for (const s of ships) work = this.removeWord(work, s);
    // Strip the shorthand tokens themselves so they can't become "pilots"
    for (const k of Object.keys(SYSTEM_ALIASES)) work = this.removeWord(work, k);
    for (const k of Object.keys(SHIP_ALIASES)) work = this.removeWord(work, k);
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

module.exports = { IntelParser, EVENT_PINGS };