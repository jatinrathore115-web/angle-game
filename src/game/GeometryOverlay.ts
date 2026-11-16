import { DEG, arcMid, pointOnBearing } from './AngleMath';
import { TURRET } from './calibration';
import type { Arc, QuestionGeometry, TurnSign } from './types';

const R_UNKNOWN = 162;
const R_KNOWN = 146;
const LABEL_R = 212;
const LINE_LEN = 360;

interface Ghost {
  arc: Arc;
  value: number;
  life: number;
}

/**
 * Draws the two intersecting lines and the angle arcs. It reads the SAME
 * QuestionGeometry object the firing solution uses, so the picture can never
 * disagree with the trajectory.
 */
export class GeometryOverlay {
  geo: QuestionGeometry | null = null;
  /** 0..1 eased display intensity (low by default, raised by hint/inactivity) */
  intensity = 0;
  targetIntensity = 0;
  /** extra emphasis pulse for hints, 0..1 */
  emphasis = 0;
  private ghosts: Ghost[] = [];
  private t = 0;

  set(geo: QuestionGeometry | null): void {
    this.geo = geo;
    this.ghosts = [];
    if (!geo) this.intensity = this.targetIntensity = 0;
  }

  /** Show the wrong attempt as a fading arc so learners see its size against the target. */
  ghost(referenceRay: number, turnSign: TurnSign, value: number): void {
    this.ghosts.push({ arc: { startDeg: referenceRay, sweepDeg: turnSign * value }, value, life: 1.8 });
  }

  update(dt: number): void {
    this.t += dt;
    this.intensity += (this.targetIntensity - this.intensity) * Math.min(1, dt * 5);
    this.emphasis = Math.max(0, this.emphasis - dt * 0.35);
    for (const g of this.ghosts) g.life -= dt;
    this.ghosts = this.ghosts.filter((g) => g.life > 0);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const g = this.geo;
    if (!g || this.intensity < 0.01) return;
    const I = this.intensity;
    const pulse = this.emphasis > 0 ? 0.5 + 0.5 * Math.sin(this.t * 8) : 0;
    const E = Math.min(1, I + this.emphasis * 0.6);
    ctx.save();
    ctx.lineCap = 'round';

    // two straight lines through the turret (four rays)
    const drawLine = (bearing: number, alpha: number, emph: boolean) => {
      for (const b of [bearing, bearing + 180]) {
        const p0 = pointOnBearing(TURRET, b, 118);
        const p1 = pointOnBearing(TURRET, b, LINE_LEN);
        const grad = ctx.createLinearGradient(p0.x, p0.y, p1.x, p1.y);
        const col = emph ? '255,214,120' : '214,226,255';
        grad.addColorStop(0, `rgba(${col},${alpha})`);
        grad.addColorStop(1, `rgba(${col},0)`);
        ctx.strokeStyle = grad;
        ctx.lineWidth = emph ? 3 : 2;
        ctx.setLineDash([12, 9]);
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
      }
    };
    const straightLineEmph = this.emphasis > 0 && g.relation === 'linear-pair';
    drawLine(g.referenceRayBearingDeg, 0.75 * E + (straightLineEmph ? 0.3 * pulse : 0), straightLineEmph);
    drawLine(g.targetBearingDeg, 0.6 * E, false);
    ctx.setLineDash([]);

    // arcs
    this.drawArc(ctx, g.knownArc, R_KNOWN, `rgba(255,226,110,${0.95 * E})`, `rgba(255,226,110,${0.12 * E})`, 4);
    this.drawArc(ctx, g.unknownArc, R_UNKNOWN, `rgba(255,170,40,${Math.min(1, 1.0 * E + 0.2 * pulse)})`, `rgba(255,150,30,${(0.1 + 0.1 * pulse) * E})`, 4.5);

    // fading ghost arcs for wrong attempts
    for (const gh of this.ghosts) {
      const a = Math.min(1, gh.life / 0.6) * 0.8;
      this.drawArc(ctx, gh.arc, 172, `rgba(255,96,64,${a})`, 'rgba(0,0,0,0)', 2.5, [6, 6]);
      const m = pointOnBearing(TURRET, arcMid(gh.arc), 172 + 26);
      this.label(ctx, `${gh.value}°`, m.x, m.y, `rgba(255,140,110,${a})`, 26, a);
    }

    // labels (kept readable even at low intensity)
    const la = Math.max(0.9, E);
    const kp = pointOnBearing(TURRET, arcMid(g.knownArc), LABEL_R);
    this.label(ctx, `${g.knownDeg}°`, kp.x, kp.y, '#FFE15A', 40, la);
    const up = pointOnBearing(TURRET, arcMid(g.unknownArc), LABEL_R + 6);
    this.label(ctx, '?', up.x, up.y, '#FFD23F', 48, la, true, pulse);
    ctx.restore();
  }

  private drawArc(
    ctx: CanvasRenderingContext2D, arc: Arc, r: number, stroke: string, fill: string, w: number, dash: number[] = [],
  ): void {
    const a0 = arc.startDeg * DEG;
    const a1 = (arc.startDeg + arc.sweepDeg) * DEG;
    const ccw = arc.sweepDeg < 0;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(TURRET.x, TURRET.y);
    ctx.arc(TURRET.x, TURRET.y, r, a0, a1, ccw);
    ctx.closePath();
    ctx.fill();
    ctx.setLineDash(dash);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.arc(TURRET.x, TURRET.y, r, a0, a1, ccw);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private label(
    ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, size: number, alpha: number,
    chip = false, pulse = 0,
  ): void {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `800 ${size}px "Baloo 2", "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (chip) {
      ctx.fillStyle = 'rgba(9,15,36,0.72)';
      ctx.strokeStyle = `rgba(255,190,60,${0.75 + 0.25 * pulse})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(x, y + 2, size * 0.62 + pulse * 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = color;
    ctx.fillText(text, x, y + 2);
    ctx.restore();
  }
}
