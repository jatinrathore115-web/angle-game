// Asset diagnostics + calibration export.
// Usage: node scripts/analyze-assets.mjs [diagnosticOutDir]
// Writes src/game/assetCalibration.json (consumed by the game) and, if an out dir
// is given, a meteor contact sheet PNG with detected head markers for visual QA.
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const A = (f) => path.join(root, 'public/assets', f);
const load = (f) => PNG.sync.read(fs.readFileSync(A(f)));
const outDir = process.argv[2];

const COLS = 6, ROWS = 5;
export function cellRect(i, w, h) {
  const c = i % COLS, r = Math.floor(i / COLS);
  const x0 = Math.round((c * w) / COLS), x1 = Math.round(((c + 1) * w) / COLS);
  const y0 = Math.round((r * h) / ROWS), y1 = Math.round(((r + 1) * h) / ROWS);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function px(img, x, y) {
  const o = (y * img.width + x) * 4;
  return [img.data[o], img.data[o + 1], img.data[o + 2], img.data[o + 3]];
}

// ---------- meteor sheet ----------
const sheet = load('meteor-30frame.png');
const frames = [];
for (let i = 0; i < 30; i++) {
  const R = cellRect(i, sheet.width, sheet.height);
  let minx = 1e9, miny = 1e9, maxx = -1, maxy = -1, mass = 0, sx = 0, sy = 0;
  // rock pixels: opaque, dark-ish, warm (not purple tail, not bright flame)
  const rock = [];
  for (let y = R.y; y < R.y + R.h; y++) for (let x = R.x; x < R.x + R.w; x++) {
    const [r, g, b, a] = px(sheet, x, y);
    if (a > 40) {
      minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y);
      mass += a; sx += x * a; sy += y * a;
    }
    const lum = 0.3 * r + 0.59 * g + 0.11 * b;
    if (a > 235 && lum < 95 && r > b * 1.4 && r > 40) rock.push([x, y]);
  }
  // Rock cluster: the rock is the dark blob at the LEADING edge of the comet.
  // Project opaque pixels on the art's travel direction (~32deg, down-right), find
  // the leading extreme, and keep only rock pixels within 80px of it.
  const DIR = (32 * Math.PI) / 180, dcx = Math.cos(DIR), dcy = Math.sin(DIR);
  let pmax = -1e9;
  for (let y = R.y; y < R.y + R.h; y++) for (let x = R.x; x < R.x + R.w; x++) {
    if (px(sheet, x, y)[3] > 200) pmax = Math.max(pmax, x * dcx + y * dcy);
  }
  const cand = rock.filter(([x, y]) => x * dcx + y * dcy > pmax - 80);
  let n = 0, ax = 0, ay = 0;
  for (const [x, y] of cand) { n++; ax += x; ay += y; }
  let hx = ax / n, hy = ay / n;
  // second pass: tighten around the first estimate
  n = 0; ax = 0; ay = 0;
  for (const [x, y] of cand) if (Math.hypot(x - hx, y - hy) < 34) { n++; ax += x; ay += y; }
  hx = ax / n; hy = ay / n;
  // visual rock radius ~ distance from centre to the leading opaque edge, minus flame rim
  const radius = Math.max(14, (pmax - (hx * dcx + hy * dcy)) - 6);
  const cx = sx / mass, cy = sy / mass;
  frames.push({
    i, rect: R,
    alphaBounds: { x: minx - R.x, y: miny - R.y, w: maxx - minx + 1, h: maxy - miny + 1 },
    head: { x: +(hx - R.x).toFixed(1), y: +(hy - R.y).toFixed(1) },
    headRadius: +radius.toFixed(1),
    // direction of travel in sheet art = from alpha centroid toward head
    artAngleDeg: +((Math.atan2(hy - cy, hx - cx) * 180) / Math.PI).toFixed(1),
    rockPixels: n,
  });
}

// Principal axis of the comet (alpha-weighted, long-tail frames 12-29) = art travel direction.
let Sxx = 0, Syy = 0, Sxy = 0, Sw = 0;
for (const f of frames.slice(12)) {
  const R = f.rect; let m = 0, mx = 0, my = 0;
  for (let y = R.y; y < R.y + R.h; y++) for (let x = R.x; x < R.x + R.w; x++) { const a = px(sheet, x, y)[3]; if (a > 60) { m += a; mx += x * a; my += y * a; } }
  mx /= m; my /= m;
  for (let y = R.y; y < R.y + R.h; y++) for (let x = R.x; x < R.x + R.w; x++) { const a = px(sheet, x, y)[3]; if (a > 60) { const dx = x - mx, dy = y - my; Sxx += dx * dx * a; Syy += dy * dy * a; Sxy += dx * dy * a; Sw += a; } }
}
const artAngleDeg = +((0.5 * Math.atan2(2 * Sxy, Sxx - Syy) * 180) / Math.PI).toFixed(2);
console.log('art travel angle (deg, screen, y-down):', artAngleDeg);

// ---------- barrel ----------
const barrel = load('turret-barrel.png');
function alphaBounds(img, thr = 40) {
  let minx = 1e9, miny = 1e9, maxx = -1, maxy = -1;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    if (img.data[(y * img.width + x) * 4 + 3] > thr) {
      if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
    }
  }
  return { x: minx, y: miny, w: maxx - minx + 1, h: maxy - miny + 1 };
}
const bb = alphaBounds(barrel);
// vertical axis of the tube near muzzle: opaque span at x = maxx - 60
function vSpan(img, x) {
  let a = -1, b = -1;
  for (let y = 0; y < img.height; y++) if (img.data[(y * img.width + x) * 4 + 3] > 128) { if (a < 0) a = y; b = y; }
  return [a, b];
}
const muzzleX = bb.x + bb.w - 1;
const [ma, mb] = vSpan(barrel, muzzleX - 40);
const [ra, rb] = vSpan(barrel, bb.x + Math.round(bb.w * 0.16));

