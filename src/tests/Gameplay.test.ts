import { describe, expect, it } from 'vitest';
import { DEG, pointOnBearing } from '../game/AngleMath';
import { AudioEngine } from '../game/AudioEngine';
import { BARREL_MUZZLE, BARREL_PIVOT, BARREL_SCALE, MUZZLE_DIST, TURRET } from '../game/calibration';
import { RoundState } from '../game/RoundState';
import { StateMachine } from '../game/StateMachine';
import { Turret } from '../game/Turret';

/** Mirror of the DOM transform: image px -> world, for a mount rotated by cssRotationFor(bearing). */
function barrelImageToWorld(p: { x: number; y: number }, bearing: number) {
  const a = Turret.cssRotationFor(bearing) * DEG;
  const lx = (p.x - BARREL_PIVOT.x) * BARREL_SCALE, ly = (p.y - BARREL_PIVOT.y) * BARREL_SCALE;
  return { x: TURRET.x + lx * Math.cos(a) - ly * Math.sin(a), y: TURRET.y + lx * Math.sin(a) + ly * Math.cos(a) };
}

describe('barrel pivot', () => {
  it('pivot stays on the socket and muzzle tracks the aim ray at 0/90/180/270 and everywhere between', () => {
    for (let b = 0; b < 360; b += 1) {
      const pivot = barrelImageToWorld(BARREL_PIVOT, b);
      expect(pivot.x).toBeCloseTo(TURRET.x, 9);
      expect(pivot.y).toBeCloseTo(TURRET.y, 9);
      const m = barrelImageToWorld(BARREL_MUZZLE, b);
      const expected = pointOnBearing(TURRET, b, MUZZLE_DIST);
      expect(Math.hypot(m.x - expected.x, m.y - expected.y)).toBeLessThan(1e-6);
    }
    expect(MUZZLE_DIST).toBeGreaterThan(165);
    expect(MUZZLE_DIST).toBeLessThan(205);
  });
});

describe('scoring', () => {
  it('double click cannot fire twice or score twice', () => {
    const r = new RoundState();
    r.beginRound('linear-pair');
    expect(r.tryLock(104)).toBe(true);
    expect(r.tryLock(104)).toBe(false);
    expect(r.tryLock(76)).toBe(false);
    const first = r.registerHit();
    const second = r.registerHit();
    expect(first.points).toBeGreaterThan(0);
    expect(second.points).toBe(0);
    expect(r.score).toBe(first.points);
  });

  it('wrong answers eliminate that option only, and no score', () => {
    const r = new RoundState();
    r.beginRound('vertical');
    r.tryLock(112);
    r.registerMiss(112);
    expect(r.score).toBe(0);
    expect(r.tryLock(112)).toBe(false);
    expect(r.tryLock(68)).toBe(true);
    expect(r.registerHit().firstTry).toBe(false);
  });

  it('reset restores everything', () => {
    const r = new RoundState();
    r.beginRound('linear-pair');
    r.tryLock(104);
    r.registerHit();
    r.beginRound('linear-pair');
    r.loseLife();
    r.reset();
    expect([r.score, r.combo, r.lives, r.firstTryCorrect, r.roundsCleared, r.eliminated.size]).toEqual([0, 0, 3, 0, 0, 0]);
    expect(r.isLocked).toBe(false);
  });

  it('state machine rejects illegal transitions and drops timers on reset', () => {
    const sm = new StateMachine();
    sm.go('TITLE');
    expect(() => sm.go('HIT')).toThrow();
    let fired = false;
    sm.after(0.1, () => (fired = true));
    sm.clearTimers();
    sm.update(1);
    expect(fired).toBe(false);
  });
});

describe('audio', () => {
  it('every sound call is safe when muted / without an AudioContext', () => {
    const a = new AudioEngine();
    a.setMuted(true);
    expect(() => {
      a.unlock();
      a.startup();
      a.hover();
      a.click();
      a.servoUpdate(300);
      a.charge();
      a.fire();
      a.zip(-1, 1, 0.3);
      a.explosion(0.5);
      a.correct();
      a.wrong();
      a.fizzle();
      a.shieldHit(true);
      a.meteorWhoosh(0.5, 0, true);
      a.victory();
      a.gameOver();
      a.silenceLoops();
      a.setSuspended(true);
      a.toggleMute();
      a.setVolume(2);
    }).not.toThrow();
    expect(a.volume).toBe(1);
  });
});
