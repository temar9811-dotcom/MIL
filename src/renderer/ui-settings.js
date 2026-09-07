// MIL ui-settings v13 - primary character selector
const settingsForm = document.getElementById('settings-form');
const logPathInput = document.getElementById('log-path') || document.getElementById('logs-dir');
const proximityInput = document.getElementById('proximity-range');
const channelsInput = document.getElementById('intel-channels') || document.getElementById('channels');
const soundCheckbox = document.getElementById('sound-enabled') || document.getElementById('sound');
const notificationCheckbox = document.getElementById('notification-enabled') || document.getElementById('notifications');
const presenceCheckbox = document.getElementById('presence-windows');
const saveState = document.getElementById('save-state');
const browseBtn = document.getElementById('browse-logs');
const imperiumBtn = document.getElementById('imperium-intel');
const bigTextCheckbox = document.getElementById('big-text');
const groupsBox = document.getElementById('group-alerts');
const intelTimeoutInput = document.getElementById('intel-timeout');
const primarySelect = document.getElementById('primary-char');

const pingEss = document.getElementById('ping-ess');
const pingBubble = document.getElementById('ping-bubble');
const pingDrag = document.getElementById('ping-drag');
const pingAnsiblex = document.getElementById('ping-ansiblex');
const pingCamping = document.getElementById('ping-camping');
const enableDebugCheckbox = document.getElementById('enable-debug');

const volumeRedInput = document.getElementById('volume-red');
const volumeRedLabel = document.getElementById('volume-red-label');
const volumeSoftInput = document.getElementById('volume-soft');
const volumeSoftLabel = document.getElementById('volume-soft-label');
const alertSoundInput = document.getElementById('alert-sound-path');
const softSoundInput = document.getElementById('soft-sound-path');
const browseAlertSound = document.getElementById('browse-alert-sound');
const browseSoftSound = document.getElementById('browse-soft-sound');

const IMPERIUM_INTEL = [
  'fareast.imperium',
  'east.imperium',
  'west.imperium',
  'southeast.imperium',
  'gem.imperium',
];

let loadedGroups = [];

function applyBigText(on) {
  document.body.classList.toggle('big-text', !!on);
  if (bigTextCheckbox) bigTextCheckbox.checked = !!on;
}

if (bigTextCheckbox) {
  bigTextCheckbox.addEventListener('change', () => applyBigText(bigTextCheckbox.checked));
}

function updateVolumeLabels() {
  if (volumeRedLabel && volumeRedInput) volumeRedLabel.textContent = `${volumeRedInput.value}%`;
  if (volumeSoftLabel && volumeSoftInput) volumeSoftLabel.textContent = `${volumeSoftInput.value}%`;
}

async function renderPrimaryChar(settings) {
  if (!primarySelect || !window.electronAPI || !window.electronAPI.getCharacters) return;
  let chars = [];
  try {
    chars = await window.electronAPI.getCharacters();
  } catch (_) { return; }
  primarySelect.innerHTML = '';
  const auto = document.createElement('option');
  auto.value = '';
  auto.textContent = 'Auto (first online)';
  primarySelect.appendChild(auto);
  for (const c of chars) {
    const o = document.createElement('option');
    o.value = c.name;
    o.textContent = c.name;
    primarySelect.appendChild(o);
  }
  primarySelect.value = settings.primaryChar || '';
}

