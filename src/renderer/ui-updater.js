// # FILE: src/renderer/ui-updater.js
// # VERSION: 1
// ui-updater v1 - the header "Update Now" button, the status text, and the
// What's New dialog. Mirrors ESP: the button appears only when an update is
// waiting AND automatic install is off, and the status line never shows idle
// hourly noise.
const updateStatusEl = document.getElementById('update-status');
const updateNowBtn = document.getElementById('update-now');
const changelogDialog = document.getElementById('changelog-dialog');
const changelogTitle = document.getElementById('changelog-title');
const changelogNotes = document.getElementById('changelog-notes');
const changelogClose = document.getElementById('changelog-close');

const UPDATE_STATUS_TEXT = {
  unavailable: '',
  current: '',
  available: 'Update available',
  downloading: 'Downloading update…',
  error: 'Update check failed',
  setting: '',
};

// A status line is only shown while the user is actually doing something (or
// something went wrong). The hourly "current" result is not news.
let userFired = false;
let userFiredTimer = null;

function markUserFired() {
  userFired = true;
  if (userFiredTimer) clearTimeout(userFiredTimer);
  userFiredTimer = setTimeout(() => { userFired = false; }, 6000);
}

function renderStatus(status) {
  if (!status) return;
  const { state, autoInstall, available, supported } = status;

  if (updateNowBtn) {
    // On-demand mode only: when automatic install is on, the dialog is the
    // single path and a second button would be two competing ways to update.
    const showButton = supported !== false && autoInstall === false && !!available;
    updateNowBtn.style.display = showButton ? '' : 'none';
  }

  if (!updateStatusEl) return;
  let text = UPDATE_STATUS_TEXT[state] || '';
  // Idle results are silent unless the user just pressed something.
  if ((state === 'current' || state === 'available') && !userFired) text = '';
  updateStatusEl.textContent = text;
  updateStatusEl.style.display = text ? '' : 'none';
}

async function refreshStatus() {
  if (!window.electronAPI || !window.electronAPI.getUpdaterStatus) return;
  try {
    renderStatus(await window.electronAPI.getUpdaterStatus());
  } catch (_) {}
}

function openChangelog(info) {
  if (!changelogDialog) return;
  if (changelogTitle) {
    changelogTitle.textContent = `What's New in v${(info && info.version) || ''}`.trim();
  }
  if (changelogNotes) changelogNotes.textContent = (info && info.notes) || 'Welcome to the new version!';
  changelogDialog.style.display = 'flex';
}

function closeChangelogDialog() {
  if (changelogDialog) changelogDialog.style.display = 'none';
  if (window.electronAPI && window.electronAPI.closeChangelog) {
    window.electronAPI.closeChangelog().catch(() => {});
  }
}

if (updateNowBtn) {
  updateNowBtn.addEventListener('click', async () => {
    markUserFired();
    if (!window.electronAPI || !window.electronAPI.downloadUpdate) return;
    renderStatus({ state: 'downloading', autoInstall: false, available: true, supported: true });
    await window.electronAPI.downloadUpdate();
    refreshStatus();
  });
}

if (changelogClose) {
  changelogClose.addEventListener('click', closeChangelogDialog);
}

if (changelogDialog) {
  // Click the backdrop to dismiss, but never a click inside the panel.
  changelogDialog.addEventListener('click', (e) => {
    if (e.target === changelogDialog) closeChangelogDialog();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && changelogDialog.style.display !== 'none') closeChangelogDialog();
  });
}

if (window.electronAPI) {
  if (window.electronAPI.onUpdateStatus) {
    window.electronAPI.onUpdateStatus((status) => renderStatus(status));
  }
  // Pushed only when automatic install is on; when it is off the header button
  // is the path instead, and `renderStatus` reveals it from the poll.
  if (window.electronAPI.onUpdateAvailable) {
    window.electronAPI.onUpdateAvailable((info) => {
      openChangelog(null);
      renderStatus({ state: 'available', autoInstall: true, available: true, supported: true, version: info && info.version });
    });
  }
  if (window.electronAPI.onShowChangelog) {
    window.electronAPI.onShowChangelog((info) => openChangelog(info));
  }
}

// The changelog is checked once per version, on mount. It is deliberately not
// part of the status poll: it writes `lastSeenVersion` on the main side, so
// asking repeatedly would consume the popup before it could be seen.
(async () => {
  refreshStatus();
  if (!window.electronAPI || !window.electronAPI.getChangelog) return;
  try {
    const info = await window.electronAPI.getChangelog();
    if (info && info.show) openChangelog(info);
  } catch (_) {}
})();

window.updateRenderer = { refreshStatus, renderStatus, openChangelog, closeChangelogDialog };
