// MIL notifications v2 - one-line body: char > range > system > intel
const { Notification } = require('electron');

class NotificationSender {
  constructor(log) {
    this.log = log;
    this.enabled = true;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
  }

  send(alert) {
    if (!this.enabled) return;

    const shipPart = alert.ship ? ` in a ${alert.ship}` : '';
    const intel = `${alert.pilot || '?'}${shipPart}`;
    const body = [
      alert.character || '?',
      `${alert.jumps == null ? '?' : alert.jumps}`,
      alert.system || '?',
      intel,
    ].join(' > ');

    const title = alert.type === 'red' ? 'RED Alert' : 'Soft Alert';

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