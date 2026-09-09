// # FILE: src/renderer/ui-zkill.js
// # VERSION: 6
/**
Zkill tab controller with Phase 2 alerting integration.
Filters kills by stream range for display,
but sends eligible kills to main process for alert evaluation.
Includes a 2-minute age gate and 24-hour deduplication for alerts.
*/
(function () {
var POLL_MS = 30000;
var MAX_KILLS = 100;
var MAX_KILL_AGE_MS = 2 * 60 * 1000; // 2 minutes
var ALERT_RETENTION_MS = 24 * 60 * 60 * 1000; // 24 hours
var alertedKills = new Map(); // killmail_id -> timestamp
var pollTimer = null;
var charRefreshTimer = null;
var rangeInput = null;
var charFilter = null;
var killList = null;
var saveBtn = null;
var saveState = null;

function log(level, msg) {
    if (typeof window.appendDebug === 'function') window.appendDebug(level, 'Zkill-UI: ' + msg);
}

function getSettings() {
    return {
        zkillStreamRange: rangeInput ? parseInt(rangeInput.value, 10) || 5 : 5,
        zkillCharFilter: charFilter ? charFilter.value : ''
    };
}

async function saveSettings() {
    if (!window.electronAPI || !window.electronAPI.saveSettings) return;
    try {
        var existing = await window.electronAPI.getSettings();
        var merged = Object.assign({}, existing, getSettings());
        await window.electronAPI.saveSettings(merged);
        if (saveState) {
            saveState.textContent = 'Saved!';
            setTimeout(function () { saveState.textContent = ''; }, 2000);
        }
        log('INFO', 'Settings saved successfully.');
    } catch (err) {
        log('ERROR', 'Failed to save settings: ' + err.message);
    }
}

async function processKillForAlerts(kill) {
    if (!window.electronAPI || !window.electronAPI.processZkillKill) return;
    try {
        log('DEBUG', 'Sending kill ' + kill.id + ' to main process for alert evaluation.');
        await window.electronAPI.processZkillKill(kill);
    } catch (err) {
        log('WARN', 'Alert processing failed for kill ' + kill.id + ': ' + err.message);
    }
}

async function poll() {
    if (!window.zkillApi || !window.zkillData || !window.zkillData.isLoaded()) {
        log('DEBUG', 'Poll skipped: API or Data module not ready.');
        return;
    }
    log('DEBUG', 'Starting Zkill poll cycle...');
    try {
        var chars = [];
        if (window.electronAPI && window.electronAPI.getCharacters) {
            chars = await window.electronAPI.getCharacters();
        }
        var filter = getSettings().zkillCharFilter;
        var range = getSettings().zkillStreamRange;
        var systems = [];
        for (var i = 0; i < chars.length; i++) {
            if (!chars[i].online || !chars[i].system) continue;
            if (filter && chars[i].name !== filter) continue;
            if (systems.indexOf(chars[i].system) === -1) systems.push(chars[i].system);
        }
        if (systems.length === 0) { 
            log('INFO', 'No online characters/systems found. Clearing list.');
            if (window.zkillRender) window.zkillRender.renderKills(killList, []); 
            return; 
        }
        log('INFO', 'Polling for kills within ' + range + ' jumps of ' + systems.length + ' systems.');
        var nearby = window.zkillData.systemsWithin(systems, range);
        var kills = await window.zkillApi.fetchRecentKills();
        var filtered = [];
        var now = Date.now();
        var alertCount = 0;
        
        for (var j = 0; j < kills.length; j++) {
            var k = kills[j];
            k.pulledAt = now; // Track when we pulled this kill for the "Pulled" column
            var killTime = new Date(k.time).getTime();
            var age = now - killTime;
            
            // 1. Dedupe & 2. Age Gate for Alerting
            if (!alertedKills.has(k.id)) {
                if (age <= MAX_KILL_AGE_MS) {
                    await processKillForAlerts(k);
                    alertCount++;
                }
                alertedKills.set(k.id, now);
            }
            
            // Filter for tab display based on stream range
            if (nearby.has(k.system)) {
                k.jumps = nearby.get(k.system);
                filtered.push(k);
            }
        }
        log('INFO', 'Processed ' + kills.length + ' kills. Sent ' + alertCount + ' for alerting. Displaying ' + filtered.length + ' in range.');
        
        // Prune 24h log to prevent memory leak
        var cutoff = now - ALERT_RETENTION_MS;
        alertedKills.forEach(function (ts, id) {
            if (ts < cutoff) alertedKills.delete(id);
        });
        
        filtered.sort(function (a, b) { return a.jumps - b.jumps; });
        if (window.zkillRender) window.zkillRender.renderKills(killList, filtered);
    } catch (err) {
        log('ERROR', 'Poll cycle failed: ' + err.message);
    }
}

async function populateCharFilter() {
    if (!charFilter || !window.electronAPI || !window.electronAPI.getCharacters) return;
    var chars = [];
    try {
        chars = await window.electronAPI.getCharacters();
        log('INFO', 'Fetched ' + chars.length + ' characters from registry.');
        var onlineCount = chars.filter(function(c) { return c.online; }).length;
        log('INFO', onlineCount + ' characters currently online.');
    } catch (err) {
        log('WARN', 'Failed to fetch characters: ' + err.message);
        return;
    }
    var cur = charFilter.value;
    charFilter.innerHTML = '';
    var all = document.createElement('option');
    all.value = '';
    all.textContent = 'All online';
    charFilter.appendChild(all);
    var onlineChars = chars.filter(function(c) { return c.online; });
    for (var i = 0; i < onlineChars.length; i++) {
        var o = document.createElement('option');
        o.value = onlineChars[i].name;
        o.textContent = onlineChars[i].name + (onlineChars[i].system ? ' (' + onlineChars[i].system + ')' : '');
        charFilter.appendChild(o);
    }
    charFilter.value = cur;
    if (charFilter.value === '') charFilter.value = ''; // Ensure 'All online' is selected if cur was empty
    log('DEBUG', 'Populated character dropdown with ' + onlineChars.length + ' online characters.');
}

window.loadZkillSettings = function (settings) {
    if (!settings) return;
    if (rangeInput) rangeInput.value = settings.zkillStreamRange || 5;
    if (charFilter) charFilter.value = settings.zkillCharFilter || '';
    populateCharFilter();
    poll();
    if (!pollTimer) pollTimer = setInterval(poll, POLL_MS);
    if (!charRefreshTimer) {
        charRefreshTimer = setInterval(populateCharFilter, 30000);
    }
};

function init() {
    rangeInput = document.getElementById('zkill-range');
    charFilter = document.getElementById('zkill-char-filter');
    killList = document.getElementById('zkill-list');
    saveBtn = document.getElementById('zkill-save');
    saveState = document.getElementById('zkill-save-state');
    if (saveBtn) saveBtn.addEventListener('click', saveSettings);
    log('INFO', 'Zkill UI initialized.');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
})();