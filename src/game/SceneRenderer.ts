import { ART_SX, ART_SY, STAGE_H, STAGE_W } from './calibration';
import { mulberry32 } from './LevelBank';
import { Starfield } from './Starfield';
import type { Quality } from './types';

/** Large drifting gas clouds (stage px): purple, blue, orange, kept faint so play stays readable. */
const CURRENTS: { y: number; w: number; h: number; c: string; dur: number }[] = [
  { y: 80, w: 900, h: 420, c: '170,60,230', dur: 140 },
  { y: 520, w: 1000, h: 460, c: '40,110,255', dur: 170 },
  { y: 260, w: 760, h: 360, c: '255,110,40', dur: 200 },
];

/**
 * Live background built once in the DOM. Nearly everything is animated by CSS
 * keyframes on transform/opacity (compositor-only, ~free per frame):
 *
 *  inside #bg-drift (moves WITH the painted plate, so glows stay registered):
 *   - bgDrift          very slow zoom/pan of the whole plate ("camera breathing")
 *   - nebulaBreathe    masked radial glows on the painted purple/orange/blue nebulae
 *   - starFlare        diffraction-cross glints on the painted bright stars
 *   - arcEnergyFlow    energy glints flowing along the curve of the blue nebula band
 *  free-floating depth layers:
 *   - Starfield        3-layer drifting parallax starfield on canvas (moving stars, depth)
 *   - nebulaFlow       large soft gas clouds gliding slowly across the sky
 *   - dustDrift        faint space dust drifting slowly across the view
 *   - shootingStar     an occasional faint meteor streak (scheduled on game time, so it pauses)
 *   - pointer parallax deep layer ±4px (plate) vs near layer ±7px (foreground motes)
 */

const S = (x: number, y: number): [number, number] => [x * ART_SX, y * ART_SY];

/** Ridge of the painted blue nebula band (source px, measured from space-background.png). */
const BLUE_BAND_SRC: [number, number][] = [
  [1180, 668], [1260, 618], [1340, 584], [1420, 522], [1470, 497], [1540, 446], [1600, 390], [1660, 322],
];

/** Painted nebula hot-spots (source px) with colour, radius and breathing period. */
const NEBULAE: { x: number; y: number; r: number; c: string; dur: number }[] = [
  { x: 300, y: 120, r: 250, c: '205,60,220', dur: 31 }, // purple, top-left
  { x: 150, y: 260, r: 170, c: '120,50,210', dur: 27 },
  { x: 1450, y: 80, r: 210, c: '255,110,30', dur: 25 }, // orange, top-right
  { x: 1466, y: 497, r: 230, c: '40,120,255', dur: 34 }, // blue band core
  { x: 1300, y: 600, r: 200, c: '40,110,255', dur: 29 },
  { x: 1580, y: 380, r: 170, c: '60,140,255', dur: 37 },
  { x: 180, y: 820, r: 240, c: '110,40,190', dur: 33 }, // purple haze, bottom-left
];

/** Painted bright point stars (source px). */
const FLARES: { x: number; y: number; c: string; size: number }[] = [
  { x: 151, y: 188, c: '120,180,255', size: 64 },
  { x: 1204, y: 142, c: '130,190,255', size: 46 },
  { x: 1538, y: 348, c: '255,160,80', size: 52 },
  { x: 212, y: 546, c: '255,150,70', size: 50 },
  { x: 1508, y: 679, c: '110,170,255', size: 46 },
];

