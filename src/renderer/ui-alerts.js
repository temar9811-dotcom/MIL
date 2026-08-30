// src/renderer/ui-alerts.js
const alertsList = document.getElementById('alerts');

window.addAlert = (data) => {
  if (!alertsList || !data) return;
  const el = document.createElement('div');
  el.className = `alert alert-${data.type === 'red' ? 'red' : 'soft'}`;
  el.style.whiteSpace = 'pre-line';
  const shipPart = data.ship ? ` in a ${data.ship}` : '';
  el.textContent = [
    data.character || 'unknown character',
    `${data.jumps == null ? '?' : data.jumps} jumps`,
    `${data.pilot || 'unknown pilot'}${shipPart}`,
  ].join('\n');
  alertsList.insertBefore(el, alertsList.firstChild);
  while (alertsList.children.length > 20) {
    alertsList.removeChild(alertsList.lastChild);
  }
};

window.clearAlerts = () => {
  if (alertsList) alertsList.innerHTML = '';
};