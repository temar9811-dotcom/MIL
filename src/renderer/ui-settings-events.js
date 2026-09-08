// # FILE: src/renderer/ui-settings-events.js
// # VERSION: 1

const pingEss = document.getElementById('ping-ess');
const pingBubble = document.getElementById('ping-bubble');
const pingDrag = document.getElementById('ping-drag');
const pingAnsiblex = document.getElementById('ping-ansiblex');
const pingCamping = document.getElementById('ping-camping');
const volumeRedInput = document.getElementById('volume-red');
const volumeRedLabel = document.getElementById('volume-red-label');
const volumeSoftInput = document.getElementById('volume-soft');
const volumeSoftLabel = document.getElementById('volume-soft-label');
const alertSoundInput = document.getElementById('alert-sound-path');
const softSoundInput = document.getElementById('soft-sound-path');
const browseAlertSound = document.getElementById('browse-alert-sound');
const browseSoftSound = document.getElementById('browse-soft-sound');
const imperiumBtn = document.getElementById('imperium-intel');
const channelsInput = document.getElementById('intel-channels') || document.getElementById('channels');

const IMPERIUM_INTEL = [
  'fareast.imperium',
  'east.imperium',
  'west.imperium',
  'southeast.imperium',
  'gem.imperium',
];

function updateVolumeLabels() {
  if (volumeRedLabel && volumeRedInput) volumeRedLabel.textContent = `${volumeRedInput.value}%`;
  if (volumeSoftLabel && volumeSoftInput) volumeSoftLabel.textContent = `${volumeSoftInput.value}%`;
}

window.loadEventSettings = (settings) => {
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
};

window.collectEventSettings = () => {
  return {
    eventPings: {
      ess: pingEss ? pingEss.checked : true,
      bubble: pingBubble ? pingBubble.checked : true,
      drag: pingDrag ? pingDrag.checked : true,
      ansiblex: pingAnsiblex ? pingAnsiblex.checked : true,
      camping: pingCamping ? pingCamping.checked : true,
    },
    volumeRed: volumeRedInput ? parseInt(volumeRedInput.value) || 0 : 50,
    volumeSoft: volumeSoftInput ? parseInt(volumeSoftInput.value) || 0 : 50,
    alertSoundPath: alertSoundInput ? alertSoundInput.value.trim() : '',
    softSoundPath: softSoundInput ? softSoundInput.value.trim() : '',
  };
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
