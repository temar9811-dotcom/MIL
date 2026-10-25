// # FILE: src/main/localmonitor/index.js
// # VERSION: 2
// Local monitor: polls user-picked screen regions for hostile and neutral
// icons and fires an alert when one is present.
//
// Two areas, both of them Local windows - typically one per logged-in
// character. They deliberately share a single template set: an icon is a
// property of the game, not of a window, so both Locals watch the same
// "image_*" art and both raise the same red alert. What differs between the
// areas is only the screen region being watched, and each keeps its own
// detection state, threshold history and cooldown.
//
// The detection and alerting behaviour follows EVE-Alert
// (github.com/Geuthur/EVE-Alert, GPL-3.0):
//   * a vision pass every 250ms runs the template match and records a boolean
//     per area - the reference has no memory beyond that boolean;
//   * a check pass every randomised 2-3s turns a held positive into alarms:
//     sound and notification on each of the first three checks, then the fourth
//     starts the cooldown, which silently swallows the rest of it. Any check
//     with a negative reading resets both counters.
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, nativeImage, screen } = require('electron');
const { captureRegion, areaSize, isUsableArea, areaRect, areaDisplay } = require('./capture');
const { toChannels, toRgba, resampleChannels } = require('./bitmap');
const { Vision, Template } = require('./vision');
const { PythonDetector } = require('./python-detector');

const AREA_LOCAL_1 = 1;
const AREA_LOCAL_2 = 2;
const AREA_IDS = [AREA_LOCAL_1, AREA_LOCAL_2];
const AREA_LABELS = { [AREA_LOCAL_1]: 'Local 1', [AREA_LOCAL_2]: 'Local 2' };
const VISION_POLL_MS = 250;
const CHECK_MIN_MS = 2000;
const CHECK_MAX_MS = 3000;
// Exclusive "run slower" multipliers offered in settings. The vision pass and
// the alarm check pass scale together, so one number describes the whole
// monitor: at 5x it captures and matches a fifth as often and confirms a hit
// five times more slowly. The timers are computed from these, never stored, so
// the shipped cadence is still the single source of truth.
const CHECK_RATES = [1, 2, 5, 8, 10];
const DEFAULT_CHECK_RATE = 1;
const MAX_SOUND_TRIGGERS = 3;
const DEFAULT_THRESHOLD = 60;
const DEFAULT_COOLDOWN = 60;
const THRESHOLD_MIN = 1;
const THRESHOLD_MAX = 100;
const COOLDOWN_MIN = 0;
const COOLDOWN_MAX = 3600;
const MAX_PIXELS = 2200000;
const MAX_CAPTURE_FAILURES = 3;
const TEMPLATE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.bmp']);
const TEMPLATE_PREFIX = 'image_';

// The interface scales EVE offers. One master image per icon is stored on disk
// and expanded to this set in memory at load time, so a template keeps working
// when the user changes interface scale and the folder never fills up with
// near-duplicate files. A master captured at the top of this range downsamples
// cleanly to every entry below it; the reverse would only invent detail.
const UI_SCALES = [90, 100, 110, 125, 150, 175, 200];
const DEFAULT_MASTER_SCALE = 100;
// A scaled template smaller than this loses the detail the correlation needs.
const MIN_SCALED_SIDE = 4;

// Trailing _<scale> in a file name declares the interface scale the master was
// captured at, e.g. image_hostile-red_150.png. Absent, DEFAULT_MASTER_SCALE is
// assumed and a warning is logged, since every derived size depends on it.
function masterScaleOf(fileName) {
  const base = path.basename(fileName, path.extname(fileName));
  const m = base.match(/_(\d{2,3})$/);
  if (!m) return { scale: DEFAULT_MASTER_SCALE, declared: false };
  const scale = Number(m[1]);
  return { scale: scale > 0 ? scale : DEFAULT_MASTER_SCALE, declared: true };
}

