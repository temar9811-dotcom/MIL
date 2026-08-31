// MIL ui-alerts v4 - alert history rendering
const alertsList = document.getElementById('alerts');

function makeCard(data) {
  const el = document.createElement('div');
  el.className = `alert alert-${data.type === 'red' ? 'red' : 'soft'}`;
  const parts = [
    data.character || '?',
    `${data.jumps == null ? '?' : data.jumps}`,
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