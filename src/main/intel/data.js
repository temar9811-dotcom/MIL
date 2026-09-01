// MIL data v2 - systemsWithin BFS for the Intel Map
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class IntelData {
  constructor(log) {
    this.log = log;
    this.adjacency = new Map();
    this.ships = [];
    this.systemNames = [];
    this.load();
  }

  dataDir() {
    return path.join(app.getAppPath(), 'resources', 'data');
  }

  load() {
    try {
      const sysPath = path.join(this.dataDir(), 'systems.json');
      const raw = JSON.parse(fs.readFileSync(sysPath, 'utf8'));
      const map = raw.systems || raw;
      for (const [name, neighbors] of Object.entries(map)) {
        if (!this.adjacency.has(name)) this.adjacency.set(name, new Set());
        for (const n of neighbors || []) {
          this.adjacency.get(name).add(n);
          if (!this.adjacency.has(n)) this.adjacency.set(n, new Set());
          this.adjacency.get(n).add(name);
        }
      }
      this.systemNames = [...this.adjacency.keys()].sort((a, b) => b.length - a.length);
      this.log.info(`Loaded ${this.adjacency.size} systems with ${this.countConnections()} connections`);
    } catch (err) {
      this.log.error(`systems.json load failed: ${err.message}`);
    }
    try {
      const shipPath = path.join(this.dataDir(), 'ships.json');
      const raw = JSON.parse(fs.readFileSync(shipPath, 'utf8'));
      this.ships = (Array.isArray(raw) ? raw : raw.ships || [])
        .slice()
        .sort((a, b) => b.length - a.length);
      this.log.info(`Loaded ${this.ships.length} ships`);
    } catch (err) {
      this.log.error(`ships.json load failed: ${err.message}`);
    }
  }

  countConnections() {
    let count = 0;
    for (const neighbors of this.adjacency.values()) {
      count += neighbors.size;
    }
    return Math.floor(count / 2);
  }

  systemsWithin(from, maxJumps) {
    const out = new Map();
    if (!from || !this.adjacency.has(from)) return out;
    out.set(from, 0);
    let frontier = [from];
    let depth = 0;
    while (frontier.length && depth < maxJumps) {
      depth++;
      const next = [];
      for (const cur of frontier) {
        for (const n of this.adjacency.get(cur) || []) {
          if (!out.has(n)) {
            out.set(n, depth);
            next.push(n);
          }
        }
      }
      frontier = next;
    }
    return out;
  }

  matchSystem(text) {
    return this.matchDict(text, this.systemNames);
  }

  matchShip(text) {
    return this.matchDict(text, this.ships);
  }

  matchDict(text, names) {
    const lower = String(text || '').toLowerCase();
    for (const name of names) {
      const n = name.toLowerCase();
      const idx = lower.indexOf(n);
      if (idx === -1) continue;
      const before = lower[idx - 1];
      const after = lower[idx + n.length];
      const okB = !before || /[^a-z0-9]/.test(before);
      const okA = !after || /[^a-z0-9]/.test(after);
      if (okB && okA) return name;
    }
    return null;
  }

  jumpsBetween(a, b) {
    if (!a || !b || !this.adjacency.has(a) || !this.adjacency.has(b)) return null;
    if (a === b) return 0;
    const seen = new Set([a]);
    let frontier = [a];
    let depth = 0;
    while (frontier.length && depth < 20) {
      depth++;
      const next = [];
      for (const cur of frontier) {
        for (const n of this.adjacency.get(cur) || []) {
          if (n === b) return depth;
          if (!seen.has(n)) {
            seen.add(n);
            next.push(n);
          }
        }
      }
      frontier = next;
    }
    return null;
  }
}

module.exports = { IntelData };