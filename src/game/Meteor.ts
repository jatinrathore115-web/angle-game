import { DEG, norm360, pointOnBearing } from './AngleMath';
import {
  IMPACT_RADIUS,
  METEOR_ART_ANGLE,
  METEOR_FPS,
  METEOR_FRAME_COUNT,
  METEOR_INTRO_END,
  METEOR_LOOP_START,
  METEOR_SHEET,
  TURRET,
} from './calibration';
import { frameAt } from './SpriteSheet';
import type { Vec2 } from './types';

const ENTRY_TIME = 1.1;
const ENTRY_EXTRA = 150;

/**
 * One meteor flying radially at the turret. Because the flight is radial its
 * bearing from the turret is constant, so the question geometry stays exact
 * while it approaches.
 */
export class Meteor {
  readonly bearing: number;
  readonly startDist: number;
  readonly journeyTime: number;
  progress = 0;
  /** 1 = normal approach, 0 = held (aim cinematic). Eased toward speedTarget. */
  speed = 1;
  speedTarget = 1;
  /** calm mode: the meteor parks here and never hits */
  stopAt: number;
  entry: number; // 0..1
  animTime = 0;
  frameIndex = 0;
  alive = true;
  isExploding = false;
  head: Vec2 = { x: 0, y: 0 };
  scale = 1;
  rotation = 0; // radians, applied to sheet art
  alpha = 1;
  private lurch = 0;
  private wobbleSeed: number;

  constructor(bearing: number, startDist: number, journeyTime: number, opts: { calm?: boolean; skipEntry?: boolean } = {}) {
    this.bearing = norm360(bearing);
    this.startDist = startDist;
    this.journeyTime = journeyTime;
    this.stopAt = opts.calm ? 0.5 : 1;
    this.entry = opts.skipEntry ? 1 : 0;
    this.animTime = opts.skipEntry ? (METEOR_INTRO_END + 1) / METEOR_FPS : 0;
    this.wobbleSeed = bearing * 13.37;
    this.updateTransform(0);
  }

  get distance(): number {
    const travel = this.startDist - IMPACT_RADIUS;
    return this.startDist - travel * this.progress + (1 - easeOut(this.entry)) * ENTRY_EXTRA;
  }

  get entering(): boolean {
    return this.entry < 1;
  }

  /** Visible rock radius in stage px for the current frame (collision uses this, not the sprite box). */
  get rockRadius(): number {
    return METEOR_SHEET.frames[this.frameIndex].headRadius * this.scale * 0.92;
  }

  get reachedCore(): boolean {
    return this.progress >= 1;
  }

  /** Wrong answer: the meteor surges forward a little. */
  surge(amount: number): void {
    this.lurch += amount;
  }

  update(dt: number): void {
    this.animTime += dt;
    if (this.entry < 1) this.entry = Math.min(1, this.entry + dt / ENTRY_TIME);
    this.speed += (this.speedTarget - this.speed) * Math.min(1, dt * 10);
    if (this.entry >= 1 && !this.isExploding) {
      let dp = (dt / this.journeyTime) * this.speed;
      if (this.lurch > 0) {
        const l = Math.min(this.lurch, dt * 0.25);
        this.lurch -= l;
        dp += l;
      }
      this.progress = Math.min(this.stopAt, this.progress + dp);
    }
    this.frameIndex = frameAt(this.animTime, METEOR_FPS, METEOR_INTRO_END, METEOR_LOOP_START, METEOR_FRAME_COUNT - 1);
    this.updateTransform(dt);
  }

  private updateTransform(_dt: number): void {
    this.head = pointOnBearing(TURRET, this.bearing, this.distance);
    this.scale = 1.05 + 0.3 * this.progress;
    this.alpha = easeOut(this.entry);
    // tail points away from the turret: art faces METEOR_ART_ANGLE, travel faces bearing+180
    const travel = this.bearing + 180;
    const wobble = Math.sin(this.animTime * 1.7 + this.wobbleSeed) * 1.2;
    this.rotation = (travel - METEOR_ART_ANGLE + wobble) * DEG;
  }

  draw(ctx: CanvasRenderingContext2D, sheet: HTMLImageElement | ImageBitmap): void {
    if (!this.alive) return;
    const f = METEOR_SHEET.frames[this.frameIndex];
    const r = f.rect;
    ctx.save();
    ctx.translate(this.head.x, this.head.y);
    ctx.rotate(this.rotation);
    ctx.scale(this.scale, this.scale);
    ctx.globalAlpha = this.alpha;
    ctx.drawImage(sheet, r.x, r.y, r.w, r.h, -f.head.x, -f.head.y, r.w, r.h);
    // nearer = slightly brighter (additive re-draw at low alpha)
    const boost = 0.06 + 0.22 * this.progress;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = this.alpha * boost;
    ctx.drawImage(sheet, r.x, r.y, r.w, r.h, -f.head.x, -f.head.y, r.w, r.h);
    ctx.restore();
  }
}

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
