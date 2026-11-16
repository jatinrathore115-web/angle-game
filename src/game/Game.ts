import {
  angularMiss,
  answerFor,
  bearingDeg,
  buildGeometry,
  pointOnBearing,
  preferredTurnSign,
  safeHitRadius,
  segmentCircleHit,
  shotBearing,
} from './AngleMath';
import type { Assets } from './AssetLoader';
import { AudioEngine } from './AudioEngine';
import { FRAME_INNER, SPAWN_RECT, STAGE_W, TURRET } from './calibration';
import { GeometryOverlay } from './GeometryOverlay';
import {

  SPAWN_BEARINGS,
  TOTAL_LEVELS,
  curatedLevels,
  generateMasteryLevel,
  mulberry32,
} from './LevelBank';
import { Meteor } from './Meteor';
import { Projectile } from './Projectile';
import { ResponsiveStage } from './ResponsiveStage';
import { RoundState } from './RoundState';
import { SceneRenderer } from './SceneRenderer';
import { StateMachine, type GameState } from './StateMachine';
import { Turret } from './Turret';
import { UI } from './UI';
import { VFX } from './VFX';
import type { Difficulty, LevelDef, Quality, QuestionGeometry, Settings } from './types';

const SETTINGS_KEY = 'angle-defense-settings';
const BEST_KEY = 'angle-defense-best';

interface PendingShot {
  index: number;
  value: number;
  bearing: number;
  correct: boolean;
}

/** Distance from the turret to the edge of the spawn rectangle along a bearing. */
export function spawnDistance(bearing: number): number {
  const c = Math.cos((bearing * Math.PI) / 180), s = Math.sin((bearing * Math.PI) / 180);
  const tx = c > 1e-6 ? (SPAWN_RECT.right - TURRET.x) / c : c < -1e-6 ? (SPAWN_RECT.left - TURRET.x) / c : Infinity;
  const ty = s > 1e-6 ? (SPAWN_RECT.bottom - TURRET.y) / s : s < -1e-6 ? (SPAWN_RECT.top - TURRET.y) / s : Infinity;
  return Math.min(tx, ty, 640);
}

export class Game {
  readonly sm = new StateMachine();
  readonly round = new RoundState();
  readonly audio = new AudioEngine();
  readonly overlay = new GeometryOverlay();
  readonly vfx: VFX;
  readonly ui: UI;
  readonly turret: Turret;
  readonly rs: ResponsiveStage;
  private scene: SceneRenderer;
  private worldCtx: CanvasRenderingContext2D;
  private fxCtx: CanvasRenderingContext2D;
  private playfield: HTMLElement;
  private aura: HTMLElement;
  private toastLayer: HTMLElement;

  meteor: Meteor | null = null;
  projectile: Projectile | null = null;
  level!: LevelDef;
  levelIndex = 0;
  geo: QuestionGeometry | null = null;
  private levels: LevelDef[] = curatedLevels();
  private shot: PendingShot | null = null;
  private chargeT = -1;
  private aimT = 0;
  private inactivity = 0;
  private tutorShown = false;
  private emberAcc = 0;
  private hitStop = 0;
  private paused = false;
  private hidden = false;
  private raf = 0;
  private last = 0;
  private rng = mulberry32(2026);
  private reduced = false;
  private best = 0;
  /** QA / slow-motion hook (1 = real time). */
  timeScale = 1;
  settings: Settings;
  private cleanup: (() => void)[] = [];

