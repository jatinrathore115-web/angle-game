import { STAGE_H, STAGE_W } from './calibration';
import type { Vec2 } from './types';

/** Below this stage scale, interactive UI grows (relative to the art) to stay tappable/legible. */
const UI_REFERENCE_SCALE = 0.62;
const UI_MAX = 1.6;

/**
 * Uniformly scales the 1920x1080 logical stage into the viewport (letterboxed,
 * never distorted). Also:
 *  - Portrait touch devices: the stage is rotated 90° to fill the screen, so the
 *    landscape game is playable immediately (also with rotation lock on).
 *  - `ui` factor (exposed as CSS var --ui): on small screens controls and text grow
 *    relative to the art so touch targets stay >= ~44 CSS px and labels stay legible.
 *  - Canvases get a backing store of CSS px x min(DPR, cap); drawing stays in logical units.
 */
export class ResponsiveStage {
  scale = 1;
  offsetX = 0;
  offsetY = 0;
  rotated = false;
  ui = 1;
  dprCap = 2;
  private canvases: { el: HTMLCanvasElement; ctx: CanvasRenderingContext2D }[] = [];
  private listeners: (() => void)[] = [];
  private coarse = window.matchMedia('(pointer: coarse)');
  private onResize = () => this.layout();

  constructor(private viewport: HTMLElement, private stage: HTMLElement) {
    window.addEventListener('resize', this.onResize);
    window.addEventListener('orientationchange', this.onResize);
    window.visualViewport?.addEventListener('resize', this.onResize);
    this.coarse.addEventListener('change', this.onResize);
    this.layout();
  }

  addCanvas(el: HTMLCanvasElement): CanvasRenderingContext2D {
    const ctx = el.getContext('2d', { alpha: true })!;
    this.canvases.push({ el, ctx });
    this.sizeCanvas(el, ctx);
    return ctx;
  }

  onLayout(fn: () => void): void {
    this.listeners.push(fn);
  }

  layout(): void {
    const vw = this.viewport.clientWidth || window.innerWidth;
    const vh = this.viewport.clientHeight || window.innerHeight;
    // Rotate only on touch devices held in portrait; a narrow desktop window just letterboxes.
    this.rotated = this.coarse.matches && vh > vw;
    const availW = this.rotated ? vh : vw;
    const availH = this.rotated ? vw : vh;
    this.scale = Math.min(availW / STAGE_W, availH / STAGE_H);
    const s = this.scale;
    if (this.rotated) {
      // scale -> rotate 90° clockwise -> centre: stage x runs down the screen
      const tx = (vw + STAGE_H * s) / 2;
      const ty = (vh - STAGE_W * s) / 2;
      this.offsetX = tx;
      this.offsetY = ty;
      this.stage.style.transform = `translate(${tx}px, ${ty}px) rotate(90deg) scale(${s})`;
    } else {
      this.offsetX = (vw - STAGE_W * s) / 2;
      this.offsetY = (vh - STAGE_H * s) / 2;
      this.stage.style.transform = `translate(${this.offsetX}px, ${this.offsetY}px) scale(${s})`;
    }
    this.ui = Math.min(UI_MAX, Math.max(1, UI_REFERENCE_SCALE / s));
    this.stage.style.setProperty('--ui', this.ui.toFixed(3));
    this.stage.classList.toggle('rotated', this.rotated);
    this.stage.classList.toggle('compact', this.ui > 1.01);
    for (const c of this.canvases) this.sizeCanvas(c.el, c.ctx);
    for (const fn of this.listeners) fn();
  }

  get pixelRatio(): number {
    return this.scale * Math.min(window.devicePixelRatio || 1, this.dprCap);
  }

  private sizeCanvas(el: HTMLCanvasElement, ctx: CanvasRenderingContext2D): void {
    const pr = this.pixelRatio;
    const w = Math.max(1, Math.round(STAGE_W * pr));
    const h = Math.max(1, Math.round(STAGE_H * pr));
    if (el.width !== w || el.height !== h) {
      el.width = w;
      el.height = h;
    }
    ctx.setTransform(w / STAGE_W, 0, 0, h / STAGE_H, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
  }

  /** Clear a canvas in logical units. */
  clear(ctx: CanvasRenderingContext2D): void {
    ctx.clearRect(0, 0, STAGE_W, STAGE_H);
  }

  /** Map a client (CSS px) pointer position to logical stage units (handles rotation). */
  toStage(clientX: number, clientY: number): Vec2 {
    const rect = this.viewport.getBoundingClientRect();
    const x = clientX - rect.left - this.offsetX, y = clientY - rect.top - this.offsetY;
    if (this.rotated) return { x: y / this.scale, y: -x / this.scale };
    return { x: x / this.scale, y: y / this.scale };
  }

  destroy(): void {
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('orientationchange', this.onResize);
    window.visualViewport?.removeEventListener('resize', this.onResize);
    this.coarse.removeEventListener('change', this.onResize);
  }
}
