// Local Monitor — transparent fullscreen region picker overlay.
// pickRegion() opens one overlay window on the display under the cursor and
// returns a promise of {ok, x, y, x2, y2} (absolute screen DIP coords) or
// {ok:false, canceled:true}. The overlay renderer reports the drag box via the
// 'overlay-rect' IPC channel and cancels via 'overlay-cancel'.
const path = require('path');
const { BrowserWindow, ipcMain, screen } = require('electron');

const PICK_TIMEOUT_MS = 5 * 60 * 1000;
const MIN_SIDE = 5;

let activePick = null;

function resolveDisplay() {
  let point = null;
  try {
    point = screen.getCursorScreenPoint();
  } catch (_) {
    point = null;
  }
  if (point) {
    try {
      const display = screen.getDisplayNearestPoint(point);
      if (display && display.bounds) return display;
    } catch (_) { /* fall through to primary */ }
  }
  return screen.getPrimaryDisplay();
}

function normalizeRect(rect, bounds) {
  let x0 = Number(rect && rect.x0);
  let y0 = Number(rect && rect.y0);
  let x1 = Number(rect && rect.x1);
  let y1 = Number(rect && rect.y1);
  if (![x0, y0, x1, y1].every(Number.isFinite)) {
    return { ok: false, canceled: true };
  }
  if (x0 > x1) { const t = x0; x0 = x1; x1 = t; }
  if (y0 > y1) { const t = y0; y0 = y1; y1 = t; }
  if (x1 - x0 < MIN_SIDE || y1 - y0 < MIN_SIDE) {
    return { ok: false, canceled: true, reason: 'too-small' };
  }
  return {
    ok: true,
    x: Math.round(bounds.x + x0),
    y: Math.round(bounds.y + y0),
    x2: Math.round(bounds.x + x1),
    y2: Math.round(bounds.y + y1),
  };
}

// Optional single `display` argument (a screen.Display with .bounds) overrides
// "display under cursor"; used for testing or callers that already resolved it.
function pickRegion(display) {
  if (activePick) return Promise.resolve({ ok: false, canceled: true });
  const target = display && display.bounds ? display : resolveDisplay();
  const bounds = target.bounds;

  const overlay = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    fullscreen: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    hasShadow: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '..', '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Fullscreen may not engage reliably for secondary/negative-offset displays;
  // cover the whole display bounds explicitly as a fallback.
  try {
    if (!overlay.isFullScreen()) overlay.setBounds(bounds);
    overlay.setAlwaysOnTop(true, 'screen-saver');
    overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch (_) { /* best-effort platform-specific calls */ }

  const pick = { overlay, settled: false, resolver: null, timer: null };
  activePick = pick;
  pick.promise = new Promise((resolve) => { pick.resolver = resolve; });

  function settle(result, closeWindow) {
    if (pick.settled) return;
    pick.settled = true;
    if (pick.timer) { clearTimeout(pick.timer); pick.timer = null; }
    if (activePick === pick) activePick = null;
    if (closeWindow !== false) {
      try { if (!overlay.isDestroyed()) overlay.close(); } catch (_) { /* noop */ }
    }
    if (pick.resolver) pick.resolver(result);
  }

  ipcMain.once('overlay-rect', (_event, rect) => {
    settle(normalizeRect(rect, bounds), true);
  });
  ipcMain.once('overlay-cancel', () => {
    settle({ ok: false, canceled: true }, true);
  });

  overlay.on('closed', () => {
    settle({ ok: false, canceled: true }, false);
  });
  overlay.webContents.on('did-fail-load', (_e, code, desc) => {
    if (code === -3) return; // aborted by our own close
    settle({ ok: false, canceled: true }, true);
  });
  overlay.webContents.on('render-process-gone', () => {
    settle({ ok: false, canceled: true }, true);
  });

  // Backstop so the invoke can never hang the tab even if the window dies silently.
  pick.timer = setTimeout(() => settle({ ok: false, canceled: true }, true), PICK_TIMEOUT_MS);

  overlay.once('ready-to-show', () => {
    try {
      overlay.show();
      overlay.focus();
    } catch (_) { /* noop */ }
  });

  overlay.loadFile(path.join(__dirname, '..', '..', 'renderer', 'overlay.html'));
  return pick.promise;
}

module.exports = { pickRegion, normalizeRect, resolveDisplay };