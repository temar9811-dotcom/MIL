// src/renderer/ui-alerts.js
const alertsList = document.getElementById('alerts-list');

window.addAlert = (type, message) => {
  const alert = document.createElement('div');
  alert.className = `alert alert-${type}`;
  alert.textContent = message;
  alertsList.insertBefore(alert, alertsList.firstChild);
  
  // Keep only last 10 alerts
  while (alertsList.children.length > 10) {
    alertsList.removeChild(alertsList.lastChild);
  }
};

window.clearAlerts = () => {
  alertsList.innerHTML = '';
};