async function renderGroups(settings) {
  if (!groupsBox || !window.electronAPI || !window.electronAPI.getGroups) return;
  try {
    loadedGroups = await window.electronAPI.getGroups();
  } catch (_) { return; }
  const ga = (settings && settings.groupAlerts) || {};
  groupsBox.innerHTML = '';
  for (const g of loadedGroups) {
    const entry = ga[g.id] || {};

    const row = document.createElement('div');
    row.style.marginBottom = '10px';

    const line1 = document.createElement('div');
    line1.style.display = 'flex';
    line1.style.alignItems = 'center';
    line1.style.gap = '8px';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = `group-${g.id}`;
    cb.checked = !!entry.enabled;

    const dot = document.createElement('span');
    dot.style.width = '8px';
    dot.style.height = '8px';
    dot.style.borderRadius = '50%';
    dot.style.flex = '0 0 auto';
    dot.style.background = g.color || '#888';

    const label = document.createElement('label');
    label.htmlFor = cb.id;
    label.style.flex = '1';
    label.textContent = g.label;

    line1.append(cb, dot, label);

    const line2 = document.createElement('div');
    line2.style.display = 'flex';
    line2.style.alignItems = 'center';
    line2.style.gap = '8px';
    line2.style.marginLeft = '24px';
    line2.style.marginTop = '4px';

    const range = document.createElement('input');
    range.type = 'number';
    range.min = '0';
    range.step = '1';
    range.style.width = '70px';
    range.id = `grouprange-${g.id}`;
    range.value = entry.range != null ? entry.range : 5;

    const unit = document.createElement('span');
    unit.style.color = '#888';
    unit.style.fontSize = '0.85em';
    unit.textContent = 'jumps beyond proximity';

    line2.append(range, unit);

    row.append(line1, line2);
    groupsBox.appendChild(row);
  }
}

function collectGroupAlerts() {
  const out = {};
  for (const g of loadedGroups) {
    const cb = document.getElementById(`group-${g.id}`);
    const range = document.getElementById(`grouprange-${g.id}`);
    out[g.id] = {
      enabled: cb ? cb.checked : false,
      range: range ? parseInt(range.value, 10) || 0 : 0,
    };
  }
  return out;
}

window.loadSettings = (settings) => {
  if (!settings) return;
  if (logPathInput) logPathInput.value = settings.logPath || '';
  if (proximityInput) proximityInput.value = settings.proximityRange ?? 2;
  if (channelsInput) channelsInput.value = settings.intelChannels || '';
  if (soundCheckbox) soundCheckbox.checked = settings.soundEnabled !== false && settings.sound !== false;
  if (notificationCheckbox) notificationCheckbox.checked = settings.notificationEnabled !== false && settings.notifications !== false;
  if (presenceCheckbox) presenceCheckbox.checked = (settings.presenceSource || 'window') === 'window';
  if (intelTimeoutInput) intelTimeoutInput.value = settings.intelTimeout ?? 10;

  const ep = (settings && settings.eventPings) || {};
  if (pingEss) pingEss.checked = ep.ess !== false;
  if (pingBubble) pingBubble.checked = ep.bubble !== false;
  if (pingDrag) pingDrag.checked = ep.drag !== false;
  if (pingAnsiblex) pingAnsiblex.checked = ep.ansiblex !== false;
  if (pingCamping) pingCamping.checked = ep.camping !== false;

  const legacy = settings.volume == null ? 50 : settings.volume;
  if (volumeRedInput) volumeRedInput.value = settings.volumeRed == null ? legacy : settings.volumeRed;
  if (volumeSoftInput) volumeSoftInput.value = settings.volumeSoft == null ? legacy : settings.volumeSoft;
  updateVolumeLabels();

  if (alertSoundInput) alertSoundInput.value = settings.alertSoundPath || '';
  if (softSoundInput) softSoundInput.value = settings.softSoundPath || '';

  applyBigText(settings.bigText === true)
    if (enableDebugCheckbox) enableDebugCheckbox.checked = settings.enableDebug === true;
  renderGroups(settings);
  renderPrimaryChar(settings);

  if (settings.watchList && typeof window.renderWatchList === 'function') {
    window.renderWatchList(settings.watchList);
  }
};

if (volumeRedInput) volumeRedInput.addEventListener('input', updateVolumeLabels);
if (volumeSoftInput) volumeSoftInput.addEventListener('input', updateVolumeLabels);

if (browseAlertSound && alertSoundInput) {
  browseAlertSound.addEventListener('click', async () => {
    if (!window.electronAPI || !window.electronAPI.browseWav) return;
    const file = await window.electronAPI.browseWav();
    if (file) alertSoundInput.value = file;
  });
}

