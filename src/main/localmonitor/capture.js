// Local Monitor capture — desktopCapturer thumbnail crop to BGRA buffers.

function displayForRegion(region) {
  const { screen } = require('electron');
  const cx = (region.x + region.x2) / 2;
  const cy = (region.y + region.y2) / 2;
  return (
    screen
      .getAllDisplays()
      .find(
        (d) =>
          cx >= d.bounds.x &&
          cx <= d.bounds.x + d.bounds.width &&
          cy >= d.bounds.y &&
          cy <= d.bounds.y + d.bounds.height,
      ) || null
  );
}

function validRegion(region) {
  return (
    region &&
    Number.isFinite(region.x) &&
    Number.isFinite(region.y) &&
    Number.isFinite(region.x2) &&
    Number.isFinite(region.y2) &&
    region.x2 - region.x >= 1 &&
    region.y2 - region.y >= 1
  );
}

async function captureRegion(region) {
  const { desktopCapturer } = require('electron');
  if (!validRegion(region)) return null;
  const display = displayForRegion(region);
  if (!display) return null;
  const { bounds } = display;
  let sources;
  try {
    sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: bounds.width, height: bounds.height },
    });
  } catch (_) {
    return null;
  }
  const source = sources.find((s) => String(s.display_id) === String(display.id));
  if (!source) return null;
  const size = source.thumbnail.getSize();
  const bW = size.width;
  const bH = size.height;
  if (!bW || !bH) return null;
  const scaleX = bW / bounds.width;
  const scaleY = bH / bounds.height;
  const x0 = Math.max(0, Math.round((region.x - bounds.x) * scaleX));
  const y0 = Math.max(0, Math.round((region.y - bounds.y) * scaleY));
  const x1 = Math.min(bW, Math.round((region.x2 - bounds.x) * scaleX));
  const y1 = Math.min(bH, Math.round((region.y2 - bounds.y) * scaleY));
  const cw = x1 - x0;
  const ch = y1 - y0;
  if (cw < 1 || ch < 1) return null;
  const bitmap = source.thumbnail.toBitmap();
  const data = Buffer.alloc(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    const srcStart = ((y0 + y) * bW + x0) * 4;
    bitmap.copy(data, y * cw * 4, srcStart, srcStart + cw * 4);
  }
  return { data, width: cw, height: ch, displayId: display.id };
}

// nativeImage.toBitmap() is BGRA; the renderer needs RGBA for ImageData.
function bgraToRgba(bgra) {
  const out = Buffer.from(bgra);
  const n = out.length;
  for (let i = 0; i < n; i += 4) {
    const b = out[i];
    const r = out[i + 2];
    out[i] = r;
    out[i + 2] = b;
  }
  return out;
}

module.exports = { captureRegion, bgraToRgba, displayForRegion, validRegion };