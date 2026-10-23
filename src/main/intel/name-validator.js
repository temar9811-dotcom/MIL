// Synchronous EVE character-name grammar and lexical classification.
const fs = require('fs');
const path = require('path');

class NameValidator {
  constructor(data, log) {
    this.data = data;
    this.log = log;
    this.words = this.loadWords();
    this.shipNames = new Set((data && Array.isArray(data.ships) ? data.ships : [])
      .map((name) => String(name).toLowerCase()));
  }

  wordsPath() {
    if (this.data && typeof this.data.dataDir === 'function') {
      try {
        return path.join(this.data.dataDir(), 'words.txt');
      } catch (_) {
        // Fall through to the source-tree path for lightweight test adapters.
      }
    }
    return path.resolve(__dirname, '../../../resources/data/words.txt');
  }

  loadWords() {
    try {
      return new Set(fs.readFileSync(this.wordsPath(), 'utf8')
        .split(/\r?\n/)
        .map((word) => word.trim().toLowerCase())
        .filter(Boolean));
    } catch (err) {
      if (this.log && typeof this.log.warn === 'function') {
        this.log.warn(`Pilot word list unavailable; dictionary classification disabled: ${err.message}`);
      }
      return new Set();
    }
  }

  isValid(name) {
    if (typeof name !== 'string') return false;
    // Preserve RIFT's [A-z] range, including punctuation between Z and a.
    if (!/^[A-z0-9 '-]{3,37}$/.test(name)) return false;
    if (/^['-]|['-]$/.test(name)) return false;

    const parts = name.split(' ');
    if (parts.length > 3 || parts.some((part) => part.length === 0)) return false;
    const caps = [25, 35, 12];
    return parts.every((part, index) =>
      part.length <= caps[index] && /^[A-z0-9'-]+$/.test(part));
  }

  classify(name) {
    const value = typeof name === 'string' ? name : String(name == null ? '' : name);
    const lowercase = value === value.toLowerCase();
    if (!this.isValid(value)) return { kind: 'invalid', lowercase };
    if (this.shipNames.has(value.toLowerCase())) {
      return { kind: 'type-name', lowercase };
    }
    const words = value.toLowerCase().split(/\s+/);
    if (words.every((word) => this.words.has(word))) {
      return { kind: 'dictionary', lowercase };
    }
    return { kind: 'candidate', lowercase };
  }
}

module.exports = { NameValidator };
