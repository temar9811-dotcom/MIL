// # FILE: tools/slice-icons.js
// # VERSION: 1
// Cuts candidate icon tiles out of a Local Monitor snapshot so they can be
// identified by name instead of by eyeballing pixel coordinates.
//
//   node tools/slice-icons.js <snapshot.png> [options]
//
//   --out <dir>       output folder (default: <snapshot dir>/tiles)
//   --band x0:x1      restrict to a vertical band of columns
//   --zoom <n>        output tile size multiplier, default 8
//   --rows            also write a contact sheet with all tiles in a grid
//   --min-run <n>     rows a tile must span to count, default 5
//   --thr <n>         luminance above which a pixel counts as content, default 45
//
// The snapshot is decoded with System.Drawing via PowerShell so the tool runs
// outside Electron. Every tile is written as <out>/tile-<n>.png, smooth-scaled
// so a vision model can read a 9px icon, and described in <out>/manifest.json
// with the exact source rectangle - so a name coming back from a model maps
// straight onto a crop of the original.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const argv = process.argv.slice(2);
// Flags that consume the next argument. Everything else is a switch, and
// anything not starting with -- (and not a consumed value) is positional.
const VALUE_FLAGS = new Set(['out', 'band', 'zoom', 'min-run', 'thr', 'templates', 'export']);
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const name = a.slice(2);
    if (VALUE_FLAGS.has(name) && argv[i + 1] !== undefined) i++;
  } else {
    positional.push(a);
  }
}
const flags = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const name = a.slice(2);
    if (VALUE_FLAGS.has(name)) {
      if (argv[i + 1] !== undefined) flags.push([name, argv[++i]]);
    } else {
      flags.push([name, true]);
    }
  }
}
const flag = (name, fallback) => {
  const hit = flags.find((f) => f[0] === name);
  return hit ? hit[1] : fallback;
};
const has = (name) => flags.some((f) => f[0] === name && f[1] === true);
// --export is repeatable: --export 5=image_hostile-red:200
// (named exportSpecs, not exports: this is CommonJS and `exports` is taken)
const exportSpecs = flags.filter((f) => f[0] === 'export' && typeof f[1] === 'string')
  .map((f) => f[1]);

const src = positional[0];
if (!src) {
  console.error([
    'usage: node tools/slice-icons.js <snapshot.png> [options]',
    '',
    '  --out <dir>          tile output folder (default: <snapshot dir>/tiles)',
    '  --band <x0:x1>       column range holding the icon column',
    '  --zoom <n>           tile magnification for reading, default 8',
    '  --rows               also write contact-sheet.png',
    '  --min-run <n>        rows a tile must span, default 5',
    '  --thr <n>            luminance counted as content, default 45',
    '  --export <n:name:scale>   write tile n as a template (repeatable)',
    '  --templates <dir>    template output folder',
  ].join('\n'));
  process.exit(1);
}
if (!fs.existsSync(src)) {
  console.error(`no such file: ${src}`);
  process.exit(1);
}
const zoom = Math.max(1, Number(flag('zoom', 8)));
const minRun = Math.max(2, Number(flag('min-run', 5)));
const thr = Math.max(1, Number(flag('thr', 45)));
const bandArg = flag('band', null);
const outDir = path.resolve(flag('out', path.join(path.dirname(src), 'tiles')));
fs.mkdirSync(outDir, { recursive: true });

