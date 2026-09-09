// # FILE: src/renderer/ui-debug.js
// # VERSION: 1

/**
 * Isolated, defensive debug-log UI module.
 * Only this file ever touches #debug-panel.
 * Exposes:
 *   window.appendDebug(level, msg)   – formatted line
 *   window.appendDebugLine(raw)      – raw IPC line
 *   window.updateDebugTabVisibility()
 */
(function () {
  var MAX_LINES = 200;
  var panel = null;
  var tabBtn = null;
  var clearBtn = null;
  var toggle = null;

  /* ---- internal helpers ---- */

  function init() {
    panel   = document.getElementById('debug-panel');
    tabBtn  = document.getElementById('debug-tab-btn');
    clearBtn = document.getElementById('clear-debug');
    toggle  = document.getElementById('debug-toggle');

    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        if (panel) panel.textContent = '';
      });
    }

    if (toggle) {
      toggle.addEventListener('change', function () {
        applyVisibility();
      });
    }
  }

  function ts() {
    return new Date().toLocaleTimeString();
  }

  function pushLine(text) {
    if (!panel) return;
    try {
      var span = document.createElement('span');
      span.textContent = text + '\n';
      panel.appendChild(span);
      while (panel.childNodes.length > MAX_LINES) {
        panel.removeChild(panel.firstChild);
      }
      panel.scrollTop = panel.scrollHeight;
    } catch (_) { /* debug must never crash the app */ }
  }

  function applyVisibility() {
    if (!tabBtn || !toggle) return;
    if (toggle.checked) {
      tabBtn.classList.remove('hidden');
    } else {
      tabBtn.classList.add('hidden');
    }
  }

  /* ---- public API ---- */

  window.appendDebug = function (level, msg) {
    var lvl = (level || 'LOG').toUpperCase();
    pushLine('[' + ts() + '] [' + lvl + '] ' + msg);
  };

  window.appendDebugLine = function (raw) {
    pushLine(raw);
  };

  window.updateDebugTabVisibility = applyVisibility;

  /* ---- bootstrap ---- */

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();