// MIL extract-star-map v2 - build resources/data/map.json from the EVE SDE
// Produces three independent 2D map layouts:
//   - neweden    : the k-space cluster, each region keeps CCP's exact x2d/y2d
//                  interior shape, regions repacked so true-3D neighbours
//                  (light years) sit next to each other on the map.
//   - wormholes  : all w-space, drawn from its true 3D positions (no CCP 2D
//                  layout exists) projected to 2D via principal-component fit.
//   - pochven    : the Triglavian region, same true-3D projection.
//
// Input:  ./static.db (SDE-derived, same file extract-eve-data.js uses)
// Output: resources/data/map.json

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const DB_PATH = './static.db';
const OUTPUT = path.join(__dirname, 'resources', 'data', 'map.json');

const JUMP_PX = 18;    // target on-screen length of a median jump (neweden)
const PAD = 26;        // empty gutter between packed regions / around maps (px)
const PAD_INNER = 16;  // padding inside each region's bounding box (px)
const M_PER_LY = 9.4607304725808e15;
const WMAP_TARGET_PX = 1500;   // blob maps target width ~1500px

const MORTON_BITS = 21; // w-space / k-space region centroids in ly * 1000 fit in ~21 bits

if (!fs.existsSync(DB_PATH)) {
  console.error('Error: static.db not found (SDE-derived file, see extract-eve-data.js).');
  process.exit(1);
}

const db = new sqlite3.Database(DB_PATH);

function isNewEden(rid) { return (rid >= 10000001 && rid <= 10000069) || rid === 10001000 || rid === 10001004; }
function isPochven(rid) { return rid === 10000070; }
function isWormhole(rid) { return rid >= 11000001 && rid <= 11000033; }

function median(sorted) {
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// --- 3D -> 2D principal-component projection (preserves real distances) ---
function pcaProject(points) {
  // points: [{x,y,z}]. Returns [u,v] per point (relative to origin ~ centroid),
  // axes are the two dominant eigenvectors of the covariance matrix.
  const n = points.length;
  let mx = 0, my = 0, mz = 0;
  for (const p of points) { mx += p.x; my += p.y; mz += p.z; }
  mx /= n; my /= n; mz /= n;
  let cxx = 0, cxy = 0, cxz = 0, cyy = 0, cyz = 0, czz = 0;
  for (const p of points) {
    const dx = p.x - mx, dy = p.y - my, dz = p.z - mz;
    cxx += dx * dx; cxy += dx * dy; cxz += dx * dz;
    cyy += dy * dy; cyz += dy * dz; czz += dz * dz;
  }
  // Jacobi rotation on the symmetric 3x3 covariance
  const A = [[cxx, cxy, cxz], [cxy, cyy, cyz], [cxz, cyz, czz]];
  const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let iter = 0; iter < 50; iter++) {
    let off = Math.abs(A[0][1]) + Math.abs(A[0][2]) + Math.abs(A[1][2]);
    if (off < 1e-9) break;
    const offs = [[0, 1], [0, 2], [1, 2]].sort((a, b) => Math.abs(A[b[0]][b[1]]) - Math.abs(A[a[0]][a[1]]));
    const [p, q] = offs[0];
    const apq = A[p][q];
    if (Math.abs(apq) < 1e-12) continue;
    const theta = (A[q][q] - A[p][p]) / (2 * apq);
    const t = (Math.abs(theta) < 1e-9 ? 1 : Math.sign(theta)) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
    const c = 1 / Math.sqrt(t * t + 1), s = t * c;
    for (let k = 0; k < 3; k++) {
      const akp = A[k][p], akq = A[k][q];
      A[k][p] = c * akp - s * akq;
      A[k][q] = s * akp + c * akq;
    }
    for (let k = 0; k < 3; k++) {
      const apk = A[p][k], aqk = A[q][k];
      A[p][k] = c * apk - s * aqk;
      A[q][k] = s * apk + c * aqk;
    }
    for (let k = 0; k < 3; k++) {
      const vkp = V[k][p], vkq = V[k][q];
      V[k][p] = c * vkp - s * vkq;
      V[k][q] = s * vkp + c * vkq;
    }
  }
  // eigenpairs: vault value A[i][i], vector V[*][i]
  const evs = [0, 1, 2].sort((a, b) => Math.abs(A[b][b]) - Math.abs(A[a][a]));
  const e1 = [V[0][evs[0]], V[1][evs[0]], V[2][evs[0]]];
  const e2 = [V[0][evs[1]], V[1][evs[1]], V[2][evs[1]]];
  return points.map((p) => {
    const dx = p.x - mx, dy = p.y - my, dz = p.z - mz;
    return { u: dx * e1[0] + dy * e1[1] + dz * e1[2], v: dx * e2[0] + dy * e2[1] + dz * e2[2] };
  });
}

// --- Z-order (Morton) key in 3D: keeps true-3D neighbours close in sort order ---
function spread3(v) {
  v &= (1 << MORTON_BITS) - 1;
  for (let i = 0; i < 21; i += 3) {
    const bit = 1 << i;
    v = (v | (v << (2 * i + 1))) & (((1 << (21 - i)) - 1) << (2 * i));
  }
  return v;
}