class LocalMonitor {
  constructor(log, deps = {}) {
    this.log = log;
    this.alerts = deps.alerts || null;
    this.sounds = deps.sounds || null;
    this.notifications = deps.notifications || null;
    this.onAlarm = deps.onAlarm || (() => {});
    this.onStatus = deps.onStatus || (() => {});
    this.templatesDirOverride = deps.templatesDir || null;
    this.detector = deps.detector || new PythonDetector(log);

    // Derived timers, seeded at the shipped cadence. setCheckRate rewrites
    // them; the constructor must not go through it because the timers are not
    // running yet and there is nothing to retime.
    this.checkRate = DEFAULT_CHECK_RATE;
    this.visionPollMs = VISION_POLL_MS;
    this.checkMinMs = CHECK_MIN_MS;
    this.checkMaxMs = CHECK_MAX_MS;

    this.running = false;
    this.startPromise = null;
    this.busy = false;
    this.threshold = DEFAULT_THRESHOLD;
    this.cooldown = DEFAULT_COOLDOWN;
    this.muted = false;
    this.templateScale = '100';
    this.lastError = null;
    this.nextCheckAt = 0;
    this.templates = { 1: [], 2: [] };
    this.vision = { 1: null, 2: null };
    this.visionTimer = null;
    this.checkTimer = null;
    this.overlay = null;
    this.overlayResolve = null;
    this.previewWins = { 1: null, 2: null };

    this.areas = {
      1: this.newArea(),
      2: this.newArea(),
    };
  }

  // Sounding an alert goes through the alert bus, which is the only thing a
  // gated module is handed. The direct sounds/notifications deps remain as a
  // fallback so a caller that predates the bus still works; the bus wins when
  // both are present. Both are guarded because a silent failure here would
  // look identical to a clean Local.
  playAlertSound(type) {
    try {
      if (this.alerts) return this.alerts.play(type);
      if (this.sounds) this.sounds.play(type);
    } catch (err) {
      this.log.warn(`[LocalMonitor] sound failed: ${err.message}`);
    }
  }

  notifyAlert(title, body) {
    try {
      if (this.alerts) return this.alerts.notify(title, body);
      if (this.notifications) this.notifications.sendMessage(title, body);
    } catch (err) {
      this.log.warn(`[LocalMonitor] notification failed: ${err.message}`);
    }
  }

  newArea() {
    return {
      enabled: false,
      x: 0,
      y: 0,
      x2: 0,
      y2: 0,
      enemy: false,
      lastCount: 0,
      lastWidth: 0,
      lastHeight: 0,
      // template name -> best score, from the pass that set lastCount.
      lastMatches: null,
      triggers: 0,
      cooldownUntil: 0,
      captureFailures: 0,
    };
  }

  // --- templates -----------------------------------------------------------

  templatesDir() {
    if (this.templatesDirOverride) return this.templatesDirOverride;
    const dev = path.join(__dirname, '..', '..', '..', 'resources', 'local-monitor', 'templates');
    if (fs.existsSync(dev)) return dev;
    const packaged = path.join(
      process.resourcesPath || '',
      'local-monitor',
      'templates',
    );
    return packaged && fs.existsSync(packaged) ? packaged : dev;
  }

