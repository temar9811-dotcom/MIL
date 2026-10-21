// # FILE: src/main/localmonitor/capture.js
// # VERSION: 1
// Screen capture of a user-picked region, in logical pixels.
//
// Everything downstream - template matching, the overlay preview, the stored
// area rectangle - works in DIP (what screen.getDisplay().bounds and
// BrowserWindow report), so the capture is requested at DIP size and Electron's
// own downscaling of the physical framebuffer does the DPI conversion. That
// means a 125% scaled display is matched in a 0.8x space, which is why the
// engine warns about non-100% scaling: template art has to be supplied at the
// same ratio.
const { desktopCapturer, screen } = require('electron');

function areaSize(area) {
  return {
    width: Math.round(area.x2 - area.x),
    height: Math.round(area.y2 - area.y),
  };
}

function isUsableArea(area) {
  if (!area) return false;
  const { width, height } = areaSize(area);
  return Number.isFinite(width) && Number.isFinite(height) && width >= 8 && height >= 8;
}

// A bare Electron.Rectangle. Must stay free of any extra field: NativeImage/
// screen APIs convert this by shape and throw "conversion failure" otherwise,
// which is why the monitor's internal area objects are never passed directly.
function areaRect(area) {
  const size = areaSize(area);
  return { x: area.x, y: area.y, width: size.width, height: size.height };
}

function areaDisplay(area) {
  return screen.getDisplayMatching(areaRect(area));
}

function clampToBounds(rect, bounds) {
  const x = Math.max(bounds.x, Math.min(rect.x, bounds.x + bounds.width));
  const y = Math.max(bounds.y, Math.min(rect.y, bounds.y + bounds.height));
  const right = Math.max(x, Math.min(rect.x + rect.width, bounds.x + bounds.width));
  const bottom = Math.max(y, Math.min(rect.y + rect.height, bounds.y + bounds.height));
  return { x, y, width: right - x, height: bottom - y };
}

// Returns a NativeImage cropped to the area, or null when the screen could not
// be captured (minimised, locked, or a permission prompt is pending).
async function captureRegion(area) {
  if (!isUsableArea(area)) return null;
  const size = areaSize(area);
  const display = areaDisplay(area);
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: display.bounds.width, height: display.bounds.height },
    fetchWindowIcons: false,
  });
  if (!sources.length) return null;
  const source = sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
  if (!source || !source.thumbnail || source.thumbnail.isEmpty()) return null;

  const b = display.bounds;
  const crop = clampToBounds({ x: area.x - b.x, y: area.y - b.y, width: size.width, height: size.height }, {
    x: 0, y: 0, width: b.width, height: b.height,
  });
  if (crop.width < 1 || crop.height < 1) return null;
  const cropped = source.thumbnail.crop({
    x: Math.round(crop.x), y: Math.round(crop.y),
    width: Math.round(crop.width), height: Math.round(crop.height),
  });
  if (cropped.isEmpty()) return null;
  return cropped;
}

module.exports = { captureRegion, areaSize, isUsableArea, areaRect, areaDisplay };
