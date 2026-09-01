// MIL pyramid v1 - Intel Map feed (tracking + backfill + center + payload)
const { GROUPS } = require('../intel/groups');

const DEFAULT_TTL_MIN = 10;

class PyramidFeed {
  constructor(engine) {
    this.e = engine;
    this.enabled = false;
    this.systemIntel = new Map();
    this.distances = null;
    this.you = null;
    this.layoutKey = '';
    this.center = null;
  }

  get log() { return this.e.log; }
  get config() { return this.e.config; }
  get data() { return this.e.data; }
  get registry() { return this.e.registry; }

  setPyramid(enabled) {
    const on = !!enabled;
    if (on === this.enabled) return;
    this.enabled = on;
    if (!on) {
      this.systemIntel.clear();
      this.distances = null;
      this.you = null;
      this.layoutKey = '';
      this.log.info('Intel Map tracking OFF (zero load)');
    } else {
      this.log.info('Intel Map tracking ON');
      this.backfill();
    }
  }

  clearPyramid() {
    this.systemIntel.clear();
    this.log.info('Intel Map intel cleared');
  }

  setPyramidCenter(name) {
    this.center = name || null;
    this.layoutKey = '';
    this.log.info(`Intel Map center: ${this.center || 'primary (auto)'}`);
  }

  intelTtlMs() {
    const mins = Number(this.config && this.config.intelTimeout);
    const v = Number.isFinite(mins) && mins > 0 ? mins : DEFAULT_TTL_MIN;
    return Math.min(v, 120) * 60 * 1000;
  }

  pyramidMaxExtra() {
    const raw = this.config.groupAlerts || {};
    let extra = 0;
    for (const g of GROUPS) {
      const gs = raw[g.id];
      if (gs && gs.enabled) extra = Math.max(extra, Number(gs.range) || 0);
    }
    for (const w of Array.isArray(this.config.watchList) ? this.config.watchList : []) {
      const ex = Number(w.extraRange) || 0;
      if (ex > 0) extra = Math.max(extra, ex);
    }
    if (extra === 0) extra = 10;
    return Math.min(extra, 20);
  }

  // Center selector wins, then settings primary, then first online
  primaryCharEntry() {
    const want = String(this.center || (this.config && this.config.primaryChar) || '').toLowerCase();
    let fallback = null;
    for (const c of this.registry.all()) {
      if (!c.online || !c.system) continue;
      if (want && c.name.toLowerCase() === want) return c;
      if (!fallback) fallback = c;
    }
    return fallback;
  }

  primarySystem() {
    const c = this.primaryCharEntry();
    return c ? c.system : null;
  }

  primaryName() {
    const c = this.primaryCharEntry();
    return c ? c.name : null;
  }

  ensureLayout() {
    if (!this.enabled) return;
    const you = this.primarySystem();
    const proximity = Number(this.config.proximityRange) || 0;
    const extra = this.pyramidMaxExtra();
    const key = [you, proximity, extra].join('|');
    if (key === this.layoutKey && this.distances) return;
    this.layoutKey = key;
    this.you = you;
    if (!you) {
      this.distances = null;
      return;
    }
    this.distances = this.data.systemsWithin(you, Math.min(proximity + extra, 20));
    this.log.info(
      `Intel Map layout rebuilt: you=${you}, out to ${Math.min(proximity + extra, 20)}j (${this.distances.size} systems)`,
    );
  }

  recordSystemIntel(event) {
    if (!this.enabled || !event.system) return;
    const now = Date.now();
    const eventPing = (event.events && event.events[0]) || null;
    const label = event.pilot
      || (event.count ? `${event.count} hostiles` : null)
      || (eventPing ? eventPing.label : null)
      || 'Hostiles';

    let rec = this.systemIntel.get(event.system);
    if (!rec) {
      rec = { ts: now, entries: [] };
      this.systemIntel.set(event.system, rec);
    }
    rec.ts = now;
    rec.entries.push({ pilot: event.pilot || null, ship: event.ship || null, label, ts: now });
    if (rec.entries.length > 15) rec.entries = rec.entries.slice(-15);

    if (event.pilot) {
      const p = event.pilot.toLowerCase();
      for (const [sys, other] of this.systemIntel) {
        if (sys === event.system) continue;
        const kept = other.entries.filter((en) => (en.pilot || '').toLowerCase() !== p);
        if (kept.length !== other.entries.length) {
          if (kept.length === 0) {
            this.systemIntel.delete(sys);
          } else {
            other.entries = kept;
            other.ts = kept[kept.length - 1].ts;
          }
        }
      }
    }
  }