  // Expand one master image into a Template per supported interface scale.
  // The master itself is used as-is, so a capture at a scale already in the list
  // costs nothing beyond that one extra copy.
  buildTemplates(entry, planes) {
    const { scale: master, declared } = masterScaleOf(entry);
    const out = [];
    if (!declared) {
      this.log.warn(
        `[LocalMonitor] "${entry}" has no _<scale> suffix; assuming ${master}%. `
        + 'Rename it e.g. image_hostile-red_150.png so the derived sizes are right',
      );
    }
    const seen = new Set();
    const targets = this.templateScale === 'all' ? UI_SCALES : [Number(this.templateScale)];
    for (const target of targets) {
      const ratio = target / master;
      const w = Math.round(planes.width * ratio);
      const h = Math.round(planes.height * ratio);
      if (w < MIN_SCALED_SIDE || h < MIN_SCALED_SIDE) continue;
      const key = `${w}x${h}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const scaled = ratio === 1 ? planes : resampleChannels(planes, w, h);
      out.push(new Template(`${entry}@${target}%`, scaled));
    }
    if (!out.length) {
      this.log.warn(`[LocalMonitor] "${entry}" is too small to scale (${planes.width}x${planes.height})`);
    }
    return out;
  }

  loadTemplates() {
    const dir = this.templatesDir();
    const all = [];
    let entries = [];
    try {
      entries = fs.readdirSync(dir);
    } catch (_) {
      this.log.warn(`[LocalMonitor] template folder not found: ${dir}`);
    }
    for (const entry of entries.sort()) {
      if (TEMPLATE_EXTS.has(path.extname(entry).toLowerCase()) === false) continue;
      const name = entry.toLowerCase();
      if (!name.startsWith(TEMPLATE_PREFIX)) {
        this.log.warn(`[LocalMonitor] ignoring "${entry}": name must start with "${TEMPLATE_PREFIX}"`);
        continue;
      }
      try {
        const img = nativeImage.createFromPath(path.join(dir, entry));
        if (img.isEmpty()) {
          this.log.warn(`[LocalMonitor] could not decode "${entry}"`);
          continue;
        }
        const built = this.buildTemplates(entry, toChannels(img));
        all.push(...built);
        this.log.info(
          `[LocalMonitor] "${entry}" (${img.getSize().width}x${img.getSize().height} at ${masterScaleOf(entry).scale}%) -> ${built.length} interface scale variant(s)`,
        );
      } catch (err) {
        this.log.warn(`[LocalMonitor] could not read "${entry}": ${err.message}`);
      }
    }
    // Both Locals watch the same art, so they share one array of Template
    // instances. That is safe because normalisation happens once in the
    // Template constructor and is idempotent, and it halves the memory and the
    // per-poll work compared with two independent copies. Each area still gets
    // its own Vision, so detection state and cooldowns stay independent.
    const found = { [AREA_LOCAL_1]: all, [AREA_LOCAL_2]: all };
    this.templates = found;
    this.vision = {
      [AREA_LOCAL_1]: new Vision(found[AREA_LOCAL_1]),
      [AREA_LOCAL_2]: new Vision(found[AREA_LOCAL_2]),
    };
    const masters = new Set();
    for (const t of all) masters.add(t.name.replace(/@\d+%(.*)$/, '$1'));
    this.log.info(
      `[LocalMonitor] templates: ${all.length} shared by both Locals in ${dir} `
      + `(${masters.size} master image(s) x ${UI_SCALES.length} interface scales)`,
    );
  }

  // --- settings ------------------------------------------------------------

  applySettings(settings) {
    if (!settings || typeof settings !== 'object') return;
    const priorThreshold = this.threshold;
    const priorScale = this.templateScale;
    if (Number.isFinite(settings.localThreshold)) {
      this.threshold = Math.max(THRESHOLD_MIN, Math.min(THRESHOLD_MAX, Math.round(settings.localThreshold)));
    }
    if (Number.isFinite(settings.localCooldown)) {
      this.cooldown = Math.max(COOLDOWN_MIN, Math.min(COOLDOWN_MAX, Math.round(settings.localCooldown)));
    }
    if ('localMute' in settings) this.muted = !!settings.localMute;
    if ('localTemplateScale' in settings) {
      const value = String(settings.localTemplateScale);
      this.templateScale = value === '90' || value === '100' ? value : '100';
    }
    if ('localCheckRate' in settings) {
      this.setCheckRate(settings.localCheckRate);
    }
    for (const id of AREA_IDS) {
      const src = settings[`localArea${id}`];
      if (!src || typeof src !== 'object') continue;
      const area = this.areas[id];
      if ('enabled' in src) area.enabled = !!src.enabled;
      if ([src.x, src.y, src.x2, src.y2].every((n) => Number.isFinite(n))) {
        area.x = src.x;
        area.y = src.y;
        area.x2 = src.x2;
        area.y2 = src.y2;
      }
    }
    if (this.running && (priorThreshold !== this.threshold || priorScale !== this.templateScale)) {
      this.loadTemplates();
      this.detector.updateSettings(this.threshold / 100, this.templateScale)
        .then(() => this.emit())
        .catch((err) => this.fail(`Could not update OpenCV detector: ${err.message}`));
    }
    this.emit();
  }

  usableAreas() {
    return AREA_IDS.filter((id) => {
      const area = this.areas[id];
      return area.enabled && isUsableArea(area) && this.templates[id].length > 0;
    });
  }

  // --- status --------------------------------------------------------------

  status() {
    const now = Date.now();
    const areas = {};
    for (const id of AREA_IDS) {
      const area = this.areas[id];
      const size = areaSize(area);
      areas[id] = {
        enabled: area.enabled,
        set: isUsableArea(area),
        enemy: area.enemy,
        lastCount: area.lastCount,
        templates: this.templates[id].length,
        width: size.width,
        height: size.height,
      };
    }
    let cooldown = { active: false, remainingS: 0 };
    for (const id of AREA_IDS) {
      const remaining = Math.ceil((this.areas[id].cooldownUntil - now) / 1000);
      if (remaining > 0) cooldown = { active: true, remainingS: remaining };
    }
    return {
      running: this.running,
      threshold: this.threshold,
      // The renderer reads cooldown.active/remainingS for the countdown, so the
      // configured value goes out under a different key.
      cooldownSetting: this.cooldown,
      muted: this.muted,
      templateScale: this.templateScale,
      nextCheckS: this.running ? Math.max(0, Math.ceil((this.nextCheckAt - now) / 1000)) : null,
      cooldown,
      // Both Locals share one template set, so this is the shared length, not
      // a sum over the areas - summing would double-count every variant.
      templates: this.templates[AREA_LOCAL_1].length,
      ...this.checkRateTimings(),
      areas,
      lastError: this.lastError,
    };
  }

  emit() {
    this.onStatus(this.status());
  }

  fail(message) {
    this.lastError = message;
    this.log.error(`[LocalMonitor] ${message}`);
    this.emit();
    return { ok: false, error: message };
  }

  // --- lifecycle -----------------------------------------------------------

  // --- check rate ----------------------------------------------------------
  // One exclusive multiplier drives both timers. Rejecting anything that is
  // not in CHECK_RATES matters: a stray 0 or 100 from a hand-edited config
  // would otherwise turn into a 0ms poll loop.
  setCheckRate(rate) {
    const n = Number(rate);
    const next = CHECK_RATES.includes(n) ? n : DEFAULT_CHECK_RATE;
    if (next === this.checkRate) return false;
    this.checkRate = next;
    this.visionPollMs = VISION_POLL_MS * next;
    this.checkMinMs = CHECK_MIN_MS * next;
    this.checkMaxMs = CHECK_MAX_MS * next;
    // Both timers are already live if we are running, so a change has to
    // retime them rather than wait for a restart.
    if (this.running) this.restartTimers();
    return true;
  }

  checkRateTimings() {
    return {
      checkRate: this.checkRate,
      visionPollMs: this.visionPollMs,
      checkMinMs: this.checkMinMs,
      checkMaxMs: this.checkMaxMs,
    };
  }

  restartTimers() {
    if (this.visionTimer) {
      clearInterval(this.visionTimer);
      this.visionTimer = setInterval(() => this.visionTick(), this.visionPollMs);
    }
    this.nextCheckAt = 0;
    this.scheduleCheck(0);
  }

  async start() {
    if (this.running) return { ok: true };
    if (this.startPromise) return this.startPromise;
    const operation = this.startInternal();
    this.startPromise = operation;
    try {
      return await operation;
    } finally {
      if (this.startPromise === operation) this.startPromise = null;
    }
  }

  async startInternal() {
    this.loadTemplates();
    if (this.templates[AREA_LOCAL_1].length === 0) {
      return this.fail(`No detection templates in ${this.templatesDir()} - add ${TEMPLATE_PREFIX}*.png`);
    }
    const enabled = AREA_IDS.filter((id) => this.areas[id].enabled);
    if (enabled.length === 0) {
      return this.fail('Enable an area and pick a region for it first');
    }
    const usable = [];
    try {
      await this.detector.start(this.templatesDir(), this.threshold / 100, this.templateScale);
    } catch (err) {
      await this.detector.stop();
      return this.fail(`Could not start OpenCV detector: ${err.message}`);
    }
    if (!this.detector.isReady()) {
      await this.detector.stop();
      return this.fail(`No usable templates for ${this.templateScale === 'all' ? 'all sizes' : `${this.templateScale}%`}`);
    }
    for (const id of enabled) {
      if (!isUsableArea(this.areas[id])) {
        const size = areaSize(this.areas[id]);
        await this.detector.stop();
        return this.fail(`Area ${id} region is ${size.width}x${size.height} - set it to at least 8x8`);
      }
      if (this.templates[id].length === 0) {
        await this.detector.stop();
        return this.fail(`${AREA_LABELS[id]} has no templates - add ${TEMPLATE_PREFIX}*.png to the templates folder`);
      }
      const size = areaSize(this.areas[id]);
      if (size.width * size.height > MAX_PIXELS) {
        await this.detector.stop();
        return this.fail(`Area ${id} is ${size.width}x${size.height} - keep it under ${MAX_PIXELS} pixels`);
      }
      // Mirrors the reference's vision_check: fail loudly rather than start a
      // loop that can never see anything.
      const probe = await this.detectArea(this.areas[id]);
      if (probe.error) {
        await this.detector.stop();
        return this.fail(`Screen capture failed for area ${id}: ${probe.error}`);
      }
      usable.push(id);
    }
    for (const id of AREA_IDS) this.resetAlarm(id);
    this.lastError = null;
    this.running = true;
    this.busy = false;
    this.nextCheckAt = Date.now();
    this.visionTimer = setInterval(() => this.visionTick(), this.visionPollMs);
    this.scheduleCheck(0);
    this.emit();
    this.log.info(`[LocalMonitor] started (area ${usable.join(', ')}, threshold ${this.threshold})`);
    return { ok: true };
  }

  stop() {
    const was = this.running;
    if (this.visionTimer) clearInterval(this.visionTimer);
    if (this.checkTimer) clearTimeout(this.checkTimer);
    this.visionTimer = null;
    this.checkTimer = null;
    this.running = false;
    this.detector.stop();
    this.busy = false;
    this.nextCheckAt = 0;
    for (const id of AREA_IDS) {
      this.areas[id].enemy = false;
      this.areas[id].lastCount = 0;
      this.resetAlarm(id);
    }
    if (was) this.log.info('[LocalMonitor] stopped');
    this.emit();
  }

  dispose() {
    this.stop();
    this.closeOverlay();
    this.closeAllPreviews();
  }

  // --- vision --------------------------------------------------------------

  visionTick() {
    if (!this.running || this.busy) return;
    this.busy = true;
    this.visionPass()
      .catch((err) => this.log.error(`[LocalMonitor] vision pass failed: ${err.message}`))
      .then(() => { this.busy = false; });
  }

  async visionPass() {
    for (const id of this.usableAreas()) {
      if (!this.running) return;
      const area = this.areas[id];
      const result = await this.detectArea(area);
      if (result.error) {
        area.captureFailures += 1;
        this.lastError = `Area ${id}: ${result.error}`;
        if (area.captureFailures >= MAX_CAPTURE_FAILURES) {
          this.log.error(`[LocalMonitor] ${this.lastError} ${MAX_CAPTURE_FAILURES}x - stopping`);
          this.stop();
          return;
        }
        continue;
      }
      area.captureFailures = 0;
      area.lastWidth = result.width;
      area.lastHeight = result.height;
      const trace = result.matches.map((m) => ({ name: m.name, score: m.score, x: m.x, y: m.y, w: m.w, h: m.h }));
      const boxes = trace.map((m) => [m.x, m.y, m.w, m.h]);
      area.lastCount = boxes.length;
      area.enemy = boxes.length > 0;
      if (boxes.length > 0) this.rememberMatches(id, trace);
      else area.lastMatches = null;
    }
  }

  detectorRegion(area) {
    const display = areaDisplay(area);
    const displays = screen.getAllDisplays();
    const displayIndex = Math.max(0, displays.findIndex((d) => String(d.id) === String(display.id)));
    return {
      x: area.x, y: area.y,
      width: Math.round(area.x2 - area.x), height: Math.round(area.y2 - area.y),
      displayIndex,
      displays: displays.map((d) => ({ x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height, scaleFactor: d.scaleFactor })),
    };
  }

  async detectArea(area) {
    try {
      const result = await this.detector.detect(this.detectorRegion(area));
      if (result.error) return result;
      // A successful BitBlt can still return a nearly black frame when the
      // EVE window is covered or the selected rectangle no longer points at
      // Local. Treat that as a capture failure instead of a misleading clear.
      if (
        Number.isFinite(result.frameMean)
        && Number.isFinite(result.frameStddev)
        && result.frameMean < 32
        && result.frameStddev < 2
      ) {
        return { ...result, error: 'Captured area is blank or covered; show EVE and reselect the Local region' };
      }
      const width = Math.round((area.x2 - area.x) * areaDisplay(area).scaleFactor);
      const height = Math.round((area.y2 - area.y) * areaDisplay(area).scaleFactor);
      return { ...result, width, height };
    } catch (err) {
      return { matches: [], error: err.message };
    }
  }

  // --- alarm state machine -------------------------------------------------

  scheduleCheck(delay) {
    if (!this.running) return;
    if (this.checkTimer) clearTimeout(this.checkTimer);
    this.checkTimer = setTimeout(() => this.checkTick(), delay);
  }

  checkTick() {
    if (!this.running) return;
    const jitter = this.checkMinMs + Math.floor(Math.random() * (this.checkMaxMs - this.checkMinMs));
    this.nextCheckAt = Date.now() + jitter;
    for (const id of this.usableAreas()) {
      if (this.areas[id].enemy) this.maybeAlarm(id);
      else this.resetAlarm(id);
    }
    this.emit();
    this.scheduleCheck(jitter);
  }

  resetAlarm(id) {
    const area = this.areas[id];
    area.triggers = 0;
    area.cooldownUntil = 0;
  }

  maybeAlarm(id) {
    if (this.muted) return;
    const area = this.areas[id];
    const now = Date.now();
    if (now < area.cooldownUntil) return;
    area.triggers += 1;
    if (area.triggers > MAX_SOUND_TRIGGERS) {
      // Fourth held check: arm the cooldown instead of alarming.
      area.triggers = 0;
      area.cooldownUntil = now + this.cooldown * 1000;
      this.log.info(`[LocalMonitor] area ${id} cooldown for ${this.cooldown}s`);
      return;
    }
    this.fireAlarm(id);
  }

  fireAlarm(id) {
    const count = this.areas[id].lastCount || 1;
    // Both areas are Local windows watching the same hostile/neutral art, so
    // both raise the same red alert. The area label is carried through instead
    // of a severity, so you can tell which client's Local fired it.
    const label = `${AREA_LABELS[id]} x${count}`;
    // The notification is the one line most people ever read, so it says the
    // area and how much matched, in words. `label` already begins with the area
    // name, which is why this does not append "detected in Local" - that read
    // "Local 1 x31 detected in Local". What matched stays in the log line below,
    // which is where the family and score detail belongs.
    const noun = count === 1 ? 'match' : 'matches';
    this.playAlertSound('red');
    this.notifyAlert('RED ALERT', `${AREA_LABELS[id]} detected (${count} ${noun})`);
    // The alert itself only says "something was found". This is the line that
    // answers "what was it", which is the question you actually have when a
    // red alert turns out to be your own window frame or a colour-shifted icon.
    this.log.info(`[LocalMonitor] alarm: ${label} — ${this.describeMatches(id)}`);
    this.onAlarm({
      type: 'red',
      character: 'Local Monitor',
      jumps: 0,
      system: 'Local',
      pilot: null,
      label: label,
      source: 'local-monitor',
    });
  }

  // --- what matched --------------------------------------------------------
  // Fold the pre-merge hits down to one entry per template, keeping the best
  // score each one got. Seven scale variants of the same icon will all hit the
  // same contact; listing all 35 would bury the one line that matters, so the
  // families are collapsed and the best-scoring variant is named.
  rememberMatches(id, trace) {
    const best = new Map();
    for (const hit of trace || []) {
      const prev = best.get(hit.name);
      if (prev === undefined || hit.score > prev) best.set(hit.name, hit.score);
    }
    this.areas[id].lastMatches = best;
  }

  // "image_hostile-red_125.png 0.93" - the icon family without its scale
  // suffix, best score, and how many templates of that family agreed.
  describeMatches(id) {
    const matches = this.areas[id] && this.areas[id].lastMatches;
    if (!matches || matches.size === 0) return 'no template recorded (matcher returned no trace)';
    const families = new Map();
    for (const [name, score] of matches) {
      // image_hostile-red_125.png -> image_hostile-red
      const family = name.replace(/_\d{2,3}\.png$/i, '');
      const prev = families.get(family);
      // Count every variant that fired and keep the best score among them.
      // Replacing the entry on a better score would throw the count away, so
      // the tally and the peak are updated independently.
      if (!prev) {
        families.set(family, { score, count: 1 });
      } else {
        prev.count += 1;
        if (score > prev.score) prev.score = score;
      }
    }
    const parts = [...families.entries()]
      .sort((a, b) => b[1].score - a[1].score)
      .map(([family, v]) => `${family} ${v.score.toFixed(2)}x${v.count}`);
    return `matched ${parts.join(', ')}`;
  }

  // --- renderer actions ----------------------------------------------------

  // --- preview popout ------------------------------------------------------
  // Preview used to hand raw pixels back to the settings window, which painted
  // them into a canvas inside the Local Monitor card. It now opens a frameless
  // popout sized to exactly the capture, so what you inspect is the region and
  // nothing else - no card, no canvas, no caption bar, no scaling.
  //
  // The popout is deliberately *not* zoomed. A 26x26 capture gives a 26x26
  // window. That is the honest answer to "is this the same art as my template",
  // but Windows enforces a minimum window size, so the window is measured after
  // it opens and any clamping is logged and reported back to the caller rather
  // than silently cropping the image.
  previewWindow(areaId) {
    let win = this.previewWins[areaId];
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      if (!win.isVisible()) win.show();
      win.focus();
      return win;
    }
    win = new BrowserWindow({
      width: 1,
      height: 1,
      useContentSize: true,
      show: false,
      frame: false,
      transparent: false,
      backgroundColor: '#000000',
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: false,
      alwaysOnTop: true,
      minWidth: 1,
      minHeight: 1,
      webPreferences: {
        preload: path.join(__dirname, 'preview-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    this.previewWins[areaId] = win;
    // Put it under the cursor: the region being previewed is almost always
    // what the user is looking at, and a window-sized-to-the-capture popout
    // has to go somewhere that does not cover it.
    const pt = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(pt);
    const b = display.workArea;
    const size = win.getContentSize();
    win.setPosition(
      Math.max(b.x, Math.min(pt.x - Math.round(size[0] / 2), b.x + b.width - size[0])),
      Math.max(b.y, Math.min(pt.y - Math.round(size[1] / 2), b.y + b.height - size[1])),
    );
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.once('ready-to-show', () => win.show());
    win.on('closed', () => {
      if (this.previewWins[areaId] === win) this.previewWins[areaId] = null;
    });
    win.loadFile(path.join(__dirname, '..', '..', 'renderer', 'preview.html'))
      .catch((err) => {
        this.log.error(`[LocalMonitor] preview popout failed to load: ${err.message}`);
      });
    return win;
  }

  // Force the window to the capture's exact pixel size, then confirm it stuck.
  // Returns null when the OS refused, so the caller can say so out loud.
  sizePreviewWindow(win, width, height) {
    if (!win || win.isDestroyed()) return null;
    win.setContentSize(Math.max(1, width), Math.max(1, height));
    const [w, h] = win.getContentSize();
    if (w !== width || h !== height) {
      this.log.warn(
        `[LocalMonitor] preview window clamped by the OS: wanted ${width}x${height}, got ${w}x${h}`,
      );
      return { clamped: true, width: w, height: h };
    }
    return { clamped: false, width: w, height: h };
  }

  closePreview(areaId) {
    const win = this.previewWins[areaId];
    if (win && !win.isDestroyed()) win.close();
    this.previewWins[areaId] = null;
  }

  closeAllPreviews() {
    for (const id of AREA_IDS) this.closePreview(id);
  }

  async preview(id, opts) {
    const areaId = Number(id) === AREA_LOCAL_2 ? AREA_LOCAL_2 : AREA_LOCAL_1;
    const showBoxes = !!(opts && opts.boxes);
    const area = this.areas[areaId];
    if (!isUsableArea(area)) return { ok: false, error: `Pick a region for ${AREA_LABELS[areaId]} first` };
    if (!this.vision[areaId] || this.vision[areaId].count === 0) this.loadTemplates();
    const shot = await captureRegion(area);
    if (!shot) return { ok: false, error: 'Screen capture failed' };
    const { rgba, width, height } = toRgba(shot);
    const boxes = this.vision[areaId].count > 0
      ? this.vision[areaId].match(toChannels(shot), this.threshold / 100)
      : [];
    this.log.info(`[LocalMonitor] preview ${AREA_LABELS[areaId]}: ${width}x${height}, ${boxes.length} match(es)`);

    const win = this.previewWindow(areaId);
    const sized = this.sizePreviewWindow(win, width, height);
    if (!sized) return { ok: false, error: 'Preview window could not be opened' };
    win.webContents.send('local-monitor-preview-render', {
      width,
      height,
      rgba,
      points: boxes,
      showBoxes,
      count: boxes.length,
      area: areaId,
    });
    return {
      ok: true,
      width,
      height,
      count: boxes.length,
      clamped: sized.clamped,
      windowWidth: sized.width,
      windowHeight: sized.height,
      threshold: this.threshold,
    };
  }

  testAlarm() {
    if (this.muted) return { ok: true, muted: true };
    this.playAlertSound('red');
    this.notifyAlert('RED ALERT', 'Test alert from Local Monitor');
    // Say plainly that nothing was matched - otherwise this line reads like a
    // real detection in the debug log.
    this.log.info('[LocalMonitor] test alarm fired (no image match — manual test)');
    return { ok: true, muted: false };
  }

  // --- snapshots -----------------------------------------------------------
  // Writes the raw capture of a region to disk. This is what template art is
  // cut from, and because it goes through the same capture path the matcher
  // uses, a template taken from here matches the live region exactly.
  snapshotDir() {
    if (app.isPackaged) {
      return path.join(app.getPath('userData'), 'local-monitor', 'snapshots');
    }
    const dev = path.join(__dirname, '..', '..', '..', 'resources', 'local-monitor', 'snapshots');
    if (fs.existsSync(path.join(__dirname, '..', '..', '..', 'resources', 'local-monitor'))) {
      return dev;
    }
    return path.join(app.getPath('userData'), 'local-monitor', 'snapshots');
  }

  async snapshot(id) {
    const areaId = Number(id) === AREA_LOCAL_2 ? AREA_LOCAL_2 : AREA_LOCAL_1;
    const area = this.areas[areaId];
    if (!isUsableArea(area)) return { ok: false, error: `Area ${areaId} has no region set` };
    const shot = await captureRegion(area);
    if (!shot) return { ok: false, error: 'Screen capture failed' };
    const size = shot.getSize();
    const scale = Math.round(areaDisplay(area).scaleFactor * 100);
    const dir = this.snapshotDir();
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      return { ok: false, error: `Could not create ${dir}: ${err.message}` };
    }
    const file = path.join(dir, `area${areaId}-${scale}pct.png`);
    try {
      fs.writeFileSync(file, shot.toPNG());
    } catch (err) {
      return { ok: false, error: `Could not write ${file}: ${err.message}` };
    }
    this.log.info(`[LocalMonitor] area ${areaId} snapshot ${size.width}x${size.height} @${scale}% -> ${file}`);
    return { ok: true, file, width: size.width, height: size.height, scalePct: scale };
  }

  // --- region picker -------------------------------------------------------

  async pickArea(id) {
    if (this.overlay) return { ok: false, error: 'A region picker is already open' };
    const areaId = Number(id) === AREA_LOCAL_2 ? AREA_LOCAL_2 : AREA_LOCAL_1;
    let result;
    try {
      const rect = await this.openOverlay();
      if (!rect || !isUsableArea(rect)) {
        result = { ok: false, canceled: true };
      } else {
        const area = this.areas[areaId];
        area.x = Math.round(rect.x);
        area.y = Math.round(rect.y);
        area.x2 = Math.round(rect.x2);
        area.y2 = Math.round(rect.y2);
        area.enabled = true;
        this.lastError = null;
        this.emit();
        this.log.info(`[LocalMonitor] area ${areaId} set to ${area.x},${area.y} ${area.x2}x${area.y2}`);
        result = { ok: true, area: { x: area.x, y: area.y, x2: area.x2, y2: area.y2 } };
      }
    } finally {
      this.closeOverlay();
    }
    if (result && result.ok) {
      // Only now, with the tint, hint text and selection box gone, otherwise
      // they would be baked into the snapshot.
      await new Promise((r) => setTimeout(r, 250));
      const shot = await this.snapshot(areaId).catch((err) => ({ ok: false, error: err.message }));
      if (shot && shot.ok) {
        result.snapshot = shot;
      } else if (shot) {
        this.log.warn(`[LocalMonitor] snapshot failed: ${shot.error}`);
        result.snapshotError = shot.error;
      }
    }
    return result;
  }

  openOverlay() {
    return new Promise((resolve) => {
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      const bounds = display.bounds;
      const win = new BrowserWindow({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        show: false,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        webPreferences: {
          preload: path.join(__dirname, 'overlay-preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
      this.overlay = win;
      this.overlayResolve = resolve;
      win.setAlwaysOnTop(true, 'screen-saver');
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      win.once('ready-to-show', () => win.show());
      win.on('closed', () => {
        this.overlay = null;
        this.overlayResolve = null;
      });
      win.loadFile(path.join(__dirname, '..', '..', 'renderer', 'overlay.html'))
        .catch((err) => {
          this.log.error(`[LocalMonitor] region picker failed to load: ${err.message}`);
          this.resolveOverlay(null);
        });
    });
  }

  // The overlay reports its drag in CSS pixels relative to its own window, so
  // shift it into screen coordinates here where the window origin is known.
  resolveOverlayDrag(rect) {
    if (!this.overlay || this.overlay.isDestroyed() || !rect) {
      this.resolveOverlay(null);
      return;
    }
    const b = this.overlay.getBounds();
    this.resolveOverlay({
      x: b.x + Math.round(rect.x0),
      y: b.y + Math.round(rect.y0),
      x2: b.x + Math.round(rect.x1),
      y2: b.y + Math.round(rect.y1),
    });
  }

  resolveOverlay(rect) {
    if (!this.overlayResolve) return;
    const done = this.overlayResolve;
    this.overlayResolve = null;
    done(rect || null);
  }

  closeOverlay() {
    const win = this.overlay;
    this.overlay = null;
    this.resolveOverlay(null);
    if (win && !win.isDestroyed()) win.destroy();
  }
}

module.exports = { LocalMonitor, AREA_LOCAL_1, AREA_LOCAL_2, AREA_LABELS };