if (browseSoftSound && softSoundInput) {
  browseSoftSound.addEventListener('click', async () => {
    if (!window.electronAPI || !window.electronAPI.browseWav) return;
    const file = await window.electronAPI.browseWav();
    if (file) softSoundInput.value = file;
  });
}

if (imperiumBtn && channelsInput) {
  imperiumBtn.addEventListener('click', () => {
    const current = String(channelsInput.value || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const seen = new Set(current.map((s) => s.toLowerCase()));
    for (const ch of IMPERIUM_INTEL) {
      if (!seen.has(ch.toLowerCase())) {
        current.push(ch);
        seen.add(ch.toLowerCase());
      }
    }
    channelsInput.value = current.join(', ');
    if (typeof window.appendDebug === 'function') {
      window.appendDebug('INFO', 'Imperium Intel channels added - remember to Save');
    }
  });
}

if (browseBtn && logPathInput) {
  browseBtn.addEventListener('click', async () => {
    if (!window.electronAPI || !window.electronAPI.browseFolder) return;
    const folder = await window.electronAPI.browseFolder();
    if (folder) {
      logPathInput.value = folder;
      if (typeof window.appendDebug === 'function') {
        window.appendDebug('INFO', `Log folder selected: ${folder}`);
      }
    }
  });
}

if (settingsForm) {
  settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (saveState) saveState.textContent = 'Saving...';

    const soundOn = soundCheckbox ? soundCheckbox.checked : true;
    const notifOn = notificationCheckbox ? notificationCheckbox.checked : true;

    const settings = {
      logPath: logPathInput ? logPathInput.value : '',
      proximityRange: proximityInput ? parseInt(proximityInput.value) || 2 : 2,
      intelChannels: channelsInput ? channelsInput.value : '',
      soundEnabled: soundOn,
      notificationEnabled: notifOn,
      sound: soundOn,
      notifications: notifOn,
      presenceSource: presenceCheckbox && !presenceCheckbox.checked ? 'logs' : 'window',
      primaryChar: primarySelect ? primarySelect.value : '',
      intelTimeout: intelTimeoutInput ? parseInt(intelTimeoutInput.value, 10) || 10 : 10,
      eventPings: {
        ess: pingEss ? pingEss.checked : true,
        bubble: pingBubble ? pingBubble.checked : true,
        drag: pingDrag ? pingDrag.checked : true,
        ansiblex: pingAnsiblex ? pingAnsiblex.checked : true,
        camping: pingCamping ? pingCamping.checked : true,
      },
      groupAlerts: collectGroupAlerts(),
      volumeRed: volumeRedInput ? parseInt(volumeRedInput.value) || 0 : 50,
      volumeSoft: volumeSoftInput ? parseInt(volumeSoftInput.value) || 0 : 50,
      volume: volumeRedInput ? parseInt(volumeRedInput.value) || 0 : 50,
      alertSoundPath: alertSoundInput ? alertSoundInput.value.trim() : '',
      softSoundPath: softSoundInput ? softSoundInput.value.trim() : '',
      bigText: bigTextCheckbox ? bigTextCheckbox.checked : false,
          enableDebug: enableDebugCheckbox ? enableDebugCheckbox.checked : false,
      watchList: typeof window.getWatchListData === 'function' ? window.getWatchListData() : []
    };

    try {
      if (!window.electronAPI || !window.electronAPI.saveSettings) {
        throw new Error('electronAPI.saveSettings is not available. Check preload script.');
      }
      await window.electronAPI.saveSettings(settings);
      if (saveState) {
        saveState.textContent = 'Saved!';
        setTimeout(() => { saveState.textContent = ''; }, 2000);
      }
      if (typeof window.appendDebug === 'function') {
        window.appendDebug('INFO', 'Settings saved successfully');
      }
    } catch (err) {
      if (saveState) saveState.textContent = 'Error!';
      if (typeof window.appendDebug === 'function') {
        window.appendDebug('ERROR', `Failed to save settings: ${err.message}`);
      }
    }
  });
}