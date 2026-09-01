// MIL logtail v1 - lock-safe log file reading helpers
const fs = require('fs');

const LOCK_CODES = new Set(['EBUSY', 'EPERM', 'EACCES']);
const LOCK_RETRY_MS = 750;
const MAX_LOCK_RETRIES = 3;

function isLockError(err) {
  return !!err && LOCK_CODES.has(err.code);
}

function withFd(filePath, fn) {
  const fd = fs.openSync(filePath, 'r');
  try {
    return fn(fd, fs.fstatSync(fd).size);
  } finally {
    try { fs.closeSync(fd); } catch (_) { /* already closed */ }
  }
}

// Throws on lock - caller schedules the retry
function readNewBytes(filePath, offset, size) {
  return withFd(filePath, (fd) => {
    const buf = Buffer.alloc(Math.max(0, size - offset));
    fs.readSync(fd, buf, 0, buf.length, offset);
    return buf;
  });
}

function readTailBytes(filePath, tailSize) {
  return withFd(filePath, (fd, size) => {
    const start = Math.max(0, size - tailSize);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    return buf;
  });
}

function readHeadBytes(filePath, headSize) {
  return withFd(filePath, (fd, size) => {
    const buf = Buffer.alloc(Math.min(size, headSize));
    fs.readSync(fd, buf, 0, buf.length, 0);
    return buf;
  });
}

function detectEncoding(filePath) {
  try {
    const b = readHeadBytes(filePath, 2);
    if (b[0] === 0xFF && b[1] === 0xFE) return 'utf16le';
  } catch (_) { /* default utf8 */ }
  return 'utf8';
}

function decodeChunk(buf, enc) {
  const text = enc === 'utf16le' ? buf.toString('utf16le') : buf.toString('utf8');
  return text.replace(/\uFEFF/g, '');
}

function readHeaderSync(filePath, enc) {
  try {
    const lines = decodeChunk(readHeadBytes(filePath, 8192), enc).split(/\r?\n/);
    let character = null;
    let channel = null;
    let sessionStart = null;
    for (const raw of lines) {
      const line = raw.trim();
      const cm = line.match(/^Channel Name:\s*(.+)$/i);
      if (cm) channel = cm[1].trim();
      const lm = line.match(/^Listener:\s*(.+)$/i);
      if (lm) character = lm[1].trim();
      const sm = line.match(/^Session started:\s*(.+)$/i);
      if (sm) sessionStart = sm[1].trim();
    }
    return { character, channel, sessionStart };
  } catch (_) {
    return { character: null, channel: null, sessionStart: null };
  }
}

module.exports = {
  isLockError,
  readNewBytes,
  readTailBytes,
  detectEncoding,
  decodeChunk,
  readHeaderSync,
  LOCK_RETRY_MS,
  MAX_LOCK_RETRIES,
};