  constructor(private stage: HTMLElement, viewport: HTMLElement, private assets: Assets) {
    this.settings = this.loadSettings();
    this.best = this.loadBest();
    this.rs = new ResponsiveStage(viewport, stage);
    this.rs.dprCap = this.settings.quality === 'high' ? 2 : this.settings.quality === 'medium' ? 1.5 : 1;
    this.worldCtx = this.rs.addCanvas(stage.querySelector('#world-canvas')!);
    this.fxCtx = this.rs.addCanvas(stage.querySelector('#fx-canvas')!);
    this.playfield = stage.querySelector('#playfield')!;
    this.aura = stage.querySelector('#meteor-aura')!;
    this.toastLayer = stage.querySelector('#float-layer')!;
    this.scene = new SceneRenderer(stage, this.settings.quality);
    this.vfx = new VFX(stage.querySelector('#fx-dom')!);
    this.vfx.quality = this.settings.quality;
    this.turret = new Turret(stage.querySelector('#turret')!, assets.base, assets.barrel, 204);

    this.ui = new UI(stage, {
      onPlay: () => this.play(),
      onOption: (i) => this.choose(i),
      onOptionHover: () => this.audio.hover(),
      onHint: () => this.hint(),
      onPauseToggle: () => this.togglePause(),
      onRestart: () => this.restart(),
      onMuteToggle: () => this.ui.setMuted(this.audio.toggleMute()),
      onVolume: (v) => {
        this.audio.setVolume(v);
        if (this.audio.muted && v > 0) this.ui.setMuted(this.audio.toggleMute());
      },
      onDifficulty: (d) => this.setDifficulty(d),
      onQuality: (q) => this.setQuality(q),
    });
    this.ui.onScoreTick = () => this.audio.scoreTick();
    this.ui.setMuted(this.audio.muted);
    this.ui.setVolume(this.audio.volume);
    this.ui.setDifficulty(this.settings.difficulty);
    this.ui.setQuality(this.settings.quality);
    this.ui.setLives(this.round.lives);
    this.ui.setScore(0, true);

    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.reduced = this.vfx.reducedMotion = mq.matches;
    const onMq = () => (this.reduced = this.vfx.reducedMotion = mq.matches);
    mq.addEventListener('change', onMq);
    this.cleanup.push(() => mq.removeEventListener('change', onMq));

    this.listen(window, 'keydown', (e) => this.onKey(e as KeyboardEvent));
    this.listen(document, 'visibilitychange', () => this.onVisibility());
    this.listen(window, 'blur', () => {
      if (this.isActive()) this.setPaused(true);
    });

    this.sm.onEnter = (s, prev) => this.onEnter(s, prev);
    this.enterTitle();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private listen(t: EventTarget, ev: string, fn: (e: Event) => void): void {
    t.addEventListener(ev, fn);
    this.cleanup.push(() => t.removeEventListener(ev, fn));
  }

  // ================================================================ flow
  private enterTitle(): void {
    this.sm.reset();
    this.sm.go('TITLE');
  }

  /** Is a mission in progress (not title/end screens)? */
  isActive(): boolean {
    return !this.sm.is('BOOT', 'TITLE', 'WON', 'GAME_OVER');
  }

  play(): void {
    if (!this.sm.is('TITLE')) return;
    this.audio.unlock();
    this.audio.startup();
    this.ui.showTitle(false);
    this.ui.setPlaying(true);
    this.sm.go('SPAWNING');
  }

  restart(): void {
    this.audio.unlock();
    this.setPaused(false, true);
    this.sm.clearTimers();
    this.round.reset();
    this.levels = curatedLevels();
    this.levelIndex = 0;
    this.rng = mulberry32(2026);
    this.tutorShown = false;
    this.projectile = null;
    this.shot = null;
    this.vfx.clear();
    this.overlay.set(null);
    this.ui.hideToast();
    this.ui.showEnd(null);
    this.ui.setLives(this.round.lives);
    this.ui.setScore(0, true);
    this.meteor = null;
    this.sm.reset();
    this.sm.go('TITLE');
    this.play();
  }

  private loadLevel(index: number, bearingOverride?: number): void {
    if (index >= this.levels.length) {
      const prev = this.levels[this.levels.length - 1];
      this.levels.push(generateMasteryLevel(index + 1, this.rng, prev?.targetBearingDeg));
    }
    let lvl = this.levels[index];
    if (bearingOverride !== undefined) {
      const answer = answerFor(lvl.relation, lvl.knownDeg);
      lvl = { ...lvl, targetBearingDeg: bearingOverride, turnSign: preferredTurnSign(bearingOverride, answer) };
      this.levels[index] = lvl;
    }
    this.level = lvl;
    this.geo = buildGeometry(lvl.knownDeg, lvl.relation, lvl.targetBearingDeg, lvl.turnSign);
    this.ui.setOptions(lvl.options);
    this.ui.setLevel(lvl.label, index + 1, TOTAL_LEVELS, lvl.relation === 'linear-pair' ? 'linear pair' : 'vertically opposite angles');
  }

  private journeyTime(): number {
    return Math.max(9, 14 - 0.55 * this.level.speedTier);
  }

  private spawnMeteor(skipEntry: boolean): void {
    const b = this.level.targetBearingDeg;
    const d = spawnDistance(b) * 0.95;
    this.meteor = new Meteor(b, d, this.journeyTime(), { calm: this.settings.difficulty === 'calm', skipEntry });
  }

  private onEnter(s: GameState, _prev: GameState): void {
    switch (s) {
      case 'TITLE': {
        // Static "first frame" that mirrors the reference layout: L1 meteor parked upper-left,
        // barrel tracking it, the four L1 options visible but inactive.
        this.levelIndex = 0;
        this.loadLevel(0);
        this.spawnMeteor(true);
        this.meteor!.speed = this.meteor!.speedTarget = 0;
        this.turret.snap(this.meteor!.bearing);
        this.overlay.set(null);
        this.ui.setOptionsEnabled(false);
        this.ui.setHintEnabled(false);
        this.ui.showTitle(true);
        this.ui.setPlaying(false);
        break;
      }
      case 'SPAWNING': {
        this.round.beginRound(this.level.relation);
        this.ui.setOptionsEnabled(false);
        this.ui.setHintEnabled(false);
        if (!this.meteor) this.spawnMeteor(false);
        this.meteor!.speedTarget = 1;
        this.turret.aimAt(this.meteor!.bearing);
        this.overlay.set(this.geo);
        this.overlay.targetIntensity = 0;
        break;
      }
      case 'QUESTION_ACTIVE': {
        this.round.unlock();
        this.inactivity = 0;
        this.overlay.geo = this.geo;
        this.overlay.targetIntensity = 0.7;
        this.turret.aimAt(this.geo!.referenceRayBearingDeg);
        this.ui.setOptionsEnabled(true, this.round.eliminated);
        this.ui.setHintEnabled(true);
        if (this.meteor) this.meteor.speedTarget = 1;
        break;
      }
      case 'AIMING':
        this.aimT = 0;
        this.chargeT = -1;
        this.ui.setOptionsEnabled(false, this.round.eliminated);
        this.ui.setHintEnabled(false);
        this.overlay.targetIntensity = 0.55;
        break;
      case 'FIRING':
        this.overlay.targetIntensity = 0.2;
        break;
      case 'HIT':
        this.overlay.targetIntensity = 0;
        this.sm.after(0.55, () => this.sm.go('EXPLANATION'));
        break;
      case 'EXPLANATION':
        this.ui.toast(this.explanation(), 'good', 1.6);
        this.sm.after(1.0, () => this.sm.go('NEXT_WAVE'));
        break;
      case 'NEXT_WAVE':
        this.levelIndex++;
        this.meteor = null;
        if (this.levelIndex >= TOTAL_LEVELS) {
          this.sm.go('WON');
        } else {
          this.loadLevel(this.levelIndex);
          this.sm.go('SPAWNING');
        }
        break;
      case 'MISS':
        this.sm.after(0.65, () => {
          if (this.sm.is('MISS')) this.sm.go('QUESTION_ACTIVE');
        });
        break;
      case 'IMPACT_RECOVERY':
        this.onImpact();
        break;
      case 'WON':
        this.finish('won');
        break;
      case 'GAME_OVER':
        this.finish('lost');
        break;
      default:
        break;
    }
  }

  private finish(kind: 'won' | 'lost'): void {
    this.ui.setOptionsEnabled(false);
    this.ui.setHintEnabled(false);
    this.ui.setPlaying(false);
    this.overlay.set(null);
    this.audio.silenceLoops();
    if (kind === 'won') this.audio.victory();
    else this.audio.gameOver();
    if (this.round.score > this.best) {
      this.best = this.round.score;
      try {
        localStorage.setItem(BEST_KEY, String(this.best));
      } catch {
        /* ignore */
      }
    }
    const m = this.round.mastery;
    const pct = (r: { correct: number; total: number }) => (r.total ? `${r.correct}/${r.total} first try` : '—');
    this.ui.showEnd(kind, {
      score: this.round.score,
      best: this.best,
      bestCombo: this.round.bestCombo,
      firstTry: this.round.firstTryCorrect,
      rounds: this.round.roundsCleared,
      linear: pct(m['linear-pair']),
      vertical: pct(m.vertical),
    });
  }

  // ================================================================ input
  /** Player picks option `index`. The number becomes a gun bearing. */
  choose(index: number): void {
    if (!this.sm.is('QUESTION_ACTIVE') || this.paused || !this.geo) return;
    const value = this.level.options[index];
    if (!this.round.tryLock(value)) return; // double-click / repeat guard
    this.audio.click(((this.ui.optionButtons[index].offsetLeft + 120) / STAGE_W) * 2 - 1);
    this.ui.pressOption(index);
    const bearing = shotBearing(this.geo.referenceRayBearingDeg, this.geo.turnSign, value);
    this.shot = { index, value, bearing, correct: value === this.geo.answerDeg };
    if (this.meteor) this.meteor.speedTarget = 0; // brief hold for the aim + flight cinematic
    this.turret.aimAt(bearing);
    this.sm.go('AIMING');
  }

  hint(): void {
    if (!this.sm.is('QUESTION_ACTIVE') || !this.geo) return;
    this.overlay.emphasis = 1;
    this.overlay.targetIntensity = 1;
    this.inactivity = 0;
    this.ui.toast(this.hintText(Math.min(2, this.round.wrongThisRound + 1)), 'hint', 3.2);
  }

  private hintText(level: number): string {
    const g = this.geo!;
    const k = `<b class="k">${g.knownDeg}°</b>`;
    const q = '<b class="q">?</b>';
    if (g.relation === 'linear-pair') {
      if (level <= 1) return `Adjacent angles on a straight line add up to <b>180°</b>.`;
      if (level === 2) return `${k} + ${q} = 180°`;
      return `${q} = 180° − ${g.knownDeg}° = <b>${g.answerDeg}°</b>`;
    }
    if (level <= 1) return `Vertically opposite angles are <b>equal</b>.`;
    if (level === 2) return `The ${q} sits directly opposite ${k} across the crossing.`;
    return `Opposite angles are equal → ${q} = <b>${g.answerDeg}°</b>`;
  }

  private explanation(): string {
    const g = this.geo!;
    return g.relation === 'linear-pair'
      ? `${g.knownDeg}° + <b>${g.answerDeg}°</b> = 180° ✓`
      : `Opposite angles are equal → <b>${g.answerDeg}°</b> ✓`;
  }

  private onKey(e: KeyboardEvent): void {
    if (e.repeat && !['1', '2', '3', '4'].includes(e.key)) return;
    const k = e.key;
    if (k >= '1' && k <= '4') {
      if (e.repeat) return;
      this.choose(Number(k) - 1);
      e.preventDefault();
    } else if (k === 'p' || k === 'P' || k === 'Escape') {
      this.togglePause();
    } else if (k === 'm' || k === 'M') {
      this.ui.setMuted(this.audio.toggleMute());
    } else if (k === 'h' || k === 'H') {
      this.hint();
    } else if (k === 'Enter' || k === ' ') {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === 'BUTTON' || tag === 'INPUT') return; // let the focused control act
      if (this.sm.is('TITLE')) this.play();
      else if (this.sm.is('WON', 'GAME_OVER')) this.restart();
      e.preventDefault();
    } else if ((k === 'e' || k === 'E') && import.meta.env.DEV) {
      // dev-only visual QA for the explosion
      const x = 400 + Math.random() * 1100, y = 200 + Math.random() * 500;
      this.vfx.spawnExplosion(x, y, 1);
      this.audio.unlock();
      this.audio.explosion((x / STAGE_W) * 2 - 1);
    }
  }

