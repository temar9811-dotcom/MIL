// MIL alerts v5 - primary char wins distance ties
const { GROUPS } = require('./groups');

const RED_COLOR = '#ef4444';
const SOFT_DEFAULT = '#facc15';

class Alerts {
  constructor(deps) {
    this.presence = deps.presence;
    this.data = deps.data;
    this.log = deps.log;
    this.config = deps.config || {};
    this.cooldown = new Map();
    this.systemIdle = new Map();
    this.cooldownMs = 30000;
    this.systemIdleMs = 10000;
  }

  setConfig(config) {
    this.config = config || {};
  }

  closestCharacter(system) {
    const primary = String((this.config && this.config.primaryChar) || '').toLowerCase();
    let best = null;
    for (const c of this.presence.all()) {
      if (!c.system) continue;
      if (!c.online) continue;
      const d = this.data.jumpsBetween(c.system, system);
      if (d == null) continue;
      const rank = primary && c.name.toLowerCase() === primary ? 0 : 1;
      if (!best ||
          d < best.jumps ||
          (d === best.jumps && rank < best.rank) ||
          (d === best.jumps && rank === best.rank && c.order < best.char.order)) {
        best = { char: c, jumps: d, rank };
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

  groupSettings() {
    const raw = this.config.groupAlerts || {};
    return GROUPS.map((g) => ({
      def: g,
      enabled: !!(raw[g.id] && raw[g.id].enabled),
      range: Number(raw[g.id] && raw[g.id].range) || 0,
    }));
  }

  enabledEventPing(event) {
    const ep = this.config.eventPings || {};
    return (event.events || []).find((ev) => ep[ev.id] !== false) || null;
  }

  evaluate(event) {
    if (!event || !event.system) return null;

    const eventPing = this.enabledEventPing(event);
    const pilotLabel = event.pilot
      || (event.count ? `${event.count} hostiles` : null)
      || (eventPing ? eventPing.label : null);
    if (!pilotLabel) return null;

    const proximity = Number(this.config.proximityRange) || 0;
    const best = this.closestCharacter(event.system);
    if (!best) return null;

    let type = null;
    let color = null;

    if (best.jumps <= proximity) {
      type = 'red';
      color = RED_COLOR;
    } else {
      const list = Array.isArray(this.config.watchList) ? this.config.watchList : [];
      const watchHit = list.find((e) => this.matchesWatch(e, event, best.jumps, proximity));
      if (watchHit) {
        type = 'soft';
        color = watchHit.color || SOFT_DEFAULT;
      } else {
        let groupHit = null;
        for (const g of this.groupSettings()) {
          if (!g.enabled || !g.range) continue;
          const ship = String(event.ship || '').toLowerCase();
          if (ship && g.def.ships.some((s) => s.toLowerCase() === ship) && best.jumps <= proximity + g.range) {
            groupHit = g;
            break;
          }
        }
        if (groupHit) {
          type = 'soft';
          color = groupHit.def.color;
        } else if (eventPing) {
          type = 'soft';
          color = eventPing.color;
        }
      }
    }
    if (!type) return null;

    const now = Date.now();

    const sysKey = [event.system, best.char.name].join('|');
    if (type !== 'red' && now - (this.systemIdle.get(sysKey) || 0) < this.systemIdleMs) return null;
    this.systemIdle.set(sysKey, now);

    const pilotKey = [type, event.pilot || `group:${event.system}`, event.system, best.char.name].join('|');
    if (now - (this.cooldown.get(pilotKey) || 0) < this.cooldownMs) return null;
    this.cooldown.set(pilotKey, now);

    return {
      type,
      color,
      character: best.char.name,
      jumps: best.jumps,
      pilot: pilotLabel,
      ship: event.ship || null,
      system: event.system,
    };
  }
}

module.exports = { Alerts };