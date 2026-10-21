// # FILE: src/main/alerts-bus.js
// # VERSION: 1
// The alert system is the only shared surface in the app.
//
// The log reader (the engine) is always loaded and owns alert history, sounds
// and notifications. Optional modules - the local monitor today, the map and
// zkill tomorrow - are handed one of these and nothing else. They cannot reach
// the engine, each other, or any other subsystem, because they never get a
// reference to them; this object is the whole of what they can see.
//
// Keeping it this narrow is the point. It means a gated module can be turned
// off and its code deleted without anything else noticing, and it means adding
// a module cannot accidentally couple two subsystems together.
class AlertsBus {
  constructor(log, engine) {
    this.log = log;
    this.engine = engine;
  }

  // Play an alert sound by type ('red' | 'soft').
  play(type) {
    try {
      if (this.engine.sounds) this.engine.sounds.play(type);
    } catch (err) {
      this.log.warn(`[alerts] sound failed: ${err.message}`);
    }
  }

  // Raise an OS notification. Modules should normally use push() instead, so
  // the alert also lands in the Alerts tab and the history file.
  notify(title, body) {
    try {
      if (this.engine.notifications) this.engine.notifications.sendMessage(title, body);
    } catch (err) {
      this.log.warn(`[alerts] notification failed: ${err.message}`);
    }
  }

  // Hand a finished alert to the alert system: it goes to the Alerts tab, the
  // history file and the log. Sounds and notifications are the caller's job,
  // which is how the local monitor's red alert stays distinct from a
  // log-derived one.
  push(alert) {
    if (this.engine.pushExternalAlert) this.engine.pushExternalAlert(alert);
  }
}

module.exports = { AlertsBus };
