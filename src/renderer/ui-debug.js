// # FILE: src/renderer/ui-debug.js
// # VERSION: 3

// src/renderer/ui-debug.js
const debugToggle = document.getElementById('debug-toggle');
const debugPanel = document.getElementById('debug-panel');
const clearDebugBtn = document.getElementById('clear-debug');
const debugSection = debugPanel ? debugPanel.closest('section') : null;

function setDebugVisible(visible) {
  const target = debugSection || debugPanel;
  if (!target) return;
  target.style.display = visible ? '' : 'none';
}

if (debugToggle) {
  setDebugVisible(debugToggle.checked);
  debugToggle.addEventListener('change', () => {
    const on = debugToggle.checked;
    if (on && debugPanel) debugPanel.textContent = '';
    setDebugVisible(on);
    if (window.electronAPI && window.electronAPI.toggleDebug) {
      window.electronAPI.toggleDebug(on);
    }
  });
}

if (clearDebugBtn && debugPanel) {
  clearDebugBtn.addEventListener('click', () => {
    debugPanel.textContent = '';
  });
}

window.appendDebugLine = (line) => {
  if (!debugPanel) return;
  const time = new Date().toLocaleTimeString();
  debugPanel.textContent += `[${time}] ${line}\n`;
  debugPanel.scrollTop = debugPanel.scrollHeight;
};

window.appendDebug = (level, msg) => {
  window.appendDebugLine(`[${level}] ${msg}`);
};

window.updateDebugLog = (lines) => {
  if (!debugPanel) return;
  debugPanel.textContent = Array.isArray(lines) ? lines.join('\n') : lines;
  debugPanel.scrollTop = debugPanel.scrollHeight;
};