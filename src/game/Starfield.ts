import { STAGE_H, STAGE_W } from './calibration';
import { mulberry32 } from './LevelBank';
import type { Quality } from './types';

/**
 * Layered parallax starfield, drawn first into the (already per-frame) world canvas
 * so it adds no extra full-screen layer for the browser to composite.
 *
 * Three depth layers drift continuously across the sky at different speeds
 * (far = slow, small, dim; near = faster, larger, glowing), which reads as the
 * station gliding through space. Each layer also shifts by a different amount
 * with the pointer, adding depth on top of the drift.
 *
 * Performance (measured on an Intel UHD iGPU, typical school hardware):
 *  - far + mid layers (~200 stars) are painted ONCE into seamless wrap-around
 *    tiles; each frame a tile is just slid along its drift path (4 draws/layer);
 *  - only the ~24 near stars are drawn individually, so they keep their twinkle;
 *  - glow sprites are pre-sized (no per-draw rescaling) and smoothing is "low".
 */

interface Star {
  x: number;
  y: number;
  size: number;
  base: number; // base opacity
  tw: number; // twinkle phase
  tws: number; // twinkle speed (0 = steady)
  halo: number; // glow radius in stage px (integer)
  img: HTMLCanvasElement; // glow sprite pre-sized to 2*halo
}

interface Layer {
  speed: number; // px/s along the drift direction
  parallax: number; // px of pointer parallax at full deflection
  glow: number; // halo opacity factor
  stars: Star[];
  /** tiled layers: accumulated drift offset + cached tile */
  tiled: boolean;
  ox: number;
  oy: number;
  tile?: HTMLCanvasElement;
}

/** Drift direction: leftward and slightly down, a calm "cruising" feel. */
const DIR_X = -0.97, DIR_Y = 0.24;
const MARGIN = 24;
const MAX_TILE_SCALE = 1.5; // cap tile resolution (memory) — far stars are soft anyway

/** colour tints for the glow sprites: white, ice blue, warm, pink */
const TINTS = ['255,255,255', '170,205,255', '255,214,170', '255,170,230'];

export class Starfield {
  private layers: Layer[] = [];
  private sprites = new Map<string, HTMLCanvasElement>();
  private tileScale = 0;
  private t = 0;
  private px = 0;
  private py = 0;

  constructor(private ctx: CanvasRenderingContext2D, quality: Quality) {
    this.build(quality);
  }

  build(quality: Quality): void {
    const k = quality === 'high' ? 1 : quality === 'medium' ? 0.65 : 0.4;
    const rng = mulberry32(2718);
    const spec = [
      { n: 150, speed: 5, parallax: 2, size: [0.6, 1.1], base: [0.25, 0.5], twinkle: 0, haloK: 4.5, glow: 0.35, tiled: true },
      { n: 75, speed: 13, parallax: 5, size: [1.0, 1.7], base: [0.4, 0.7], twinkle: 0, haloK: 4.5, glow: 0.35, tiled: true },
      { n: 26, speed: 30, parallax: 11, size: [1.6, 2.6], base: [0.6, 0.95], twinkle: 0.55, haloK: 7, glow: 0.55, tiled: false },
    ];
    this.layers = spec.map((s) => ({
      speed: s.speed,
      parallax: s.parallax,
      glow: s.glow,
      tiled: s.tiled,
      ox: 0,
      oy: 0,
      stars: Array.from({ length: Math.round(s.n * k) }, () => {
        const size = s.size[0] + rng() * (s.size[1] - s.size[0]);
        const halo = Math.max(2, Math.round(size * s.haloK));
        const tint = TINTS[rng() < 0.7 ? 0 : 1 + Math.floor(rng() * 3)];
        return {
          x: rng() * STAGE_W,
          y: rng() * STAGE_H,
          size,
          base: s.base[0] + rng() * (s.base[1] - s.base[0]),
          tw: rng() * Math.PI * 2,
          tws: rng() < s.twinkle ? 0.8 + rng() * 2.2 : 0,
          halo,
          img: this.sprite(tint, halo),
        };
      }),
    }));
    this.tileScale = 0; // force tile rebuild
  }

