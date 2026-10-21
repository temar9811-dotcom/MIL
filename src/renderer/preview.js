// # FILE: src/renderer/preview.js
// # VERSION: 1
// Paints one captured region at 1:1 into a frameless, image-sized popout.
// The main process owns the window size, so this file only has to hand the
// pixels to the canvas and keep the window honest about its own size.
(function () {
  'use strict';

  var view = document.getElementById('view');
  var ctx = view && view.getContext('2d');
  var api = window.electronAPI || {};

  function drawBoxes(points) {
    if (!points || !points.length) return;
    ctx.strokeStyle = '#e94560';
    ctx.lineWidth = 1;
    // Align a 1px stroke to the pixel grid, otherwise a thin box straddles two
    // pixel columns and reads as a smear at these sizes.
    ctx.translate(0.5, 0.5);
    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      if (!p || p.length < 4) continue;
      var x = Math.round(p[0]);
      var y = Math.round(p[1]);
      var w = Math.round(p[2]);
      var h = Math.round(p[3]);
      if (!isFinite(x) || !isFinite(y) || !isFinite(w) || !isFinite(h)) continue;
      ctx.strokeRect(x, y, Math.max(w - 1, 0), Math.max(h - 1, 0));
    }
    ctx.translate(-0.5, -0.5);
  }

  function render(payload) {
    if (!ctx || !payload) return;
    var w = payload.width;
    var h = payload.height;
    var px = payload.rgba;
    if (!w || !h || !px) return;
    if (px.length !== w * h * 4) {
      // A short buffer means the capture and the size disagree; painting
      // partial data would be worse than showing nothing.
      if (api.report) api.report('rgba size mismatch: ' + px.length + ' != ' + (w * h * 4));
      return;
    }
    if (view.width !== w) view.width = w;
    if (view.height !== h) view.height = h;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(px), w, h), 0, 0);
    if (payload.showBoxes) drawBoxes(payload.points);
    // Tell the main process the painted size so it can correct the window if
    // the OS clamped it - a clipped preview would silently hide detections.
    if (api.report) api.report({ width: w, height: h, count: payload.count || 0 });
  }

  // Esc closes; so does a double-click, which is the only click a frameless
  // window gets for free. A single click must not close, or dragging the
  // window would dismiss it.
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && api.close) api.close();
  });
  document.addEventListener('dblclick', function () {
    if (api.close) api.close();
  });
  window.addEventListener('mousedown', function (ev) { ev.preventDefault(); });

  if (api.onRender) api.onRender(render);
})();
