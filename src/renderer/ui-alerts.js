// MIL ui-alerts v10 - shared alert card; live patch on alert-updated
const alertsList = document.getElementById('alerts');
const popoutBtn = document.getElementById('popout-alerts');
const clearBtn = document.getElementById('clear-alerts');

function patchAlert(id, data) {
  if (!alertsList || id == null) return;
  const el = alertsList.querySelector(`[data-alert-id="${id}"]`);
  if (el) window.alertCard.patch(el, data);
}

function trimList() {
  while (alertsList.children.length > 50) {
    alertsList.removeChild(alertsList.lastChild);
  }
}

window.addAlert = (data) => {
  if (!alertsList || !data) return;
  alertsList.insertBefore(window.alertCard.make(data), alertsList.firstChild);
  trimList();
};

window.renderAlertHistory = (list) => {
  if (!alertsList || !Array.isArray(list)) return;
  alertsList.innerHTML = '';
  for (let i = list.length - 1; i >= 0; i--) {
    alertsList.insertBefore(window.alertCard.make(list[i]), alertsList.firstChild);
  }
};

window.clearAlerts = () => {
  if (alertsList) alertsList.innerHTML = '';
};

if (popoutBtn) {
  popoutBtn.addEventListener('click', () => {
    if (window.electronAPI && window.electronAPI.popoutAlerts) {
      window.electronAPI.popoutAlerts();
    }
  });
}

if (clearBtn) {
  clearBtn.addEventListener('click', () => {
    if (window.electronAPI && window.electronAPI.clearAlerts) {
      window.electronAPI.clearAlerts();
    }
  });
}

if (window.electronAPI && window.electronAPI.onAlertsCleared) {
  window.electronAPI.onAlertsCleared(() => window.clearAlerts());
}

// This script loads in both windows; the docked tab is patched by renderer.js,
// so only the pop-out (which has no engine-status element) subscribes here.
if (!document.getElementById('engine-status') && window.electronAPI && window.electronAPI.onAlertUpdated) {
  window.electronAPI.onAlertUpdated((data) => patchAlert(data && data.id, data));
}