// # FILE: src/renderer/ui-debug.js
// # VERSION: 6

const debugToggle = document.getElementById('debug-toggle');
const debugPanel = document.getElementById('debug-panel');
const clearDebugBtn = document.getElementById('clear-debug');

// Removed setDebugVisible - tab system handles visibility via CSS classes
if (debugToggle) {
  debugToggle.addEventListener('change', () => {
    const on = debugToggle.checked;
    if (on && debugPanel) debugPanel.textContent = '';
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