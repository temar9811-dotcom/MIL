// # FILE: src/main/notifications.js
// # VERSION: 5
// MIL notifications v5 - "N jumps" wording + free-form messages
const { Notification } = require('electron');

class NotificationSender {
  constructor(log) {
    this.log = log;
    this.enabled = true;
  }

  setEnabled(enabled) { this.enabled = enabled; }

  send(alert) {
    if (!this.enabled) return;
    const title = alert.type === 'red' ? 'RED Alert' : 'Soft Alert';
    if (alert.linkOnly) {
      this.show(title, alert.label || 'Intel link');
      return;
    }
    const shipPart = alert.ship ? ` in a ${alert.ship}` : '';
    const intel = `${alert.pilot || alert.label || '?'}${shipPart}`;
    const body = [
      alert.character || '?',
      alert.jumps == null ? '?' : `${alert.jumps} jumps`,
      alert.system || '?',
      intel,
    ].join(' > ');
    this.show(title, body);
  }

  // For sources that already know their own wording (the local monitor).
  sendMessage(title, body) {
    if (!this.enabled) return;
    this.show(title, body);
  }

  show(title, body) {
    try {
      const notif = new Notification({ title, body, silent: true });
      notif.show();
      this.log.info(`OS notification sent: ${title} - ${body}`);
    } catch (err) {
      this.log.warn(`OS notification failed: ${err.message}`);
    }
  }
}

module.exports = { NotificationSender };