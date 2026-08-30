// diag.js - usage: node diag.js [logfile]   (no arg = newest .txt in Chatlogs)
const fs = require('fs');
const path = require('path');

let file = process.argv[2];
if (!file) {
  const dir = path.join(process.env.USERPROFILE, 'Documents', 'EVE', 'logs', 'Chatlogs');
  const files = fs.readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.txt'))
    .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  if (!files.length) { console.log('no txt files found in', dir); process.exit(1); }
  file = path.join(dir, files[0].f);
}

const stat = fs.statSync(file);
console.log('file:', file);
console.log('size:', stat.size, '| mtime:', stat.mtime.toString());

const fd = fs.openSync(file, 'r');
const head = Buffer.alloc(Math.min(512, stat.size));
fs.readSync(fd, head, 0, head.length, 0);
const tailLen = Math.min(2048, stat.size);
const tail = Buffer.alloc(tailLen);
fs.readSync(fd, tail, 0, tailLen, stat.size - tailLen);
fs.closeSync(fd);

console.log('first 8 bytes hex:', head.slice(0, 8).toString('hex'));
console.log('encoding guess:', (head[0] === 0xFF && head[1] === 0xFE) ? 'UTF-16LE' : 'NOT UTF-16LE');

const decode = (buf) => (buf[0] === 0xFF && buf[1] === 0xFE)
  ? buf.toString('utf16le').replace(/\uFEFF/g, '')
  : buf.toString('utf8').replace(/\uFEFF/g, '');

const lines = decode(tail).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
console.log('\nlast decoded lines:');
lines.slice(-4).forEach((l) => console.log('  |', l));

const re = /^\[\s*(\d{4}\.\d{2}\.\d{2}\s+\d{2}:\d{2}:\d{2})\s*\]\s+(.+?)\s+>\s+(.*)$/;
const last = lines[lines.length - 1] || '';
const m = last.match(re);
console.log('\nparse regex match on last line:', m ? 'YES' : 'NO');
if (m) {
  const p = m[1].match(/^(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
  const asUTC = new Date(Date.UTC(+p[1], +p[2] - 1, +p[3], +p[4], +p[5], +p[6]));
  const asLocal = new Date(+p[1], +p[2] - 1, +p[3], +p[4], +p[5], +p[6]);
  const now = Date.now();
  console.log('log timestamp:', m[1]);
  console.log('now (UTC):   ', new Date(now).toUTCString());
  console.log('age treated as UTC  :', Math.round((now - asUTC.getTime()) / 60000), 'min');
  console.log('age treated as local:', Math.round((now - asLocal.getTime()) / 60000), 'min');
}