// MIL registry v3 - immediate offline flip when client window closes
class CharacterRegistry {
  constructor(log) {
    this.log = log;
    this.characters = new Map();
    this.nextOrder = 1;
    this.offlineTimeoutMs = 30 * 60 * 1000;
  }

  _newEntry(character, online, lastSeen) {
    return {
      name: character,
      system: null,
      order: this.nextOrder++,
      channels: new Set(),
      sessions: new Map(),
      lastSeen: lastSeen || Date.now(),
      online: !!online,
    };
  }

  updateFromHeader(filePath, character, channel, sessionStart, active, lastSeenTs) {
    if (!character) return;
    let entry = this.characters.get(character);
    if (!entry) {
      entry = this._newEntry(character, active, lastSeenTs);
      this.characters.set(character, entry);
      this.log.watch(`Character registered: ${character} (${active ? 'online' : 'offline'})`);
    }
    if (channel) entry.channels.add(channel);
    if (sessionStart) entry.sessions.set(filePath, sessionStart);
    if (active) {
      entry.lastSeen = lastSeenTs || Date.now();
      if (!entry.online) {
        entry.online = true;
        this.log.watch(`${character} back online`);
      }
    }
  }

  recordActivity(character) {
    if (!character) return;
    let entry = this.characters.get(character);
    if (!entry) {
      entry = this._newEntry(character, true, null);
      this.characters.set(character, entry);
      this.log.watch(`Character registered: ${character} (online)`);
      return;
    }
    entry.lastSeen = Date.now();
    if (!entry.online) {
      entry.online = true;
      this.log.watch(`${character} back online`);
    }
  }

  setOffline(character) {
    const entry = this.characters.get(character);
    if (entry && entry.online) {
      entry.online = false;
      this.log.watch(`${entry.name} marked offline (client window closed)`);
    }
  }

  updateSystem(character, system) {
    if (!character || !system) return;
    let entry = this.characters.get(character);
    if (!entry) {
      entry = this._newEntry(character, false, null);
      this.characters.set(character, entry);
      this.log.watch(`Character registered: ${character} (offline)`);
    }
    if (entry.system !== system) {
      entry.system = system;
      this.log.watch(`${character} system -> ${system}`);
    }
  }

  checkOffline() {
    const now = Date.now();
    for (const entry of this.characters.values()) {
      if (entry.online && (now - entry.lastSeen) > this.offlineTimeoutMs) {
        entry.online = false;
        this.log.watch(`${entry.name} marked offline (no activity 30min)`);
      }
    }
  }

  get(character) {
    return this.characters.get(character) || null;
  }

  all() {
    return [...this.characters.values()].sort((a, b) => a.order - b.order);
  }

  getOnline() {
    return this.all().filter((c) => c.online);
  }
}

module.exports = { CharacterRegistry };