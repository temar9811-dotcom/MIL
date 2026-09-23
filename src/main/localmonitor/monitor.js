// Local Monitor — main-process capture → match → alarm loop.
const path = require('path');
const { Worker } = require('worker_threads');
const templates = require('./templates');
const { captureRegion, bgraToRgba, validRegion } = require('./capture');

const MAX_TRIGGERS = 3;
const CYCLE_MIN_MS = 2000;
const CYCLE_MAX_MS = 3000;
const MATCH_TIMEOUT_MS = 8000;

function randomCycleMs() {
  return CYCLE_MIN_MS + Math.random() * (CYCLE_MAX_MS - CYCLE_MIN_MS);
}

function normalizeArea(area) {
  area = area || {};
  return {
    enabled: !!area.enabled,
    x: Number(area.x) || 0,
    y: Number(area.y) || 0,
    x2: Number(area.x2) || 0,
    y2: Number(area.y2) || 0,
  };
}

class LocalMonitor {
  constructor(log, hooks, onStatus) {
    this.log = log;
    this.hooks = hooks || {};
    this.onStatus = onStatus || (() => {});
    this.running = false;
    this.worker = null;
    this.timer = null;
    this.pending = new Map();
    this.msgId = 0;
    this.templateList = [];
    this.triggerCount = 0;
    this.cooldownUntil = 0;
    this.areas = {
      1: { enemy: false, lastCount: 0 },
      2: { enemy: false, lastCount: 0 },
    };
    this.nextCheckAt = 0;
    this.lastCycleAt = 0;
    this.lastError = null;
  }

  config() {
    const s = (this.hooks.getSettings && this.hooks.getSettings()) || {};
    const threshold = Number(s.localThreshold);
    const cooldown = Number(s.localCooldown);
    return {
      enabled: !!s.localMonitorEnabled,
      threshold: Number.isFinite(threshold) ? threshold : 60,
      cooldown: Number.isFinite(cooldown) ? cooldown : 60,
      mute: !!s.localMute,
      templateDir: s.localTemplateDir || '',
      area1: normalizeArea(s.localArea1),
      area2: normalizeArea(s.localArea2),
    };
  }

  start() {
    if (this.running) return { running: true };
    const cfg = this.config();
    try {
      const res = templates.load(cfg.templateDir);
      this.templateList = res.list;
      if (res.count) {
        this.log.info(`Local monitor: loaded ${res.count} templates from ${res.dir}`);
      } else {
        this.log.warn(
          `Local monitor: no templates found in ${res.dir} — monitoring will never match`,
        );
      }
    } catch (err) {
      this.templateList = [];
      this.log.error(`Local monitor: template load failed: ${err.message}`);
    }
    this.running = true;
    this.triggerCount = 0;
    this.cooldownUntil = 0;
    this.lastError = null;
    this.emitStatus();
    this.scheduleNext(0);
    this.log.info('Local monitor started');
    return { running: true };
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.running = false;
    this.triggerCount = 0;
    this.cooldownUntil = 0;
    this.areas[1].enemy = false;
    this.areas[2].enemy = false;
    this.terminateWorker();
    this.emitStatus();
    this.log.info('Local monitor stopped');
  }

  isRunning() {
    return this.running;
  }

  status() {
    const now = Date.now();
    const inCooldown = now < this.cooldownUntil;
    const cfg = this.config();
    return {
      running: this.running,
      masterEnabled: cfg.enabled,
      nextCheckS: this.running
        ? Math.max(0, (this.nextCheckAt - now) / 1000)
        : null,
      areas: {
        1: {
          enabled: cfg.area1.enabled,
          enemy: this.areas[1].enemy,
          lastCount: this.areas[1].lastCount,
        },
        2: {
          enabled: cfg.area2.enabled,
          enemy: this.areas[2].enemy,
          lastCount: this.areas[2].lastCount,
        },
      },
      cooldown: {
        active: inCooldown,
        until: inCooldown ? this.cooldownUntil : 0,
        remainingS: inCooldown ? Math.round((this.cooldownUntil - now) / 1000) : 0,
      },
      triggers: this.triggerCount,
      muted: cfg.mute,
      templates: this.templateList.length,
      lastError: this.lastError,
      lastCycleAt: this.lastCycleAt,
    };
  }

  emitStatus() {
    this.onStatus(this.status());
  }

