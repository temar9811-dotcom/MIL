// # FILE: src/main/localmonitor/bitmap.js
// # VERSION: 1
// Raw pixel helpers for the local monitor.
//
// NativeImage.toBitmap() hands back 32-bit pixels whose channel order is
// platform dependent and not pinned down by the docs. Template matching is
// blind to that (a correlation is invariant when both images are permuted the
// same way) but the preview handed to the renderer is not, so the order is
// probed once from a PNG whose RGBA content we control.
const { nativeImage } = require('electron');
const zlib = require('zlib');

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

// Minimal 8-bit RGBA PNG encoder, used only to build the channel-order probe.
function encodeRgbaPng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: truecolour with alpha
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

let cachedOrder = null;

// 'rgba' or 'bgra' - the byte order of NativeImage.toBitmap() output.
function channelOrder() {
  if (cachedOrder) return cachedOrder;
  // Two pixels we author ourselves: pure red, then pure blue.
  const png = encodeRgbaPng(2, 1, new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]));
  const bmp = nativeImage.createFromBuffer(png).toBitmap();
  cachedOrder = bmp[0] > bmp[2] ? 'bgra' : 'rgba';
  return cachedOrder;
}

// True RGBA bytes, for anything the renderer will draw.
function toRgba(image) {
  const { width, height } = image.getSize();
  const bmp = image.toBitmap();
  const out = new Uint8Array(width * height * 4);
  if (channelOrder() === 'bgra') {
    for (let i = 0; i < out.length; i += 4) {
      out[i] = bmp[i + 2];
      out[i + 1] = bmp[i + 1];
      out[i + 2] = bmp[i];
      out[i + 3] = bmp[i + 3];
    }
  } else {
    out.set(bmp);
  }
  return { rgba: out, width, height };
}

// Three float planes for matching. Deliberately does not swizzle: the template
// is read the same way, so a consistent permutation cancels out in the
// correlation and the hot loop stays a straight copy.
function toChannels(image) {
  const { width, height } = image.getSize();
  const bmp = image.toBitmap();
  const n = width * height;
  const r = new Float32Array(n);
  const g = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0, o = 0; i < n; i++, o += 4) {
    r[i] = bmp[o];
    g[i] = bmp[o + 1];
    b[i] = bmp[o + 2];
  }
  return { r, g, b, width, height };
}

// Resample three float planes to dstW x dstH.
//
// Shrinking uses an area (box) filter, which is what makes a template captured
// at one EVE interface scale degrade gracefully to the others: every destination
// pixel is the mean of the source pixels it covers, so fine detail folds into the
// average instead of aliasing into the wrong pixel. Growing uses bilinear.
//
// This is the reason a master captured at the largest interface scale is worth
// more than one captured at the smallest: downscaling keeps real detail at every
// smaller scale, while upscaling can only invent it.
function resampleChannels(img, dstW, dstH) {
  const { r, g, b, width: sw, height: sh } = img;
  dstW = Math.max(1, Math.round(dstW));
  dstH = Math.max(1, Math.round(dstH));
  if (dstW === sw && dstH === sh) {
    return { r: Float32Array.from(r), g: Float32Array.from(g), b: Float32Array.from(b), width: sw, height: sh };
  }
  const n = dstW * dstH;
  const or_ = new Float32Array(n);
  const og = new Float32Array(n);
  const ob = new Float32Array(n);
  const shrinking = dstW <= sw && dstH <= sh;
  for (let dy = 0; dy < dstH; dy++) {
    for (let dx = 0; dx < dstW; dx++) {
      const d = dy * dstW + dx;
      if (shrinking) {
        const x0 = (dx * sw) / dstW;
        const x1 = ((dx + 1) * sw) / dstW;
        const y0 = (dy * sh) / dstH;
        const y1 = ((dy + 1) * sh) / dstH;
        const ix0 = Math.floor(x0);
        const ix1 = Math.min(sw, Math.ceil(x1));
        const iy0 = Math.floor(y0);
        const iy1 = Math.min(sh, Math.ceil(y1));
        let sr = 0, sg = 0, sb = 0, c = 0;
        for (let y = iy0; y < iy1; y++) {
          const cy = Math.min(y + 1, y1) - Math.max(y, y0);
          if (cy <= 0) continue;
          for (let x = ix0; x < ix1; x++) {
            const cx = Math.min(x + 1, x1) - Math.max(x, x0);
            if (cx <= 0) continue;
            const wgt = cx * cy;
            const s = y * sw + x;
            sr += r[s] * wgt; sg += g[s] * wgt; sb += b[s] * wgt; c += wgt;
          }
        }
        if (c > 0) { or_[d] = sr / c; og[d] = sg / c; ob[d] = sb / c; }
        continue;
      }
      // bilinear
      const fx = ((dx + 0.5) * sw) / dstW - 0.5;
      const fy = ((dy + 0.5) * sh) / dstH - 0.5;
      const x0 = Math.max(0, Math.min(sw - 1, Math.floor(fx)));
      const y0 = Math.max(0, Math.min(sh - 1, Math.floor(fy)));
      const x1 = Math.min(sw - 1, x0 + 1);
      const y1 = Math.min(sh - 1, y0 + 1);
      const tx = Math.max(0, Math.min(1, fx - x0));
      const ty = Math.max(0, Math.min(1, fy - y0));
      const i00 = y0 * sw + x0;
      const i01 = y0 * sw + x1;
      const i10 = y1 * sw + x0;
      const i11 = y1 * sw + x1;
      const w00 = (1 - tx) * (1 - ty);
      const w01 = tx * (1 - ty);
      const w10 = (1 - tx) * ty;
      const w11 = tx * ty;
      or_[d] = r[i00] * w00 + r[i01] * w01 + r[i10] * w10 + r[i11] * w11;
      og[d] = g[i00] * w00 + g[i01] * w01 + g[i10] * w10 + g[i11] * w11;
      ob[d] = b[i00] * w00 + b[i01] * w01 + b[i10] * w10 + b[i11] * w11;
    }
  }
  return { r: or_, g: og, b: ob, width: dstW, height: dstH };
}

module.exports = { channelOrder, toRgba, toChannels, resampleChannels, encodeRgbaPng };
