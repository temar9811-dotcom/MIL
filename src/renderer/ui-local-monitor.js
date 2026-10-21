// # FILE: src/renderer/ui-local-monitor.js
// # VERSION: 1
/**
Local Monitor tab controller.
Wires the tab UI to the main-process LocalMonitor engine via electronAPI:
status poll + push, Start/Stop toggle, per-area region picker, CSP-safe
the 1:1 preview popout (the main process owns its window), alarm settings persistence.
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
    els.checkRate = $('lm-check-rate');
    els.cooldown = $('lm-cooldown');
    els.mute = $('lm-mute');
    els.save = $('lm-save');
    els.saveState = $('lm-save-state');
    els.areas = [
        {
            enabled: $('lm-en1'), set: $('lm-set1'), preview: $('lm-preview1'), snapshot: $('lm-snapshot1'),
            boxes: $('lm-boxes1'), hint: $('lm-hint1'),
            coords: [$('lm-a1-x'), $('lm-a1-y'), $('lm-a1-x2'), $('lm-a1-y2')],
        },
        {
            enabled: $('lm-en2'), set: $('lm-set2'), preview: $('lm-preview2'), snapshot: $('lm-snapshot2'),
            boxes: $('lm-boxes2'), hint: $('lm-hint2'),
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

// The five intervals the main process accepts. Anything else falls back to the
// shipped cadence, so a value that slips through here is not a crash.
var CHECK_RATES = [1, 2, 5, 8, 10];
var DEFAULT_CHECK_RATE = 1;

function clampCheckRate(raw) {
    var n = Number(raw);
    return CHECK_RATES.indexOf(n) === -1 ? DEFAULT_CHECK_RATE : n;
}

function getSettings() {
    return {
        localThreshold: clampThreshold(els.threshold ? els.threshold.value : '', DEFAULT_THRESHOLD),
        localCooldown: (els.cooldown && Number(els.cooldown.value) >= 0) ? Number(els.cooldown.value) : DEFAULT_COOLDOWN,
        localMute: !!(els.mute && els.mute.checked),
        localCheckRate: clampCheckRate(els.checkRate ? els.checkRate.value : DEFAULT_CHECK_RATE),
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

async function saveSettings() {
    if (!window.electronAPI || !window.electronAPI.saveSettings || !window.electronAPI.getSettings) {
        log('WARN', 'electronAPI.saveSettings not available');
        return false;
    }
    try {
        var existing = await window.electronAPI.getSettings();
        var merged = Object.assign({}, existing, getSettings());
        // localMonitorEnabled is the module gate, not the running state, and is
        // deliberately left exactly as it is. Writing it from here used to make
        // Start switch the whole module on and Stop tear it down, so the monitor
        // could never sit still-but-configured, and it came back on its own at
        // the next launch. Only the Start/Stop buttons and the main process own
        // whether it is running.
        merged.localMonitorEnabled = existing.localMonitorEnabled === true;
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
            log('INFO', 'Local monitor stopped.');
        } catch (err) {
            log('ERROR', 'Failed to stop local monitor: ' + err.message);
        }
    } else {
        // Save first: start() runs against the area regions and threshold the
        // main process was last told about, not the ones still in these inputs.
        var saved = await saveSettings();
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
        if (res.snapshot) {
            log('INFO', 'Area ' + i + ' snapshot saved: ' + res.snapshot.file +
                ' (' + res.snapshot.width + 'x' + res.snapshot.height + ' @' + res.snapshot.scalePct + '%)');
        }
        if (res.snapshotError) log('WARN', 'Area ' + i + ' snapshot failed: ' + res.snapshotError);
        await saveSettings();
        await refreshStatus();
    } catch (err) {
        log('ERROR', 'Area ' + i + ' pick failed: ' + err.message);
    }
}

async function snapshotArea(i) {
    if (!window.electronAPI || !window.electronAPI.saveLocalSnapshot) return;
    var area = els.areas[i - 1];
    try {
        if (area && area.hint) area.hint.textContent = 'Capturing…';
        var res = await window.electronAPI.saveLocalSnapshot(i);
        if (!res || !res.ok) {
            var why = (res && res.error) ? res.error : 'unknown error';
            if (area && area.hint) area.hint.textContent = 'Snapshot failed: ' + why;
            log('ERROR', 'Area ' + i + ' snapshot failed: ' + why);
            return;
        }
        if (area && area.hint) {
            area.hint.textContent = 'Snapshot: ' + res.file + ' (' + res.width + 'x' + res.height + ' @' + res.scalePct + '%)';
        }
        log('INFO', 'Area ' + i + ' snapshot saved: ' + res.file);
    } catch (err) {
        log('ERROR', 'Area ' + i + ' snapshot failed: ' + err.message);
    }
}

// The preview is no longer drawn here. Clicking Preview opens a frameless
// popout sized to exactly the capture, so this card only reports what the
// preview found as text - the count is the part that has to survive being one
// line tall.
async function previewArea(i) {
    if (!window.electronAPI || !window.electronAPI.localMonitorPreview) return;
    var area = els.areas[i - 1];
    if (!area || !area.hint) return;
    var showBoxes = area.boxes && area.boxes.checked;
    try {
        area.hint.textContent = 'Capturing…';
        var res = await window.electronAPI.localMonitorPreview({ area: i, boxes: showBoxes });
        if (!res || !res.ok) {
            area.hint.textContent = (res && res.error) ? ('Preview unavailable: ' + res.error) : 'Preview unavailable.';
            log('WARN', 'Preview ' + i + ' failed: ' + ((res && res.error) || 'no reason given'));
            return;
        }
        var count = res.count || 0;
        var size = res.width + 'x' + res.height;
        if (res.clamped) {
            // Worth surfacing: the OS refused the exact size, so the popout is
            // showing a cropped or padded capture and the boxes may not line up.
            area.hint.textContent = count + ' detection(s) at ' + size
                + ' — window clamped to ' + res.windowWidth + 'x' + res.windowHeight + ', image may be cropped.';
            log('WARN', 'Preview ' + i + ' window clamped: capture ' + size
                + ', window ' + res.windowWidth + 'x' + res.windowHeight);
        } else {
            area.hint.textContent = count + ' detection(s) at ' + size + '.';
            log('INFO', 'Previewed area ' + i + ' (' + size + ', ' + count + ' match(es)).');
        }
    } catch (err) {
        area.hint.textContent = 'Preview failed: ' + err.message;
        log('ERROR', 'Area ' + i + ' preview failed: ' + err.message);
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
    if (els.checkRate) els.checkRate.value = String(clampCheckRate(settings.localCheckRate));
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
    if (els.areas[0].snapshot) els.areas[0].snapshot.addEventListener('click', function () { snapshotArea(1); });
    if (els.areas[1].snapshot) els.areas[1].snapshot.addEventListener('click', function () { snapshotArea(2); });
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