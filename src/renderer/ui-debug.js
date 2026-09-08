// # FILE: src/renderer/ui-debug.js
// # VERSION: 7

const debugToggle = document.getElementById('debug-toggle');
const debugPanel = document.getElementById('debug-panel');
const clearDebugBtn = document.getElementById('clear-debug');

// REMOVED setDebugVisible entirely. 
// The tab system (ui-tabs.js) handles all panel visibility via CSS classes.
// Inline styles were overriding the tabs and hiding the log.

if (debugToggle) {
  debugToggle.addEventListener('change', () => {
    const on = debugToggle.checked;
    
    // Only clear the log when turning it back on
    if (on && debugPanel) {
      debugPanel.textContent = '';
    }
    
    // Just tell the backend to start/stop sending logs
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