import type { Difficulty, Quality } from './types';

export interface UIHandlers {
  onPlay(): void;
  onOption(index: number): void;
  onOptionHover(): void;
  onHint(): void;
  onPauseToggle(): void;
  onRestart(): void;
  onMuteToggle(): void;
  onVolume(v: number): void;
  onDifficulty(d: Difficulty): void;
  onQuality(q: Quality): void;
}

export interface EndStats {
  score: number;
  best: number;
  bestCombo: number;
  firstTry: number;
  rounds: number;
  linear: string;
  vertical: string;
}

const $ = <T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string) => root.querySelector<T>(sel)!;

/** All DOM UI: HUD, the four answer buttons, overlays and a screen-reader live region. Buttons stay crisp DOM text. */
export class UI {
  readonly optionButtons: HTMLButtonElement[];
  private scoreEl: HTMLElement;
  private shownScore = 0;
  private targetScore = 0;
  private tickAcc = 0;
  private liveEl: HTMLElement;
  onScoreTick?: () => void;
  private cleanup: (() => void)[] = [];

  constructor(private stage: HTMLElement, private h: UIHandlers) {
    this.optionButtons = [...stage.querySelectorAll<HTMLButtonElement>('#options .opt')];
    this.scoreEl = $(stage, '#hud-score-value');
    this.liveEl = $(stage, '#sr-live');
    this.optionButtons.forEach((b, i) => {
      this.on(b, 'click', () => this.h.onOption(i));
      this.on(b, 'pointerenter', (e) => {
        if ((e as PointerEvent).pointerType === 'mouse' && !b.disabled) this.h.onOptionHover();
      });
      this.on(b, 'focus', () => {
        if (!b.disabled && b.matches(':focus-visible')) this.h.onOptionHover();
      });
    });
    this.on($(stage, '#btn-play'), 'click', () => this.h.onPlay());
    this.on($(stage, '#btn-hint'), 'click', () => this.h.onHint());
    this.on($(stage, '#btn-resume'), 'click', () => this.h.onPauseToggle());
    this.on($(stage, '#btn-pause-restart'), 'click', () => this.h.onRestart());
    this.on($(stage, '#btn-retry'), 'click', () => this.h.onRestart());
    this.on($(stage, '#btn-end-sound'), 'click', () => this.h.onMuteToggle());
    this.on($(stage, '#vol'), 'input', (e) => this.h.onVolume(Number((e.target as HTMLInputElement).value) / 100));
    this.on($(stage, '#set-mute'), 'change', () => this.h.onMuteToggle());
    for (const el of stage.querySelectorAll<HTMLInputElement>('input[data-setting="difficulty"]')) {
      this.on(el, 'change', () => el.checked && this.h.onDifficulty(el.value as Difficulty));
    }
    for (const el of stage.querySelectorAll<HTMLInputElement>('input[data-setting="quality"]')) {
      this.on(el, 'change', () => el.checked && this.h.onQuality(el.value as Quality));
    }
  }

  private on(el: EventTarget, ev: string, fn: (e: Event) => void): void {
    el.addEventListener(ev, fn);
    this.cleanup.push(() => el.removeEventListener(ev, fn));
  }

  // ------------------------------------------------------------ loading / overlays
  setLoading(done: number, total: number): void {
    const pct = Math.round((done / total) * 100);
    $(this.stage, '#load-bar').style.transform = `scaleX(${done / total})`;
    $(this.stage, '#load-text').textContent = `Loading assets… ${pct}%`;
  }

  setLoadError(msg: string): void {
    $(this.stage, '#load-text').textContent = `⚠ ${msg}. Check your connection and reload.`;
    $(this.stage, '#title-card').classList.add('error');
  }

  setReady(): void {
    $(this.stage, '#title-card').classList.add('ready');
    const play = $<HTMLButtonElement>(this.stage, '#btn-play');
    // No auto-focus: it would paint a focus ring for mouse/touch players.
    // Keyboard players can Tab to it, or just press Enter/Space (handled in Game.onKey).
    play.disabled = false;
  }

  showTitle(show: boolean): void {
    this.toggleOverlay('#title-overlay', show);
    this.stage.classList.toggle('in-title', show);
  }

  showPause(show: boolean): void {
    this.toggleOverlay('#pause-overlay', show);
    if (show) $(this.stage, '#btn-resume').focus({ preventScroll: true });
  }

  showEnd(kind: 'won' | 'lost' | null, s?: EndStats): void {
    this.toggleOverlay('#end-overlay', kind !== null);
    if (!kind || !s) return;
    $(this.stage, '#end-title').textContent = kind === 'won' ? 'MISSION COMPLETE' : 'SHIELDS DOWN';
    $(this.stage, '#end-sub').textContent =
      kind === 'won' ? 'Every meteor intercepted. The station is safe.' : 'The station needs another pilot run. Your angles are getting sharper!';
    $(this.stage, '#end-stats').innerHTML = `
      <div><span>Score</span><b>${s.score}</b></div>
      <div><span>Best</span><b>${s.best}</b></div>
      <div><span>Best combo</span><b>×${s.bestCombo}</b></div>
      <div><span>First-try hits</span><b>${s.firstTry}/${s.rounds}</b></div>
      <div><span>Linear pairs</span><b>${s.linear}</b></div>
      <div><span>Vertically opposite</span><b>${s.vertical}</b></div>`;
    this.stage.querySelector<HTMLElement>('#end-card')!.classList.toggle('won', kind === 'won');
    $(this.stage, '#btn-retry').focus({ preventScroll: true });
  }

