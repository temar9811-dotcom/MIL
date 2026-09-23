// Local Monitor matcher — pure-JS port of OpenCV TM_CCOEFF_NORMED
// plus cv.groupRectangles behaviour, running in a worker_thread.
const { parentPort, isMainThread } = require('worker_threads');

const GROUP_THRESHOLD = 1;
const GROUP_EPS = 0.5;
const DETECTION_THRESHOLD_MIN = 0.1;
const DETECTION_THRESHOLD_MAX = 1.0;

function clampThreshold(threshold) {
  const t = Number(threshold) / 100;
  if (!Number.isFinite(t)) return DETECTION_THRESHOLD_MIN;
  return Math.max(
    Math.min(t, DETECTION_THRESHOLD_MAX),
    DETECTION_THRESHOLD_MIN,
  );
}

function toLuminance(data, width, height, bgra) {
  const out = new Float32Array(width * height);
  const blue = bgra ? 0 : 2;
  const red = bgra ? 2 : 0;
  const n = width * height;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    out[i] = 0.114 * data[o + blue] + 0.587 * data[o + 1] + 0.299 * data[o + red];
  }
  return out;
}

function normalizeImage(f32) {
  const n = f32.length;
  let mn = Infinity;
  let mx = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = f32[i];
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  if (!(mx > mn)) {
    f32.fill(0);
    return;
  }
  const scale = 255 / (mx - mn);
  for (let i = 0; i < n; i++) f32[i] = (f32[i] - mn) * scale;
}

function buildIntegrals(lum, width, height) {
  const n = width * height;
  const sum = new Float64Array(n);
  const sumsq = new Float64Array(n);
  for (let y = 0; y < height; y++) {
    let row = 0;
    let row2 = 0;
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const v = lum[idx];
      row += v;
      row2 += v * v;
      const up = y > 0 ? sum[idx - width] : 0;
      const up2 = y > 0 ? sumsq[idx - width] : 0;
      sum[idx] = row + up;
      sumsq[idx] = row2 + up2;
    }
  }
  return { sum, sumsq };
}

function windowStats(sums, sumsqWide, width, x, y, tw, th) {
  const a = y * width + x;
  const b = y * width + x + tw;
  const c = (y + th) * width + x;
  const d = (y + th) * width + x + tw;
  return {
    sum: sums[d] - sums[b] - sums[c] + sums[a],
    sumsq: sumsqWide[d] - sumsqWide[b] - sumsqWide[c] + sumsqWide[a],
  };
}

function matchTemplate(lum, sums, sumsq, width, height, tpl, tw, th) {
  const maxX = width - tw;
  const maxY = height - th;
  const floats = maxX + 1;
  const result = new Float32Array(floats * (maxY + 1));
  const n = tw * th;

  let tSum = 0;
  let tSum2 = 0;
  for (let i = 0; i < n; i++) {
    const v = tpl[i];
    tSum += v;
    tSum2 += v * v;
  }
  const tMean = tSum / n;
  const tVar = Math.max(0, tSum2 - n * tMean * tMean);
  if (tVar <= 0) return result;

  for (let y = 0; y <= maxY; y++) {
    for (let x = 0; x <= maxX; x++) {
      let dot = 0;
      for (let ty = 0; ty < th; ty++) {
        const hBase = (y + ty) * width + x;
        const tBase = ty * tw;
        for (let tx = 0; tx < tw; tx++) dot += tpl[tBase + tx] * lum[hBase + tx];
      }
      const ws = windowStats(sums, sumsq, width, x, y, tw, th);
      const wMean = ws.sum / n;
      const wVar = Math.max(0, ws.sumsq - n * wMean * wMean);
      const denom = wVar * tVar;
      const corr = dot - tMean * ws.sum;
      result[y * floats + x] = denom > 1e-12 ? corr / Math.sqrt(denom) : 0;
    }
  }
  return result;
}

function rectsSimilar(a, b, eps) {
  const minW = Math.min(a[2], b[2]);
  const minH = Math.min(a[3], b[3]);
  return (
    Math.abs(a[0] - b[0]) <= eps * minW &&
    Math.abs(a[1] - b[1]) <= eps * minH &&
    Math.abs(a[0] + a[2] - b[0] - b[2]) <= eps * minW &&
    Math.abs(a[1] + a[3] - b[1] - b[3]) <= eps * minH
  );
}

function groupRectangles(rects, groupThreshold, eps) {
  if (!rects.length) return [];
  const n = rects.length;
  const classes = new Array(n).fill(-1);
  let nc = 0;
  for (let i = 0; i < n; i++) {
    if (classes[i] >= 0) continue;
    classes[i] = nc;
    const anchor = rects[i];
    for (let j = i + 1; j < n; j++) {
      if (classes[j] < 0 && rectsSimilar(anchor, rects[j], eps)) classes[j] = nc;
    }
    nc++;
  }
  const grouped = [];
  for (let c = 0; c < nc; c++) {
    let count = 0;
    let x = 0;
    let y = 0;
    let w = 0;
    let h = 0;
    for (let i = 0; i < n; i++) {
      if (classes[i] !== c) continue;
      count++;
      x += rects[i][0];
      y += rects[i][1];
      w += rects[i][2];
      h += rects[i][3];
    }
    if (count < groupThreshold) continue;
    grouped.push([
      Math.round(x / count),
      Math.round(y / count),
      Math.round(w / count),
      Math.round(h / count),
    ]);
  }
  return grouped;
}

function matchRegion(lum, width, height, templates, threshold) {
  const thr = clampThreshold(threshold);
  if (!templates || !templates.length) return [];
  normalizeImage(lum);
  const integrals = buildIntegrals(lum, width, height);
  const points = [];
  for (const tpl of templates) {
    const tw = tpl.width;
    const th = tpl.height;
    if (!tw || !th || tw > width || th > height) continue;
    const tnorm = Float32Array.from(tpl.data || []);
    if (!tnorm.length) continue;
    normalizeImage(tnorm);
    const result = matchTemplate(
      lum,
      integrals.sum,
      integrals.sumsq,
      width,
      height,
      tnorm,
      tw,
      th,
    );
    const maxX = width - tw;
    const maxY = height - th;
    const floats = maxX + 1;
    const rects = [];
    for (let y = 0; y <= maxY; y++) {
      for (let x = 0; x <= maxX; x++) {
        if (result[y * floats + x] >= thr) {
          rects.push([x, y, tw, th]);
          rects.push([x, y, tw, th]);
        }
      }
    }
    for (const r of groupRectangles(rects, GROUP_THRESHOLD, GROUP_EPS)) {
      points.push(r);
    }
  }
  return points;
}

async function runMatch(msg) {
  const { id, width, height, data, templates, threshold } = msg;
  const bgra = msg.bgra !== false;
  const lum = toLuminance(data, width, height, bgra);
  const points = matchRegion(lum, width, height, templates, threshold);
  return { id, points };
}

if (isMainThread) {
  module.exports = { matchRegion, groupRectangles, clampThreshold, toLuminance };
} else {
  parentPort.on('message', async (msg) => {
    try {
      const result = await runMatch(msg);
      parentPort.postMessage(result);
    } catch (err) {
      parentPort.postMessage({ id: msg && msg.id, error: err.message || String(err) });
    }
  });
}