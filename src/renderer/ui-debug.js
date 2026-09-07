// MIL ui-debug v2 - log panel only (tab visibility lives in renderer v8)
const debugPanel = document.getElementById('debug-panel');
const clearDebugBtn = document.getElementById('clear-debug');

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