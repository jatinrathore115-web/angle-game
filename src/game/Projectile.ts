import { DEG } from './AngleMath';
import type { Vec2 } from './types';

export const PROJECTILE_SPEED = 1400; // stage px / s

/** Visible plasma bolt travelling along the exact shot bearing. */
export class Projectile {
  pos: Vec2;
  prev: Vec2;
  readonly dir: Vec2;
  readonly bearing: number;
  alive = true;
  age = 0;
  travelled = 0;
  private trail: Vec2[] = [];

  constructor(origin: Vec2, bearing: number, readonly maxDist = 1300) {
    this.pos = { ...origin };
    this.prev = { ...origin };
    this.bearing = bearing;
    this.dir = { x: Math.cos(bearing * DEG), y: Math.sin(bearing * DEG) };
  }

  update(dt: number): void {
    if (!this.alive) return;
    this.age += dt;
    this.prev = { ...this.pos };
    const step = PROJECTILE_SPEED * dt;
    this.pos = { x: this.pos.x + this.dir.x * step, y: this.pos.y + this.dir.y * step };
    this.travelled += step;
    this.trail.unshift({ ...this.pos });
    if (this.trail.length > 7) this.trail.length = 7;
    if (this.travelled > this.maxDist) this.alive = false;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (!this.alive) return;
    const { x, y } = this.pos;
    const tailLen = Math.min(120, this.travelled);
    const tx = x - this.dir.x * tailLen, ty = y - this.dir.y * tailLen;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // orange plasma sheath / motion streak
    const g = ctx.createLinearGradient(tx, ty, x, y);
    g.addColorStop(0, 'rgba(255,90,0,0)');
    g.addColorStop(0.6, 'rgba(255,120,20,0.45)');
    g.addColorStop(1, 'rgba(255,190,80,0.95)');
    ctx.strokeStyle = g;
    ctx.lineCap = 'round';
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(255,240,200,0.9)';
    ctx.beginPath();
    ctx.moveTo(x - this.dir.x * tailLen * 0.45, y - this.dir.y * tailLen * 0.45);
    ctx.lineTo(x, y);
    ctx.stroke();
    // glow + white-hot core
    const rg = ctx.createRadialGradient(x, y, 0, x, y, 30);
    rg.addColorStop(0, 'rgba(255,255,235,1)');
    rg.addColorStop(0.25, 'rgba(255,200,90,0.85)');
    rg.addColorStop(1, 'rgba(255,90,0,0)');
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(x, y, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.translate(x, y);
    ctx.rotate(this.bearing * DEG);
    ctx.fillStyle = '#fffbe8';
    ctx.beginPath();
    ctx.ellipse(0, 0, 11, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