  togglePause(): void {
    if (!this.isActive()) return;
    this.setPaused(!this.paused);
  }

  private setPaused(p: boolean, silent = false): void {
    if (this.paused === p) return;
    this.paused = p;
    if (!silent) this.ui.showPause(p);
    else this.ui.showPause(false);
    if (p) this.audio.silenceLoops();
    this.stage.classList.toggle('paused', p);
  }

  private onVisibility(): void {
    this.hidden = document.hidden;
    this.audio.setSuspended(this.hidden);
    if (this.hidden && this.isActive()) this.setPaused(true);
    this.last = performance.now();
  }

  private setDifficulty(d: Difficulty): void {
    this.settings.difficulty = d;
    this.saveSettings();
    if (this.meteor) this.meteor.stopAt = d === 'calm' ? Math.max(0.5, this.meteor.progress) : 1;
  }

  private setQuality(q: Quality): void {
    this.settings.quality = q;
    this.saveSettings();
    this.vfx.quality = q;
    this.rs.dprCap = q === 'high' ? 2 : q === 'medium' ? 1.5 : 1;
    this.rs.layout();
    this.scene.rebuildStars(q);
  }

  // ================================================================ shooting
  private fire(): void {
    const shot = this.shot!;
    this.turret.snap(shot.bearing);
    const muzzle = this.turret.muzzle(shot.bearing);
    this.projectile = new Projectile(muzzle, shot.bearing, 1500);
    this.vfx.muzzleFlash(muzzle.x, muzzle.y, shot.bearing);
    this.turret.recoil();
    const pan = (muzzle.x / STAGE_W) * 2 - 1;
    this.audio.fire(pan);
    const end = pointOnBearing(muzzle, shot.bearing, 600);
    this.audio.zip(pan, (end.x / STAGE_W) * 2 - 1, 0.4);
    this.sm.go('FIRING');
  }

