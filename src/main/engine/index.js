const { ChatLogWatcher } = require('./watcher');

class Engine {
  constructor(log) {
    this.log = log;
    this.config = null;
    this.running = false;
    this.recentAlerts = [];
    this.onAlert = null;
    this.watcher = new ChatLogWatcher(log);
  }

  start(config) {
    this.config = config;
    this.running = true;
    this.watcher.start(config.logsDirectory, (msg) => this.handleMessage(msg));
    this.log.info('Engine started');
  }

  handleMessage(msg) {
    this.log.parse(`[${msg.channelName}] ${msg.author}: ${msg.message}`);
    // Phase 5: intel parsing goes here
    // Phase 6: alert triggering goes here
  }

  stop() {
    this.watcher.stop();
    this.running = false;
    this.log.info('Engine stopped');
  }

  applyConfig(config) {
    const oldDir = (this.config && this.config.logsDirectory) || null;
    const newDir = config.logsDirectory || null;
    this.config = config;
    if (this.running && oldDir !== newDir) {
      this.watcher.start(newDir, (msg) => this.handleMessage(msg));
    }
    this.log.info('Config applied to engine');
  }

  isRunning() { return this.running; }
  getRecentAlerts() { return this.recentAlerts; }
}

module.exports = { Engine };