  private toggleOverlay(sel: string, show: boolean): void {
    const el = $(this.stage, sel);
    el.classList.toggle('show', show);
    el.setAttribute('aria-hidden', String(!show));
    (el as HTMLElement & { inert: boolean }).inert = !show;
    // While any full-screen overlay is open, the gameplay UI behind it must not be
    // reachable by Tab or assistive tech (it is covered and meaningless there).
    const anyOpen = !!this.stage.querySelector('.overlay.show');
    for (const s of ['#hud', '#options']) (this.stage.querySelector(s) as HTMLElement & { inert: boolean }).inert = anyOpen;
  }

  setPlaying(playing: boolean): void {
    this.stage.classList.toggle('playing', playing);
  }

  // ------------------------------------------------------------ HUD
  setLevel(label: string, index: number, total: number, relation: string): void {
    $(this.stage, '#hud-level').textContent = label;
    $(this.stage, '#hud-progress').textContent = `${index}/${total}`;
    $(this.stage, '#hud-level-wrap').setAttribute('aria-label', `Level ${label}, ${relation}`);
  }

  setLives(n: number, lost = false): void {
    const leds = this.stage.querySelectorAll<HTMLElement>('#hud-lives .led');
    leds.forEach((l, i) => {
      const on = i < n;
      if (!on && lost && i === n) {
        l.classList.remove('lost');
        void l.offsetWidth;
        l.classList.add('lost');
      }
      l.classList.toggle('on', on);
    });
    $(this.stage, '#hud-lives').setAttribute('aria-label', `${n} shields left`);
  }

  setScore(n: number, instant = false): void {
    this.targetScore = n;
    if (instant) {
      this.shownScore = n;
      this.scoreEl.textContent = String(n);
    }
  }

  setMuted(m: boolean): void {
    $<HTMLInputElement>(this.stage, '#set-mute').checked = m;
    $(this.stage, '#btn-end-sound').textContent = m ? 'SOUND: OFF' : 'SOUND: ON';
  }

  setVolume(v: number): void {
    $<HTMLInputElement>(this.stage, '#vol').value = String(Math.round(v * 100));
  }

  setDifficulty(d: Difficulty): void {
    for (const el of this.stage.querySelectorAll<HTMLInputElement>('input[data-setting="difficulty"]')) el.checked = el.value === d;
  }

  setQuality(q: Quality): void {
    for (const el of this.stage.querySelectorAll<HTMLInputElement>('input[data-setting="quality"]')) el.checked = el.value === q;
  }

  setHintEnabled(on: boolean): void {
    $<HTMLButtonElement>(this.stage, '#btn-hint').disabled = !on;
  }

  // ------------------------------------------------------------ options
  setOptions(values: number[]): void {
    this.optionButtons.forEach((b, i) => {
      b.className = 'opt';
      b.querySelector('.opt-label')!.textContent = `${values[i]}°`;
      b.setAttribute('aria-label', `Answer ${i + 1}: ${values[i]} degrees`);
      b.dataset.value = String(values[i]);
    });
  }

  setOptionsEnabled(on: boolean, eliminated: Set<number> = new Set()): void {
    this.stage.classList.toggle('options-locked', !on);
    this.optionButtons.forEach((b) => {
      const elim = eliminated.has(Number(b.dataset.value));
      b.disabled = !on || elim;
      b.classList.toggle('eliminated', elim);
    });
  }

  pressOption(i: number): void {
    this.flashClass(this.optionButtons[i], 'pressed');
  }

  markWrong(i: number): void {
    this.flashClass(this.optionButtons[i], 'wrong');
  }

  markCorrect(i: number): void {
    this.flashClass(this.optionButtons[i], 'correct');
  }

  private flashClass(el: HTMLElement, cls: string): void {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  // ------------------------------------------------------------ screen-reader announcements
  /**
   * Gameplay never shows sentence banners; the maths is drawn in the diagram.
   * Assistive tech still gets the words through a visually hidden live region.
   */
  announce(text: string): void {
    this.liveEl.textContent = '';
    window.setTimeout(() => (this.liveEl.textContent = text), 30); // re-announce identical text
  }

  clearAnnouncement(): void {
    this.liveEl.textContent = '';
  }

  update(dt: number): void {
    if (this.shownScore !== this.targetScore) {
      const diff = this.targetScore - this.shownScore;
      const step = Math.sign(diff) * Math.max(1, Math.ceil(Math.abs(diff) * Math.min(1, dt * 8)));
      this.shownScore = Math.abs(step) >= Math.abs(diff) ? this.targetScore : this.shownScore + step;
      this.scoreEl.textContent = String(this.shownScore);
      this.tickAcc += dt;
      if (this.tickAcc > 0.06) {
        this.tickAcc = 0;
        this.onScoreTick?.();
      }
      this.scoreEl.parentElement!.classList.add('counting');
    } else {
      this.scoreEl.parentElement!.classList.remove('counting');
    }
  }

  destroy(): void {
    for (const c of this.cleanup) c();
    this.cleanup = [];
  }
}
