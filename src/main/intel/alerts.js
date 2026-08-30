// src/main/intel/alerts.js
class Alerts {
  constructor(deps) {
    this.presence = deps.presence;
    this.data = deps.data;
    this.log = deps.log;
    this.config = deps.config || {};
    this.cooldown = new Map();
    this.cooldownMs = 30000;
  }

  setConfig(config) {
    this.config = config || {};
  }

  closestCharacter(system) {
    let best = null;
    for (const c of this.presence.all()) {
      if (!c.system) continue;
      const d = this.data.jumpsBetween(c.system, system);
      if (d == null) continue;
      if (!best || d < best.jumps || (d === best.jumps && c.order < best.char.order)) {
        best = { char: c, jumps: d };
      }
    }
    return best;
  }

  matchesWatch(entry, event, jumps, proximity) {
    if (entry.pilot && entry.pilot.toLowerCase() !== String(event.pilot || '').toLowerCase()) return false;
    if (entry.ship && entry.ship.toLowerCase() !== String(event.ship || '').toLowerCase()) return false;
    const extra = Number(entry.extraRange) || 0;
    if (extra === 0) return true;
    return jumps <= proximity + extra;
  }

  evaluate(event) {
    if (!event || !event.system) return null;
    const pilotLabel = event.pilot || (event.count ? `${event.count} hostiles` : null);
    if (!pilotLabel) return null;

    const proximity = Number(this.config.proximityRange) || 0;
    const best = this.closestCharacter(event.system);
    if (!best) return null;

    let type = null;
    if (best.jumps <= proximity) {
      type = 'red';
    } else {
      const list = Array.isArray(this.config.watchList) ? this.config.watchList : [];
      if (list.some((e) => this.matchesWatch(e, event, best.jumps, proximity))) type = 'soft';
    }
    if (!type) return null;

    const key = [type, event.pilot || `group:${event.system}`, event.system, best.char.name].join('|');
    const now = Date.now();
    if (now - (this.cooldown.get(key) || 0) < this.cooldownMs) return null;
    this.cooldown.set(key, now);

    return {
      type,
      character: best.char.name,
      jumps: best.jumps,
      pilot: pilotLabel,
      ship: event.ship || null,
      system: event.system,
    };
  }
}

module.exports = { Alerts };