export function bandPathD(): string {
  const p = BLUE_BAND_SRC.map(([x, y]) => S(x, y));
  // Catmull-Rom -> cubic Bezier: smooth curve through every traced point
  let d = `M${p[0][0].toFixed(1)},${p[0][1].toFixed(1)}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] ?? p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

export class SceneRenderer {
  private parallaxNear: HTMLElement;
  private parallaxDeep: HTMLElement;
  private shootingLayer: HTMLElement;
  private shooters: HTMLElement[] = [];
  private shooterIdx = 0;
  private nextShooter = 4;
  private rng = mulberry32(777);
  private px = 0;
  private py = 0;
  private tx = 0;
  private ty = 0;

  private starfield: Starfield;

  constructor(private stage: HTMLElement, private quality: Quality, starCtx: CanvasRenderingContext2D) {
    this.parallaxNear = stage.querySelector<HTMLElement>('#parallax-glow')!;
    this.parallaxDeep = stage.querySelector<HTMLElement>('#bg-parallax')!;
    this.shootingLayer = stage.querySelector<HTMLElement>('#shooting')!;
    this.starfield = new Starfield(starCtx, quality);
    this.buildDust(quality);
    this.buildNebula();
    this.buildFlares();
    this.buildBandFlow();
    this.buildParallax();
    this.buildShooters();
    stage.ownerDocument.addEventListener('pointermove', this.onPointer, { passive: true });
  }

  /** Maps client coords to stage coords (set by Game; handles the rotated portrait layout). */
  toStage?: (x: number, y: number) => { x: number; y: number };

  private onPointer = (e: PointerEvent): void => {
    if (e.pointerType !== 'mouse') return; // parallax follows a mouse, not taps
    const p = this.toStage ? this.toStage(e.clientX, e.clientY) : { x: (e.clientX / window.innerWidth) * STAGE_W, y: (e.clientY / window.innerHeight) * STAGE_H };
    this.tx = Math.max(-1, Math.min(1, (p.x / STAGE_W) * 2 - 1));
    this.ty = Math.max(-1, Math.min(1, (p.y / STAGE_H) * 2 - 1));
  };

  /** Per frame (game time — stops while paused): ease parallax, schedule shooting stars. */
  update(dt: number, reduced: boolean): void {
    if (!reduced) {
      const k = Math.min(1, dt * 2.5);
      this.px += (this.tx - this.px) * k;
      this.py += (this.ty - this.py) * k;
      // depth: near motes move most, the painted plate least
      this.parallaxNear.style.transform = `translate3d(${(-this.px * 7).toFixed(2)}px, ${(-this.py * 7).toFixed(2)}px, 0)`;
      this.parallaxDeep.style.transform = `translate3d(${(-this.px * 4).toFixed(2)}px, ${(-this.py * 4).toFixed(2)}px, 0)`;
    }
    this.starfield.update(dt, this.px, this.py, reduced);
    if (reduced || this.quality === 'low') return;
    this.nextShooter -= dt;
    if (this.nextShooter <= 0) {
      this.launchShooter();
      this.nextShooter = 5 + this.rng() * 6;
    }
  }

  /** Every animation frame (also while paused, so the field stays drawn). */
  render(reduced: boolean): void {
    this.starfield.render(reduced);
  }

  // ------------------------------------------------------------ builders

  private buildDust(quality: Quality): void {
    const host = this.stage.querySelector<HTMLElement>('#dust')!;
    host.textContent = '';
    const rng = mulberry32(4242);
    const n = quality === 'high' ? 34 : quality === 'medium' ? 20 : 0;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < n; i++) {
      const d = document.createElement('i');
      d.className = 'mote';
      const size = 1.5 + rng() * 2.5;
      d.style.left = `${(rng() * STAGE_W).toFixed(1)}px`;
      d.style.top = `${(rng() * STAGE_H).toFixed(1)}px`;
      d.style.width = d.style.height = `${size.toFixed(1)}px`;
      // drift mostly sideways with a gentle rise, like dust in a slow solar wind
      d.style.setProperty('--dx', `${(-60 - rng() * 140).toFixed(0)}px`);
      d.style.setProperty('--dy', `${(-20 - rng() * 60).toFixed(0)}px`);
      d.style.setProperty('--o', (0.15 + rng() * 0.3).toFixed(2));
      d.style.animationDuration = `${(18 + rng() * 22).toFixed(1)}s`;
      d.style.animationDelay = `${(-rng() * 40).toFixed(1)}s`;
      if (rng() < 0.3) d.classList.add('warm');
      frag.appendChild(d);
    }
    host.appendChild(frag);
  }

  private buildNebula(): void {
    const host = this.stage.querySelector<HTMLElement>('#nebula')!;
    host.textContent = '';
    NEBULAE.forEach((n, i) => {
      const d = document.createElement('i');
      d.className = 'neb';
      const r = n.r * ART_SX;
      const [x, y] = S(n.x, n.y);
      d.style.left = `${x - r}px`;
      d.style.top = `${y - r}px`;
      d.style.width = d.style.height = `${r * 2}px`;
      d.style.background = `radial-gradient(closest-side, rgba(${n.c},0.6), rgba(${n.c},0.2) 55%, rgba(${n.c},0) 100%)`;
      d.style.animationDuration = `${n.dur}s`;
      d.style.animationDelay = `${-i * 4.3}s`;
      d.style.setProperty('--dx', `${(i % 2 ? 1 : -1) * (10 + (i % 4) * 4)}px`);
      d.style.setProperty('--dy', `${(i % 3 ? -1 : 1) * (8 + (i % 3) * 4)}px`);
      host.appendChild(d);
    });
    // "nebula currents": large soft clouds of gas gliding slowly across the sky
    CURRENTS.forEach((c, i) => {
      const d = document.createElement('i');
      d.className = 'neb-current';
      d.style.top = `${c.y}px`;
      d.style.width = `${c.w}px`;
      d.style.height = `${c.h}px`;
      d.style.background = `radial-gradient(closest-side, rgba(${c.c},0.5), rgba(${c.c},0.16) 55%, rgba(${c.c},0) 100%)`;
      d.style.animationDuration = `${c.dur}s`;
      d.style.animationDelay = `${-c.dur * (0.2 + i * 0.3)}s`;
      host.appendChild(d);
    });
  }

  private buildFlares(): void {
    const host = this.stage.querySelector<HTMLElement>('#bg-flares')!;
    host.textContent = '';
    FLARES.forEach((f, i) => {
      const el = document.createElement('i');
      el.className = 'flare';
      const [x, y] = S(f.x, f.y);
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.setProperty('--s', `${f.size}px`);
      el.style.setProperty('--c', f.c);
      el.style.animationDuration = `${(4.5 + i * 1.3).toFixed(1)}s`;
      el.style.animationDelay = `${(-i * 1.7).toFixed(1)}s`;
      host.appendChild(el);
    });
  }

  private buildBandFlow(): void {
    const svg = this.stage.querySelector<SVGSVGElement>('#arc-flow')!;
    const d = bandPathD();
    svg.innerHTML = `
      <defs>
        <filter id="glintBlur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3"/></filter>
      </defs>
      <path class="glint g1" d="${d}" pathLength="1000" filter="url(#glintBlur)"/>
      <path class="glint g2" d="${d}" pathLength="1000"/>
      <path class="glint g3" d="${d}" pathLength="1000" filter="url(#glintBlur)"/>`;
  }

  private buildParallax(): void {
    this.parallaxNear.innerHTML = '';
    const rng = mulberry32(99);
    for (let i = 0; i < 18; i++) {
      const s = document.createElement('i');
      s.className = 'pstar';
      s.style.left = `${(rng() * STAGE_W).toFixed(1)}px`;
      s.style.top = `${(rng() * STAGE_H).toFixed(1)}px`;
      s.style.animationDelay = `${(-rng() * 6).toFixed(2)}s`;
      this.parallaxNear.appendChild(s);
    }
  }

  private buildShooters(): void {
    this.shootingLayer.textContent = '';
    for (let i = 0; i < 2; i++) {
      const el = document.createElement('i');
      el.className = 'shooter';
      el.addEventListener('animationend', () => el.classList.remove('go'));
      this.shootingLayer.appendChild(el);
      this.shooters.push(el);
    }
  }

  /** A faint streak across the upper sky, kept away from the turret and the answer row. */
  private launchShooter(): void {
    const el = this.shooters[this.shooterIdx++ % this.shooters.length];
    const r = this.rng;
    const fromLeft = r() < 0.5;
    const x = fromLeft ? 180 + r() * 700 : 1040 + r() * 700;
    const y = 110 + r() * 230;
    const ang = (fromLeft ? 18 + r() * 22 : 180 - 18 - r() * 22);
    const len = 260 + r() * 260;
    el.classList.remove('go');
    el.style.left = `${x.toFixed(0)}px`;
    el.style.top = `${y.toFixed(0)}px`;
    el.style.setProperty('--a', `${ang.toFixed(1)}deg`);
    el.style.setProperty('--len', `${len.toFixed(0)}px`);
    el.style.animationDuration = `${(0.9 + r() * 0.6).toFixed(2)}s`;
    void el.offsetWidth;
    el.classList.add('go');
  }

  rebuildStars(q: Quality): void {
    this.quality = q;
    this.starfield.build(q);
    this.buildDust(q);
  }

  destroy(): void {
    this.stage.ownerDocument.removeEventListener('pointermove', this.onPointer);
  }
}