  private onHit(): void {
    const m = this.meteor!;
    const p = { ...m.head };
    this.projectile = null;
    m.isExploding = true;
    m.alive = false;
    this.hitStop = 0.04;
    this.vfx.spawnExplosion(p.x, p.y, 1);
    const pan = (p.x / STAGE_W) * 2 - 1;
    this.audio.explosion(pan, 1);
    this.audio.correct();
    this.audio.meteorWhoosh(0, 0, false);
    const r = this.round.registerHit();
    this.ui.setScore(this.round.score);
    this.ui.markCorrect(this.shot!.index);
    const txt = r.firstTry ? `PERFECT INTERCEPT +${r.points}` : `ANGLE CLEARED +${r.points}`;
    this.vfx.floatText(this.toastLayer, p.x, p.y - 70, txt, 'good');
    this.shot = null;
    this.sm.go('HIT');
  }

  private onMiss(at: { x: number; y: number }): void {
    const shot = this.shot!;
    this.projectile = null;
    this.vfx.fizzle(at.x, at.y);
    const pan = (at.x / STAGE_W) * 2 - 1;
    this.audio.fizzle(pan);
    this.audio.wrong(pan * 0.5);
    const n = this.round.registerMiss(shot.value);
    this.ui.markWrong(shot.index);
    this.overlay.ghost(this.geo!.referenceRayBearingDeg, this.geo!.turnSign, shot.value);
    const off = Math.round(angularMiss(shot.bearing, this.geo!.targetBearingDeg));
    const lp = pointOnBearing(TURRET, shot.bearing, 330);
    this.vfx.floatText(this.toastLayer, lp.x, lp.y, `MISALIGNED · ${off}° off`, 'warn');
    this.ui.toast(this.hintText(Math.min(3, n)), 'hint', n >= 2 ? 3.4 : 2.6);
    this.overlay.emphasis = n >= 2 ? 1 : 0.5;
    this.shot = null;
    if (this.meteor) {
      this.meteor.speedTarget = 1;
      this.meteor.surge(0.05);
    }
    this.sm.go('MISS');
  }

