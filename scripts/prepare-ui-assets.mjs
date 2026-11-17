// Prepares the start-screen assets from the originals in assets/.
// Usage: node scripts/prepare-ui-assets.mjs
//  - thumbnail.png  -> public/assets/start-thumbnail.png (copied as-is)
//  - Neon Purple Play Button.png -> public/assets/start-button.png
//      removes the stray background-removal speckles outside the button disc
//      (keeping its soft outer glow), crops square and downsamples to 512px.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => path.join(root, 'assets', f);
const dst = (f) => path.join(root, 'public/assets', f);

fs.copyFileSync(src('thumbnail.png'), dst('start-thumbnail.png'));

const im = PNG.sync.read(fs.readFileSync(src('Neon Purple Play Button.png')));
const { width: W, height: H, data } = im;
const A = (x, y) => data[(y * W + x) * 4 + 3];

// disc centre = centroid of solid pixels; radius from solid area (speckles are tiny)
let n = 0, sx = 0, sy = 0;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (A(x, y) > 200) { n++; sx += x; sy += y; }
const cx = sx / n, cy = sy / n;
const r = Math.sqrt(n / Math.PI);
const keep = r * 1.035, fade = r * 1.085; // keep the rim glow, feather to 0, drop everything beyond

let cleared = 0;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const d = Math.hypot(x - cx, y - cy);
  if (d <= keep) continue;
  const o = (y * W + x) * 4 + 3;
  const k = d >= fade ? 0 : 1 - (d - keep) / (fade - keep);
  const na = Math.round(data[o] * k);
  if (na !== data[o]) cleared++;
  data[o] = na;
}

// crop a square around the disc and box-downsample (premultiplied) to OUT px
const half = Math.ceil(fade) + 2;
const x0 = Math.round(cx - half), y0 = Math.round(cy - half), size = half * 2;
const OUT = 512, scale = size / OUT;
const out = new PNG({ width: OUT, height: OUT });
for (let oy = 0; oy < OUT; oy++) for (let ox = 0; ox < OUT; ox++) {
  let r_ = 0, g_ = 0, b_ = 0, a_ = 0, c = 0;
  const ys = y0 + oy * scale, xs = x0 + ox * scale;
  for (let yy = Math.floor(ys); yy < Math.ceil(ys + scale); yy++) for (let xx = Math.floor(xs); xx < Math.ceil(xs + scale); xx++) {
    c++;
    if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
    const o = (yy * W + xx) * 4, a = data[o + 3] / 255;
    r_ += data[o] * a; g_ += data[o + 1] * a; b_ += data[o + 2] * a; a_ += a;
  }
  const o = (oy * OUT + ox) * 4;
  out.data[o] = a_ ? Math.round(r_ / a_) : 0;
  out.data[o + 1] = a_ ? Math.round(g_ / a_) : 0;
  out.data[o + 2] = a_ ? Math.round(b_ / a_) : 0;
  out.data[o + 3] = Math.round((a_ / c) * 255);
}
fs.writeFileSync(dst('start-button.png'), PNG.sync.write(out));
console.log(`button: centre (${cx.toFixed(1)}, ${cy.toFixed(1)}) r=${r.toFixed(1)}; cleared ${cleared} speckle px; ${OUT}px out ->`, (fs.statSync(dst('start-button.png')).size / 1024).toFixed(0) + 'KB');
