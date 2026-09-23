// Local Monitor templates — load swatch images to grey Float32 luminance arrays.
const fs = require('fs');
const path = require('path');

const EXTENSIONS = ['.png', '.jpg', '.jpeg'];

function bundledDir() {
  const { app } = require('electron');
  const base = app.isPackaged
    ? process.resourcesPath
    : path.resolve(__dirname, '..', '..', '..');
  return path.join(base, 'resources', 'local-monitor', 'templates');
}

function existsDir(dir) {
  try {
    return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
  } catch (_) {
    return false;
  }
}

function resolveDir(custom) {
  const trimmed = custom && typeof custom === 'string' ? custom.trim() : '';
  if (trimmed) {
    if (!existsDir(trimmed)) return null;
    return trimmed;
  }
  const dir = bundledDir();
  return existsDir(dir) ? dir : null;
}

// Bitmap is BGRA (nativeImage.toBitmap()), premultiplied. BT.601 luminance.
function bitmapToLuminance(buf, width, height, bgra = true) {
  const out = new Float32Array(width * height);
  const blue = bgra ? 0 : 2;
  const red = bgra ? 2 : 0;
  const n = width * height;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    out[i] = 0.114 * buf[o + blue] + 0.587 * buf[o + 1] + 0.299 * buf[o + red];
  }
  return out;
}

function load(dir) {
  const { nativeImage } = require('electron');
  const dirName = resolveDir(dir) || bundledDir();
  let names = [];
  try {
    names = fs.readdirSync(dirName);
  } catch (_) {
    names = [];
  }
  const files = names
    .filter((f) => EXTENSIONS.includes(path.extname(f).toLowerCase()))
    .sort();
  const list = [];
  for (const name of files) {
    try {
      const img = nativeImage.createFromPath(path.join(dirName, name));
      if (img.isEmpty()) continue;
      const size = img.getSize();
      const bitmap = img.toBitmap();
      list.push({
        name,
        width: size.width,
        height: size.height,
        data: bitmapToLuminance(bitmap, size.width, size.height),
      });
    } catch (_) {
      // Skip unreadable swatches individually; never abort the whole load.
    }
  }
  return { list, count: list.length, dir: dirName };
}

module.exports = { load, resolveDir, bundledDir, bitmapToLuminance };