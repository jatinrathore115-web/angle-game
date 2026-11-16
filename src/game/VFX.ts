import { DEG } from './AngleMath';
import { mulberry32 } from './LevelBank';
import type { Quality } from './types';

/**
 * VFX controller.
 * - Canvas (pooled, capped) for high-count dynamics: sparks, rock fragments, shards,
 *   embers, smoke puffs, fireball, shock rings, muzzle flash.
 * - A small pool of DOM elements driven by named CSS keyframes (fx.css) for soft
 *   composited layers: muzzleFlash, impactRing, plasmaExpand, smokeBillow, debrisFly, shimmerFade.
 * Everything is positioned in stage (world) units at the actual collision point.
 */

type PKind = 'spark' | 'frag' | 'shard' | 'ember';
interface Particle {
  active: boolean;
  kind: PKind;
  x: number; y: number; vx: number; vy: number;
  life: number; max: number;
  size: number; len: number; drag: number; grav: number;
  rot: number; vr: number;
  hue: number;
}
interface Smoke {
  active: boolean;
  x: number; y: number; vx: number; vy: number;
  r0: number; r1: number; life: number; max: number; delay: number;
  rot: number; vr: number; variant: number; alpha: number; warm: number;
}
interface Ring { x: number; y: number; r0: number; r1: number; life: number; max: number; width: number; color: string; delay: number; alpha: number }
interface Ball { x: number; y: number; r0: number; r1: number; life: number; max: number; delay: number; seed: number }
interface Flash { x: number; y: number; r: number; life: number; max: number; bearing: number; cone: boolean; delay: number }

const MAX_PARTICLES = 110;
const MAX_SMOKE = 24;

export class VFX {
  private particles: Particle[] = [];
  private smoke: Smoke[] = [];
  private rings: Ring[] = [];
  private balls: Ball[] = [];
  private flashes: Flash[] = [];
  private puffSprites: HTMLCanvasElement[] = [];
  private warmPuff!: HTMLCanvasElement;
  private rng = mulberry32(7);
  private shakeT = 0;
  private shakeDur = 0;
  private shakeAmp = 0;
  shakeX = 0;
  shakeY = 0;
  reducedMotion = false;
  quality: Quality = 'high';
  private dom: HTMLElement;
  private domPool: Record<string, HTMLElement[]> = {};
  private domIdx: Record<string, number> = {};
  /** cumulative count of explosions — used by tests / QA */
  explosions = 0;

  constructor(domLayer: HTMLElement) {
    this.dom = domLayer;
    for (let i = 0; i < MAX_PARTICLES; i++) this.particles.push({ active: false } as Particle);
    for (let i = 0; i < MAX_SMOKE; i++) this.smoke.push({ active: false } as Smoke);
    this.buildSprites();
    this.buildDomPool('ring', 3);
    this.buildDomPool('plasma', 2);
    this.buildDomPool('smokeDom', 6);
    this.buildDomPool('debris', 10);
    this.buildDomPool('muzzle', 2);
  }

  private get qMul(): number {
    return this.quality === 'high' ? 1 : this.quality === 'medium' ? 0.7 : 0.45;
  }

  get activeParticles(): number {
    return this.particles.filter((p) => p.active).length;
  }