  /** dt in game time (0 while paused); pointer in -1..1 (already eased by the caller). */
  update(dt: number, pointerX: number, pointerY: number, reduced: boolean): void {
    this.px = pointerX;
    this.py = pointerY;
    if (reduced) return;
    this.t += dt;
    for (const L of this.layers) {
      const dx = DIR_X * L.speed * dt, dy = DIR_Y * L.speed * dt;
      if (L.tiled) {
        L.ox = mod(L.ox + dx, STAGE_W);
        L.oy = mod(L.oy + dy, STAGE_H);
        continue;
      }
      for (const s of L.stars) {
        s.x = mod(s.x + dx + MARGIN, STAGE_W + MARGIN * 2) - MARGIN;
        s.y = mod(s.y + dy + MARGIN, STAGE_H + MARGIN * 2) - MARGIN;
      }
    }
  }

  /** Draws into a canvas the caller has already cleared for this frame. */
  render(reduced: boolean): void {
    const c = this.ctx;
    const scale = Math.min(MAX_TILE_SCALE, c.getTransform().a);
    if (Math.abs(scale - this.tileScale) > 0.05) this.buildTiles(scale);
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.imageSmoothingQuality = 'low';
    for (const L of this.layers) {
      const ox = -this.px * L.parallax, oy = -this.py * L.parallax;
      if (L.tiled && L.tile) {
        // slide the pre-painted tile; 4 placements cover the wrap seam
        const x0 = mod(L.ox + ox, STAGE_W), y0 = mod(L.oy + oy, STAGE_H);
        c.globalAlpha = 1;
        for (const tx of [x0 - STAGE_W, x0]) for (const ty of [y0 - STAGE_H, y0]) {
          c.drawImage(L.tile, tx, ty, STAGE_W, STAGE_H);
        }
        continue;
      }
      c.fillStyle = '#ffffff';
      for (const s of L.stars) {
        const tw = s.tws && !reduced ? 0.55 + 0.45 * Math.sin(this.t * s.tws + s.tw) : 1;
        const a = s.base * tw;
        const x = s.x + ox, y = s.y + oy;
        c.globalAlpha = a * L.glow; // soft glow halo
        c.drawImage(s.img, x - s.halo, y - s.halo);
        c.globalAlpha = Math.min(1, a * 1.1); // crisp core
        c.fillRect(x - s.size / 2, y - s.size / 2, s.size, s.size);
      }
    }
    c.restore();
  }

  /** Paint far/mid layers once into seamless (wrap-around) tiles at the canvas resolution. */
  private buildTiles(scale: number): void {
    this.tileScale = scale;
    for (const L of this.layers) {
      if (!L.tiled) continue;
      const cv = L.tile ?? document.createElement('canvas');
      cv.width = Math.round(STAGE_W * scale);
      cv.height = Math.round(STAGE_H * scale);
      const g = cv.getContext('2d')!;
      g.setTransform(scale, 0, 0, scale, 0, 0);
      g.clearRect(0, 0, STAGE_W, STAGE_H);
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = '#ffffff';
      for (const s of L.stars) {
        // draw copies across the edges so the tile wraps without a seam
        for (const wx of [-STAGE_W, 0, STAGE_W]) for (const wy of [-STAGE_H, 0, STAGE_H]) {
          const x = s.x + wx, y = s.y + wy;
          if (x < -s.halo || x > STAGE_W + s.halo || y < -s.halo || y > STAGE_H + s.halo) continue;
          g.globalAlpha = s.base * L.glow;
          g.drawImage(s.img, x - s.halo, y - s.halo);
          g.globalAlpha = Math.min(1, s.base * 1.1);
          g.fillRect(x - s.size / 2, y - s.size / 2, s.size, s.size);
        }
      }
      L.tile = cv;
    }
  }

  private sprite(rgb: string, halo: number): HTMLCanvasElement {
    const key = `${rgb}|${halo}`;
    let cv = this.sprites.get(key);
    if (cv) return cv;
    cv = document.createElement('canvas');
    cv.width = cv.height = halo * 2;
    const g = cv.getContext('2d')!;
    const grd = g.createRadialGradient(halo, halo, 0, halo, halo, halo);
    grd.addColorStop(0, `rgba(${rgb},1)`);
    grd.addColorStop(0.25, `rgba(${rgb},0.45)`);
    grd.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = grd;
    g.fillRect(0, 0, halo * 2, halo * 2);
    this.sprites.set(key, cv);
    return cv;
  }
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}