  private onImpact(): void {
    const lives = this.round.loseLife();
    this.vfx.shieldHit(TURRET.x, TURRET.y);
    this.audio.shieldHit(lives === 0);
    this.audio.meteorWhoosh(0, 0, false);
    this.ui.setLives(lives, true);
    this.ui.setScore(this.round.score);
    this.ui.setOptionsEnabled(false);
    this.ui.setHintEnabled(false);
    this.ui.toast(lives > 0 ? `SHIELD HIT · ${lives} left — let's try that angle again` : 'SHIELDS DOWN', 'warn', 1.6);
    this.meteor = null;
    this.projectile = null;
    this.shot = null;
    this.overlay.set(null);
    this.stage.classList.remove('shield-hit');
    void this.stage.offsetWidth;
    this.stage.classList.add('shield-hit');
    this.sm.after(lives > 0 ? 1.1 : 1.4, () => {
      if (lives <= 0) {
        this.sm.go('GAME_OVER');
        return;
      }
      // retry the same concept from a new side
      const cur = this.level.targetBearingDeg;
      const choices = SPAWN_BEARINGS.filter((b) => angularMiss(b, cur) > 40);
      this.loadLevel(this.levelIndex, choices[Math.floor(this.rng() * choices.length)]);
      this.sm.go('SPAWNING');
    });
  }

