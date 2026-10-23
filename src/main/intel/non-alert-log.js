// # FILE: src/main/intel/non-alert-log.js
// # VERSION: 1
// Records chat lines that reached the intel pipeline but produced no alert,
// plus explicit pipeline rejection reasons such as name-gated, stale,
// queue-full, and queue-expired for offline review.
//
// A line lands here when it passed the channel / freshness / duplicate gates and
// then either failed to parse (no pilot, system, ship, count, event or link) or
// parsed but the alert rules found nothing to say for a reason other than range.
// A report that was understood but simply out of range is deliberately excluded:
// the user wants the odd lines, not a log of every distant sighting.
//
// The file starts empty on every app launch: reset() deletes the previous log so
// a restart always begins from a clean slate.
const fs = require('fs');
const path = require('path');

class NonAlertLog {
  constructor({ cachePath }) {
    this.path = path.join(path.dirname(cachePath), 'non-alerts.log');
  }

  // Delete the previous log and start fresh. Called once per app launch.
  reset() {
    try {
      if (fs.existsSync(this.path)) fs.unlinkSync(this.path);
    } catch (_) { /* a locked or missing file is not worth failing startup over */ }
  }

  // Append one raw chat line. Logging must never break the alert pipeline.
  append(rawLine, reason) {
    if (!rawLine) return;
    try {
      fs.appendFileSync(this.path, `${rawLine}${reason ? `\t[reason=${reason}]` : ''}\n`);
    } catch (_) { /* never crash on logging */ }
  }
}

module.exports = { NonAlertLog };
