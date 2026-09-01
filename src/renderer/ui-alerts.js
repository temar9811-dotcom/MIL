// MIL ui-alerts v9 - Map button opens the Intel Map pop-out
const alertsList = document.getElementById('alerts');
const popoutBtn = document.getElementById('popout-alerts');
const clearBtn = document.getElementById('clear-alerts');
const mapBtn = document.getElementById('open-pyramid');

function makeCard(data) {
  const el = document.createElement('div');
  el.className = `alert alert-${data && data.type === 'red' ? 'red' : 'soft'}`;
  const parts = [
    data.character || '?',
    data.jumps == null ? '?' : `${data.jumps} jumps`,
    data.system || '?',
    data.pilot || '?',
  ];
  if (data.ship) parts.push(data.ship);
  const line = parts.join(' > ');
  el.textContent = line;
  el.title = line;
  el.style.whiteSpace = 'nowrap';
  el.style.overflow = 'hidden';
  el.style.textOverflow = 'ellipsis';
  if (data && data.color) {
    el.style.borderLeft = `4px solid ${data.color}`;
  }
  return el;
}

function trimList() {
  while (alertsList.children.length > 50) {
    alertsList.removeChild(alertsList.lastChild);
  }
}

window.addAlert = (data) => {
  if (!alertsList || !data) return;
  alertsList.insertBefore(makeCard(data), alertsList.firstChild);
  trimList();
};

window.renderAlertHistory = (list) => {
  if (!alertsList || !Array.isArray(list)) return;
  alertsList.innerHTML = '';
  for (let i = list.length - 1; i >= 0; i--) {
    alertsList.insertBefore(makeCard(list[i]), alertsList.firstChild);
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

if (mapBtn) {
  mapBtn.addEventListener('click', () => {
    if (window.electronAPI && window.electronAPI.openPyramid) {
      window.electronAPI.openPyramid();
    }
  });
}

if (window.electronAPI && window.electronAPI.onAlertsCleared) {
  window.electronAPI.onAlertsCleared(() => window.clearAlerts());
}