  // ================================================================ loop
  private frame = (ts: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    let dt = (ts - this.last) / 1000;
    this.last = ts;
    if (!(dt > 0)) dt = 0;
    dt = Math.min(dt, 1 / 20) * this.timeScale; // clamp after tab restore / hitches
    if (this.hidden) return;
    if (!this.paused) {
      let gdt = dt;
      if (this.hitStop > 0) {
        this.hitStop -= dt;
        gdt = 0;
      }
      this.update(gdt, dt);
    }
    this.render();
  };

  private update(dt: number, realDt: number): void {
    this.sm.update(dt);
    this.ui.update(realDt);
    this.scene.update(realDt, this.reduced);
    this.overlay.update(dt);
    this.vfx.update(dt);
    const angVel = this.turret.update(dt);
    if (this.isActive()) this.audio.servoUpdate(angVel);

    const m = this.meteor;
    if (m) {
      m.update(dt);
      if (m.alive && this.isActive()) {
        this.emberAcc += dt;
        if (this.emberAcc > 0.06) {
          this.emberAcc = 0;
          this.vfx.ember(m.head.x, m.head.y);
        }
        this.audio.meteorWhoosh(m.progress, (m.head.x / STAGE_W) * 2 - 1, true);
      }
    }

    switch (this.sm.state) {
      case 'SPAWNING':
        if (m) this.turret.aimAt(m.bearing);
        if (m && !m.entering && this.sm.timeInState > 0.45) {
          this.sm.go('QUESTION_ACTIVE');
          if (this.levelIndex === 0 && !this.tutorShown) {
            this.ui.toast('The cannon turns from its <b>reference ray</b> by the angle you pick.', 'info', 3.2);
          }
        }
        break;
      case 'QUESTION_ACTIVE':
        this.inactivity += dt;
        if (this.inactivity > 3 && this.overlay.targetIntensity < 0.85) this.overlay.targetIntensity = 0.85;
        if (this.levelIndex === 0 && !this.tutorShown && this.inactivity > 6) {
          this.tutorShown = true;
          this.ui.toast(`Tip: <b class="k">${this.geo!.knownDeg}°</b> and <b class="q">?</b> sit side by side on one straight line.`, 'hint', 3.4);
          this.overlay.emphasis = 0.8;
        }
        if (m && m.reachedCore) this.sm.go('IMPACT_RECOVERY');
        break;
      case 'MISS':
        if (m && m.reachedCore) this.sm.go('IMPACT_RECOVERY');
        break;
      case 'AIMING':
        this.aimT += dt;
        if (this.chargeT < 0 && this.turret.settled && this.aimT > 0.08) {
          this.chargeT = 0.17;
          const mz = this.turret.muzzle();
          this.vfx.charge(mz.x, mz.y);
          this.audio.charge((mz.x / STAGE_W) * 2 - 1);
          this.stage.classList.add('charging');
        } else if (this.chargeT >= 0) {
          this.chargeT -= dt;
          if (this.chargeT <= 0) {
            this.stage.classList.remove('charging');
            this.fire();
          }
        }
        break;
      case 'FIRING': {
        const p = this.projectile;
        if (!p) break;
        p.update(dt);
        if (m && m.alive && this.geo) {
          const dist = Math.hypot(m.head.x - TURRET.x, m.head.y - TURRET.y);
          const r = safeHitRadius(m.rockRadius, dist, this.level.options, this.geo.answerDeg);
          if (segmentCircleHit(p.prev, p.pos, m.head, r)) {
            this.onHit();
            break;
          }
        }
        const out =
          p.pos.x < FRAME_INNER.left + 12 || p.pos.x > FRAME_INNER.right - 12 ||
          p.pos.y < FRAME_INNER.top + 12 || p.pos.y > FRAME_INNER.bottom - 12;
        if (!p.alive || out) this.onMiss(p.pos);
        break;
      }
      default:
        break;
    }
  }