  // ---------------------------------------------------------------- sprites
  private buildSprites(): void {
    const r = mulberry32(42);
    for (let v = 0; v < 3; v++) {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const g = c.getContext('2d')!;
      // billowy puff = cluster of soft lobes
      for (let i = 0; i < 9; i++) {
        const a = r() * Math.PI * 2, d = r() * 26;
        const x = 64 + Math.cos(a) * d, y = 64 + Math.sin(a) * d;
        const rad = 22 + r() * 22;
        const grd = g.createRadialGradient(x, y, 0, x, y, rad);
        const tone = 46 + Math.floor(r() * 24);
        grd.addColorStop(0, `rgba(${tone},${tone - 4},${tone + 22},0.85)`);
        grd.addColorStop(0.6, `rgba(${tone - 10},${tone - 14},${tone + 12},0.42)`);
        grd.addColorStop(1, 'rgba(20,16,40,0)');
        g.fillStyle = grd;
        g.beginPath();
        g.arc(x, y, rad, 0, Math.PI * 2);
        g.fill();
      }
      this.puffSprites.push(c);
    }
    const w = document.createElement('canvas');
    w.width = w.height = 128;
    const g = w.getContext('2d')!;
    const grd = g.createRadialGradient(64, 64, 10, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,170,60,0.0)');
    grd.addColorStop(0.55, 'rgba(255,120,30,0.55)');
    grd.addColorStop(1, 'rgba(255,60,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    this.warmPuff = w;
  }

  private buildDomPool(kind: string, n: number): void {
    this.domPool[kind] = [];
    this.domIdx[kind] = 0;
    for (let i = 0; i < n; i++) {
      const el = document.createElement('div');
      el.className = `fx-${kind}`;
      this.dom.appendChild(el);
      this.domPool[kind].push(el);
    }
  }

  /** Restart a pooled CSS-animated element at stage position. */
  private playDom(kind: string, x: number, y: number, vars: Record<string, string> = {}): void {
    const pool = this.domPool[kind];
    const el = pool[this.domIdx[kind]++ % pool.length];
    el.classList.remove('play');
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
    void el.offsetWidth; // restart keyframes
    el.classList.add('play');
  }

  // ---------------------------------------------------------------- spawners
  private spawnParticle(p: Partial<Particle>): void {
    const slot = this.particles.find((q) => !q.active);
    if (!slot) return; // hard cap
    Object.assign(slot, { active: true, life: 0, rot: 0, vr: 0, drag: 2, grav: 0, len: 0, hue: 30 }, p);
  }

  private spawnSmoke(s: Partial<Smoke>): void {
    const slot = this.smoke.find((q) => !q.active);
    if (!slot) return;
    Object.assign(slot, { active: true, life: 0 }, s);
  }

  shake(amp: number, dur: number): void {
    if (this.reducedMotion) return;
    this.shakeAmp = Math.max(this.shakeAmp * (1 - this.shakeT / Math.max(this.shakeDur, 0.001)), amp);
    this.shakeDur = dur;
    this.shakeT = 0;
  }

  /** Muzzle flash at the real rotated barrel tip. */
  muzzleFlash(x: number, y: number, bearing: number): void {
    this.flashes.push({ x, y, r: 46, life: 0, max: 0.12, bearing, cone: true, delay: 0 });
    this.rings.push({ x, y, r0: 6, r1: 48, life: 0, max: 0.28, width: 2, color: '255,190,110', delay: 0, alpha: 0.5 });
    this.playDom('muzzle', x, y, { '--rot': `${bearing}deg` });
    const n = 2 + Math.floor(this.rng() * 3);
    for (let i = 0; i < n; i++) {
      const a = (bearing + (this.rng() - 0.5) * 40) * DEG;
      const sp = 380 + this.rng() * 380;
      this.spawnParticle({ kind: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, max: 0.16 + this.rng() * 0.14, size: 1.6, len: 0.03, drag: 6 });
    }
  }

  /** Tiny charge glow at the muzzle while the capacitor fills. */
  charge(x: number, y: number): void {
    this.flashes.push({ x, y, r: 18, life: 0, max: 0.2, bearing: 0, cone: false, delay: 0 });
  }

  /** Wrong shot dissipates: small amber fizzle, no blast. */
  fizzle(x: number, y: number): void {
    this.flashes.push({ x, y, r: 22, life: 0, max: 0.18, bearing: 0, cone: false, delay: 0 });
    for (let i = 0; i < 7; i++) {
      const a = this.rng() * Math.PI * 2, sp = 60 + this.rng() * 120;
      this.spawnParticle({ kind: 'ember', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, max: 0.4 + this.rng() * 0.3, size: 1.6, drag: 3, hue: 38 });
    }
    this.spawnSmoke({ x, y, vx: 0, vy: -10, r0: 6, r1: 20, max: 0.7, delay: 0, rot: 0, vr: 0.4, variant: 0, alpha: 0.35, warm: 0.6 });
  }

  /** Meteor reached the shield: restrained orange shockwave around the core. */
  shieldHit(x: number, y: number): void {
    this.rings.push({ x, y, r0: 90, r1: 190, life: 0, max: 0.55, width: 6, color: '255,140,40', delay: 0, alpha: 0.75 });
    this.rings.push({ x, y, r0: 100, r1: 150, life: 0, max: 0.45, width: 2, color: '255,220,160', delay: 0.06, alpha: 0.6 });
    this.spawnExplosion(x, y, 0.55);
    this.shake(4, 0.22);
  }

  /** Sparse embers trailing a meteor. */
  ember(x: number, y: number): void {
    if (this.activeParticles > MAX_PARTICLES * 0.6) return;
    const a = this.rng() * Math.PI * 2, sp = 10 + this.rng() * 30;
    this.spawnParticle({ kind: 'ember', x: x + Math.cos(a) * 14, y: y + Math.sin(a) * 14, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, max: 0.6 + this.rng() * 0.6, size: 1.2 + this.rng(), drag: 1, hue: 25 + this.rng() * 20 });
  }

  /**
   * Cinematic 4-phase explosion at (x, y). intensity 0..1+.
   *  Phase 1 (0-100ms)    contact: white-hot spark, streaklets, localized bloom.
   *  Phase 2 (70-320ms)   plasma fireball 15->85px + shock ring 0->130px + lagging ring, 2-4px shake.
   *  Phase 3 (180-850ms)  35-65 sparks (varied speed/length/drag), 8-12 spinning rock flecks, bright shards.
   *  Phase 4 (150-1900ms) 12-24 layered smoke puffs, warm-lit edges, drifting/expanding/dissolving.
   */
  spawnExplosion(x: number, y: number, intensity = 1): void {
    this.explosions++;
    const k = Math.max(0.3, intensity) * this.qMul;
    const r = this.rng;
    if (this.reducedMotion) {
      // simple clean impact ring + soft glow, no debris storm or shake
      this.flashes.push({ x, y, r: 60, life: 0, max: 0.3, bearing: 0, cone: false, delay: 0 });
      this.rings.push({ x, y, r0: 10, r1: 110, life: 0, max: 0.5, width: 4, color: '255,180,90', delay: 0, alpha: 0.7 });
      this.playDom('ring', x, y);
      return;
    }
    // Phase 1 — contact
    this.flashes.push({ x, y, r: 70 * intensity, life: 0, max: 0.1, bearing: 0, cone: false, delay: 0 });
    for (let i = 0; i < 3; i++) {
      const a = r() * Math.PI * 2, sp = 900 + r() * 500;
      this.spawnParticle({ kind: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, max: 0.12, size: 2.4, len: 0.05, drag: 9 });
    }
    // Phase 2 — plasma fireball + shock rings
    this.balls.push({ x, y, r0: 22, r1: 92 * Math.max(0.6, intensity), life: 0, max: 0.34, delay: 0.05, seed: r() * 100 });
    this.rings.push({ x, y, r0: 4, r1: 130 * Math.max(0.6, intensity), life: 0, max: 0.3, width: 3.5, color: '255,236,200', delay: 0.05, alpha: 0.65 });
    this.rings.push({ x, y, r0: 4, r1: 100 * Math.max(0.6, intensity), life: 0, max: 0.34, width: 1.6, color: '255,150,60', delay: 0.13, alpha: 0.45 });
    this.playDom('plasma', x, y);
    this.playDom('ring', x, y);
    this.shake(2 + 2 * Math.min(1, intensity), 0.16);
    // Phase 3 — debris
    const nSparks = Math.round((35 + r() * 30) * k);
    for (let i = 0; i < nSparks; i++) {
      const a = r() * Math.PI * 2;
      const sp = 140 + Math.pow(r(), 0.6) * 760;
      this.spawnParticle({
        kind: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        max: 0.35 + r() * 0.5, size: 1 + r() * 2.2, len: 0.02 + r() * 0.05, drag: 1.5 + r() * 3.5, grav: 40, hue: 22 + r() * 30,
      });
    }
    const nFrags = Math.round((8 + r() * 4) * Math.max(0.6, k));
    for (let i = 0; i < nFrags; i++) {
      const a = r() * Math.PI * 2, sp = 120 + r() * 300;
      this.spawnParticle({ kind: 'frag', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, max: 0.6 + r() * 0.35, size: 3 + r() * 4.5, drag: 1.6, rot: r() * 6, vr: (r() - 0.5) * 18, grav: 30 });
    }
    for (let i = 0; i < 3; i++) {
      const a = r() * Math.PI * 2, sp = 420 + r() * 300;
      this.spawnParticle({ kind: 'shard', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120, max: 0.7 + r() * 0.2, size: 2.4, len: 0.04, drag: 1.2, grav: 520 });
    }
    for (let i = 0; i < 6; i++) {
      const a = r() * Math.PI * 2;
      this.playDom('debris', x, y, { '--dx': `${Math.cos(a) * (70 + r() * 90)}px`, '--dy': `${Math.sin(a) * (70 + r() * 90)}px`, '--spin': `${(r() - 0.5) * 720}deg` });
    }
    // Phase 4 — smoke
    const nSmoke = Math.round((12 + r() * 12) * Math.max(0.5, k));
    for (let i = 0; i < nSmoke; i++) {
      const a = r() * Math.PI * 2, sp = 18 + r() * 55;
      this.spawnSmoke({
        x: x + Math.cos(a) * r() * 18, y: y + Math.sin(a) * r() * 18,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 16 - r() * 18,
        r0: 16 + r() * 10, r1: 48 + r() * 30, max: 1.0 + r() * 0.9, delay: 0.15 + r() * 0.3,
        rot: r() * 6, vr: (r() - 0.5) * 0.8, variant: Math.floor(r() * 3), alpha: 0.75 + r() * 0.25, warm: 1,
      });
    }
    for (let i = 0; i < 3; i++) {
      const a = r() * Math.PI * 2;
      this.playDom('smokeDom', x + Math.cos(a) * 14, y + Math.sin(a) * 14, { '--dx': `${Math.cos(a) * 40}px`, '--dy': `${Math.sin(a) * 30 - 30}px`, '--d': `${1.3 + r() * 0.5}s` });
    }
    // lingering harmless glow motes
    for (let i = 0; i < Math.round(8 * k); i++) {
      const a = r() * Math.PI * 2, sp = 20 + r() * 60;
      this.spawnParticle({ kind: 'ember', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 10, max: 0.9 + r() * 0.5, size: 1.4, drag: 0.8, hue: 35 });
    }
  }

  /** Floating label (e.g. "+150") using CSS shimmerFade. */
  floatText(layer: HTMLElement, x: number, y: number, text: string, cls = ''): void {
    const el = document.createElement('div');
    el.className = `float-text ${cls}`;
    el.textContent = text;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    layer.appendChild(el);
    el.addEventListener('animationend', () => el.remove(), { once: true });
    window.setTimeout(() => el.remove(), 3000); // safety for reduced-motion / hidden tabs
  }

  // ---------------------------------------------------------------- update/draw
  update(dt: number): void {
    for (const p of this.particles) {
      if (!p.active) continue;
      p.life += dt;
      if (p.life >= p.max) { p.active = false; continue; }
      const d = Math.exp(-p.drag * dt);
      p.vx *= d; p.vy = p.vy * d + p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }
    for (const s of this.smoke) {
      if (!s.active) continue;
      s.life += dt;
      if (s.life >= s.max + s.delay) { s.active = false; continue; }
      if (s.life < s.delay) continue;
      const d = Math.exp(-1.1 * dt);
      s.vx *= d; s.vy = s.vy * d - 6 * dt;
      // turbulent billow
      const t = s.life * 2.3 + s.rot * 3;
      s.x += (s.vx + Math.sin(t) * 6) * dt;
      s.y += (s.vy + Math.cos(t * 1.3) * 4) * dt;
      s.rot += s.vr * dt;
    }
    const age = <T extends { life: number; max: number; delay: number }>(arr: T[]) => {
      for (const o of arr) o.life += dt;
      return arr.filter((o) => o.life < o.max + o.delay);
    };
    this.rings = age(this.rings);
    this.balls = age(this.balls);
    this.flashes = age(this.flashes);
    if (this.shakeT < this.shakeDur) {
      this.shakeT += dt;
      const f = Math.max(0, 1 - this.shakeT / this.shakeDur) * this.shakeAmp;
      this.shakeX = (this.rng() * 2 - 1) * f;
      this.shakeY = (this.rng() * 2 - 1) * f;
    } else {
      this.shakeX = this.shakeY = 0;
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    // smoke first (normal alpha so dark smoke reads on navy), warm-lit early
    for (const s of this.smoke) {
      if (!s.active || s.life < s.delay) continue;
      const t = (s.life - s.delay) / s.max;
      const rad = s.r0 + (s.r1 - s.r0) * (1 - Math.pow(1 - t, 2));
      const a = s.alpha * (t < 0.12 ? t / 0.12 : Math.pow(1 - (t - 0.12) / 0.88, 1.4));
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.rot);
      ctx.globalAlpha = Math.max(0, a);
      ctx.drawImage(this.puffSprites[s.variant], -rad, -rad, rad * 2, rad * 2);
      if (s.warm > 0 && t < 0.45) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = Math.max(0, (1 - t / 0.45) * 0.55 * s.warm);
        ctx.drawImage(this.warmPuff, -rad, -rad, rad * 2, rad * 2);
      }
      ctx.restore();
    }
    // rock fragments: normal compositing
    ctx.save();
    for (const p of this.particles) {
      if (!p.active || p.kind !== 'frag') continue;
      const t = p.life / p.max;
      ctx.globalAlpha = 1 - t * t;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = t < 0.25 ? '#b4482a' : '#3b2a2c';
      ctx.beginPath();
      ctx.moveTo(-p.size, -p.size * 0.4);
      ctx.lineTo(p.size * 0.2, -p.size * 0.8);
      ctx.lineTo(p.size, p.size * 0.3);
      ctx.lineTo(-p.size * 0.3, p.size * 0.7);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = `rgba(255,120,40,${0.7 * (1 - t)})`;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // fireball
    for (const b of this.balls) {
      if (b.life < b.delay) continue;
      const t = (b.life - b.delay) / b.max;
      const rad = b.r0 + (b.r1 - b.r0) * (1 - Math.pow(1 - t, 3));
      const a = t < 0.3 ? 1 : 1 - (t - 0.3) / 0.7;
      for (let i = 0; i < 4; i++) {
        // irregular lobes
        const ang = b.seed + i * 1.7 + t * 2;
        const ox = Math.cos(ang) * rad * 0.18, oy = Math.sin(ang) * rad * 0.18;
        const rr = rad * (0.75 + 0.12 * Math.sin(b.seed + i * 2.1));
        const g = ctx.createRadialGradient(b.x + ox, b.y + oy, 0, b.x + ox, b.y + oy, rr);
        g.addColorStop(0, `rgba(255,250,225,${0.9 * a})`);
        g.addColorStop(0.3, `rgba(255,205,90,${0.75 * a})`);
        g.addColorStop(0.65, `rgba(255,95,20,${0.45 * a})`);
        g.addColorStop(1, 'rgba(160,20,40,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(b.x + ox, b.y + oy, rr, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // localized bloom / muzzle flash
    for (const f of this.flashes) {
      if (f.life < f.delay) continue;
      const t = (f.life - f.delay) / f.max;
      const a = 1 - t;
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r);
      g.addColorStop(0, `rgba(255,255,240,${a})`);
      g.addColorStop(0.3, `rgba(255,200,100,${0.7 * a})`);
      g.addColorStop(1, 'rgba(255,100,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
      ctx.fill();
      if (f.cone) {
        ctx.save();
        ctx.translate(f.x, f.y);
        ctx.rotate(f.bearing * DEG);
        const cg = ctx.createLinearGradient(0, 0, f.r * 1.6, 0);
        cg.addColorStop(0, `rgba(255,245,210,${a})`);
        cg.addColorStop(1, 'rgba(255,120,0,0)');
        ctx.fillStyle = cg;
        ctx.beginPath();
        ctx.moveTo(0, -9);
        ctx.quadraticCurveTo(f.r * 0.8, -16 * (1 - t * 0.5), f.r * 1.6, 0);
        ctx.quadraticCurveTo(f.r * 0.8, 16 * (1 - t * 0.5), 0, 9);
        ctx.fill();
        ctx.restore();
      }
    }
    // shock rings
    for (const r of this.rings) {
      if (r.life < r.delay) continue;
      const t = (r.life - r.delay) / r.max;
      const rad = r.r0 + (r.r1 - r.r0) * (1 - Math.pow(1 - t, 2));
      ctx.strokeStyle = `rgba(${r.color},${r.alpha * (1 - t)})`;
      ctx.lineWidth = r.width * (1 - t * 0.6);
      ctx.beginPath();
      ctx.arc(r.x, r.y, rad, 0, Math.PI * 2);
      ctx.stroke();
    }
    // sparks / shards / embers
    ctx.lineCap = 'round';
    for (const p of this.particles) {
      if (!p.active || p.kind === 'frag') continue;
      const t = p.life / p.max;
      const a = p.kind === 'ember' ? Math.sin(Math.PI * t) : 1 - t;
      if (p.kind === 'ember') {
        ctx.fillStyle = `hsla(${p.hue},100%,62%,${a * 0.9})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      const light = p.kind === 'shard' ? 88 : 60 + 30 * (1 - t);
      ctx.strokeStyle = `hsla(${p.hue},100%,${light}%,${a})`;
      ctx.lineWidth = p.size * (1 - t * 0.5);
      ctx.beginPath();
      ctx.moveTo(p.x - p.vx * p.len, p.y - p.vy * p.len);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  clear(): void {
    for (const p of this.particles) p.active = false;
    for (const s of this.smoke) s.active = false;
    this.rings = [];
    this.balls = [];
    this.flashes = [];
    this.shakeT = this.shakeDur = 0;
    this.shakeX = this.shakeY = 0;
  }
}
