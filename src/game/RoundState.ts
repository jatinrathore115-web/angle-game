import type { Relation } from './types';

export const BASE_POINTS = 100;
export const FIRST_TRY_BONUS = 50;
export const COMBO_STEP = 25;
export const MAX_LIVES = 3;

/** Pure scoring / attempt bookkeeping, independent of rendering so it is unit-testable. */
export class RoundState {
  score = 0;
  combo = 0;
  bestCombo = 0;
  lives = MAX_LIVES;
  firstTryCorrect = 0;
  roundsCleared = 0;
  wrongThisRound = 0;
  eliminated = new Set<number>();
  mastery: Record<Relation, { correct: number; total: number }> = {
    'linear-pair': { correct: 0, total: 0 },
    vertical: { correct: 0, total: 0 },
  };
  private locked = false;
  private resolved = false;
  private relation: Relation = 'linear-pair';

  beginRound(relation: Relation, keepAttempts = false): void {
    this.relation = relation;
    this.locked = false;
    this.resolved = false;
    if (!keepAttempts) {
      this.wrongThisRound = 0;
      this.eliminated.clear();
    }
  }

  /** Lock input for a shot. Returns false if already locked (double click / key repeat). */
  tryLock(option: number): boolean {
    if (this.locked || this.resolved || this.eliminated.has(option)) return false;
    this.locked = true;
    return true;
  }

  unlock(): void {
    this.locked = false;
  }

  get isLocked(): boolean {
    return this.locked;
  }

  /** Award points once per round; repeated calls return 0. */
  registerHit(): { points: number; bonus: number; firstTry: boolean } {
    if (this.resolved) return { points: 0, bonus: 0, firstTry: false };
    this.resolved = true;
    const firstTry = this.wrongThisRound === 0;
    this.combo = firstTry ? this.combo + 1 : 1;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    const bonus = (firstTry ? FIRST_TRY_BONUS : 0) + COMBO_STEP * Math.max(0, this.combo - 1);
    const points = BASE_POINTS + bonus;
    this.score += points;
    this.roundsCleared++;
    if (firstTry) this.firstTryCorrect++;
    this.mastery[this.relation].total++;
    if (firstTry) this.mastery[this.relation].correct++;
    return { points, bonus, firstTry };
  }

  registerMiss(option: number): number {
    this.locked = false;
    this.wrongThisRound++;
    this.eliminated.add(option);
    this.combo = 0;
    return this.wrongThisRound;
  }

  /** Meteor reached the core. Returns remaining lives. */
  loseLife(): number {
    if (this.resolved) return this.lives;
    this.resolved = true;
    this.lives = Math.max(0, this.lives - 1);
    this.combo = 0;
    this.mastery[this.relation].total++;
    return this.lives;
  }

  reset(): void {
    this.score = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.lives = MAX_LIVES;
    this.firstTryCorrect = 0;
    this.roundsCleared = 0;
    this.wrongThisRound = 0;
    this.eliminated.clear();
    this.mastery = { 'linear-pair': { correct: 0, total: 0 }, vertical: { correct: 0, total: 0 } };
    this.locked = false;
    this.resolved = false;
  }
}