  private render(): void {
    const w = this.worldCtx, f = this.fxCtx;
    this.rs.clear(w);
    this.rs.clear(f);
    this.overlay.draw(w);
    const m = this.meteor;
    if (m && m.alive) {
      m.draw(w, this.assets.meteor);
      this.aura.style.opacity = String(m.alpha);
      this.aura.style.transform = `translate3d(${m.head.x.toFixed(1)}px, ${m.head.y.toFixed(1)}px, 0) scale(${(m.scale * (0.9 + 0.3 * m.progress)).toFixed(3)})`;
    } else {
      this.aura.style.opacity = '0';
    }
    this.projectile?.draw(f);
    this.vfx.draw(f);
    this.playfield.style.transform =
      this.vfx.shakeX || this.vfx.shakeY ? `translate3d(${this.vfx.shakeX.toFixed(2)}px, ${this.vfx.shakeY.toFixed(2)}px, 0)` : '';
  }

  // ================================================================ persistence
  private loadSettings(): Settings {
    const d: Settings = { volume: 0.62, muted: false, difficulty: 'normal', quality: 'high' };
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s.difficulty === 'calm' || s.difficulty === 'normal') d.difficulty = s.difficulty;
        if (['high', 'medium', 'low'].includes(s.quality)) d.quality = s.quality;
      }
    } catch {
      /* ignore */
    }
    if (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2 && !localStorage.getItem?.(SETTINGS_KEY)) d.quality = 'medium';
    return d;
  }

  private saveSettings(): void {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ difficulty: this.settings.difficulty, quality: this.settings.quality }));
    } catch {
      /* ignore */
    }
  }

  private loadBest(): number {
    try {
      return Number(localStorage.getItem(BEST_KEY)) || 0;
    } catch {
      return 0;
    }
  }

  /** Test / QA hook: current state snapshot. */
  debug() {
    return {
      state: this.sm.state,
      level: this.level?.label,
      answer: this.geo?.answerDeg,
      targetBearing: this.geo?.targetBearingDeg,
      referenceRay: this.geo?.referenceRayBearingDeg,
      barrel: this.turret.angle,
      score: this.round.score,
      lives: this.round.lives,
      meteor: this.meteor ? { ...this.meteor.head, progress: this.meteor.progress, frame: this.meteor.frameIndex } : null,
      particles: this.vfx.activeParticles,
      explosions: this.vfx.explosions,
      bearingToMeteor: this.meteor ? bearingDeg(TURRET, this.meteor.head) : null,
    };
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.sm.clearTimers();
    for (const c of this.cleanup) c();
    this.ui.destroy();
    this.scene.destroy();
    this.rs.destroy();
    this.audio.silenceLoops();
    this.audio.stopAmbient();
  }
}

