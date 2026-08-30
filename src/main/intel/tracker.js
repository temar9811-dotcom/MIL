// src/main/intel/tracker.js
class IntelTracker {
  constructor(log) {
    this.log = log;
    this.pilots = new Map();
  }

  record(event) {
    if (!event || !event.pilot) return null;
    const prev = this.pilots.get(event.pilot) || {};
    const entry = {
      pilot: event.pilot,
      system: event.system || prev.system || null,
      ship: event.ship || prev.ship || null,
      channel: event.channel || prev.channel || null,
      lastSeen: Date.now(),
    };
    this.pilots.set(event.pilot, entry);
    return entry;
  }

  get(pilot) {
    return this.pilots.get(pilot) || null;
  }

  all() {
    return [...this.pilots.values()];
  }

  clear() {
    this.pilots.clear();
  }
}

module.exports = { IntelTracker };