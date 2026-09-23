// # FILE: src/renderer/ui-local-monitor.js
// # VERSION: 1
/**
Local Monitor tab controller.
Wires the tab UI to the main-process LocalMonitor engine via electronAPI:
status poll + push, Start/Stop toggle, per-area region picker, CSP-safe
canvas previews (ImageData/putImageData), alarm settings persistence.
*/
(function () {
var POLL_MS = 500;
var DEFAULT_AREA = { enabled: false, x: 0, y: 0, x2: 0, y2: 0 };
var DEFAULT_THRESHOLD = 60;
var DEFAULT_COOLDOWN = 60;

var els = {};
var pollTimer = null;
var statusRunning = false;
var lastError = null;

function log(level, msg) {
    if (typeof window.appendDebug === 'function') window.appendDebug(level, 'Local-Monitor: ' + msg);
}

function $(id) {
    return document.getElementById(id);
}

function collectElements() {
    els.status = $('lm-status');
    els.start = $('lm-start');
    els.test = $('lm-test');
    els.threshold = $('lm-threshold');
    els.thresholdLabel = $('lm-threshold-label');
    els.cooldown = $('lm-cooldown');
    els.mute = $('lm-mute');
    els.save = $('lm-save');
    els.saveState = $('lm-save-state');
    els.areas = [
        {
            enabled: $('lm-en1'), set: $('lm-set1'), preview: $('lm-preview1'),
            boxes: $('lm-boxes1'), canvas: $('lm-canvas1'), hint: $('lm-hint1'),
            coords: [$('lm-a1-x'), $('lm-a1-y'), $('lm-a1-x2'), $('lm-a1-y2')],
        },
        {
            enabled: $('lm-en2'), set: $('lm-set2'), preview: $('lm-preview2'),
            boxes: $('lm-boxes2'), canvas: $('lm-canvas2'), hint: $('lm-hint2'),
            coords: [$('lm-a2-x'), $('lm-a2-y'), $('lm-a2-x2'), $('lm-a2-y2')],
        },
    ];
}

function readAreaEls(area) {
    return {
        enabled: !!area.enabled.checked,
        x: parseInt(area.coords[0].value, 10) || 0,
        y: parseInt(area.coords[1].value, 10) || 0,
        x2: parseInt(area.coords[2].value, 10) || 0,
        y2: parseInt(area.coords[3].value, 10) || 0,
    };
}

function getSettings() {
    return {
        localThreshold: clampThreshold(els.threshold ? els.threshold.value : '', DEFAULT_THRESHOLD),
        localCooldown: (els.cooldown && Number(els.cooldown.value) >= 0) ? Number(els.cooldown.value) : DEFAULT_COOLDOWN,
        localMute: !!(els.mute && els.mute.checked),
        localArea1: readAreaEls(els.areas[0]),
        localArea2: readAreaEls(els.areas[1]),
    };
}

function clampThreshold(raw, def) {
    var n = parseInt(raw, 10);
    if (!Number.isFinite(n)) return def;
    return Math.max(10, Math.min(100, n));
}

function areaIsSet(data) {
    data = data || {};
    return Number.isFinite(data.x) && Number.isFinite(data.y) &&
        Number.isFinite(data.x2) && Number.isFinite(data.y2) &&
        data.x2 - data.x >= 1 && data.y2 - data.y >= 1;
}

function fillArea(area, data) {
    if (!area) return;
    data = data || DEFAULT_AREA;
    area.enabled.checked = !!data.enabled;
    area.coords[0].value = data.x || 0;
    area.coords[1].value = data.y || 0;
    area.coords[2].value = data.x2 || 0;
    area.coords[3].value = data.y2 || 0;
    if (area.hint) {
        area.hint.textContent = areaIsSet(data)
            ? ''
            : 'Area not set — press "Set area" and drag a box over EVE Local.';
    }
}

async function saveSettings(overrideMaster) {
    if (!window.electronAPI || !window.electronAPI.saveSettings || !window.electronAPI.getSettings) {
        log('WARN', 'electronAPI.saveSettings not available');
        return false;
    }
    try {
        var existing = await window.electronAPI.getSettings();
        var merged = Object.assign({}, existing, getSettings());
        if (overrideMaster !== undefined) {
            merged.localMonitorEnabled = !!overrideMaster;
        } else {
            merged.localMonitorEnabled = !!existing.localMonitorEnabled;
        }
        await window.electronAPI.saveSettings(merged);
        if (els.saveState) {
            els.saveState.textContent = 'Saved!';
            setTimeout(function () { els.saveState.textContent = ''; }, 2000);
        }
        log('INFO', 'Settings saved successfully.');
        return true;
    } catch (err) {
        log('ERROR', 'Failed to save settings: ' + err.message);
        return false;
    }
}

function formatArea(label, a) {
    if (!a) return label + ': n/a';
    if (!a.enabled) return label + ': disabled';
    if (a.enemy) return label + ': enemy x' + a.lastCount;
    return label + ': clear' + (a.lastCount ? ' (' + a.lastCount + ')' : '');
}

function renderStatus(data) {
    if (!data) return;
    var parts = [];
    if (data.running) {
        statusRunning = true;
        parts.push('running');
        if (typeof data.nextCheckS === 'number') {
            parts.push('next check in ' + Math.max(0, Math.ceil(data.nextCheckS)) + 's');
        }
    } else {
        statusRunning = false;
        parts.push('stopped');
    }
    parts.push(formatArea('A1', data.areas && data.areas[1]));
    parts.push(formatArea('A2', data.areas && data.areas[2]));
    if (data.cooldown && data.cooldown.active) {
        parts.push('cooldown ' + Math.max(0, Math.round(data.cooldown.remainingS)) + 's');
    }
    if (typeof data.templates === 'number') {
        parts.push(data.templates + ' template' + (data.templates === 1 ? '' : 's'));
    }
    if (data.muted) parts.push('muted');
    if (data.lastError) parts.push('error: ' + data.lastError);
    if (els.status) els.status.textContent = parts.join(' · ');
    if (els.start) {
        els.start.textContent = data.running ? 'Stop' : 'Start';
        els.start.classList.toggle('running', !!data.running);
    }
    if (data.lastError !== lastError) {
        lastError = data.lastError;
        if (data.lastError) log('WARN', 'monitor error: ' + data.lastError);
    }
}

async function refreshStatus() {
    if (!window.electronAPI || !window.electronAPI.localMonitorStatus) return;
    try {
        renderStatus(await window.electronAPI.localMonitorStatus());
    } catch (err) {
        log('DEBUG', 'Status poll failed: ' + err.message);
    }
}

function startPoll() {
    if (pollTimer || !els.start) return;
    pollTimer = setInterval(refreshStatus, POLL_MS);
}

async function toggleStart() {
    if (!window.electronAPI || !window.electronAPI.localMonitorStart || !window.electronAPI.localMonitorStop) return;
    if (statusRunning) {
        try {
            await window.electronAPI.localMonitorStop();
            await saveSettings(false);
            log('INFO', 'Local monitor stopped.');
        } catch (err) {
            log('ERROR', 'Failed to stop local monitor: ' + err.message);
        }
    } else {
        var saved = await saveSettings(true);
        if (!saved) return;
        try {
            await window.electronAPI.localMonitorStart();
            log('INFO', 'Local monitor started.');
        } catch (err) {
            log('ERROR', 'Failed to start local monitor: ' + err.message);
        }
    }
    await refreshStatus();
}

async function testAlarm() {
    if (!window.electronAPI || !window.electronAPI.testLocalAlarm) return;
    try {
        var res = await window.electronAPI.testLocalAlarm();
        log('INFO', 'Test alarm sent (muted: ' + !!(res && res.muted) + ').');
    } catch (err) {
        log('ERROR', 'Test alarm failed: ' + err.message);
    }
}

async function pickArea(i) {
    if (!window.electronAPI || !window.electronAPI.pickLocalArea) return;
    var area = els.areas[i - 1];
    if (!area) return;
    try {
        var res = await window.electronAPI.pickLocalArea(i);
        if (!res || !res.ok) {
            log('INFO', 'Area ' + i + ' pick canceled' + (res && res.reason ? ': ' + res.reason : '') + '.');
            return;
        }
        var a = res.area || {};
        area.enabled.checked = true;
        area.coords[0].value = a.x || 0;
        area.coords[1].value = a.y || 0;
        area.coords[2].value = a.x2 || 0;
        area.coords[3].value = a.y2 || 0;
        if (area.hint) area.hint.textContent = '';
        log('INFO', 'Area ' + i + ' set: ' + JSON.stringify(a));
        await saveSettings();
        await refreshStatus();
    } catch (err) {
        log('ERROR', 'Area ' + i + ' pick failed: ' + err.message);
    }
}

function clearPreview(area, hint) {
    if (!area || !area.canvas) return;
    var ctx = area.canvas.getContext('2d');
    if (ctx) {
        ctx.clearRect(0, 0, area.canvas.width, area.canvas.height);
    }
    area.canvas.width = 640;
    area.canvas.height = 360;
    if (area.hint) area.hint.textContent = hint || 'No preview available.';
}

function drawBoxes(ctx, points) {
    if (!points || !points.length) return;
    ctx.strokeStyle = '#e94560';
    ctx.lineWidth = 2;
    for (var i = 0; i < points.length; i++) {
        var p = points[i];
        if (!p || p.length < 4 || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
        ctx.strokeRect(Math.round(p[0]), Math.round(p[1]), Math.round(p[2]), Math.round(p[3]));
    }
}

function rgbaPixels(rgba) {
    if (!rgba) return null;
    if (rgba instanceof Uint8Array) return rgba;
    if (Object.prototype.toString.call(rgba) === '[object Uint8Array]') return rgba;
    if (rgba.data instanceof Uint8Array) return rgba.data;
    return null;
}

async function previewArea(i) {
    if (!window.electronAPI || !window.electronAPI.localMonitorPreview) return;
    var area = els.areas[i - 1];
    if (!area) return;
    var showBoxes = area.boxes && area.boxes.checked;
    try {
        if (area.hint) area.hint.textContent = 'Capturing…';
        var res = await window.electronAPI.localMonitorPreview(i);
        if (!res || !res.ok) {
            clearPreview(area, (res && res.error) ? ('Preview unavailable: ' + res.error) : 'Preview unavailable.');
            return;
        }
        var w = res.width;
        var h = res.height;
        var px = rgbaPixels(res.rgba);
        if (!w || !h || !px) {
            clearPreview(area, 'Preview returned no image data.');
            return;
        }
        if (px.length !== w * h * 4) {
            log('WARN', 'Preview rgba size mismatch: got ' + px.length + ' expected ' + (w * h * 4));
            clearPreview(area, 'Preview data mismatch (' + px.length + ' bytes).');
            return;
        }
        area.canvas.width = w;
        area.canvas.height = h;
        var ctx = area.canvas.getContext('2d');
        if (!ctx) return;
        ctx.putImageData(new ImageData(new Uint8ClampedArray(px), w, h), 0, 0);
        if (showBoxes) drawBoxes(ctx, res.points);
        var count = res.points && res.points.length ? res.points.length : 0;
        if (area.hint) area.hint.textContent = count ? count + ' detection(s).' : 'No detections in this region.';
        log('INFO', 'Previewed area ' + i + ' (' + w + 'x' + h + ').');
    } catch (err) {
        log('ERROR', 'Area ' + i + ' preview failed: ' + err.message);
        clearPreview(area, 'Preview failed: ' + err.message);
    }
}

window.loadLocalMonitorSettings = function (settings) {
    if (!settings || !els.start) return;
    fillArea(els.areas[0], settings.localArea1 || DEFAULT_AREA);
    fillArea(els.areas[1], settings.localArea2 || DEFAULT_AREA);
    if (els.threshold) els.threshold.value = clampThreshold(settings.localThreshold, DEFAULT_THRESHOLD);
    if (els.thresholdLabel) els.thresholdLabel.textContent = els.threshold.value;
    if (els.cooldown) {
        els.cooldown.value = (Number(settings.localCooldown) >= 0) ? settings.localCooldown : DEFAULT_COOLDOWN;
    }
    if (els.mute) els.mute.checked = !!settings.localMute;
    refreshStatus();
    startPoll();
    log('INFO', 'Local Monitor settings loaded.');
};

function init() {
    collectElements();
    if (!els.start) return;
    if (els.start) els.start.addEventListener('click', toggleStart);
    if (els.test) els.test.addEventListener('click', testAlarm);
    if (els.save) els.save.addEventListener('click', function () { saveSettings(); });
    if (els.threshold) {
        els.threshold.addEventListener('input', function () {
            if (els.thresholdLabel) els.thresholdLabel.textContent = els.threshold.value;
        });
    }
    if (els.areas[0].set) els.areas[0].set.addEventListener('click', function () { pickArea(1); });
    if (els.areas[1].set) els.areas[1].set.addEventListener('click', function () { pickArea(2); });
    if (els.areas[0].preview) els.areas[0].preview.addEventListener('click', function () { previewArea(1); });
    if (els.areas[1].preview) els.areas[1].preview.addEventListener('click', function () { previewArea(2); });
    if (window.electronAPI && window.electronAPI.onLocalMonitorStatus) {
        window.electronAPI.onLocalMonitorStatus(renderStatus);
    }
    log('INFO', 'Local Monitor UI initialized.');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
})();