function morton3D(xi, yi, zi) {
  return (spread3(xi) | (spread3(yi) << 1) | (spread3(zi) << 2)) >>> 0;
}

function hilbertOrder(items) {
  // items: array of records carrying p0._3d = {x,y,z} in ly. Returns the items
  // sorted by 3D Morton key, so consecutive records are true-3D neighbours.
  let loX = Infinity, hiX = -Infinity, loY = Infinity, hiY = -Infinity, loZ = Infinity, hiZ = -Infinity;
  for (const it of items) {
    const p = it._3d || it;
    if (p.x < loX) loX = p.x; if (p.x > hiX) hiX = p.x;
    if (p.y < loY) loY = p.y; if (p.y > hiY) hiY = p.y;
    if (p.z < loZ) loZ = p.z; if (p.z > hiZ) hiZ = p.z;
  }
  const span = Math.max(1e-9, hiX - loX, hiY - loY, hiZ - loZ);
  const cells = (1 << MORTON_BITS) - 1;
  const quant = (v, lo2) => Math.max(0, Math.min(cells, Math.floor(((v - lo2) / span) * cells)));
  return items
    .map((it) => {
      const p = it._3d || it;
      return { it, k: morton3D(quant(p.x, loX), quant(p.y, loY), quant(p.z, loZ)) };
    })
    .sort((a, b) => a.k - b.k)
    .map((o) => o.it);
}

function packRegions(regionMeta) {
  // regionMeta: [{id, name, w, h, cx, cy}] in final px. Orders by the 3D
  // locality order already applied to the input list (consecutive = nearby in
  // light years), band-assembles into shelves.
  let maxW = 0;
  for (const r of regionMeta) maxW = Math.max(maxW, r.w);
  const totalArea = regionMeta.reduce((a, r) => a + r.w * r.h, 0);
  const targetW = Math.max(maxW, Math.ceil(Math.sqrt(totalArea) * 1.5), 1500);

  const bands = [];
  let band = [];
  let bandW = 0;
  let bandH = 0;
  for (const r of regionMeta) {
    if (band.length && bandW + r.w > targetW) {
      bands.push({ regions: band, h: bandH });
      band = [];
      bandW = 0;
      bandH = 0;
    }
    band.push(r);
    bandW += r.w + PAD;
    bandH = Math.max(bandH, r.h);
  }
  if (band.length) bands.push({ regions: band, h: bandH });

  let y = 0;
  const placed = [];
  for (const b of bands) {
    let x = 0;
    for (const r of b.regions) {
      r.x = Math.round(x);
      r.y = Math.round(y);
      placed.push(r);
      x += r.w + PAD;
    }
    y += b.h + PAD;
  }
  const mapW = Math.max(...placed.map((r) => r.x + r.w));
  const mapH = y - PAD;
  return { placed, mapW, mapH, bands: bands.length };
}

