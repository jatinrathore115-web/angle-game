/**
 * Procedural, original sound design on the Web Audio API. No sample files.
 * Graph:  voices -> sfx / ambient buses -> master -> compressor/limiter -> destination
 *                      sfx -> reverb send (generated impulse) -> master
 * Every public method is safe to call before unlock, while muted, or where Web
 * Audio is unavailable: it simply does nothing.
 */
type Ctx = AudioContext;

const STORAGE_KEY = 'angle-defense-audio';

export class AudioEngine {
  ctx: Ctx | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private ambient!: GainNode;
  private reverbSend!: GainNode;
  private white!: AudioBuffer;
  private pink!: AudioBuffer;
  private ambientNodes: AudioScheduledSourceNode[] = [];
  private servo: { osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private whoosh: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode; pan: StereoPannerNode } | null = null;
  private lastHover = 0;
  volume = 0.62;
  muted = false;

  constructor() {
    try {
      const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (typeof s.volume === 'number') this.volume = Math.min(1, Math.max(0, s.volume));
        if (typeof s.muted === 'boolean') this.muted = s.muted;
      }
    } catch {
      /* storage unavailable: defaults */
    }
  }

  /** Must be called from a user gesture. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const AC: typeof AudioContext | undefined =
          (globalThis as any).AudioContext || (globalThis as any).webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC({ latencyHint: 'interactive' });
        this.build();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  private build(): void {
    const c = this.ctx!;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 8;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    const limiter = c.createDynamicsCompressor();
    limiter.threshold.value = -2;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.08;
    this.master = c.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(comp).connect(limiter).connect(c.destination);
    this.sfx = c.createGain();
    this.sfx.gain.value = 0.9;
    this.sfx.connect(this.master);
    this.ambient = c.createGain();
    this.ambient.gain.value = 0.16;
    this.ambient.connect(this.master);
    // generated room reverb
    const conv = c.createConvolver();
    conv.buffer = this.impulse(1.6, 2.6);
    this.reverbSend = c.createGain();
    this.reverbSend.gain.value = 0.22;
    this.reverbSend.connect(conv).connect(this.master);
    this.white = this.noiseBuffer(false);
    this.pink = this.noiseBuffer(true);
  }

  private impulse(sec: number, decay: number): AudioBuffer {
    const c = this.ctx!;
    const len = Math.floor(c.sampleRate * sec);
    const buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  private noiseBuffer(pink: boolean): AudioBuffer {
    const c = this.ctx!;
    const len = c.sampleRate * 2;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (pink) {
        b0 = 0.99765 * b0 + w * 0.099046;
        b1 = 0.963 * b1 + w * 0.2965164;
        b2 = 0.57 * b2 + w * 1.0526913;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
      } else d[i] = w;
    }
    return buf;
  }

  private get ok(): boolean {
    return !!this.ctx && this.ctx.state !== 'closed';
  }

  // ------------------------------------------------------------ settings
  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    this.applyMaster();
    this.save();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyMaster();
    this.save();
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  private applyMaster(): void {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, t, 0.03);
  }

  private save(): void {
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify({ volume: this.volume, muted: this.muted }));
    } catch {
      /* ignore */
    }
  }

  /** Hidden tab: suspend everything; visible again: resume. */
  setSuspended(s: boolean): void {
    if (!this.ok) return;
    try {
      if (s) void this.ctx!.suspend();
      else void this.ctx!.resume();
    } catch {
      /* ignore */
    }
  }

  // ------------------------------------------------------------ primitives
  private out(pan: number, reverb = 0): AudioNode {
    const c = this.ctx!;
    const p = c.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(this.sfx);
    if (reverb > 0) {
      const s = c.createGain();
      s.gain.value = reverb;
      p.connect(s).connect(this.reverbSend);
    }
    return p;
  }

  private tone(
    type: OscillatorType, f0: number, f1: number, t: number, dur: number, peak: number,
    dest: AudioNode, attack = 0.004, curve: 'exp' | 'lin' = 'exp',
  ): void {
    const c = this.ctx!;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (curve === 'exp') o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    else o.frequency.linearRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noise(
    t: number, dur: number, type: BiquadFilterType, f0: number, f1: number, q: number, peak: number,
    dest: AudioNode, attack = 0.003, pink = false,
  ): void {
    const c = this.ctx!;
    const s = c.createBufferSource();
    s.buffer = pink ? this.pink : this.white;
    s.loop = true;
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(dest);
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur + 0.05);
  }

  private now(offset = 0): number {
    return this.ctx!.currentTime + offset;
  }

  // ------------------------------------------------------------ events
  startup(): void {
    if (!this.ok) return;
    const t = this.now(0.02), d = this.out(0, 0.4);
    this.tone('sawtooth', 55, 110, t, 0.9, 0.12, this.lowpass(d, 600, t, 1400));
    this.tone('triangle', 110, 220, t + 0.05, 0.8, 0.12, d);
    this.tone('sine', 330, 440, t + 0.25, 0.6, 0.06, d);
    this.noise(t, 0.7, 'bandpass', 300, 2400, 2, 0.05, d, 0.2, true);
    this.startAmbient();
  }

  private lowpass(dest: AudioNode, f0: number, t: number, f1: number): AudioNode {
    const f = this.ctx!.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(f0, t);
    f.frequency.linearRampToValueAtTime(f1, t + 0.6);
    f.connect(dest);
    return f;
  }

  /** Very quiet machine-hum pad: detuned low saws through a breathing low-pass + pink air. */
  startAmbient(): void {
    if (!this.ok || this.ambientNodes.length) return;
    const c = this.ctx!;
    const t = c.currentTime;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 260;
    lp.Q.value = 3;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 3);
    lp.connect(g).connect(this.ambient);
    for (const [f, type] of [[55, 'sawtooth'], [55.4, 'sawtooth'], [82.5, 'triangle'], [110.2, 'sine']] as [number, OscillatorType][]) {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const og = c.createGain();
      og.gain.value = type === 'sine' ? 0.18 : 0.12;
      o.connect(og).connect(lp);
      o.start(t);
      this.ambientNodes.push(o);
    }
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoG = c.createGain();
    lfoG.gain.value = 110;
    lfo.connect(lfoG).connect(lp.frequency);
    lfo.start(t);
    this.ambientNodes.push(lfo);
    const air = c.createBufferSource();
    air.buffer = this.pink;
    air.loop = true;
    const af = c.createBiquadFilter();
    af.type = 'bandpass';
    af.frequency.value = 500;
    af.Q.value = 0.7;
    const ag = c.createGain();
    ag.gain.value = 0.09;
    air.connect(af).connect(ag).connect(g);
    air.start(t);
    this.ambientNodes.push(air);
  }

  stopAmbient(): void {
    for (const n of this.ambientNodes) {
      try { n.stop(); } catch { /* already stopped */ }
    }
    this.ambientNodes = [];
  }

  /** Continuous meteor whoosh; call update every frame with proximity 0..1 and pan. */
  meteorWhoosh(proximity: number, pan: number, active: boolean): void {
    if (!this.ok) return;
    const c = this.ctx!;
    if (active && !this.whoosh) {
      const src = c.createBufferSource();
      src.buffer = this.pink;
      src.loop = true;
      const filter = c.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 1.2;
      filter.frequency.value = 500;
      const gain = c.createGain();
      gain.gain.value = 0.0001;
      const p = c.createStereoPanner();
      src.connect(filter).connect(gain).connect(p).connect(this.sfx);
      src.start();
      this.whoosh = { src, gain, filter, pan: p };
    }
    if (!this.whoosh) return;
    const t = c.currentTime;
    if (!active) {
      this.whoosh.gain.gain.setTargetAtTime(0.0001, t, 0.08);
      const w = this.whoosh;
      this.whoosh = null;
      try { w.src.stop(t + 0.5); } catch { /* ignore */ }
      return;
    }
    this.whoosh.gain.gain.setTargetAtTime(0.025 + proximity * 0.09, t, 0.15);
    this.whoosh.filter.frequency.setTargetAtTime(380 + proximity * 900, t, 0.2);
    this.whoosh.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), t, 0.2);
    // faint crackles
    if (Math.random() < 0.05 + proximity * 0.08) {
      const d = this.out(pan);
      this.noise(this.now(), 0.03 + Math.random() * 0.03, 'highpass', 2500, 3500, 0.8, 0.02 + proximity * 0.03, d, 0.002);
    }
  }

  hover(): void {
    if (!this.ok) return;
    const n = performance.now();
    if (n - this.lastHover < 90) return;
    this.lastHover = n;
    const d = this.out(0);
    this.tone('sine', 2400, 2000, this.now(), 0.05, 0.035, d, 0.002);
  }

  /** small mechanical "tik-thunk" */
  click(pan = 0): void {
    if (!this.ok) return;
    const t = this.now(), d = this.out(pan, 0.1);
    this.noise(t, 0.025, 'highpass', 3000, 5000, 1, 0.12, d, 0.001);
    this.tone('square', 1800, 900, t, 0.03, 0.04, d, 0.001);
    this.tone('sine', 180, 70, t + 0.035, 0.09, 0.22, d, 0.003);
    this.noise(t + 0.035, 0.06, 'lowpass', 900, 300, 1, 0.08, d, 0.002);
  }

  /** Servo whirr follows angular velocity; silent when idle. */
  servoUpdate(angVel: number): void {
    if (!this.ok) return;
    const c = this.ctx!;
    const t = c.currentTime;
    const level = Math.min(1, angVel / 480);
    if (level > 0.02 && !this.servo) {
      const osc = c.createOscillator();
      osc.type = 'sawtooth';
      const osc2 = c.createOscillator();
      osc2.type = 'square';
      const filter = c.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 4;
      const gain = c.createGain();
      gain.gain.value = 0.0001;
      osc.connect(filter);
      const g2 = c.createGain();
      g2.gain.value = 0.3;
      osc2.connect(g2).connect(filter);
      filter.connect(gain).connect(this.sfx);
      osc.start();
      osc2.start();
      this.servo = { osc, osc2, gain, filter };
    }
    if (!this.servo) return;
    if (level <= 0.02) {
      this.servo.gain.gain.setTargetAtTime(0.0001, t, 0.03);
      const s = this.servo;
      this.servo = null;
      try { s.osc.stop(t + 0.2); s.osc2.stop(t + 0.2); } catch { /* ignore */ }
      return;
    }
    this.servo.osc.frequency.setTargetAtTime(90 + level * 160, t, 0.03);
    this.servo.osc2.frequency.setTargetAtTime(45 + level * 60, t, 0.03);
    this.servo.filter.frequency.setTargetAtTime(700 + level * 1300, t, 0.03);
    this.servo.gain.gain.setTargetAtTime(0.03 + level * 0.05, t, 0.03);
  }

  /** 120-220ms rising capacitor sweep + metallic buzz. */
  charge(pan = 0): void {
    if (!this.ok) return;
    const t = this.now(), d = this.out(pan, 0.1);
    this.tone('sawtooth', 220, 1400, t, 0.19, 0.05, d, 0.02);
    this.tone('sine', 440, 2600, t, 0.19, 0.05, d, 0.02);
    this.noise(t, 0.18, 'bandpass', 800, 4000, 6, 0.04, d, 0.05);
  }

  /** Multilayer THOOM-PSHH: sub thump, transient, laser hiss, mechanical clack. */
  fire(pan = 0): void {
    if (!this.ok) return;
    const t = this.now(), d = this.out(pan * 0.6, 0.25);
    this.tone('sine', 110, 48, t, 0.18, 0.75, d, 0.002);
    this.tone('triangle', 200, 60, t, 0.12, 0.3, d, 0.002);
    this.noise(t, 0.09, 'bandpass', 2600, 900, 0.9, 0.45, d, 0.001);
    this.noise(t + 0.01, 0.25, 'highpass', 6000, 3500, 0.7, 0.08, d, 0.01);
    this.tone('sawtooth', 1600, 400, t + 0.005, 0.22, 0.05, d, 0.003);
    this.noise(t + 0.06, 0.035, 'highpass', 2000, 3000, 2, 0.14, d, 0.001);
    this.tone('square', 600, 300, t + 0.06, 0.03, 0.05, d, 0.001);
  }

  /** Quiet Doppler-ish zip panned along the flight. */
  zip(panFrom: number, panTo: number, dur: number): void {
    if (!this.ok) return;
    const c = this.ctx!;
    const t = c.currentTime;
    const p = c.createStereoPanner();
    p.pan.setValueAtTime(clampPan(panFrom), t);
    p.pan.linearRampToValueAtTime(clampPan(panTo), t + dur);
    p.connect(this.sfx);
    this.tone('sine', 1800, 700, t, dur, 0.05, p, 0.01);
    this.noise(t, dur, 'bandpass', 3000, 1200, 3, 0.04, p, 0.02);
  }

  /** Hit: crack/sizzle first, then the deep body ~30ms later, crunchy burst, warm rumble. */
  explosion(pan = 0, intensity = 1): void {
    if (!this.ok) return;
    const t = this.now(), d = this.out(pan * 0.7, 0.35);
    const k = Math.min(1.2, intensity);
    this.noise(t, 0.06, 'highpass', 4000, 2500, 0.8, 0.35 * k, d, 0.001);
    this.tone('square', 2400, 800, t, 0.03, 0.06 * k, d, 0.001);
    this.tone('sine', 110, 38, t + 0.03, 0.75, 0.9 * k, d, 0.004);
    this.tone('triangle', 70, 30, t + 0.03, 0.9, 0.35 * k, d, 0.01);
    this.noise(t + 0.03, 0.4, 'lowpass', 5000, 300, 0.6, 0.55 * k, d, 0.004);
    this.noise(t + 0.05, 1.05, 'lowpass', 900, 80, 0.8, 0.35 * k, d, 0.04, true);
    // sparse debris tinks
    for (let i = 0; i < 5; i++) {
      const dt = 0.16 + Math.random() * 0.55;
      const f = 2500 + Math.random() * 3500;
      this.tone('sine', f, f * 0.8, t + dt, 0.05, 0.02 + Math.random() * 0.02, this.out(pan + (Math.random() - 0.5) * 0.6), 0.001);
    }
  }

  /** Elegant 3-note ascending cue (original). */
  correct(): void {
    if (!this.ok) return;
    const t = this.now(0.22), d = this.out(0, 0.5);
    [659.25, 830.61, 987.77].forEach((f, i) => {
      this.tone('triangle', f, f, t + i * 0.085, 0.42, 0.09, d, 0.006, 'lin');
      this.tone('sine', f * 2, f * 2, t + i * 0.085, 0.3, 0.03, d, 0.006, 'lin');
    });
  }

  scoreTick(): void {
    if (!this.ok) return;
    this.tone('sine', 1500, 1500, this.now(), 0.04, 0.03, this.out(0.5), 0.001, 'lin');
  }

  /** Dry misfire / fizzle with a gentle downshift — not an insulting buzzer. */
  wrong(pan = 0): void {
    if (!this.ok) return;
    const t = this.now(), d = this.out(pan, 0.15);
    this.noise(t, 0.28, 'bandpass', 1800, 500, 2.5, 0.12, d, 0.005);
    this.tone('triangle', 392, 330, t + 0.05, 0.16, 0.06, d, 0.01, 'lin');
    this.tone('triangle', 330, 262, t + 0.2, 0.22, 0.05, d, 0.01, 'lin');
  }

  fizzle(pan = 0): void {
    if (!this.ok) return;
    const t = this.now(), d = this.out(pan);
    this.noise(t, 0.22, 'highpass', 3000, 1200, 1, 0.06, d, 0.004);
  }

  shieldHit(lastLife: boolean): void {
    if (!this.ok) return;
    const t = this.now(), d = this.out(0, 0.3);
    this.tone('sine', 90, 35, t, 0.6, 0.8, d, 0.004);
    this.noise(t, 0.35, 'lowpass', 1200, 150, 0.7, 0.35, d, 0.004);
    this.tone('triangle', lastLife ? 220 : 330, lastLife ? 165 : 262, t + 0.15, 0.5, 0.06, d, 0.02, 'lin');
    if (lastLife) this.tone('sine', 55, 30, t, 1.1, 0.5, d, 0.01);
  }

  victory(): void {
    if (!this.ok) return;
    const t = this.now(0.05), d = this.out(0, 0.6);
    const seq: [number, number][] = [[523.25, 0], [659.25, 0.12], [783.99, 0.24], [1046.5, 0.4], [987.77, 0.62], [1046.5, 0.74]];
    for (const [f, dt] of seq) {
      this.tone('sawtooth', f, f, t + dt, 0.35, 0.04, this.lowpass(d, 2200, t + dt, 3000), 0.008, 'lin');
      this.tone('triangle', f, f, t + dt, 0.45, 0.07, d, 0.008, 'lin');
    }
    this.tone('sine', 130.8, 130.8, t + 0.4, 1.4, 0.15, d, 0.05, 'lin');
  }

  gameOver(): void {
    if (!this.ok) return;
    const t = this.now(), d = this.out(0, 0.6);
    [392, 349.23, 311.13, 261.63].forEach((f, i) => this.tone('triangle', f, f * 0.99, t + i * 0.28, 0.7, 0.06, d, 0.03, 'lin'));
    this.tone('sine', 65, 45, t, 2, 0.2, d, 0.2);
  }

  /** Stop continuous voices (pause / reset). */
  silenceLoops(): void {
    this.servoUpdate(0);
    this.meteorWhoosh(0, 0, false);
  }
}

function clampPan(p: number): number {
  return Math.max(-1, Math.min(1, p));
}