// --- decode via System.Drawing -------------------------------------------
const tmp = path.join(os.tmpdir(), `slice-icons-${process.pid}`);
fs.mkdirSync(tmp, { recursive: true });
const rawPath = path.join(tmp, 'img.raw');
const metaPath = path.join(tmp, 'img.json');
const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$bmp = [System.Drawing.Bitmap]::new('${src.replace(/'/g, "''")}')
$w = $bmp.Width; $h = $bmp.Height
$d = $bmp.LockBits([System.Drawing.Rectangle]::new(0,0,$w,$h), [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$b = New-Object byte[] ($d.Stride * $h)
[System.Runtime.InteropServices.Marshal]::Copy($d.Scan0, $b, 0, $b.Length)
$bmp.UnlockBits($d); $bmp.Dispose()
[System.IO.File]::WriteAllBytes('${rawPath.replace(/'/g, "''")}', $b)
[System.IO.File]::WriteAllText('${metaPath.replace(/'/g, "''")}', (@{ width=$w; height=$h; stride=$d.Stride } | ConvertTo-Json))
`;
execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], { stdio: 'inherit' });
const { width: W, height: H, stride: S } = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
const buf = fs.readFileSync(rawPath);
fs.rmSync(tmp, { recursive: true, force: true });
const bgr = (x, y) => { const o = y * S + x * 4; return [buf[o + 2], buf[o + 1], buf[o]]; };

// --- locate the icon column ----------------------------------------------
// Default band: the leftmost columns that hold content, which is where an EVE
// list keeps its icon. Widen it with --band once you know better.
let bx0 = 0;
let bx1 = Math.min(W, 40) - 1;
if (bandArg) {
  const [a, b] = bandArg.split(':').map(Number);
  bx0 = Math.max(0, Math.min(W - 1, a));
  bx1 = Math.max(bx0, Math.min(W - 1, b));
}
const contentCols = [];
for (let x = 0; x < W; x++) {
  let n = 0;
  for (let y = 0; y < H; y++) { const [r, g, b] = bgr(x, y); if ((r + g + b) / 3 > thr) n++; }
  if (n > 0) contentCols.push(x);
}
// Auto-detect only when no band was given: widen the default to the first
// content column plus room for one icon. An explicit --band is never touched.
if (!bandArg && contentCols.length) {
  bx0 = contentCols[0];
  bx1 = Math.min(W - 1, bx0 + 24);
}

const tiles = [];
{
  let cur = null;
  for (let y = 0; y < H; y++) {
    let n = 0;
    for (let x = bx0; x <= bx1; x++) { const [r, g, b] = bgr(x, y); if ((r + g + b) / 3 > thr) n++; }
    if (n >= 2) { if (!cur) cur = { y0: y, y1: y }; else cur.y1 = y; }
    else if (cur) { if (cur.y1 - cur.y0 + 1 >= minRun) tiles.push(cur); cur = null; }
  }
  if (cur && cur.y1 - cur.y0 + 1 >= minRun) tiles.push(cur);
}

// --- encode --------------------------------------------------------------
const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const zlib = require('zlib');

// bilinear upscale of an RGB crop
function cropScaled(x0, y0, w, h, z) {
  const ow = w * z;
  const oh = h * z;
  const out = Buffer.alloc(ow * oh * 4);
  for (let dy = 0; dy < oh; dy++) {
    const fy = (dy + 0.5) / z - 0.5;
    const sy = Math.max(0, Math.min(h - 1, Math.round(fy)));
    for (let dx = 0; dx < ow; dx++) {
      const fx = (dx + 0.5) / z - 0.5;
      const sx = Math.max(0, Math.min(w - 1, Math.round(fx)));
      const [r, g, b] = bgr(x0 + sx, y0 + sy);
      const o = (dy * ow + dx) * 4;
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255;
    }
  }
  return { data: out, width: ow, height: oh };
}

// --- quality gate ---------------------------------------------------------
// Two independent signals, because neither alone is trustworthy on 16px art.
//
// Speckle is the reliable one. Genuine icon art has no isolated near-pure
// pixels: a crop either contains a colour or it does not. Values like
// (4,1,255) sitting beside (0,0,254) are per-channel quantisation noise from a
// lossy round trip (usually JPEG chroma, re-wrapped losslessly as PNG), and no
// resampling removes it - it only smears. Measured on real art: clean tiles
// sit at 0.0%, damaged ones at 4.5-12%. So speckle is the hard gate.
//
// Coherence (each pixel within 12 of its neighbours' mean) is only a gross-noise
// floor. Small, high-contrast icon art legitimately scores low on it because
// most pixels sit on an edge, so the threshold must sit well below real art:
// clean EVE icons measure 55-73%, while per-channel noise collapses to 0-1%.
// Setting this near the clean figures would reject perfectly good crops.
//
// Both are measured on native source pixels, never on the magnified tiles -
// nearest-neighbour zoom replicates each pixel into a block and would report a
// noise image as ~95% coherent.
const COHERENCE_MIN = 0.35;
const SPECKLE_MAX = 0.01;
function inspect([x0, y0, w, h]) {
  let coh = 0;
  let tot = 0;
  let pure = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = bgr(x0 + x, y0 + y);
      const nb = [bgr(x0 + x, y0 + y - 1), bgr(x0 + x, y0 + y + 1), bgr(x0 + x - 1, y0 + y), bgr(x0 + x + 1, y0 + y)];
      const m = [0, 1, 2].map((k) => nb.reduce((s, n) => s + n[k], 0) / 4);
      const d = Math.max(...[0, 1, 2].map((k) => Math.abs(p[k] - m[k])));
      if (d <= 12) coh++;
      tot++;
      const mx = Math.max(...p);
      const mn = Math.min(...p);
      if (mx > 200 && mx - mn > 180) pure++;
    }
  }
  const coherence = tot ? coh / tot : 0;
  const speckle = (pure + 0) / (w * h);
  return { coherence: +coherence.toFixed(3), speckle: +speckle.toFixed(4), ok: coherence >= COHERENCE_MIN && speckle <= SPECKLE_MAX };
}

// Shrink a rect to the content that differs from its corner background, so the
// exported template carries no dead rows or columns of window background.
function tighten([x0, y0, w, h]) {
  const at = (x, y) => bgr(x0 + x, y0 + y);
  const corners = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]];
  const tally = new Map();
  for (const c of corners) {
    const k = at(c[0], c[1]).join(',');
    tally.set(k, (tally.get(k) || 0) + 1);
  }
  const bg = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number);
  const near = (p) => Math.max(...[0, 1, 2].map((k) => Math.abs(p[k] - bg[k]))) <= 24;
  let ax0 = w, ay0 = h, ax1 = -1, ay1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!near(at(x, y))) {
        if (x < ax0) ax0 = x;
        if (x > ax1) ax1 = x;
        if (y < ay0) ay0 = y;
        if (y > ay1) ay1 = y;
      }
    }
  }
  if (ax1 < 0) return null;
  return [x0 + ax0, y0 + ay0, ax1 - ax0 + 1, ay1 - ay0 + 1];
}

const pad = 1;
const manifest = [];
for (const [i, t] of tiles.entries()) {
  const x0 = Math.max(0, bx0 - pad);
  const w = Math.min(W, bx1 + pad + 1) - x0;
  const raw = [x0, t.y0, w, t.y1 - t.y0 + 1];
  const { data, width, height } = cropScaled(x0, t.y0, w, t.y1 - t.y0 + 1, zoom);
  const name = `tile-${String(i + 1).padStart(3, '0')}.png`;
  fs.writeFileSync(path.join(outDir, name), encodePng(width, height, data));
  // Report quality on the tightened rect, not the raw row, because that is the
  // rect that would actually be written. Measuring the raw row instead counts
  // the dead background rows against the art and makes the listing contradict
  // what export then does.
  const tight = tighten(raw);
  manifest.push({ file: name, n: i + 1, rect: raw, tight, ...(tight ? inspect(tight) : { coherence: 0, speckle: 1, ok: false }) });
}

if (has('rows')) {
  const cols = Math.min(10, manifest.length || 1);
  const rows = Math.ceil(manifest.length / cols) || 1;
  const cw = manifest.length ? manifest[0].rect[2] * zoom + 4 : 8;
  const ch = manifest.length ? manifest[0].rect[3] * zoom + 4 : 8;
  const PW = cols * cw + 4;
  const PH = rows * ch + 4;
  const px = Buffer.alloc(PW * PH * 4);
  for (let i = 0; i < PW * PH; i++) { px[i * 4] = 20; px[i * 4 + 1] = 20; px[i * 4 + 2] = 24; px[i * 4 + 3] = 255; }
  manifest.forEach((m, i) => {
    const gx = 4 + (i % cols) * cw;
    const gy = 4 + Math.floor(i / cols) * ch;
    const srcTile = fs.readFileSync(path.join(outDir, m.file));
    const zw = m.rect[2] * zoom;
    const zh = m.rect[3] * zoom;
    // re-decode our own tile straight from the source pixels to stay lossless
    const { data } = cropScaled(m.rect[0], m.rect[1], m.rect[2], m.rect[3], zoom);
    void srcTile;
    for (let y = 0; y < zh && gy + y < PH; y++) {
      for (let x = 0; x < zw && gx + x < PW; x++) {
        const s = (y * zw + x) * 4;
        const d = ((gy + y) * PW + gx + x) * 4;
        px[d] = data[s]; px[d + 1] = data[s + 1]; px[d + 2] = data[s + 2]; px[d + 3] = 255;
      }
    }
    // 1px separator
    for (let x = 0; x < zw + 2 && gx + x < PW; x++) {
      for (const yy of [gy - 1, gy + zh]) { if (yy < 0 || yy >= PH) continue; const d = (yy * PW + gx + x) * 4; px[d] = 90; px[d + 1] = 90; px[d + 2] = 90; px[d + 3] = 255; }
    }
  });
  fs.writeFileSync(path.join(outDir, 'contact-sheet.png'), encodePng(PW, PH, px));
}

// --- export --------------------------------------------------------------
// --export <n>:<name>:<scale> turns a chosen tile into a ready template:
// tightened to its content, written with the image_ prefix the loader
// routes on, and carrying the _<scale> suffix the size expansion depends on.
// The scale must be the EVE *interface* scale the snapshot was taken at, not
// the display scale in the snapshot's file name.
const templatesDir = path.resolve(flag('templates', path.join(path.dirname(path.resolve(src)), '..', 'templates')));
const exported = [];
if (exportSpecs.length) {
  fs.mkdirSync(templatesDir, { recursive: true });
  for (const spec of exportSpecs) {
    const [nRaw, name, scale] = spec.split(':');
    const n = Number(nRaw);
    const entry = manifest.find((m) => m.n === n);
    if (!entry) {
      console.error(`  REFUSED ${spec}: no tile numbered ${n} (have 1..${manifest.length})`);
      continue;
    }
    if (!/^image_[a-z0-9._-]+$/.test(name || '')) {
      console.error(`  REFUSED ${spec}: name must start with image_ and be lowercase`);
      continue;
    }
    if (!/^\d{2,3}$/.test(scale || '')) {
      console.error(`  REFUSED ${spec}: scale must be an EVE interface scale like 200`);
      continue;
    }
    const tight = entry.tight;
    if (!tight) {
      console.error(`  REFUSED ${spec}: tile ${n} is empty after tightening`);
      continue;
    }
    const q = inspect(tight);
    if (!q.ok) {
      const why = [];
      if (q.coherence < COHERENCE_MIN) why.push(`coherence ${(q.coherence * 100).toFixed(0)}% < ${COHERENCE_MIN * 100}%`);
      if (q.speckle > SPECKLE_MAX) why.push(`speckle ${(q.speckle * 100).toFixed(1)}% > ${SPECKLE_MAX * 100}%`);
      console.error(
        `  REFUSED ${name}_${scale}.png from tile ${n}: art looks lossy (${why.join(', ')}). `
        + 'Re-snap with the app Snapshot button; do not repair the pixels.',
      );
      continue;
    }
    const file = path.join(templatesDir, `${name}_${scale}.png`);
    const { data, width, height } = cropScaled(tight[0], tight[1], tight[2], tight[3], 1);
    fs.writeFileSync(file, encodePng(width, height, data));
    exported.push({ name: `${name}_${scale}.png`, from: entry.file, rect: tight, size: [width, height], ...q });
    console.log(
      `  wrote ${name}_${scale}.png  ${width}x${height}  from ${entry.file} rect ${tight.join(',')}  `
      + `(coherence ${(q.coherence * 100).toFixed(0)}%, speckle ${(q.speckle * 100).toFixed(1)}%)`,
    );
  }
}

fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify({
  source: path.resolve(src), sourceSize: [W, H], band: [bx0, bx1], zoom, count: manifest.length, tiles: manifest, exported,
}, null, 2));

console.log(`source ${path.basename(src)} ${W}x${H}, band x=${bx0}..${bx1}`);
console.log(`${manifest.length} tile(s) -> ${outDir}`);
const flagged = manifest.filter((m) => !m.ok);
for (const m of manifest) {
  const t = m.tight ? `${m.tight[2]}x${m.tight[3]}` : '-';
  console.log(`  ${m.file}  row ${String(m.rect).padEnd(20)} tight ${t.padEnd(9)} coherence ${(m.coherence * 100).toFixed(0)}%  speckle ${(m.speckle * 100).toFixed(1)}%${m.ok ? '' : '  <-- will not export'}`);
}
if (flagged.length) console.log(`${flagged.length} of ${manifest.length} tiles fail the quality gate.`);
if (!exportSpecs.length) {
  console.log(`\nAsk a vision model: "which of these ${manifest.length} images is the <icon> ?" and answer with file names.`);
  console.log('Then: --export <n>:image_<name>:<eve-ui-scale>   (repeatable)');
} else {
  console.log(`\n${exported.length} template(s) written to ${templatesDir}`);
}
if (exported.length === exportSpecs.length && exportSpecs.length) {
  console.log('Reload the app (Start, or Preview) to load them.');
}

