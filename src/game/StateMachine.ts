export type GameState =
  | 'BOOT'
  | 'TITLE'
  | 'SPAWNING'
  | 'QUESTION_ACTIVE'
  | 'AIMING'
  | 'FIRING'
  | 'HIT'
  | 'MISS'
  | 'IMPACT_RECOVERY'
  | 'EXPLANATION'
  | 'NEXT_WAVE'
  | 'WON'
  | 'GAME_OVER';

const ALLOWED: Record<GameState, GameState[]> = {
  BOOT: ['TITLE'],
  TITLE: ['SPAWNING'],
  SPAWNING: ['QUESTION_ACTIVE', 'TITLE'],
  QUESTION_ACTIVE: ['AIMING', 'IMPACT_RECOVERY', 'TITLE'],
  AIMING: ['FIRING', 'TITLE'],
  FIRING: ['HIT', 'MISS', 'IMPACT_RECOVERY', 'TITLE'],
  HIT: ['EXPLANATION', 'TITLE'],
  MISS: ['QUESTION_ACTIVE', 'IMPACT_RECOVERY', 'TITLE'],
  IMPACT_RECOVERY: ['SPAWNING', 'GAME_OVER', 'TITLE'],
  EXPLANATION: ['NEXT_WAVE', 'TITLE'],
  NEXT_WAVE: ['SPAWNING', 'WON', 'TITLE'],
  WON: ['TITLE', 'SPAWNING'],
  GAME_OVER: ['TITLE', 'SPAWNING'],
};

/** Tiny explicit state machine with game-time timers (pausing freezes timers too). */
export class StateMachine {
  state: GameState = 'BOOT';
  timeInState = 0;
  private timers: { at: number; fn: () => void; token: number }[] = [];
  private clock = 0;
  private token = 0;
  onEnter?: (s: GameState, prev: GameState) => void;

  go(next: GameState): void {
    if (!ALLOWED[this.state].includes(next)) {
      throw new Error(`Illegal transition ${this.state} -> ${next}`);
    }
    const prev = this.state;
    this.state = next;
    this.timeInState = 0;
    this.onEnter?.(next, prev);
  }

  is(...s: GameState[]): boolean {
    return s.includes(this.state);
  }

  /** Run `fn` after `sec` of game time, only if still in the same state token. */
  after(sec: number, fn: () => void): void {
    this.timers.push({ at: this.clock + sec, fn, token: this.token });
  }

  /** Cancel all pending timers (restart / reset). */
  clearTimers(): void {
    this.timers = [];
    this.token++;
  }

  update(dt: number): void {
    this.clock += dt;
    this.timeInState += dt;
    if (!this.timers.length) return;
    const due = this.timers.filter((t) => t.at <= this.clock && t.token === this.token);
    this.timers = this.timers.filter((t) => t.at > this.clock && t.token === this.token);
    for (const t of due) t.fn();
  }

  reset(): void {
    this.clearTimers();
    this.state = 'BOOT';
    this.timeInState = 0;
  }
}
