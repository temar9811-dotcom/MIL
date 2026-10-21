// # FILE: src/main/localmonitor/vision.js
// # VERSION: 1
// OpenCV-compatible template matching (TM_CCOEFF_NORMED) plus a port of
// cv.groupRectangles.
//
// This is the detection stage of EVE-Alert (github.com/Geuthur/EVE-Alert,
// GPL-3.0) reimplemented for the main process: min-max normalise both images,
// slide every template across the region, keep the positions scoring at or above
// the threshold, then merge overlapping boxes so one contact yields one
// detection.
//
// TM_CCOEFF_NORMED at offset (x, y) over n = w*h*3 samples:
//   num = SUM(T*I) - n*mean(T)*mean(I)
//   den = sqrt((SUM(T*T) - n*mean(T)^2) * (SUM(I*I) - n*mean(I)^2))
// The window sums come from summed-area tables, so only SUM(T*I) needs a real
// multiply-accumulate. A half-resolution pass runs first and only its hits are
// re-scored at full resolution, which is what keeps a 250ms poll affordable.

const COARSE_MIN_SIDE = 8;   // templates thinner than this are matched at full res only
const COARSE_RELAX = 0.15;   // accept a coarse hit this far below the threshold
const GROUP_THRESHOLD = 1;   // cv.groupRectangles groupThreshold
const GROUP_EPS = 0.5;       // cv.groupRectangles eps (intersection-over-union)

// Joint min-max normalisation across all three channels, matching
// cv.normalize(src, None, 0, 255, cv.NORM_MINMAX) on a colour image.
function normalizePlanes(img) {
  const { r, g, b, width, height } = img;
  const n = width * height;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < n; i++) {
    const R = r[i], G = g[i], B = b[i];
    if (R < min) min = R;
    if (R > max) max = R;
    if (G < min) min = G;
    if (G > max) max = G;
    if (B < min) min = B;
    if (B > max) max = B;
  }
  const range = max - min;
  const scale = range > 0 ? 255 / range : 0;
  for (let i = 0; i < n; i++) {
    r[i] = (r[i] - min) * scale;
    g[i] = (g[i] - min) * scale;
    b[i] = (b[i] - min) * scale;
  }
  return img;
}

// 2x2 box average, used only to build the coarse search level.
function halve(img) {
  const w = img.width >> 1;
  const h = img.height >> 1;
  if (w < 1 || h < 1) return null;
  const n = w * h;
  const r = new Float32Array(n);
  const g = new Float32Array(n);
  const b = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * 2) * img.width + x * 2;
      const d = o + img.width;
      const i = y * w + x;
      r[i] = (img.r[o] + img.r[o + 1] + img.r[d] + img.r[d + 1]) / 4;
      g[i] = (img.g[o] + img.g[o + 1] + img.g[d] + img.g[d + 1]) / 4;
      b[i] = (img.b[o] + img.b[o + 1] + img.b[d] + img.b[d + 1]) / 4;
    }
  }
  return { r, g, b, width: w, height: h };
}

// Summed-area tables over (R+G+B) and (R^2+G^2+B^2).
function buildIntegral(img) {
  const { r, g, b, width, height } = img;
  const iw = width + 1;
  const sum = new Float64Array(iw * (height + 1));
  const sumSq = new Float64Array(iw * (height + 1));
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    let rowSq = 0;
    const src = y * width;
    const base = (y + 1) * iw;
    const prev = y * iw;
    for (let x = 0; x < width; x++) {
      const R = r[src + x];
      const G = g[src + x];
      const B = b[src + x];
      rowSum += R + G + B;
      rowSq += R * R + G * G + B * B;
      sum[base + x + 1] = sum[prev + x + 1] + rowSum;
      sumSq[base + x + 1] = sumSq[prev + x + 1] + rowSq;
    }
  }
  return { sum, sumSq, iw };
}

class Template {
  constructor(name, img) {
    normalizePlanes(img);
    const pixels = img.width * img.height;
    let s = 0;
    let sq = 0;
    for (let i = 0; i < pixels; i++) {
      const R = img.r[i];
      const G = img.g[i];
      const B = img.b[i];
      s += R + G + B;
      sq += R * R + G * G + B * B;
    }
    this.name = name;
    this.width = img.width;
    this.height = img.height;
    this.r = img.r;
    this.g = img.g;
    this.b = img.b;
    this.n = pixels * 3;
    this.mean = s / this.n;
    this.varSum = sq - this.n * this.mean * this.mean;
    const small = halve(img);
    this.half = small && img.width >= COARSE_MIN_SIDE && img.height >= COARSE_MIN_SIDE
      ? new Template(`${name}@1/2`, small)
      : null;
  }
}

class Frame {
  constructor(img) {
    normalizePlanes(img);
    this.width = img.width;
    this.height = img.height;
    this.r = img.r;
    this.g = img.g;
    this.b = img.b;
    const it = buildIntegral(this);
    this.sum = it.sum;
    this.sumSq = it.sumSq;
    this.iw = it.iw;
  }

  windowSum(table, x, y, w, h) {
    const iw = this.iw;
    return table[(y + h) * iw + x + w] - table[y * iw + x + w]
      - table[(y + h) * iw + x] + table[y * iw + x];
  }