  // Replay recent log tails so the map shows the CURRENT picture on open
  backfill() {
    if (!this.enabled || !this.e.watcher) return;
    const seen = new Set();
    let recorded = 0;
    const ttlMin = this.intelTtlMs() / 60000;
    this.e.watcher.replayIntel((msg) => {
      const channel = String(msg.channelName || '').trim().toLowerCase();
      if (channel === 'local' || !this.e.isIntelChannel(channel)) return;
      if (msg.author === 'EVE System') return;
      if (!this.e.timeFilter.isFresh(msg.timestamp, ttlMin)) return;
      const dedupe = [msg.channelName, msg.timestamp, msg.author, msg.message].join('|');
      if (seen.has(dedupe)) return;
      seen.add(dedupe);
      const events = this.e.parser.parse(msg) || [];
      for (const event of events) {
        if (event.pilot && this.registry.get(event.pilot)) continue;
        this.recordSystemIntel(event);
        recorded++;
      }
    });
    this.log.info(`Intel Map backfill: ${recorded} recent intel events replayed`);
  }

  closestOnlineChar(system) {
    let best = null;
    for (const c of this.registry.all()) {
      if (!c.system || !c.online) continue;
      const d = this.data.jumpsBetween(c.system, system);
      if (d == null) continue;
      if (!best || d < best.d) best = { name: c.name, d };
    }
    return best ? best.name : this.you;
  }

  intelColorFor(system, jumps) {
    const proximity = Number(this.config.proximityRange) || 0;
    if (jumps <= proximity) return '#ef4444';

    const rec = this.systemIntel.get(system);
    const ships = rec ? [...new Set(rec.entries.map((en) => en.ship).filter(Boolean))] : [];

    const raw = this.config.groupAlerts || {};
    for (const g of GROUPS) {
      const gs = raw[g.id];
      if (!gs || !gs.enabled || !(Number(gs.range) > 0)) continue;
      if (jumps <= proximity + Number(gs.range) &&
          ships.some((s) => g.ships.some((x) => x.toLowerCase() === s.toLowerCase()))) {
        return g.color;
      }
    }

    const list = Array.isArray(this.config.watchList) ? this.config.watchList : [];
    for (const w of list) {
      if (!w.pilot && !w.ship) continue;
      const pilots = rec ? rec.entries.map((en) => (en.pilot || '').toLowerCase()) : [];
      const pilotOk = !w.pilot || pilots.includes(w.pilot.toLowerCase());
      const shipOk = !w.ship || ships.some((s) => s.toLowerCase() === w.ship.toLowerCase());
      if (pilotOk && shipOk) return w.color || '#facc15';
    }
    return '#fb923c';
  }

  getPyramid() {
    if (!this.enabled) return { enabled: false };
    this.ensureLayout();
    const proximity = Number(this.config.proximityRange) || 0;
    if (!this.distances || !this.you) {
      return { enabled: true, you: null, youName: null, proximity, cynoMax: 0, softMax: 0, rows: [], alts: [], farAlts: [] };
    }

    const now = Date.now();
    const ttl = this.intelTtlMs();
    for (const [sys, rec] of this.systemIntel) {
      if (now - rec.ts > ttl) this.systemIntel.delete(sys);
    }

    const raw = this.config.groupAlerts || {};
    const cynoRange = raw.cynos && raw.cynos.enabled ? Number(raw.cynos.range) || 0 : 0;
    const extra = this.pyramidMaxExtra();

    const rowsMap = new Map();
    for (const [sys, jumps] of this.distances) {
      if (!rowsMap.has(jumps)) rowsMap.set(jumps, []);
      const rec = this.systemIntel.get(sys);
      const fresh = rec && (now - rec.ts) < ttl;
      let color = null;
      let tip = JSON.stringify([`${sys} · ${jumps}j · no recent intel`]);
      if (fresh) {
        color = this.intelColorFor(sys, jumps);
        const last = rec.entries[rec.entries.length - 1];
        const ships = [...new Set(rec.entries.map((en) => en.ship).filter(Boolean))].slice(0, 3).join(', ');
        const ago = Math.max(0, Math.round((now - rec.ts) / 60000));
        const charName = this.closestOnlineChar(sys) || '?';
        const line1 = [charName, `${jumps} jumps`, sys, last.label, ships]
          .filter(Boolean)
          .join(' > ');
        tip = JSON.stringify([line1, `${ago}m ago`]);
      }
      rowsMap.get(jumps).push({ n: sys, c: color, t: tip });
    }

    const rows = [...rowsMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([jumps, systems]) => ({ jumps, systems: systems.sort((a, b) => a.n.localeCompare(b.n)) }));

    const youName = this.primaryName();
    const alts = [];
    const farAlts = [];
    for (const c of this.registry.all()) {
      if (!c.online || !c.system) continue;
      if (youName && c.name === youName) continue;
      if (this.distances.has(c.system)) {
        alts.push({ name: c.name, system: c.system });
      } else {
        farAlts.push({ name: c.name, system: c.system });
      }
    }

    return {
      enabled: true,
      you: this.you,
      youName,
      proximity,
      cynoMax: cynoRange > 0 ? proximity + cynoRange : 0,
      softMax: proximity + extra,
      rows,
      alts,
      farAlts,
    };
  }
}

module.exports = { PyramidFeed };