// src/main/intel/presence.js
class Presence {
  constructor(data, log) {
    this.data = data;
    this.log = log;
    this.chars = new Map();
    this.nextOrder = 1;
  }

  noteCharacter(character) {
    if (!character) return;
    if (!this.chars.has(character)) {
      this.chars.set(character, { name: character, system: null, order: this.nextOrder++ });
      this.log.watch(`Character online: ${character}`);
    }
  }

  noteMessage(msg) {
    const character = msg.characterName;
    if (!character) return;
    this.noteCharacter(character);
    if (msg.author === 'EVE System') {
      const m = String(msg.message || '')
        .match(/channel\s+changed\s+to\s+local\s*:\s*(.+)$/i);
      if (m) this.setSystem(character, m[1].trim(), 'client');
    }
  }

  noteRaw(raw, character) {
    const m = String(raw || '').match(/^Listener:\s*(.+)$/);
    if (m) this.noteCharacter(m[1].trim());
    else if (character) this.noteCharacter(character);
  }

  setSystem(character, system, source) {
    if (!character || !system) return;
    this.noteCharacter(character);
    const entry = this.chars.get(character);
    if (entry.system !== system) {
      entry.system = system;
      this.log.watch(`${character} system -> ${system} (${source})`);
    }
  }

  all() {
    return [...this.chars.values()].sort((a, b) => a.order - b.order);
  }

  get(character) {
    return this.chars.get(character) || null;
  }
}

module.exports = { Presence };