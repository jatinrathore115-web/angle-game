import { describe, expect, it } from 'vitest';
import {
  answerFor,
  arcEnd,
  buildGeometry,
  norm360,
  pointOnBearing,
  safeHitRadius,
  segmentCircleHit,
  shortestDelta,
  shotBearing,
  angularMiss,
} from '../game/AngleMath';
import { curatedLevels, generateMasteryLevel, mulberry32, validateLevel } from '../game/LevelBank';
import { TURRET } from '../game/calibration';
import { spawnDistance } from '../game/Game';

const EXPECTED = [104, 68, 62, 137, 113, 28, 47, 89];

describe('curated level bank', () => {
  const levels = curatedLevels();

  it('has the 8 designed levels with correct computed answers', () => {
    expect(levels).toHaveLength(8);
    levels.forEach((l, i) => expect(answerFor(l.relation, l.knownDeg)).toBe(EXPECTED[i]));
  });

  it('every level has exactly one option equal to the answer and no duplicates', () => {
    for (const l of levels) {
      expect(validateLevel(l)).toEqual([]);
      expect(l.options.filter((o) => o === answerFor(l.relation, l.knownDeg))).toHaveLength(1);
    }
  });

  it('round 1 shows 76 | 104 | 114 | 80 in reference order, meteor upper-left', () => {
    expect(levels[0].options).toEqual([76, 104, 114, 80]);
    expect(levels[0].knownDeg).toBe(76);
    const p = pointOnBearing(TURRET, levels[0].targetBearingDeg, 500);
    expect(p.x).toBeLessThan(TURRET.x);
    expect(p.y).toBeLessThan(TURRET.y);
  });

  it('meteors come from many directions (all four quadrants)', () => {
    const quad = new Set(levels.map((l) => Math.floor(norm360(l.targetBearingDeg + 1) / 90)));
    expect(quad.size).toBe(4);
  });

  it('generated mastery levels are always valid', () => {
    const rng = mulberry32(5);
    for (let i = 0; i < 300; i++) {
      const l = generateMasteryLevel(9 + i, rng, 200);
      expect(validateLevel(l)).toEqual([]);
      const ans = answerFor(l.relation, l.knownDeg);
      for (const o of l.options) if (o !== ans) expect(Math.abs(o - ans)).toBeGreaterThanOrEqual(4);
    }
  });
});

describe('math drives the cannon', () => {
  for (const l of curatedLevels()) {
    const g = buildGeometry(l.knownDeg, l.relation, l.targetBearingDeg, l.turnSign);

    it(`L${l.id}: correct option bearing equals the meteor bearing`, () => {
      const b = shotBearing(g.referenceRayBearingDeg, g.turnSign, g.answerDeg);
      expect(angularMiss(b, l.targetBearingDeg)).toBeLessThan(1e-9);
    });

    it(`L${l.id}: every wrong option points elsewhere and can never collide`, () => {
      const d = spawnDistance(l.targetBearingDeg) * 0.95;
      const head = pointOnBearing(TURRET, l.targetBearingDeg, d);
      const r = safeHitRadius(30, d, l.options, g.answerDeg);
      for (const o of l.options) {
        const b = shotBearing(g.referenceRayBearingDeg, g.turnSign, o);
        const end = pointOnBearing(TURRET, b, 1500);
        const hit = segmentCircleHit(TURRET, end, head, r);
        if (o === g.answerDeg) expect(hit).toBe(true);
        else {
          expect(angularMiss(b, l.targetBearingDeg)).toBeGreaterThan(1);
          expect(hit).toBe(false);
        }
      }
    });

    it(`L${l.id}: drawn arcs use the same angles as the computation`, () => {
      expect(Math.abs(g.unknownArc.sweepDeg)).toBe(g.answerDeg);
      expect(Math.abs(g.knownArc.sweepDeg)).toBe(l.knownDeg);
      expect(angularMiss(arcEnd(g.unknownArc), g.targetBearingDeg)).toBeLessThan(1e-9);
      if (l.relation === 'linear-pair') {
        // known is adjacent: ends on the opposite reference ray (straight line = 180°)
        expect(angularMiss(arcEnd(g.knownArc), g.referenceRayBearingDeg + 180)).toBeLessThan(1e-9);
      } else {
        // known is vertically opposite: exactly the ? arc rotated by 180°
        expect(angularMiss(g.knownArc.startDeg, g.unknownArc.startDeg + 180)).toBeLessThan(1e-9);
        expect(angularMiss(arcEnd(g.knownArc), arcEnd(g.unknownArc) + 180)).toBeLessThan(1e-9);
      }
    });
  }
});

describe('angle normalisation', () => {
  it('wraps to [0,360)', () => {
    expect(norm360(-1)).toBe(359);
    expect(norm360(360)).toBe(0);
    expect(norm360(725)).toBe(5);
  });

  it('turns the short way across the ±180 seam (-179 -> 179 is -2°, not 358°)', () => {
    expect(shortestDelta(-179, 179)).toBeCloseTo(-2);
    expect(shortestDelta(179, -179)).toBeCloseTo(2);
    expect(shortestDelta(350, 10)).toBeCloseTo(20);
    expect(shortestDelta(10, 350)).toBeCloseTo(-20);
    for (let a = -720; a <= 720; a += 37) for (let b = -720; b <= 720; b += 41) {
      const d = shortestDelta(a, b);
      expect(d).toBeGreaterThanOrEqual(-180);
      expect(d).toBeLessThan(180);
      expect(norm360(a + d)).toBeCloseTo(norm360(b));
    }
  });
});
