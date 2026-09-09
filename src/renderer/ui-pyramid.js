// # FILE: src/renderer/ui-pyramid.js
// # VERSION: 11
// MIL ui-pyramid v11 - center selector + polling + timeout setting
const toggle = document.getElementById('pyramid-toggle');
const topToggle = document.getElementById('pyramid-top');
const clearBtn = document.getElementById('pyramid-clear');
const fastToggle = document.getElementById('pyramid-fast');
const fastInfo = document.getElementById('pyramid-fast-info');
const centerSelect = document.getElementById('pyramid-center');
const timeoutInput = document.getElementById('pyramid-timeout');
const box = document.getElementById('pyramid');
const offBox = document.getElementById('pyramid-off');
const NORMAL_MS = 5000;
const INTENSIVE_MS = 1000;
let pollTimer = null;
let pollMs = NORMAL_MS;
let layoutKey = '';
let tileEls = new Map();

async function refresh() {
  if (!window.electronAPI || !window.electronAPI.getPyramid) return;
  let data;
  try {
    data = await window.electronAPI.getPyramid();
  } catch (_) { return; }
  if (!data || !data.enabled) return;
  if (!data.you) {
    box.innerHTML = '<div style="color:#888;padding:12px;">No online character with a known system yet.</div>';
    return;
  }
  const key = [
    data.you, data.youName, data.proximity, data.cynoMax, data.softMax,
    data.rows.map((r) => `${r.jumps}:${r.systems.length}`).join(','),
  ].join('|');
  if (key !== layoutKey) {
    layoutKey = key;
    window.PyrRender.buildLayout(box, data, tileEls);
    window.PyrRender.autosize(box);
  }
  window.PyrRender.paint(data, tileEls);
}

function setOn(on) {
  if (on) {
    offBox.style.display = 'none';
    box.style.display = 'block';
    layoutKey = '';
    refresh();
    if (!pollTimer) pollTimer = setInterval(refresh, pollMs);
  } else {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    box.style.display = 'none';
    box.innerHTML = '';
    tileEls = new Map();
    layoutKey = '';
    offBox.style.display = 'block';
  }
}

async function renderCenterSelect(keep) {
  if (!centerSelect || !window.electronAPI || !window.electronAPI.getCharacters) return;
  let chars = [];
  try {
    chars = await window.electronAPI.getCharacters();
  } catch (_) { return; }
  centerSelect.innerHTML = '';
  const auto = document.createElement('option');
  auto.value = '';
  auto.textContent = 'Center: primary (auto)';
  centerSelect.appendChild(auto);
  for (const c of chars) {
    if (!c.online || !c.system) continue;
    const o = document.createElement('option');
    o.value = c.name;
    o.textContent = `Center: ${c.name}`;
    centerSelect.appendChild(o);
  }
  centerSelect.value = keep || '';
}

if (toggle) {
  toggle.addEventListener('change', async () => {
    if (window.electronAPI && window.electronAPI.setPyramid) {
      await window.electronAPI.setPyramid(toggle.checked);
    }
    setOn(toggle.checked);
  });
}

if (topToggle) {
  topToggle.addEventListener('change', () => {
    if (window.electronAPI && window.electronAPI.setPyramidTop) {
      window.electronAPI.setPyramidTop(topToggle.checked);
    }
  });
}

if (clearBtn) {
  clearBtn.addEventListener('click', async () => {
    if (window.electronAPI && window.electronAPI.clearPyramid) {
      await window.electronAPI.clearPyramid();
      refresh();
    }
  });
}

if (fastToggle) {
  fastToggle.addEventListener('change', () => {
    pollMs = fastToggle.checked ? INTENSIVE_MS : NORMAL_MS;
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = setInterval(refresh, pollMs);
    }
  });
}

if (fastInfo) {
  fastInfo.addEventListener('mousemove', (e) => {
    window.PyrRender.showTip(e, JSON.stringify([
      'Intensive map response',
      'Refreshes the map every 1s instead of 5s for near-instant intel. Uses a little more CPU while on. Resets to off each time the map opens.',
    ]));
  });
  fastInfo.addEventListener('mouseleave', window.PyrRender.hideTip);
}

if (centerSelect) {
  centerSelect.addEventListener('change', async () => {
    if (window.electronAPI && window.electronAPI.setPyramidCenter) {
      await window.electronAPI.setPyramidCenter(centerSelect.value);
    }
    layoutKey = '';
    refresh();
  });
}

// Handle Intel Map Timeout setting
if (timeoutInput) {
  timeoutInput.addEventListener('change', async () => {
    const val = parseInt(timeoutInput.value, 10) || 10;
    try {
      const settings = await window.electronAPI.getSettings();
      settings.intelTimeout = val;
      await window.electronAPI.saveSettings(settings);
    } catch (_) { /* silently fail */ }
  });
}

(async () => {
  await renderCenterSelect('');
  
  // Load timeout setting
  if (timeoutInput && window.electronAPI && window.electronAPI.getSettings) {
    try {
      const settings = await window.electronAPI.getSettings();
      if (settings && settings.intelTimeout != null) {
        timeoutInput.value = settings.intelTimeout;
      }
    } catch (_) { /* ignore */ }
  }

  if (!window.electronAPI || !window.electronAPI.getPyramid) return;
  try {
    const data = await window.electronAPI.getPyramid();
    if (data && data.enabled) {
      toggle.checked = true;
      setOn(true);
    }
  } catch (_) { /* first open stays off */ }
})();