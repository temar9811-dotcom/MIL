// MIL data v3 - systemsWithin BFS + per-map 2D layouts for the Intel Map
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const MAP_KINDS = ['neweden', 'wormholes', 'pochven'];

class IntelData {
  constructor(log) {
    this.log = log;
    this.adjacency = new Map();
    this.ships = [];
    this.systemNames = [];
    this.map = null;
    this.mapLayouts = {};
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
    try {
      const mapPath = path.join(this.dataDir(), 'map.json');
      this.map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
      const maps = this.map.maps || {};
      const sizes = MAP_KINDS.map((k) => (maps[k] ? `${k}=${maps[k].systems.length}/${maps[k].regions.length}` : `${k}=missing`)).join(' ');
      this.log.info(`Loaded star map (${sizes})`);
    } catch (err) {
      this.log.error(`map.json load failed: ${err.message}`);
      this.map = null;
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

  // Flat 2D galaxy maps for the Intel Map's map view: one per kind
  // ('neweden', 'wormholes', 'pochven'), built lazily from map.json +
  // systems.json adjacency, delivered to the renderer as tightly-packed
  // structured-clone arrays.
  buildMapLayout(kind) {
    const key = MAP_KINDS.includes(kind) ? kind : 'neweden';
    if (this.mapLayouts[key]) return this.mapLayouts[key];
    const map = (this.map && this.map.maps) ? this.map.maps[key] : null;
    this.mapLayouts[key] = {
      ok: false,
      error: null,
      reason: 'missing map.json',
    };
    if (!map) return this.mapLayouts[key];

    try {
      const regionOf = new Map();
      for (const r of map.regions) regionOf.set(r.id, r);

      const nameIdx = new Map();
      const names = [];
      const ax = [];
      const ay = [];
      const region = [];
      const sec = [];
      for (const s of map.systems) {
        const rg = regionOf.get(s.r);
        if (!rg) continue;
        nameIdx.set(s.n, names.length);
        names.push(s.n);
        ax.push(rg.x + s.u);
        ay.push(rg.y + s.v);
        region.push(map.regions.indexOf(rg));
        sec.push(s.s);
      }

      const edges = [];
      for (let i = 0; i < names.length; i++) {
        for (const n of this.adjacency.get(names[i]) || []) {
          const j = nameIdx.get(n);
          if (j != null && j > i) {
            edges.push(i, j);
          }
        }
      }

      this.mapLayouts[key] = {
        ok: true,
        error: null,
        w: map.width,
        h: map.height,
        names,
        x: Int32Array.from(ax),
        y: Int32Array.from(ay),
        region: Int32Array.from(region),
        sec: Uint8Array.from(sec),
        regionNames: map.regions.map((r) => r.name),
        regionCenters: Int32Array.from(map.regions.flatMap((r) => [r.x + (r.w >> 1), r.y + (r.h >> 1)])),
        edges: Int32Array.from(edges),
      };
      this.log.info(`Star map layout ready (${key}: ${names.length} systems, ${edges.length / 2} edges)`);
    } catch (err) {
      this.log.error(`buildMapLayout(${key}) failed: ${err.message}`);
      this.mapLayouts[key] = { ok: false, error: err.message, reason: 'build failed' };
    }
    return this.mapLayouts[key];
  }

  getMapLayoutPayload(kind) {
    const lay = this.buildMapLayout(kind);
    if (!lay.ok) return { ok: false, error: lay.error || lay.reason };
    return {
      ok: true,
      w: lay.w,
      h: lay.h,
      names: lay.names,
      x: lay.x,
      y: lay.y,
      region: lay.region,
      sec: lay.sec,
      regionNames: lay.regionNames,
      regionCenters: lay.regionCenters,
      edges: lay.edges,
    };
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