// ---------- base ----------
const base = load('turret-base.png');
const baseBB = alphaBounds(base);
// red core centroid
let rx = 0, ry = 0, rn = 0;
for (let y = 300; y < 950; y++) for (let x = 300; x < 950; x++) {
  const [r, g, b, a] = px(base, x, y);
  if (a > 200 && r > 200 && g < 60 && b < 60) { rx += x; ry += y; rn++; }
}

// ---------- frame: inner edge of opaque border along the midlines ----------
const frame = load('space-frame.png');
function scan(img, x0, y0, dx, dy) {
  let x = x0, y = y0, entered = false;
  while (x >= 0 && y >= 0 && x < img.width && y < img.height) {
    const a = img.data[(y * img.width + x) * 4 + 3];
    if (a > 200) entered = true; else if (entered) return { x, y };
    x += dx; y += dy;
  }
  return null;
}
const fw = frame.width, fh = frame.height;
const inner = {
  left: scan(frame, 0, Math.round(fh * 0.5), 1, 0)?.x,
  right: scan(frame, fw - 1, Math.round(fh * 0.5), -1, 0)?.x,
  top: scan(frame, Math.round(fw * 0.3), 0, 0, 1)?.y,
  bottom: scan(frame, Math.round(fw * 0.3), fh - 1, 0, -1)?.y,
};
// check the background is truly opaque and whether frame interior is transparent
const centerAlpha = px(frame, fw >> 1, fh >> 1)[3];

const calib = {
  meteor: { sheetW: sheet.width, sheetH: sheet.height, cols: COLS, rows: ROWS, artAngleDeg, frames },
  barrel: {
    w: barrel.width, h: barrel.height, alphaBounds: bb,
    muzzle: { x: muzzleX, y: (ma + mb) / 2 }, muzzleBoreHalfHeight: (mb - ma) / 2,
    rearAxisY: (ra + rb) / 2,
  },
  base: { w: base.width, h: base.height, alphaBounds: baseBB, core: { x: +(rx / rn).toFixed(1), y: +(ry / rn).toFixed(1) } },
  frame: { w: fw, h: fh, inner, centerAlpha },
};
fs.writeFileSync(path.join(root, 'src/game/assetCalibration.json'), JSON.stringify(calib, null, 1));
console.log(JSON.stringify({ barrel: calib.barrel, base: calib.base, frame: calib.frame }, null, 1));
console.table(frames.map((f) => ({ i: f.i, rw: f.rect.w, rh: f.rect.h, hx: f.head.x, hy: f.head.y, hr: f.headRadius, ang: f.artAngleDeg, ab: `${f.alphaBounds.x},${f.alphaBounds.y},${f.alphaBounds.w}x${f.alphaBounds.h}` })));

// ---------- diagnostic contact sheet ----------
if (outDir) {
  const cw = 300, ch = 180;
  const out = new PNG({ width: cw * COLS, height: ch * ROWS });
  for (let i = 0; i < out.data.length; i += 4) { out.data[i] = 20; out.data[i + 1] = 24; out.data[i + 2] = 60; out.data[i + 3] = 255; }
  for (const f of frames) {
    const ox = (f.i % COLS) * cw, oy = Math.floor(f.i / COLS) * ch;
    for (let y = 0; y < f.rect.h; y++) for (let x = 0; x < f.rect.w; x++) {
      const [r, g, b, a] = px(sheet, f.rect.x + x, f.rect.y + y);
      const o = ((oy + y) * out.width + ox + x) * 4;
      const t = a / 255;
      out.data[o] = r * t + out.data[o] * (1 - t); out.data[o + 1] = g * t + out.data[o + 1] * (1 - t); out.data[o + 2] = b * t + out.data[o + 2] * (1 - t);
    }
    // cell border (cyan) and head marker (green cross + circle)
    for (let x = 0; x < f.rect.w; x++) for (const y of [0, f.rect.h - 1]) { const o = ((oy + y) * out.width + ox + x) * 4; out.data[o] = 0; out.data[o + 1] = 255; out.data[o + 2] = 255; }
    for (let y = 0; y < f.rect.h; y++) for (const x of [0, f.rect.w - 1]) { const o = ((oy + y) * out.width + ox + x) * 4; out.data[o] = 0; out.data[o + 1] = 255; out.data[o + 2] = 255; }
    for (let t = 0; t < 360; t += 2) {
      const x = Math.round(f.head.x + Math.cos((t * Math.PI) / 180) * f.headRadius), y = Math.round(f.head.y + Math.sin((t * Math.PI) / 180) * f.headRadius);
      if (x >= 0 && y >= 0 && x < cw && y < ch) { const o = ((oy + y) * out.width + ox + x) * 4; out.data[o] = 0; out.data[o + 1] = 255; out.data[o + 2] = 0; }
    }
    for (let d = -5; d <= 5; d++) {
      for (const [x, y] of [[Math.round(f.head.x) + d, Math.round(f.head.y)], [Math.round(f.head.x), Math.round(f.head.y) + d]]) {
        const o = ((oy + y) * out.width + ox + x) * 4; out.data[o] = 0; out.data[o + 1] = 255; out.data[o + 2] = 0;
      }
    }
  }
  fs.writeFileSync(path.join(outDir, 'meteor-diagnostic.png'), PNG.sync.write(out));
  console.log('wrote', path.join(outDir, 'meteor-diagnostic.png'));
}
