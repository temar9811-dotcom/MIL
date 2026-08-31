// MIL ui-alerts v3 - single-line alert cards into #alerts
const alertsList = document.getElementById('alerts');

window.addAlert = (data) => {
  if (!alertsList || !data) return;
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

  alertsList.insertBefore(el, alertsList.firstChild);
  while (alertsList.children.length > 20) {
    alertsList.removeChild(alertsList.lastChild);
  }
};

window.clearAlerts = () => {
  if (alertsList) alertsList.innerHTML = '';
};