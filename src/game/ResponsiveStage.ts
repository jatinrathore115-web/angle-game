import { STAGE_H, STAGE_W } from './calibration';
import type { Vec2 } from './types';

/**
 * Uniformly scales the 1920x1080 logical stage into the viewport with
 * letterboxing. Canvases get a backing store of CSS px x min(DPR, cap) so they
 * stay crisp, while all drawing stays in logical units.
 */
export class ResponsiveStage {
  scale = 1;
  offsetX = 0;
  offsetY = 0;
  dprCap = 2;
  private canvases: { el: HTMLCanvasElement; ctx: CanvasRenderingContext2D }[] = [];
  private listeners: (() => void)[] = [];
  private onResize = () => this.layout();

  constructor(private viewport: HTMLElement, private stage: HTMLElement) {
    window.addEventListener('resize', this.onResize);
    window.visualViewport?.addEventListener('resize', this.onResize);
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
    this.scale = Math.min(vw / STAGE_W, vh / STAGE_H);
    this.offsetX = (vw - STAGE_W * this.scale) / 2;
    this.offsetY = (vh - STAGE_H * this.scale) / 2;
    this.stage.style.transform = `translate(${this.offsetX}px, ${this.offsetY}px) scale(${this.scale})`;
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

  /** Map a client (CSS px) pointer position to logical stage units. */
  toStage(clientX: number, clientY: number): Vec2 {
    return { x: (clientX - this.offsetX) / this.scale, y: (clientY - this.offsetY) / this.scale };
  }

  destroy(): void {
    window.removeEventListener('resize', this.onResize);
    window.visualViewport?.removeEventListener('resize', this.onResize);
  }
}
