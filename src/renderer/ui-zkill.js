// # FILE: src/renderer/ui-zkill.js
// # VERSION: 4
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
var rangeInput = null;
var charFilter = null;
var killList = null;
var saveBtn = null;
var saveState = null;

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
} catch (_) {}
}

function renderKills(kills) {
if (!killList) return;
killList.innerHTML = '';
if (!kills || kills.length === 0) {
var p = document.createElement('p');
p.style.color = '#888';
p.textContent = 'No kills in stream range.';
killList.appendChild(p);
return;
}
var count = Math.min(kills.length, MAX_KILLS);
for (var i = 0; i < count; i++) {
var k = kills[i];
var card = document.createElement('div');
card.className = 'alert alert-soft';
card.style.cursor = 'pointer';
var t = k.time ? new Date(k.time).toLocaleTimeString() : '?';
var line = t + ' | ' + k.system + ' (' + k.jumps + 'j) | ' + 
           (k.finalBlowShip || '?') + ' | ' + (k.victim || '?') + ' | ' + 
           (k.finalBlowChar || '?') + ' (' + (k.attackers || 0) + ')';
card.textContent = line;
card.title = line;
card.addEventListener('click', (function (url) {
return function () { window.open(url, '_blank'); };
})(k.url));
killList.appendChild(card);
}
}

async function processKillForAlerts(kill) {
if (!window.electronAPI || !window.electronAPI.processZkillKill) return;
try {
await window.electronAPI.processZkillKill(kill);
} catch (err) {
if (typeof window.appendDebug === 'function') {
window.appendDebug('WARN', 'Zkill alert processing failed: ' + err.message);
}
}
}

async function poll() {
if (!window.zkillApi || !window.zkillData || !window.zkillData.isLoaded()) return;
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
if (systems.length === 0) { renderKills([]); return; }

var nearby = window.zkillData.systemsWithin(systems, range);
var kills = await window.zkillApi.fetchRecentKills();
var filtered = [];
var now = Date.now();

for (var j = 0; j < kills.length; j++) {
var k = kills[j];
var killTime = new Date(k.time).getTime();
var age = now - killTime;

// 1. Dedupe & 2. Age Gate for Alerting
if (!alertedKills.has(k.id)) {
if (age <= MAX_KILL_AGE_MS) {
await processKillForAlerts(k);
}
alertedKills.set(k.id, now);
}

// Filter for tab display based on stream range
if (nearby.has(k.system)) {
k.jumps = nearby.get(k.system);
filtered.push(k);
}
}

// Prune 24h log to prevent memory leak
var cutoff = now - ALERT_RETENTION_MS;
alertedKills.forEach(function (ts, id) {
if (ts < cutoff) alertedKills.delete(id);
});

filtered.sort(function (a, b) { return a.jumps - b.jumps; });
renderKills(filtered);
} catch (err) {
if (typeof window.appendDebug === 'function') {
window.appendDebug('WARN', 'Zkill poll error: ' + err.message);
}
}
}

async function populateCharFilter() {
if (!charFilter || !window.electronAPI || !window.electronAPI.getCharacters) return;
var chars = [];
try { chars = await window.electronAPI.getCharacters(); } catch (_) { return; }
var cur = charFilter.value;
charFilter.innerHTML = '';
var all = document.createElement('option');
all.value = '';
all.textContent = 'All online';
charFilter.appendChild(all);
for (var i = 0; i < chars.length; i++) {
if (!chars[i].online) continue;
var o = document.createElement('option');
o.value = chars[i].name;
o.textContent = chars[i].name + (chars[i].system ? ' (' + chars[i].system + ')' : '');
charFilter.appendChild(o);
}
charFilter.value = cur;
}

window.loadZkillSettings = function (settings) {
if (!settings) return;
if (rangeInput) rangeInput.value = settings.zkillStreamRange || 5;
if (charFilter) charFilter.value = settings.zkillCharFilter || '';
populateCharFilter();
poll();
if (!pollTimer) pollTimer = setInterval(poll, POLL_MS);
};

function init() {
rangeInput = document.getElementById('zkill-range');
charFilter = document.getElementById('zkill-char-filter');
killList = document.getElementById('zkill-list');
saveBtn = document.getElementById('zkill-save');
saveState = document.getElementById('zkill-save-state');
if (saveBtn) saveBtn.addEventListener('click', saveSettings);
}

if (document.readyState === 'loading') {
document.addEventListener('DOMContentLoaded', init);
} else {
init();
}
})();