  // Correlation coefficient of tpl against the window at (x, y), or -1 when the
  // window or the template carries no contrast to correlate.
  score(tpl, x, y) {
    if (tpl.varSum <= 1e-9) return -1;
    const tw = tpl.width;
    const th = tpl.height;
    const n = tpl.n;
    const total = this.windowSum(this.sum, x, y, tw, th);
    const totalSq = this.windowSum(this.sumSq, x, y, tw, th);
    const mean = total / n;
    const variance = totalSq - n * mean * mean;
    if (variance <= 1e-9) return -1;

    const r = this.r;
    const g = this.g;
    const b = this.b;
    const tr = tpl.r;
    const tg = tpl.g;
    const tb = tpl.b;
    const stride = this.width;
    let dot = 0;
    for (let v = 0; v < th; v++) {
      let o = v * tw;
      let p = (y + v) * stride + x;
      for (let u = 0; u < tw; u++, o++, p++) {
        dot += tr[o] * r[p] + tg[o] * g[p] + tb[o] * b[p];
      }
    }
    const den = Math.sqrt(tpl.varSum * variance);
    if (den <= 1e-9) return -1;
    return (dot - n * tpl.mean * mean) / den;
  }
}

function iou(a, b) {
  const ax2 = a[0] + a[2];
  const ay2 = a[1] + a[3];
  const bx2 = b[0] + b[2];
  const by2 = b[1] + b[3];
  const iw = Math.min(ax2, bx2) - Math.max(a[0], b[0]);
  const ih = Math.min(ay2, by2) - Math.max(a[1], b[1]);
  if (iw <= 0 || ih <= 0) return 0;
  const inter = iw * ih;
  const union = a[2] * a[3] + b[2] * b[3] - inter;
  return union > 0 ? inter / union : 0;
}

// Port of cv.groupRectangles: merge boxes whose intersection-over-union beats
// eps, then emit one area-weighted box per group. The reference duplicates every
// rectangle before grouping, which changes neither membership nor the weighted
// average, so it is left out here.
function groupRectangles(rects, groupThreshold = GROUP_THRESHOLD, eps = GROUP_EPS) {
  const n = rects.length;
  if (!n) return [];
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (i) => {
    let root = i;
    while (parent[root] !== root) root = parent[root];
    while (parent[i] !== root) {
      const next = parent[i];
      parent[i] = root;
      i = next;
    }
    return root;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (iou(rects[i], rects[j]) > eps) {
        const ri = find(i);
        const rj = find(j);
        if (ri !== rj) parent[rj] = ri;
      }
    }
  }
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    let bucket = groups.get(root);
    if (!bucket) {
      bucket = [];
      groups.set(root, bucket);
    }
    bucket.push(i);
  }
  const out = [];
  for (const bucket of groups.values()) {
    if (bucket.length < groupThreshold) continue;
    let sx = 0;
    let sy = 0;
    let sw = 0;
    let sh = 0;
    let sa = 0;
    for (const i of bucket) {
      const [x, y, w, h] = rects[i];
      const area = w * h;
      sx += x * area;
      sy += y * area;
      sw += w * area;
      sh += h * area;
      sa += area;
    }
    out.push([
      Math.round(sx / sa),
      Math.round(sy / sa),
      Math.round(sw / sa),
      Math.round(sh / sa),
    ]);
  }
  return out;
}

class Vision {
  constructor(templates) {
    this.templates = templates;
  }

  get count() {
    return this.templates.length;
  }

  // img: { r, g, b, width, height } float planes, consumed (normalised in place).
  // Returns merged [x, y, w, h] boxes, one per contact.
  //
  // `trace`, when given, collects every hit that cleared the threshold together
  // with the template that produced it and the score it got. The returned boxes
  // are still merged and unchanged - the trace is pre-merge, so it describes
  // what matched rather than how many contacts survived the merge. Passing
  // nothing keeps the hot path exactly as it was.
  match(img, threshold, trace) {
    if (!this.templates.length) return [];
    const frame = new Frame(img);
    let coarse = null;
    const boxes = [];
    for (const tpl of this.templates) {
      if (tpl.width > frame.width || tpl.height > frame.height) continue;
      for (const [x, y] of this.candidates(frame, tpl, threshold, () => {
        if (coarse) return coarse;
        const small = halve(frame);
        coarse = small ? new Frame(small) : null;
        return coarse;
      })) {
        // Scored once and reused: a second call would double the cost of the
        // most expensive line in the poll loop.
        const score = frame.score(tpl, x, y);
        if (score < threshold) continue;
        boxes.push([x, y, tpl.width, tpl.height]);
        if (trace) trace.push({ name: tpl.name, score, x, y, w: tpl.width, h: tpl.height });
      }
    }
    return groupRectangles(boxes);
  }

  candidates(frame, tpl, threshold, getCoarse) {
    const coarse = tpl.half ? getCoarse() : null;
    if (!coarse || !tpl.half || coarse.width < tpl.half.width || coarse.height < tpl.half.height) {
      const all = [];
      for (let y = 0; y + tpl.height <= frame.height; y++) {
        for (let x = 0; x + tpl.width <= frame.width; x++) all.push([x, y]);
      }
      return all;
    }
    const relaxed = Math.max(0, threshold - COARSE_RELAX);
    const ht = tpl.half;
    const maxX = coarse.width - ht.width;
    const maxY = coarse.height - ht.height;
    const hits = [];
    for (let y = 0; y <= maxY; y++) {
      for (let x = 0; x <= maxX; x++) {
        if (coarse.score(ht, x, y) < relaxed) continue;
        // A coarse cell covers a 2x2 block, so verify all four full-res offsets.
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const fx = x * 2 + dx;
            const fy = y * 2 + dy;
            if (fx + tpl.width <= frame.width && fy + tpl.height <= frame.height) {
              hits.push([fx, fy]);
            }
          }
        }
      }
    }
    return hits;
  }
}

module.exports = { Vision, Template, Frame, groupRectangles, normalizePlanes, halve };