db.serialize(() => {
  db.all('SELECT solarSystemId, solarSystemName, regionId, x, y, z, x2d, y2d, security FROM SolarSystems', (err, systems) => {
    if (err) throw err;
    db.all('SELECT fromSystemId, toSystemId FROM StarGates', (err, gates) => {
      if (err) throw err;
      db.all('SELECT regionId, regionName FROM Regions', (err, regions) => {
        if (err) throw err;

        const regionName = new Map(regions.map((r) => [r.regionId, r.regionName]));
        const secClass = (sec) => (sec >= 0.45 ? 2 : sec >= 0.1 ? 1 : 0);

        const byMap = { neweden: [], wormholes: [], pochven: [] };
        const dropped = [];
        for (const s of systems) {
          if (isNewEden(s.regionId)) byMap.neweden.push(s);
          else if (isWormhole(s.regionId)) byMap.wormholes.push(s);
          else if (isPochven(s.regionId)) byMap.pochven.push(s);
          else dropped.push(s);
        }
        console.log(`classification: neweden=${byMap.neweden.length} wormholes=${byMap.wormholes.length} pochven=${byMap.pochven.length} dropped=${dropped.length}`);

        const mapsOut = {};

        // ============ NEW EDEN ============
        {
          const list = byMap.neweden;

          // pixel scale so a median k-space jump is JUMP_PX px long
          const lengths = [];
          const byId = new Map(list.map((s) => [s.solarSystemId, s]));
          for (const g of gates) {
            const a = byId.get(g.fromSystemId), b = byId.get(g.toSystemId);
            if (!a || !b || a.x2d == null || b.x2d == null) continue;
            lengths.push(Math.hypot(a.x2d - b.x2d, a.y2d - b.y2d));
          }
          lengths.sort((a, b) => a - b);
          const S = median(lengths) > 0 ? JUMP_PX / median(lengths) : 1;

          // per-region: CCP 2D bbox + true 3D centroid (ly)
          const byRegion = new Map();
          for (const s of list) {
            let arr = byRegion.get(s.regionId);
            if (!arr) { arr = []; byRegion.set(s.regionId, arr); }
            arr.push(s);
          }
          const regionMeta = [];
          for (const [rid, arr] of byRegion) {
            let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
            let cx = 0, cy = 0, cz = 0;
            for (const s of arr) {
              if (s.x2d < minU) minU = s.x2d;
              if (s.x2d > maxU) maxU = s.x2d;
              if (s.y2d < minV) minV = s.y2d;
              if (s.y2d > maxV) maxV = s.y2d;
              cx += s.x / M_PER_LY; cy += s.y / M_PER_LY; cz += s.z / M_PER_LY;
            }
            const n = arr.length;
            regionMeta.push({
              id: rid,
              name: regionName.get(rid) || String(rid),
              minU, minV, arr,
              w: Math.max((maxU - minU) * S + PAD_INNER * 2, 20),
              h: Math.max((maxV - minV) * S + PAD_INNER * 2, 20),
              _3d: { x: cx / n, y: cy / n, z: cz / n },
            });
          }

          // order regions by true-3D locality -> consecutive regions are 3D neighbours
          const ordered = hilbertOrder(regionMeta);
          const { placed, mapW, mapH, bands } = packRegions(ordered);

          const sysArr = [];
          for (const r of placed) {
            for (const s of r.arr) {
              sysArr.push({
                n: s.solarSystemName,
                r: r.id,
                u: Math.round((s.x2d - r.minU) * S + PAD_INNER),
                v: Math.round((s.y2d - r.minV) * S + PAD_INNER),
                s: secClass(s.security),
              });
            }
          }
          mapsOut.neweden = {
            scale: S, pad: PAD,
            width: mapW, height: mapH,
            regions: placed.map((r) => ({ id: r.id, name: r.name, x: r.x, y: r.y, w: Math.round(r.w), h: Math.round(r.h) })),
            systems: sysArr,
          };
          console.log(`neweden: ${sysArr.length} systems, ${placed.length} regions, ${mapW}x${mapH} px (${bands} bands), median jump ${JUMP_PX}px`);
        }

        // ============ WORMHOLES + POCHVEN ============
        for (const key of ['wormholes', 'pochven']) {
          const list = byMap[key];
          const proj = pcaProject(list);           // true-3D -> 2D (preserves distances)
          for (let i = 0; i < list.length; i++) { list[i].pu = proj[i].u; list[i].pv = proj[i].v; }

          let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
          for (const s of list) {
            if (s.pu < minU) minU = s.pu; if (s.pu > maxU) maxU = s.pu;
            if (s.pv < minV) minV = s.pv; if (s.pv > maxV) maxV = s.pv;
          }
          const S = WMAP_TARGET_PX / Math.max(maxU - minU, 1e-9);
          const mapW = Math.round((maxU - minU) * S + PAD * 2);
          const mapH = Math.round((maxV - minV) * S + PAD * 2);

          // every real (sub)region shares the single blob rectangle, so tooltips
          // still name the real region while the map is one true-3D projection.
          const byRegion = new Map();
          for (const s of list) {
            let arr = byRegion.get(s.regionId);
            if (!arr) { arr = []; byRegion.set(s.regionId, arr); }
            arr.push(s);
          }
          const regionsArr = [];
          for (const [rid, arr] of byRegion) {
            regionsArr.push({
              id: rid,
              name: regionName.get(rid) || String(rid),
              x: 0, y: 0, w: mapW, h: mapH,
              arr,
            });
          }
          const sysArr = [];
          for (const r of regionsArr) {
            for (const s of r.arr) {
              sysArr.push({
                n: s.solarSystemName,
                r: r.id,
                u: Math.round((s.pu - minU) * S + PAD),
                v: Math.round((s.pv - minV) * S + PAD),
                s: secClass(s.security),
              });
            }
          }
          mapsOut[key] = {
            scale: S, pad: PAD,
            width: mapW, height: mapH,
            regions: regionsArr.map((r) => ({ id: r.id, name: r.name, x: r.x, y: r.y, w: mapW, h: mapH })),
            systems: sysArr,
          };
          console.log(`${key}: ${sysArr.length} systems, ${regionsArr.length} regions, ${mapW}x${mapH} px`);
        }

        const out = { version: 3, maps: mapsOut };
        fs.writeFileSync(OUTPUT, JSON.stringify(out));

        // --- validation ---
        const ne = mapsOut.neweden;
        const rects = ne.regions.map((r) => [r.x, r.y, r.x + r.w, r.y + r.h]);
        let overlaps = 0;
        for (let i = 0; i < rects.length; i++) {
          for (let j = i + 1; j < rects.length; j++) {
            const a = rects[i], b = rects[j];
            if (a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]) overlaps++;
          }
        }
        console.log(`\nvalidation: neweden region overlaps = ${overlaps}`);
        console.log(`Wrote ${OUTPUT} (${(fs.statSync(OUTPUT).size / 1024).toFixed(0)} KB)`);
        db.close();
      });
    });
  });
});