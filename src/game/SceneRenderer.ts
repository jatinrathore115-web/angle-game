import { ART_SX, ART_SY, STAGE_H, STAGE_W } from './calibration';
import { mulberry32 } from './LevelBank';
import type { Quality } from './types';

/**
 * Ambient "live background" built once in the DOM and animated purely by CSS
 * keyframes (transform / opacity), so it costs almost nothing per frame:
 *  - seeded multi-depth starfield with staggered twinkle   (starTwinkle)
 *  - masked radial nebula glows on the painted nebulae      (nebulaBreathe)
 *  - glints flowing along the painted orange streak         (arcEnergyFlow)
 *  - pointer parallax on a foreground glow layer only        (slowParallax)
 */

/** Ridge of the painted orange streak, traced from space-background.png (source px). */
const STREAK_SRC: [number, number][] = [
  [85, 385], [110, 420], [150, 466], [230, 514], [310, 555], [430, 603], [550, 643], [670, 679],
  [790, 711], [910, 733], [1030, 752], [1150, 766], [1300, 779], [1450, 790], [1560, 795],
];

/** Painted nebula hot-spots (source px) with colour + size. */
const NEBULAE: { x: number; y: number; r: number; c: string; dur: number }[] = [
  { x: 330, y: 135, r: 230, c: '200,60,220', dur: 31 },
  { x: 850, y: 140, r: 200, c: '255,110,40', dur: 27 },
  { x: 1005, y: 190, r: 160, c: '255,70,200', dur: 24 },
  { x: 1240, y: 235, r: 260, c: '255,120,30', dur: 34 },
  { x: 1540, y: 270, r: 200, c: '210,70,230', dur: 29 },
  { x: 1220, y: 540, r: 220, c: '50,130,255', dur: 36 },
  { x: 1470, y: 610, r: 230, c: '40,120,255', dur: 30 },
  { x: 470, y: 370, r: 140, c: '60,120,255', dur: 26 },
];

export function streakPathD(): string {
  const p = STREAK_SRC.map(([x, y]) => [x * ART_SX, y * ART_SY]);
  // Catmull-Rom -> cubic Bezier for a smooth path through every traced point
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
  private parallax: HTMLElement;
  private px = 0;
  private py = 0;
  private tx = 0;
  private ty = 0;

  constructor(private stage: HTMLElement, quality: Quality) {
    this.buildStars(quality);
    this.buildNebula();
    this.buildStreak();
    this.parallax = stage.querySelector<HTMLElement>('#parallax-glow')!;
    this.buildParallax();
    stage.ownerDocument.addEventListener('pointermove', this.onPointer, { passive: true });
  }

  private onPointer = (e: PointerEvent): void => {
    const vw = window.innerWidth, vh = window.innerHeight;
    this.tx = ((e.clientX / vw) * 2 - 1) * 7;
    this.ty = ((e.clientY / vh) * 2 - 1) * 7;
  };

  /** Per-frame: ease the parallax layer toward the pointer (transform only). */
  update(dt: number, reduced: boolean): void {
    if (reduced) return;
    const k = Math.min(1, dt * 2.5);
    this.px += (this.tx - this.px) * k;
    this.py += (this.ty - this.py) * k;
    this.parallax.style.transform = `translate3d(${(-this.px).toFixed(2)}px, ${(-this.py).toFixed(2)}px, 0)`;
  }

  private buildStars(quality: Quality): void {
    const host = this.stage.querySelector<HTMLElement>('#stars')!;
    host.textContent = '';
    const rng = mulberry32(1337);
    const n = quality === 'high' ? 120 : quality === 'medium' ? 80 : 45;
    const tints = ['#ffffff', '#cfe0ff', '#ffd9b0', '#ffb3e6', '#9fc4ff', '#ffb070'];
    const frag = document.createDocumentFragment();
    for (let i = 0; i < n; i++) {
      const s = document.createElement('i');
      const depth = rng();
      const size = depth < 0.6 ? 1 : depth < 0.9 ? 1.6 : 2.6;
      s.className = 'star' + (rng() < 0.35 ? ' tw' : '');
      s.style.left = `${(rng() * STAGE_W).toFixed(1)}px`;
      s.style.top = `${(rng() * STAGE_H).toFixed(1)}px`;
      s.style.width = s.style.height = `${size}px`;
      s.style.background = tints[rng() < 0.75 ? 0 : 1 + Math.floor(rng() * (tints.length - 1))];
      s.style.setProperty('--o', (0.25 + depth * 0.45).toFixed(2));
      s.style.animationDuration = `${(2.5 + rng() * 4.5).toFixed(2)}s`;
      s.style.animationDelay = `${(-rng() * 7).toFixed(2)}s`;
      frag.appendChild(s);
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
      d.style.left = `${n.x * ART_SX - r}px`;
      d.style.top = `${n.y * ART_SY - r}px`;
      d.style.width = d.style.height = `${r * 2}px`;
      d.style.background = `radial-gradient(closest-side, rgba(${n.c},0.55), rgba(${n.c},0.18) 55%, rgba(${n.c},0) 100%)`;
      d.style.animationDuration = `${n.dur}s`;
      d.style.animationDelay = `${-i * 4.3}s`;
      d.style.setProperty('--dx', `${(i % 2 ? 1 : -1) * (4 + (i % 4) * 2)}px`);
      d.style.setProperty('--dy', `${(i % 3 ? -1 : 1) * (3 + (i % 3) * 2)}px`);
      host.appendChild(d);
    });
  }

  private buildStreak(): void {
    const svg = this.stage.querySelector<SVGSVGElement>('#arc-flow')!;
    const d = streakPathD();
    svg.innerHTML = `
      <defs>
        <filter id="glintBlur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.2"/></filter>
      </defs>
      <path class="glint g1" d="${d}" pathLength="1000" filter="url(#glintBlur)"/>
      <path class="glint g2" d="${d}" pathLength="1000"/>
      <path class="glint g3" d="${d}" pathLength="1000" filter="url(#glintBlur)"/>`;
  }

  private buildParallax(): void {
    this.parallax.innerHTML = '';
    const rng = mulberry32(99);
    for (let i = 0; i < 18; i++) {
      const s = document.createElement('i');
      s.className = 'pstar';
      s.style.left = `${(rng() * STAGE_W).toFixed(1)}px`;
      s.style.top = `${(rng() * STAGE_H).toFixed(1)}px`;
      s.style.animationDelay = `${(-rng() * 6).toFixed(2)}s`;
      this.parallax.appendChild(s);
    }
  }

  rebuildStars(q: Quality): void {
    this.buildStars(q);
  }

  destroy(): void {
    this.stage.ownerDocument.removeEventListener('pointermove', this.onPointer);
  }
}
