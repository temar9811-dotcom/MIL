// # FILE: src/renderer/ui-pyramid.js
// # VERSION: 15
// MIL ui-pyramid v15 - gated module. The old ON checkbox is gone: whether the
// Intel Map runs is decided by the module gate in Other Settings and by the
// main process, never from inside the map UI. This file only renders.
//
// The same file serves the tab and the pop-out window, so it has to be told
// which one it is: window resizing is a pop-out concern and must never be
// attempted from the tab, where it would resize the whole application.
//
// This file is wrapped in an IIFE for the same reason module-gates, ui-zkill and
// ui-local-monitor are. It used to be the only renderer file that was not, which
// was harmless while it was the one map implementation in the window. As a gated
// module it is injected alongside the always-loaded ui-alerts and ui-debug, and
// a classic script's top-level `const` lives in the shared global lexical scope:
// ui-alerts already declares `clearBtn`, so `const clearBtn` here was a
// SyntaxError at parse time. The whole file was rejected, window.IntelMap was
// never defined, the gate's setActive became a silent no-op, and the map stayed
// collapsed at zero height with nothing in the console to explain it.
(function () {
const topToggle = document.getElementById('pyramid-top');
const clearBtn = document.getElementById('pyramid-clear');
const fastToggle = document.getElementById('pyramid-fast');
const fastInfo = document.getElementById('pyramid-fast-info');
const centerSelect = document.getElementById('pyramid-center');
const timeoutInput = document.getElementById('pyramid-timeout');
const box = document.getElementById('pyramid');
const offBox = document.getElementById('pyramid-off');
const mapBox = document.getElementById('pyramid-map');
const viewPyrBtn = document.getElementById('pyramid-view-pyr');
const viewMapBtn = document.getElementById('pyramid-view-map');
const mapSelect = document.getElementById('pyramid-map-select');
const popoutBtn = document.getElementById('pyramid-popout');
const NORMAL_MS = 5000;
const INTENSIVE_MS = 1000;
const IS_POPOUT = document.body.dataset.pyramidHost === 'popout';
let pollTimer = null;
let pollMs = NORMAL_MS;
let layoutKey = '';
let tileEls = new Map();
let mapView = false;
let mapInit = false;
let mapInitKey = null;
let mapKey = 'neweden';
// The single source of truth for "should this window be polling right now".
// Only setActive() writes it, and the gate is the only caller.
let active = false;

// Resizing is only meaningful in the pop-out; in the tab the panel is sized by
// the app layout and resizing would resize the entire application window.
function canResize() {
  return IS_POPOUT && window.electronAPI && window.electronAPI.resizePyramid;
}

async function refresh() {
  if (!active) return;
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
  if (mapView) {
    await ensureMapInit();
    if (window.MapRender) window.MapRender.update(data);
    return;
  }
  const key = [
    data.you, data.youName, data.proximity, data.cynoMax, data.softMax,
    data.rows.map((r) => `${r.jumps}:${r.systems.length}`).join(','),
  ].join('|');
  if (key !== layoutKey) {
    layoutKey = key;
    window.PyrRender.buildLayout(box, data, tileEls);
    if (canResize()) window.PyrRender.autosize(box);
  }
  window.PyrRender.paint(data, tileEls);
}

async function ensureMapInit() {
  if (!window.electronAPI || !window.electronAPI.getMapLayout) return;
  if (mapInit && mapInitKey === mapKey) return;
  try {
    const payload = await window.electronAPI.getMapLayout(mapKey);
    if (payload && payload.ok && window.MapRender) {
      window.MapRender.init(payload);
      mapInit = true;
      mapInitKey = mapKey;
    } else if (payload && !payload.ok) {
      mapBox.innerHTML = `<div style="color:#888;padding:12px;">2D map unavailable (${payload.error || payload.reason || 'no layout data'}).</div>`;
    }
  } catch (err) {
    mapBox.innerHTML = '<div style="color:#888;padding:12px;">2D map failed to load.</div>';
  }
}

function applyView() {
  mapBox.style.display = mapView ? 'block' : 'none';
  box.style.display = mapView ? 'none' : 'block';
  if (mapSelect) mapSelect.style.display = mapView ? 'inline-block' : 'none';
}

// Why the map is showing nothing. Saying the reason matters: a tab that is
// merely paused because the pop-out has the work should not look broken.
function offMessage() {
  const gates = window.ModuleGates;
  // Unreachable in the tab: the tab button is hidden unless the module is on,
  // so a visible tab can never be disabled. Kept for the one case that can
  // still get here - settings changed under an already-injected tab.
  if (gates && !gates.isEnabled('map')) {
    return 'Intel Map has been switched off in Other Settings.';
  }
  if (IS_POPOUT) return 'Intel Map is showing in the main window tab.';
  if (gates && typeof gates.isMapPopoutOpen === 'function' && gates.isMapPopoutOpen()) {
    return 'Intel Map is showing in the pop-out window. The tab stays still while it is open.';
  }
  return 'Intel Map is idle. Open this tab to start it, or check that a character is online.';
}

function setActive(on) {
  on = !!on;
  // Only "already on" is a no-op. Going off has to keep running even when it
  // was already off, because the reason it is off can change while the tab sits
  // open - the pop-out being opened is the common one - and a stale message
  // reads as a fault that is not there.
  if (on && active) return;
  if (on) {
    active = true;
    if (offBox) offBox.style.display = 'none';
    layoutKey = '';
    applyView();
    refresh();
    if (!pollTimer) pollTimer = setInterval(refresh, pollMs);
    return;
  }
  active = false;
  // Stop the timer and drop the tiles, but keep the element references: the
  // gate can turn this back on and it is not a page reload.
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (box) {
    box.style.display = 'none';
    box.innerHTML = '';
  }
  if (mapBox) mapBox.style.display = 'none';
  if (mapSelect) mapSelect.style.display = 'none';
  tileEls = new Map();
  layoutKey = '';
  if (offBox) {
    offBox.textContent = offMessage();
    offBox.style.display = 'block';
  }
}

// The two view buttons are a radio pair: exactly one is current at a time.
// Only the two colours that carry that meaning are touched. Writing a whole
// style attribute instead would silently drop the border, padding and pointer
// cursor that both buttons get from the markup, which is what made them look
// like a different control after this module was gated.
const VIEW_ACTIVE = { background: '#1e3a5f', color: '#e2e8f0' };
const VIEW_IDLE = { background: '#0b1526', color: '#9aa4c7' };

function paintView(btn, isCurrent) {
  if (!btn) return;
  const look = isCurrent ? VIEW_ACTIVE : VIEW_IDLE;
  btn.style.background = look.background;
  btn.style.color = look.color;
}

function paintViewButtons() {
  paintView(viewPyrBtn, !mapView);
  paintView(viewMapBtn, mapView);
  // The map picker belongs to the 2D view and only that view.
  if (mapSelect) mapSelect.style.display = mapView ? 'inline-block' : 'none';
}


async function setMapView(on) {
  mapView = !!on;
  paintViewButtons();
  if (active) applyView();
  if (mapSelect) mapSelect.value = mapKey;
  if (on) {
    await ensureMapInit();
    if (canResize()) {
      try { await window.electronAPI.resizePyramid({ w: 1500, h: 1000 }); } catch (_) { /* window may stay put */ }
    }
  } else if (canResize()) {
    try {
      box.style.width = 'max-content';
      await window.electronAPI.resizePyramid({ w: box.scrollWidth, h: box.scrollHeight });
    } catch (_) { /* ignore */ }
  }
  refresh();
}

if (viewPyrBtn) viewPyrBtn.addEventListener('click', () => setMapView(false));
if (viewMapBtn) viewMapBtn.addEventListener('click', () => setMapView(true));

if (mapSelect) {
  mapSelect.addEventListener('change', async () => {
    mapKey = mapSelect.value || 'neweden';
    if (mapView && active) {
      await ensureMapInit();
      refresh();
    }
  });
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

// The tab's way out to the standalone window. The pop-out owns the work while
// it is open, and the tab pauses - see module-gates.setMapPopoutOpen.
if (popoutBtn) {
  popoutBtn.addEventListener('click', () => {
    if (window.electronAPI && window.electronAPI.openPyramid) {
      window.electronAPI.openPyramid();
    }
  });
}

// The gate calls this. Exported rather than wired to a checkbox because the
// checkbox is exactly what this change removes.
window.IntelMap = {
  setActive,
  isActive: () => active,
  setMapView,
  refresh,
};

// In the pop-out, this window is the one doing the work, so it tells the main
// window on the way in and on the way out. The tab uses that to stop
// refreshing; two pollers on the same data is duplicated CPU and RAM for
// nothing. The tab itself never announces, so the pair cannot deadlock.
function announcePopout(on) {
  if (window.electronAPI && window.electronAPI.intelMapPopout) {
    window.electronAPI.intelMapPopout(on);
  }
}

if (IS_POPOUT) window.addEventListener('beforeunload', () => announcePopout(false));

(async () => {
  await renderCenterSelect('');
  paintViewButtons();

  if (timeoutInput && window.electronAPI && window.electronAPI.getSettings) {
    try {
      const settings = await window.electronAPI.getSettings();
      if (settings && settings.intelTimeout != null) {
        timeoutInput.value = settings.intelTimeout;
      }
    } catch (_) { /* ignore */ }
  }

  if (IS_POPOUT) {
    // The pop-out has no tab strip and so no gate telling it what to do: the
    // main process only opens it when the module is enabled. It therefore takes
    // the work straight away and claims it from the tab.
    setActive(true);
    announcePopout(true);
  }
  // The tab deliberately does NOT call setActive(false) here. This file is
  // injected asynchronously, so anything it did on the way in would race the
  // gate: the gate activates the module synchronously when the last script
  // loads, and an await resuming afterwards would switch the map back off
  // behind the user's back. In the tab, `active` belongs to the gate alone.
})();

// Closes the module's own IIFE. The `})();` above closes the async bootstrap
// nested inside it, not this one.
})();
