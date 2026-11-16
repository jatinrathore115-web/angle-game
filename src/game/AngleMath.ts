import type { Arc, QuestionGeometry, Relation, TurnSign, Vec2 } from './types';

export const DEG = Math.PI / 180;

/** Normalise to [0, 360). */
export function norm360(d: number): number {
  const n = d % 360;
  return n < 0 ? n + 360 : n === 0 ? 0 : n; // avoid -0
}

/** Signed shortest rotation from `from` to `to`, in [-180, 180). */
export function shortestDelta(from: number, to: number): number {
  return norm360(to - from + 180) - 180;
}

export function bearingDeg(from: Vec2, to: Vec2): number {
  return norm360(Math.atan2(to.y - from.y, to.x - from.x) / DEG);
}

export function pointOnBearing(origin: Vec2, bearing: number, dist: number): Vec2 {
  return { x: origin.x + Math.cos(bearing * DEG) * dist, y: origin.y + Math.sin(bearing * DEG) * dist };
}

/** The one authoritative answer rule. */
export function answerFor(relation: Relation, knownDeg: number): number {
  return relation === 'linear-pair' ? 180 - knownDeg : knownDeg;
}

/** referenceRayBearing = targetBearing - turnSign * correctAngle */
export function referenceRayBearing(targetBearing: number, turnSign: TurnSign, correctDeg: number): number {
  return norm360(targetBearing - turnSign * correctDeg);
}

/** shotBearing = referenceRayBearing + turnSign * candidate. The candidate number literally steers the gun. */
export function shotBearing(referenceRay: number, turnSign: TurnSign, candidateDeg: number): number {
  return norm360(referenceRay + turnSign * candidateDeg);
}

export function angularMiss(a: number, b: number): number {
  return Math.abs(shortestDelta(a, b));
}

/**
 * Choose the turn direction so the barrel's rest pose (the reference ray) points
 * upward-ish, keeping the diagram clear of the answer buttons at the bottom.
 */
export function preferredTurnSign(targetBearing: number, answerDeg: number): TurnSign {
  const yPlus = Math.sin(referenceRayBearing(targetBearing, 1, answerDeg) * DEG);
  const yMinus = Math.sin(referenceRayBearing(targetBearing, -1, answerDeg) * DEG);
  return yPlus <= yMinus ? 1 : -1;
}

export function buildGeometry(
  knownDeg: number,
  relation: Relation,
  targetBearing: number,
  turnSign: TurnSign,
): QuestionGeometry {
  const answer = answerFor(relation, knownDeg);
  const ref = referenceRayBearing(targetBearing, turnSign, answer);
  const unknownArc: Arc = { startDeg: ref, sweepDeg: turnSign * answer };
  // linear pair: known sits next to ? on the same straight line (target ray -> opposite reference ray)
  // vertical: known sits opposite ? (opposite reference ray -> opposite target ray)
  const knownArc: Arc =
    relation === 'linear-pair'
      ? { startDeg: norm360(targetBearing), sweepDeg: turnSign * knownDeg }
      : { startDeg: norm360(ref + 180), sweepDeg: turnSign * knownDeg };
  return {
    targetBearingDeg: norm360(targetBearing),
    referenceRayBearingDeg: ref,
    turnSign,
    answerDeg: answer,
    knownDeg,
    relation,
    unknownArc,
    knownArc,
    rays: [ref, norm360(ref + 180), norm360(targetBearing), norm360(targetBearing + 180)],
  };
}

export function arcEnd(a: Arc): number {
  return norm360(a.startDeg + a.sweepDeg);
}

export function arcMid(a: Arc): number {
  return norm360(a.startDeg + a.sweepDeg / 2);
}

/** Segment p0->p1 against circle (c, r). */
export function segmentCircleHit(p0: Vec2, p1: Vec2, c: Vec2, r: number): boolean {
  const dx = p1.x - p0.x, dy = p1.y - p0.y;
  const fx = p0.x - c.x, fy = p0.y - c.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? -(fx * dx + fy * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = p0.x + dx * t - c.x, qy = p0.y + dy * t - c.y;
  return qx * qx + qy * qy <= r * r;
}

/**
 * Hit tolerance that can never let a wrong option connect: half of the
 * smallest angular gap between the correct bearing and any wrong option,
 * projected to the meteor's distance, capped by the visible rock radius.
 */
export function safeHitRadius(rockRadius: number, distance: number, options: number[], answer: number): number {
  let minGap = 360;
  for (const o of options) if (o !== answer) minGap = Math.min(minGap, Math.abs(o - answer));
  const lateral = distance * Math.sin(Math.min(minGap * 0.45, 60) * DEG);
  return Math.max(4, Math.min(rockRadius, lateral));
}
