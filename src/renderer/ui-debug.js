// src/renderer/ui-debug.js
const debugToggle = document.getElementById('debug-toggle');
const debugPanel = document.getElementById('debug-panel');
const clearDebugBtn = document.getElementById('clear-debug');

if (debugToggle && debugPanel) {
  debugToggle.addEventListener('change', () => {
    if (debugToggle.checked) {
      debugPanel.classList.remove('hidden');
      if (window.electronAPI && window.electronAPI.toggleDebug) {
        window.electronAPI.toggleDebug(true);
      }
    } else {
      debugPanel.classList.add('hidden');
      if (window.electronAPI && window.electronAPI.toggleDebug) {
        window.electronAPI.toggleDebug(false);
      }
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