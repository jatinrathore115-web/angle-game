import { DEG, angularMiss, arcMid, norm360, pointOnBearing } from './AngleMath';
import { TURRET } from './calibration';
import type { Arc, QuestionGeometry, TurnSign } from './types';

const R_UNKNOWN = 162;
const R_KNOWN = 146;
const LABEL_R = 212;
const LINE_LEN = 360;
const R_STRAIGHT = 268; // the 180° "straight angle" hint arc
const X_COLOR = "#FFB43A"; // the unknown x: same warm orange as its arc, distinct from the yellow known value
const HINT_RGB = '125,225,255'; // cool cyan: visually distinct from the yellow angle values

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
  /**
   * Visual hint level. The maths is SHOWN in the figure, never written as sentences:
   *  1  linear pair: a 180° straight-angle arc sweeps over both angles on the straight line
   *     vertical:    both opposite arcs light up in one colour with equal-angle tick marks
   *  2  as 1, plus a warm glow pulsing on the unknown x
   *  3  the x label shows the equation step (x = 180° − 76° / x = 68°)
   */
  hintLevel = 0;
  /** true once answered correctly: the ? resolves into the answer value */
  resolved = false;
  private hintT = 0;
  private resolveT = 0;
  private ghosts: Ghost[] = [];
  private t = 0;

  set(geo: QuestionGeometry | null): void {
    this.geo = geo;
    this.ghosts = [];
    this.hintLevel = 0;
    this.resolved = false;
    this.intensity = this.targetIntensity = 0;
    this.emphasis = 0;
  }

  showHint(level: number): void {
    this.hintLevel = Math.max(this.hintLevel, Math.min(3, level));
    this.hintT = this.t; // replay the sweep each time it is asked for
    this.emphasis = 1;
    this.targetIntensity = 1;
  }

  resolve(): void {
    this.resolved = true;
    this.resolveT = this.t;
    this.targetIntensity = 1;
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
    const straightLineEmph = (this.emphasis > 0 || this.hintLevel > 0) && g.relation === 'linear-pair' && !this.resolved;
    drawLine(g.referenceRayBearingDeg, 0.75 * E + (straightLineEmph ? 0.3 * pulse : 0), straightLineEmph);
    drawLine(g.targetBearingDeg, 0.6 * E, false);
    ctx.setLineDash([]);

    // arcs
    const pairHint = this.hintLevel > 0 && g.relation === 'vertical' && !this.resolved;
    const hp = 0.75 + 0.25 * Math.sin(this.t * 5);
    if (pairHint) {
      // vertically opposite: same colour + the same tick marks = "these two are equal"
      const fillA = 0.16 * hp;
      this.drawArc(ctx, g.knownArc, R_KNOWN, `rgba(${HINT_RGB},${hp})`, `rgba(${HINT_RGB},${fillA})`, 5);
      this.drawArc(ctx, g.unknownArc, R_KNOWN, `rgba(${HINT_RGB},${hp})`, `rgba(${HINT_RGB},${fillA})`, 5);
      this.ticks(ctx, g.knownArc, R_KNOWN, hp);
      this.ticks(ctx, g.unknownArc, R_KNOWN, hp);
    } else {
      this.drawArc(ctx, g.knownArc, R_KNOWN, `rgba(255,226,110,${0.95 * E})`, `rgba(255,226,110,${0.12 * E})`, 4);
      const col = this.resolved ? '255,236,140' : '255,170,40';
      const fillA = (this.resolved ? 0.22 : 0.1 + 0.1 * pulse) * E;
      this.drawArc(ctx, g.unknownArc, R_UNKNOWN, `rgba(${col},${Math.min(1, E + 0.2 * pulse)})`, `rgba(${col},${fillA})`, 4.5);
    }

    // linear pair: the straight angle (180°) sweeps across both angles on the straight line
    if (this.hintLevel > 0 && g.relation === 'linear-pair' && !this.resolved) {
      const prog = Math.min(1, (this.t - this.hintT) / 0.6);
      const ease = 1 - Math.pow(1 - prog, 3);
      const sweep = g.turnSign * 180 * ease;
      const a0 = g.referenceRayBearingDeg * DEG;
      const a1 = (g.referenceRayBearingDeg + sweep) * DEG;
      ctx.save();
      ctx.strokeStyle = `rgba(${HINT_RGB},${0.9 * hp})`;
      ctx.lineWidth = 3.5;
      ctx.shadowColor = `rgba(${HINT_RGB},0.8)`;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(TURRET.x, TURRET.y, R_STRAIGHT, a0, a1, sweep < 0);
      ctx.stroke();
      ctx.restore();
      // end caps where the arc meets the straight line
      for (const b of [g.referenceRayBearingDeg, g.referenceRayBearingDeg + 180]) {
        const p0 = pointOnBearing(TURRET, b, R_STRAIGHT - 10);
        const p1 = pointOnBearing(TURRET, b, R_STRAIGHT + 10);
        ctx.strokeStyle = `rgba(${HINT_RGB},${0.9 * ease})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
      }
      if (prog >= 1) {
        // "180°" sits on the straight-angle arc where it is farthest from the meteor's line
        const cA = norm360(g.referenceRayBearingDeg + g.turnSign * 35);
        const cB = norm360(g.referenceRayBearingDeg + g.turnSign * 145);
        const at = angularMiss(cA, g.targetBearingDeg) > angularMiss(cB, g.targetBearingDeg) ? cA : cB;
        const lp = pointOnBearing(TURRET, at, R_STRAIGHT + 30);
        this.label(ctx, '180°', lp.x, lp.y, `rgb(${HINT_RGB})`, 34, Math.min(1, (this.t - this.hintT - 0.6) * 4));
      }
    }

    // fading ghost arcs for wrong attempts
    for (const gh of this.ghosts) {
      const a = Math.min(1, gh.life / 0.6) * 0.8;
      // dashed red arc only: the crossed-out button already names the value that was tried
      this.drawArc(ctx, gh.arc, 172, `rgba(255,96,64,${a})`, 'rgba(0,0,0,0)', 2.5, [6, 6]);
    }

    // labels (kept readable even at low intensity)
    const la = Math.max(0.9, E);
    const kp = pointOnBearing(TURRET, arcMid(g.knownArc), LABEL_R);
    this.label(ctx, `${g.knownDeg}°`, kp.x, kp.y, '#FFE15A', 40, la);
    // The unknown is named like a textbook figure: an italic variable "x" (find the value of x).
    const up = pointOnBearing(TURRET, arcMid(g.unknownArc), LABEL_R + 6);
    if (this.resolved) {
      // worked-solution ending: x = 104°, with a short pop
      const k = Math.min(1, (this.t - this.resolveT) / 0.35);
      const pop = 1 + 0.4 * Math.sin(Math.PI * k) * (1 - k * 0.4);
      this.mathLabel(ctx, ` = ${g.answerDeg}°`, up.x, up.y, 42 * pop, '#FFF2B0', 1, 0.6);
    } else {
      const glow = this.hintLevel >= 2 ? 0.5 + 0.5 * Math.sin(this.t * 6) : pulse;
      const rest =
        this.hintLevel >= 3
          ? g.relation === 'linear-pair'
            ? ` = 180° − ${g.knownDeg}°`
            : ` = ${g.knownDeg}°`
          : '';
      this.mathLabel(ctx, rest, up.x, up.y, rest ? 34 : 50, X_COLOR, la, glow);
    }
    ctx.restore();
  }

  /**
   * Draws "x" in a textbook-style italic serif followed by optional plain text
   * (e.g. " = 180° − 76°"), centred at (cx, cy). `glow` (0..1) adds a warm halo for hints.
   */
  private mathLabel(
    ctx: CanvasRenderingContext2D, rest: string, cx: number, cy: number, size: number, color: string, alpha: number, glow: number,
  ): void {
    const varFont = `italic 600 ${size * 1.12}px "Cambria Math", Cambria, "Times New Roman", serif`;
    const restFont = `800 ${size * 0.82}px "Baloo 2", "Segoe UI", system-ui, sans-serif`;
    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = varFont;
    const wx = ctx.measureText('x').width;
    ctx.font = restFont;
    const wr = rest ? ctx.measureText(rest).width : 0;
    const x = cx - (wx + wr) / 2;
    const passes: [string, number, number][] = [['rgba(0,0,0,0.85)', 8, alpha]];
    if (glow > 0.01) passes.push([`rgba(255,170,40,0.95)`, 10 + 16 * glow, alpha * glow]);
    for (const [shadow, blur, a] of passes) {
      ctx.globalAlpha = a;
      ctx.shadowColor = shadow;
      ctx.shadowBlur = blur;
      ctx.shadowOffsetY = shadow.startsWith('rgba(0') ? 2 : 0;
      ctx.fillStyle = color;
      ctx.font = varFont;
      ctx.fillText('x', x, cy);
      if (rest) {
        ctx.font = restFont;
        ctx.fillText(rest, x + wx, cy + size * 0.04);
      }
    }

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

  /** Double equal-angle tick marks across an arc (textbook notation for "these angles are equal"). */
  private ticks(ctx: CanvasRenderingContext2D, arc: Arc, r: number, alpha: number): void {
    const mid = arcMid(arc);
    ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
    ctx.lineWidth = 3;
    for (const off of [-3.2, 3.2]) {
      const p0 = pointOnBearing(TURRET, mid + off, r - 11);
      const p1 = pointOnBearing(TURRET, mid + off, r + 11);
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }
  }

  /** Plain numeric label (known angle, 180°): bold digits with a soft dark shadow, no badge. */
  private label(
    ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, size: number, alpha: number,
  ): void {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `800 ${size}px "Baloo 2", "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = color;
    ctx.fillText(text, x, y + 2);
    ctx.restore();
  }
}
