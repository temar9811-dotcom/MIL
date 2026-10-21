// MIL ui-map-render v4 - flat 2D star-map view for the Intel Map (3 maps)
// Background and intel overlay share one view transform: setOrigin() marks the
// cached background dirty so panning/zooming keeps the two layers locked together.
// Draws CCP's 2D galaxy layout (regions repacked to close the void between
// them) and highlights systems with exactly the same rules as the pyramid:
// intel colours, green online alts, green "you". Hover shows the same tips.
// Auto-focuses (centres + zooms) on the same focus character the pyramid
// uses; the first drag or wheel zoom leaves that focus for free pan/zoom.
(function () {
  const canvas = document.getElementById('pyramid-map-canvas');
  const hint = document.getElementById('pyramid-map-hint');
  if (!canvas) return;

  const SHADE_ODD = '#465671';
  const SHADE_EVEN = '#35425a';
  const BASE_SEC = ['#8a4d4d', '#8f734a', '#6482b8'];
  const DOT_BASE = 1.9;
  const DOT_LIT = 3.0;
  const FOCUS_ZOOM = 3.5;

  let lay = null;
  let data = null;
  let byName = new Map();
  let lit = new Set();
  let rowByName = new Map();
  let altByName = new Map();
  let altAltName = new Map();
  let you = null;
  let youName = null;
  let grid = null;
  let gridCell = 120;

  let dpr = Math.max(1, window.devicePixelRatio || 1);
  let z = 1;
  let originX = 0;
  let originY = 0;
  let fit = 1;
  let bgDirty = true;
  let needDraw = false;
  let raf = 0;
  let schedulePending = false;
  let bgCanvas = null;
  let drag = null;
  let hoverIdx = -1;
  let mouse = null;
  let fitPending = false;
  let focusPending = true;
  let lastFocusYou = null;

  function ctx() { return canvas.getContext('2d'); }

  function applyFitIfReady() {
    if (!lay || !fitPending) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w <= 0 || h <= 0) return;
    fit = Math.min(w / lay.w, h / lay.h);
    z = fit;
    originX = lay.w / 2;
    originY = lay.h / 2;
    fitPending = false;
  }

  function resize() {
    if (!lay) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      bgCanvas = null;
      bgDirty = true;
    }
    applyFitIfReady();
  }

  function buildGrid() {
    grid = new Map();
    gridCell = Math.max(80, Math.round(120 * (canvas.width / 1400 || 1)));
    for (let i = 0; i < lay.names.length; i++) {
      const cx = Math.floor(lay.x[i] / gridCell);
      const cy = Math.floor(lay.y[i] / gridCell);
      const k = cx + ',' + cy;
      let a = grid.get(k);
      if (!a) { a = []; grid.set(k, a); }
      a.push(i);
    }
  }

  function ensureLayout(payload) {
    lay = payload;
    byName = new Map();
    for (let i = 0; i < lay.names.length; i++) byName.set(lay.names[i], i);
    lit = new Set();
    rowByName = new Map();
    altByName = new Map();
    altAltName = new Map();
    you = null;
    youName = null;
    hoverIdx = -1;
    bgCanvas = null;
    bgDirty = true;
    buildGrid();
    fitPending = true;
    focusPending = true;
    resize();
    applyFitIfReady();
  }

  function update(pyrData) {
    data = pyrData;
    lit.clear();
    rowByName.clear();
    altByName.clear();
    altAltName.clear();
    you = pyrData.you || null;
    youName = pyrData.youName || null;
    for (const row of (pyrData.rows || [])) {
      for (const s of row.systems) {
        lit.add(s.n);
        rowByName.set(s.n, { jumps: row.jumps, c: s.c || null, t: s.t });
      }
    }
    for (const a of (pyrData.alts || [])) {
      altByName.set(a.system, true);
      altAltName.set(a.system, a.name);
    }
    if (you) lit.add(you);
    focusOnYou();
    schedule();
  }

  function focusOnYou() {
    if (!you || !lay || !byName.has(you)) return;
    if (canvas.clientWidth <= 0 || canvas.clientHeight <= 0) return;
    const animate = focusPending || you !== lastFocusYou;
    lastFocusYou = you;
    focusPending = false;
    if (!animate) return;
    const i = byName.get(you);
    originX = lay.x[i];
    originY = lay.y[i];
    z = fit * FOCUS_ZOOM;
    bgDirty = true;
  }

  function shadeFor(jumps) { return jumps % 2 === 1 ? SHADE_ODD : SHADE_EVEN; }

  function worldOf(px, py) {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    return {
      x: (px - w / 2) / z + originX,
      y: (py - h / 2) / z + originY,
    };
  }

  function pick(wx, wy, worldR) {
    let best = -1;
    let bestD = Math.pow(worldR, 2);
    const x0 = Math.floor((wx - worldR) / gridCell);
    const x1 = Math.floor((wx + worldR) / gridCell);
    const y0 = Math.floor((wy - worldR) / gridCell);
    const y1 = Math.floor((wy + worldR) / gridCell);
    for (let gy = y0; gy <= y1; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        const a = grid.get(gx + ',' + gy);
        if (!a) continue;
        for (const i of a) {
          const dx = lay.x[i] - wx;
          const dy = lay.y[i] - wy;
          const d = dx * dx + dy * dy;
          if (d < bestD) { bestD = d; best = i; }
        }
      }
    }
    return best;
  }

  function tipFor(name) {
    if (you && name === you) {
      return JSON.stringify([`${youName || 'YOU'} · ${you}`]);
    }
    if (altByName.has(name)) {
      return JSON.stringify([`${altAltName.get(name)} · ${name} (alt)`, 'online']);
    }
    const row = rowByName.get(name);
    if (row && row.t) return row.t;
    const i = byName.get(name);
    const region = lay && i != null ? (lay.regionNames[lay.region[i]] || '?') : '';
    return JSON.stringify([name, region]);
  }

  function drawBackground() {
    const w = canvas.width;
    const h = canvas.height;
    if (!bgCanvas) {
      bgCanvas = document.createElement('canvas');
      bgCanvas.width = w;
      bgCanvas.height = h;
    }
    const b = bgCanvas.getContext('2d');
    const dpr2 = dpr;
    b.setTransform(1, 0, 0, 1, 0, 0);
    b.clearRect(0, 0, w, h);
    b.fillStyle = '#0b1526';
    b.fillRect(0, 0, w, h);
    b.setTransform(dpr2 * z, 0, 0, dpr2 * z, dpr2 * (canvas.clientWidth / 2 - originX * z), dpr2 * (canvas.clientHeight / 2 - originY * z));

    // faint gate web
    b.strokeStyle = 'rgba(120,150,200,0.10)';
    b.lineWidth = 1 / z;
    b.beginPath();
    const E = lay.edges;
    for (let i = 0; i < E.length; i += 2) {
      const a = E[i], c2 = E[i + 1];
      b.moveTo(lay.x[a], lay.y[a]);
      b.lineTo(lay.x[c2], lay.y[c2]);
    }
    b.stroke();

    // base dots, one pass per security class
    const r = DOT_BASE / z;
    for (let cls = 0; cls < 3; cls++) {
      b.fillStyle = BASE_SEC[cls];
      b.beginPath();
      for (let i = 0; i < lay.names.length; i++) {
        if (lay.sec[i] !== cls) continue;
        b.moveTo(lay.x[i] + r, lay.y[i]);
        b.arc(lay.x[i], lay.y[i], r, 0, 6.2832);
      }
      b.fill();
    }
    bgDirty = false;
  }

  function drawOverlay(c) {
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(bgCanvas, 0, 0);
    c.setTransform(dpr * z, 0, 0, dpr * z, dpr * (canvas.clientWidth / 2 - originX * z), dpr * (canvas.clientHeight / 2 - originY * z));

    // gates among lit systems
    c.strokeStyle = 'rgba(170,205,255,0.30)';
    c.lineWidth = 1.2 / z;
    c.beginPath();
    const E = lay.edges;
    for (let i = 0; i < E.length; i += 2) {
      const a = E[i], b = E[i + 1];
      if (!lit.has(lay.names[a]) || !lit.has(lay.names[b])) continue;
      c.moveTo(lay.x[a], lay.y[a]);
      c.lineTo(lay.x[b], lay.y[b]);
    }
    c.stroke();

    // in-range systems, coloured like the pyramid
    for (const [name, row] of rowByName) {
      const i = byName.get(name);
      if (i == null) continue;
      const col = row.c || shadeFor(row.jumps);
      c.fillStyle = col;
      c.shadowColor = col;
      c.shadowBlur = 10 / z;
      c.beginPath();
      c.moveTo(lay.x[i] + DOT_LIT / z, lay.y[i]);
      c.arc(lay.x[i], lay.y[i], DOT_LIT / z, 0, 6.2832);
      c.fill();
      c.shadowBlur = 0;
    }

    // green alts that are not already lit by intel
    for (const name of altByName.keys()) {
      const i = byName.get(name);
      if (i == null) continue;
      const hasIntel = rowByName.has(name);
      if (hasIntel) continue;
      c.fillStyle = '#22c55e';
      c.shadowColor = '#22c55e';
      c.shadowBlur = 12 / z;
      c.beginPath();
      c.moveTo(lay.x[i] + DOT_LIT / z, lay.y[i]);
      c.arc(lay.x[i], lay.y[i], DOT_LIT / z, 0, 6.2832);
      c.fill();
      c.shadowBlur = 0;
    }

    // you - bright green ring, always wins
    if (you && byName.has(you)) {
      const i = byName.get(you);
      c.fillStyle = '#22c55e';
      c.shadowColor = '#22c55e';
      c.shadowBlur = 16 / z;
      c.beginPath();
      c.moveTo(lay.x[i] + DOT_LIT / z, lay.y[i]);
      c.arc(lay.x[i], lay.y[i], DOT_LIT / z, 0, 6.2832);
      c.fill();
      c.shadowBlur = 0;
      c.strokeStyle = '#aef3c6';
      c.lineWidth = 1.6 / z;
      c.beginPath();
      c.arc(lay.x[i], lay.y[i], (DOT_LIT + 4) / z, 0, 6.2832);
      c.stroke();
    }

    if (hoverIdx >= 0) {
      c.strokeStyle = '#e2e8f0';
      c.lineWidth = 1.4 / z;
      c.beginPath();
      c.arc(lay.x[hoverIdx], lay.y[hoverIdx], (DOT_LIT + 6) / z, 0, 6.2832);
      c.stroke();
    }
  }

  function draw() {
    if (!lay || !canvas.width) return;
    const c = ctx();
    resize();
    if (!bgCanvas) bgDirty = true;
    if (bgDirty) drawBackground();
    drawOverlay(c);
  }

  function schedule() {
    if (raf) return;
    schedulePending = true;
    raf = requestAnimationFrame(() => { raf = 0; schedulePending = false; draw(); });
    setTimeout(() => {
      if (schedulePending) {
        raf = 0;
        schedulePending = false;
        draw();
      }
    }, 32);
  }

  function setOrigin(ox, oy) {
    originX = ox;
    originY = oy;
    bgDirty = true;
  }

  // interactions
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (!lay) return;
    const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
    const nx = e.clientX - canvas.getBoundingClientRect().left;
    const ny = e.clientY - canvas.getBoundingClientRect().top;
    const before = worldOf(nx, ny);
    const nz = Math.min(Math.max(z * factor, fit * 0.5), 96);
    if (Math.abs(nz - z) < 1e-9) return;
    focusPending = false;
    z = nz;
    const after = worldOf(nx, ny);
    setOrigin(originX + (before.x - after.x), originY + (before.y - after.y));
    schedule();
  }, { passive: false });

  canvas.addEventListener('pointerdown', (e) => {
    focusPending = false;
    drag = { x: e.clientX, y: e.clientY, ox: originX, oy: originY };
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!lay) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    mouse = { mx, my };
    if (drag) {
      const dx = (e.clientX - drag.x) / z;
      const dy = (e.clientY - drag.y) / z;
      setOrigin(drag.ox - dx, drag.oy - dy);
      schedule();
      return;
    }
    const world = worldOf(mx, my);
    const pickPx = Math.max(7, 8 / 1); // px radius on screen
    const next = pick(world.x, world.y, pickPx / z * 1.6);
    if (next !== hoverIdx) {
      hoverIdx = next;
      schedule();
    }
  });

  canvas.addEventListener('pointerup', () => { drag = null; });

  canvas.addEventListener('pointerleave', () => {
    hoverIdx = -1;
    drag = null;
    window.PyrRender && window.PyrRender.hideTip();
    schedule();
  });

  canvas.addEventListener('mousemove', (e) => {
    if (lay && hoverIdx >= 0) {
      window.PyrRender.showTip(e, tipFor(lay.names[hoverIdx]));
    }
  });

  const ro = new ResizeObserver(() => {
    if (!lay) return;
    resize();
    bgCanvas = null;
    bgDirty = true;
    schedule();
  });
  ro.observe(canvas);

  window.MapRender = {
    init: (payload) => { ensureLayout(payload); schedule(); },
    update,
    draw,
  };
})();