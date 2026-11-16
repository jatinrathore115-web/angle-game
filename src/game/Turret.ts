import { norm360, pointOnBearing, shortestDelta } from './AngleMath';
import {
  BARREL_IMG,
  BARREL_PIVOT,
  BARREL_SCALE,
  BARREL_TILT_DEG,
  BASE_CORE,
  BASE_IMG,
  BASE_SCALE,
  MUZZLE_DIST,
  TURRET,
} from './calibration';
import type { Vec2 } from './types';

export const SERVO_MAX_SPEED = 480; // deg/s
const SERVO_ACCEL = 3600; // deg/s^2
const SERVO_GAIN = 14; // proportional term -> smooth mechanical settle

/**
 * Stationary base + barrel on its own rotating mount. The barrel image is offset
 * inside the mount so the calibrated rear pivot sits exactly on the mount origin
 * (= the base's red socket). The base never rotates.
 */
export class Turret {
  angle: number;
  target: number;
  angVel = 0;
  private mount: HTMLElement;
  private recoilEl: HTMLElement;

  constructor(root: HTMLElement, baseImg: HTMLImageElement, barrelImg: HTMLImageElement, initial = 204) {
    this.angle = initial;
    this.target = initial;
    const base = root.querySelector<HTMLElement>('#turret-base-wrap')!;
    this.mount = root.querySelector<HTMLElement>('#barrel-mount')!;
    this.recoilEl = root.querySelector<HTMLElement>('#barrel-recoil')!;

    root.style.left = `${TURRET.x}px`;
    root.style.top = `${TURRET.y}px`;

    baseImg.id = 'turret-base';
    baseImg.alt = '';
    baseImg.draggable = false;
    Object.assign(baseImg.style, {
      width: `${BASE_IMG.w * BASE_SCALE}px`,
      height: `${BASE_IMG.h * BASE_SCALE}px`,
      left: `${-BASE_CORE.x * BASE_SCALE}px`,
      top: `${-BASE_CORE.y * BASE_SCALE}px`,
    });
    base.prepend(baseImg);

    barrelImg.id = 'turret-barrel';
    barrelImg.alt = '';
    barrelImg.draggable = false;
    Object.assign(barrelImg.style, {
      width: `${BARREL_IMG.w * BARREL_SCALE}px`,
      height: `${BARREL_IMG.h * BARREL_SCALE}px`,
      left: `${-BARREL_PIVOT.x * BARREL_SCALE}px`,
      top: `${-BARREL_PIVOT.y * BARREL_SCALE}px`,
    });
    this.recoilEl.appendChild(barrelImg);
    this.render();
  }

  aimAt(bearing: number): void {
    this.target = norm360(bearing);
  }

  snap(bearing: number): void {
    this.angle = this.target = norm360(bearing);
    this.angVel = 0;
    this.render();
  }

  get settled(): boolean {
    return Math.abs(shortestDelta(this.angle, this.target)) < 0.05 && Math.abs(this.angVel) < 1;
  }

  /** Servo motion: always along the shortest arc, speed-capped, accel-limited, no overshoot past ±180. */
  update(dt: number): number {
    const delta = shortestDelta(this.angle, this.target);
    if (Math.abs(delta) < 0.25 && Math.abs(this.angVel) < 25) {
      this.angle = this.target;
      this.angVel = 0;
    } else {
      const desired = clamp(delta * SERVO_GAIN, -SERVO_MAX_SPEED, SERVO_MAX_SPEED);
      const dv = clamp(desired - this.angVel, -SERVO_ACCEL * dt, SERVO_ACCEL * dt);
      this.angVel += dv;
      let step = this.angVel * dt;
      // never step past the target
      if (Math.sign(step) === Math.sign(delta) && Math.abs(step) > Math.abs(delta)) step = delta;
      this.angle = norm360(this.angle + step);
    }
    this.render();
    return Math.abs(this.angVel);
  }

  /** World position of the muzzle tip for the current barrel bearing. */
  muzzle(bearing = this.angle): Vec2 {
    return pointOnBearing(TURRET, bearing, MUZZLE_DIST);
  }

  recoil(): void {
    this.recoilEl.classList.remove('recoil');
    void this.recoilEl.offsetWidth;
    this.recoilEl.classList.add('recoil');
  }

  /** The CSS rotation applied to the mount (compensates the art's tiny bore tilt). */
  static cssRotationFor(bearing: number): number {
    return bearing - BARREL_TILT_DEG;
  }

  private render(): void {
    this.mount.style.transform = `rotate(${Turret.cssRotationFor(this.angle).toFixed(3)}deg)`;
  }
}

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}
