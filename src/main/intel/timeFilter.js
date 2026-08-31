// MIL timeFilter v1
class TimeFilter {
  constructor() {
    this.downtimeHourUTC = 11;
  }

  getDowntimeCutoff() {
    const now = new Date();
    const cutoff = new Date(Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
      this.downtimeHourUTC, 0, 0
    ));
    if (now < cutoff) cutoff.setUTCDate(cutoff.getUTCDate() - 1);
    return cutoff;
  }

  isAfterDowntime(mtime) {
    return new Date(mtime) >= this.getDowntimeCutoff();
  }

  parseEVETimestamp(timestamp) {
    const m = String(timestamp || '')
      .match(/^(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
    if (!m) return null;
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
  }

  isFresh(timestamp, maxAgeMinutes) {
    const t = this.parseEVETimestamp(timestamp);
    if (!t) return false;
    return (Date.now() - t.getTime()) <= maxAgeMinutes * 60 * 1000;
  }
}

module.exports = { TimeFilter };