  scheduleNext(delayMs) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.cycle();
    }, delayMs);
  }

  ensureWorker() {
    if (this.worker && this.worker.wasTerminated !== true) return this.worker;
    const worker = new Worker(path.join(__dirname, 'matcher-worker.js'));
    worker.wasTerminated = false;
    worker.on('message', (msg) => {
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id);
      if (msg.error) pending.reject(new Error(msg.error));
      else pending.resolve(msg.points || []);
    });
    worker.on('error', (err) => {
      this.log.error(`Local monitor: matcher worker error: ${err.message}`);
      this.drainPending(new Error(`matcher worker error: ${err.message}`));
      if (this.worker === worker) this.worker = null;
    });
    worker.on('exit', (code) => {
      if (this.worker === worker) this.worker = null;
      this.drainPending(new Error(`matcher worker exited (code ${code})`));
    });
    this.worker = worker;
    return worker;
  }

  drainPending(err) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pending.clear();
  }

  terminateWorker() {
    if (this.worker) {
      this.worker.wasTerminated = true;
      this.drainPending(new Error('Local monitor stopped'));
      this.worker.terminate();
      this.worker = null;
    }
  }

  match(shot, threshold) {
    return new Promise((resolve, reject) => {
      const worker = this.ensureWorker();
      const id = ++this.msgId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('matcher worker timed out'));
      }, MATCH_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      const payload = {
        id,
        width: shot.width,
        height: shot.height,
        data: shot.data,
        bgra: true,
        templates: this.templateList.map((t) => ({
          width: t.width,
          height: t.height,
          data: t.data,
        })),
        threshold,
      };
      worker.postMessage(payload, [shot.data.buffer]);
    });
  }

  async cycle() {
    if (!this.running) return;
    const cfg = this.config();
    this.lastError = null;
    let anyEnabled = false;
    if (cfg.enabled) {
      for (const [key, area] of [['1', cfg.area1], ['2', cfg.area2]]) {
        const state = this.areas[key];
        state.enemy = false;
        state.lastCount = 0;
        if (!area.enabled) continue;
        anyEnabled = true;
        if (!validRegion(area)) {
          this.log.debug(`Local monitor: area ${key} is not set, skipping`);
          continue;
        }
        try {
          const shot = await captureRegion(area);
          if (!shot) {
            this.log.debug(
              `Local monitor: capture failed for area ${key} (no display?), skipping cycle`,
            );
            continue;
          }
          const points = await this.match(shot, cfg.threshold);
          state.enemy = points.length > 0;
          state.lastCount = points.length;
        } catch (err) {
          this.lastError = err.message || String(err);
          this.log.error(`Local monitor: area ${key} check failed: ${this.lastError}`);
        }
      }
    } else if (this.log.debug) {
      this.log.debug('Local monitor: master switch off, capture skipped');
    }
    if (!anyEnabled) {
      this.log.debug('Local monitor: no enabled areas, capture skipped');
    }
    this.lastCycleAt = Date.now();
    this.handleAlarm(cfg);
    this.emitStatus();
    this.nextCheckAt = Date.now() + randomCycleMs();
    this.scheduleNext(this.nextCheckAt - Date.now());
  }

  handleAlarm(cfg) {
    const enemy = this.areas[1].enemy || this.areas[2].enemy;
    const now = Date.now();
    if (!enemy) {
      this.triggerCount = 0;
      this.cooldownUntil = 0;
      return;
    }
    if (now < this.cooldownUntil) {
      this.log.info('Local monitor: in cooldown, alarm suppressed');
      return;
    }
    this.triggerCount += 1;
    if (this.triggerCount > MAX_TRIGGERS) {
      this.cooldownUntil = now + cfg.cooldown * 1000;
      this.triggerCount = 0;
      this.log.info(
        `Local monitor: ${MAX_TRIGGERS}+ rapid triggers, entering ${cfg.cooldown}s cooldown`,
      );
      return;
    }
    this.fireAlert(cfg);
  }

  syntheticAlert(cfg) {
    return {
      type: 'red',
      pilot: 'Enemy in Local',
      ship: null,
      system: null,
      character: 'Local Monitor',
      jumps: 0,
      source: 'local-monitor',
      sound: !cfg.mute,
    };
  }

  fireAlert(cfg) {
    const alert = this.syntheticAlert(cfg);
    if (this.hooks.fireAlert) this.hooks.fireAlert(alert);
    this.log.alert(`Local monitor: alarm fired (${
      cfg.mute ? 'muted, no sound' : 'with sound'
    })`);
  }

  testAlarm() {
    const cfg = this.config();
    this.fireAlert(cfg);
    return { ok: true, muted: cfg.mute };
  }

  async preview(areaIndex) {
    const cfg = this.config();
    const area = areaIndex === 2 ? cfg.area2 : cfg.area1;
    if (!area || !validRegion(area)) {
      return { ok: false, error: 'Area not set' };
    }
    try {
      const shot = await captureRegion(area);
      if (!shot) {
        return { ok: false, error: 'Capture failed (display not found?)' };
      }
      const rgba = bgraToRgba(shot.data);
      const points = await this.match(shot, cfg.threshold);
      return {
        ok: true,
        width: shot.width,
        height: shot.height,
        rgba,
        points: points || [],
      };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  }
}

module.exports = { LocalMonitor };