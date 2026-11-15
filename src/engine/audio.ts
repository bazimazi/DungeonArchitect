/**
 * Procedural audio: every sound is synthesized with Web Audio, so the game
 * ships without audio files. Category buses feed a compressor; music is a
 * generative drone + plucked-bell layer with an intensity pulse for raids.
 */
export type Sfx =
  | "click"
  | "hover"
  | "confirm"
  | "deny"
  | "place"
  | "dig"
  | "sell"
  | "hit"
  | "heavyHit"
  | "arrow"
  | "spike"
  | "fire"
  | "freeze"
  | "boulder"
  | "trapdoor"
  | "spring"
  | "saw"
  | "gas"
  | "coin"
  | "death"
  | "monsterDeath"
  | "heal"
  | "magic"
  | "disarm"
  | "steal"
  | "recover"
  | "escape"
  | "rockfall"
  | "shriek"
  | "nightfall"
  | "dawn"
  | "victory"
  | "defeat"
  | "card"
  | "unlock"
  | "step"
  | "zap"
  | "blink"
  | "warcry"
  | "smash"
  | "chill"
  | "lute"
  | "feat";

const PENTA = [0, 3, 5, 7, 10, 12, 15, 17];

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private noise!: AudioBuffer;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  private lastPlay = new Map<string, number>();
  private voices = new Map<string, number>();
  private coinStreak = 0;
  private lastCoin = 0;
  private music: {
    drone: GainNode;
    pulse: GainNode;
    danger: GainNode;
    filter: BiquadFilterNode;
    nextNote: number;
    nextBeat: number;
    beat: number;
    timer: number;
  } | null = null;
  intensity = 0; // 0 build, 1 raid, 2 danger
  sfxVolume = 0.8;
  musicVolume = 0.5;
  muted = false;

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    this.master.connect(comp).connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this.sfxVolume;
    this.sfxBus.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicVolume * 0.6;
    this.musicBus.connect(this.master);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.reverb = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 2.4);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c);
      for (let i = 0; i < len; i++)
        ch[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2.6;
    }
    this.reverb.buffer = ir;
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.35;
    this.reverbSend.connect(this.reverb).connect(this.master);
    this.startMusic();
    document.addEventListener("visibilitychange", () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.ctx)
      this.master.gain.setTargetAtTime(
        muted ? 0 : 1,
        this.ctx.currentTime,
        0.05,
      );
  }
  setVolumes(sfx: number, music: number) {
    this.sfxVolume = sfx;
    this.musicVolume = music;
    if (!this.ctx) return;
    this.sfxBus.gain.setTargetAtTime(sfx, this.ctx.currentTime, 0.05);
    this.musicBus.gain.setTargetAtTime(music * 0.6, this.ctx.currentTime, 0.05);
  }

  /** Lower music briefly so big moments read clearly. */
  duck(amount = 0.5, hold = 0.35) {
    if (!this.ctx) return;
    const g = this.musicBus.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(this.musicVolume * 0.6 * amount, t, 0.02);
    g.setTargetAtTime(this.musicVolume * 0.6, t + hold, 0.4);
  }

  private env(
    gain: GainNode,
    t: number,
    peak: number,
    attack: number,
    decay: number,
  ) {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private osc(
    type: OscillatorType,
    f0: number,
    f1: number,
    dur: number,
    peak: number,
    t: number,
    out: AudioNode,
    attack = 0.004,
    detune = 0,
  ) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0)
      o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    o.detune.value = detune;
    const g = ctx.createGain();
    this.env(g, t, peak, attack, dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + attack + dur + 0.05);
    return g;
  }

  private noiseBurst(
    filterType: BiquadFilterType,
    f0: number,
    f1: number,
    dur: number,
    peak: number,
    t: number,
    out: AudioNode,
    q = 1,
    attack = 0.003,
  ) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    this.env(g, t, peak, attack, dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + attack + dur + 0.05);
    return g;
  }

  play(name: Sfx, opts: { volume?: number; pitch?: number } = {}) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    // Voice limiting: at most 4 overlapping and 40ms between retriggers.
    const last = this.lastPlay.get(name) ?? -1;
    const minGap = name === "step" ? 0.09 : 0.04;
    if (now - last < minGap) return;
    const active = this.voices.get(name) ?? 0;
    if (active >= 4) return;
    this.lastPlay.set(name, now);
    this.voices.set(name, active + 1);
    setTimeout(
      () =>
        this.voices.set(name, Math.max(0, (this.voices.get(name) ?? 1) - 1)),
      300,
    );

    const v = (opts.volume ?? 1) * (0.85 + Math.random() * 0.3);
    const p = (opts.pitch ?? 1) * 2 ** ((Math.random() - 0.5) / 12);
    const out = this.sfxBus;
    const t = now + 0.005;
    switch (name) {
      case "click":
        this.osc("triangle", 1200 * p, 800 * p, 0.04, 0.14 * v, t, out);
        break;
      case "hover":
        this.osc("triangle", 1500 * p, 1300 * p, 0.03, 0.04 * v, t, out);
        break;
      case "confirm":
        this.osc("triangle", 660 * p, 660 * p, 0.08, 0.14 * v, t, out);
        this.osc("triangle", 990 * p, 990 * p, 0.14, 0.14 * v, t + 0.06, out);
        break;
      case "deny": {
        const f = ctx.createBiquadFilter();
        f.type = "lowpass";
        f.frequency.value = 1200;
        f.connect(out);
        this.osc("square", 180, 140, 0.14, 0.12 * v, t, f);
        break;
      }
      case "place":
        this.osc("sine", 220 * p, 90 * p, 0.12, 0.35 * v, t, out);
        this.noiseBurst("bandpass", 1800, 900, 0.06, 0.12 * v, t, out, 1.5);
        this.osc(
          "triangle",
          880 * p,
          880 * p,
          0.12,
          0.05 * v,
          t + 0.03,
          this.reverbSend,
        );
        break;
      case "dig":
        this.noiseBurst("lowpass", 900 * p, 200, 0.18, 0.32 * v, t, out, 0.8);
        this.osc("sine", 120 * p, 60, 0.1, 0.25 * v, t, out);
        this.noiseBurst("highpass", 3000, 3000, 0.05, 0.06 * v, t + 0.06, out);
        break;
      case "sell":
        this.osc("triangle", 900 * p, 500 * p, 0.12, 0.12 * v, t, out);
        this.osc("square", 988, 988, 0.05, 0.05 * v, t + 0.08, out);
        break;
      case "hit":
        this.noiseBurst("bandpass", 1100 * p, 700, 0.07, 0.3 * v, t, out, 1);
        this.osc("sine", 160 * p, 50, 0.08, 0.35 * v, t, out);
        break;
      case "heavyHit":
        this.noiseBurst("lowpass", 1400, 200, 0.2, 0.45 * v, t, out, 0.7);
        this.osc("sine", 110 * p, 38, 0.22, 0.6 * v, t, out);
        break;
      case "arrow":
        this.noiseBurst(
          "bandpass",
          2000 * p,
          6000 * p,
          0.12,
          0.16 * v,
          t,
          out,
          4,
        );
        break;
      case "spike":
        this.noiseBurst("highpass", 3000, 3000, 0.04, 0.25 * v, t, out);
        for (const f of [523, 557, 1046])
          this.osc("square", f * p, f * p * 0.98, 0.22, 0.035 * v, t, out);
        this.osc("sine", 140, 60, 0.1, 0.3 * v, t, out);
        break;
      case "fire": {
        const g = this.noiseBurst(
          "lowpass",
          400,
          2400,
          0.45,
          0.35 * v,
          t,
          out,
          0.6,
          0.03,
        );
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 12;
        const lg = ctx.createGain();
        lg.gain.value = 0.12 * v;
        lfo.connect(lg).connect(g.gain);
        lfo.start(t);
        lfo.stop(t + 0.5);
        break;
      }
      case "freeze":
        for (let i = 0; i < 5; i++)
          this.osc(
            "sine",
            (2400 + i * 380) * p,
            (2200 + i * 300) * p,
            0.25,
            0.04 * v,
            t + i * 0.025,
            this.reverbSend,
          );
        this.noiseBurst("highpass", 5000, 8000, 0.3, 0.1 * v, t, out);
        break;
      case "boulder":
        this.noiseBurst("lowpass", 300, 120, 0.7, 0.5 * v, t, out, 0.5, 0.05);
        this.osc("sine", 55, 40, 0.7, 0.5 * v, t, out, 0.05);
        break;
      case "trapdoor":
        this.osc("square", 300, 200, 0.06, 0.1 * v, t, out);
        this.osc("sine", 400 * p, 60, 0.6, 0.2 * v, t + 0.05, out);
        this.osc("sine", 400 * p, 60, 0.6, 0.12 * v, t + 0.05, this.reverbSend);
        break;
      case "spring":
        this.osc("triangle", 180 * p, 900 * p, 0.18, 0.2 * v, t, out);
        break;
      case "saw":
        this.osc("sawtooth", 900 * p, 700 * p, 0.12, 0.05 * v, t, out);
        this.noiseBurst("bandpass", 4000, 3000, 0.1, 0.1 * v, t, out, 3);
        break;
      case "gas":
        this.noiseBurst("lowpass", 600, 300, 0.6, 0.18 * v, t, out, 0.5, 0.1);
        break;
      case "coin": {
        if (now - this.lastCoin < 0.3)
          this.coinStreak = Math.min(this.coinStreak + 1, 12);
        else this.coinStreak = 0;
        this.lastCoin = now;
        const k = 2 ** (this.coinStreak / 12);
        this.osc("square", 988 * k, 988 * k, 0.05, 0.05 * v, t, out);
        this.osc("square", 1319 * k, 1319 * k, 0.18, 0.05 * v, t + 0.06, out);
        break;
      }
      case "death": {
        const f = ctx.createBiquadFilter();
        f.type = "lowpass";
        f.frequency.setValueAtTime(2000, t);
        f.frequency.exponentialRampToValueAtTime(200, t + 0.4);
        f.connect(out);
        this.osc("sawtooth", 300 * p, 60, 0.4, 0.22 * v, t, f);
        this.noiseBurst("bandpass", 800, 300, 0.25, 0.2 * v, t, out, 1);
        this.osc(
          "sine",
          520 * p,
          260 * p,
          0.6,
          0.06 * v,
          t + 0.1,
          this.reverbSend,
        );
        break;
      }
      case "monsterDeath":
        this.noiseBurst("bandpass", 600 * p, 200, 0.2, 0.25 * v, t, out, 2);
        this.osc("triangle", 200 * p, 80, 0.2, 0.2 * v, t, out);
        break;
      case "heal":
        for (let i = 0; i < 3; i++)
          this.osc(
            "sine",
            [784, 988, 1175][i] * p,
            [784, 988, 1175][i] * p,
            0.25,
            0.05 * v,
            t + i * 0.06,
            this.reverbSend,
          );
        break;
      case "zap":
        this.noiseBurst("highpass", 3000, 6000, 0.18, 0.35 * v, t, out, 0.7);
        this.osc("square", 90 * p, 60 * p, 0.2, 0.12 * v, t, out);
        this.osc("sawtooth", 1800 * p, 300 * p, 0.12, 0.05 * v, t, out);
        break;
      case "blink":
        this.osc("sine", 400 * p, 1600 * p, 0.12, 0.12 * v, t, out);
        this.osc(
          "sine",
          1600 * p,
          600 * p,
          0.2,
          0.08 * v,
          t + 0.1,
          this.reverbSend,
        );
        break;
      case "warcry":
        this.osc("sawtooth", 140 * p, 110 * p, 0.6, 0.16 * v, t, out, 0.05, 15);
        this.osc(
          "sawtooth",
          210 * p,
          160 * p,
          0.6,
          0.1 * v,
          t,
          this.reverbSend,
          0.05,
          -15,
        );
        this.noiseBurst("bandpass", 600, 300, 0.5, 0.15 * v, t, out, 1.2, 0.04);
        break;
      case "smash":
        this.noiseBurst("lowpass", 2400, 200, 0.3, 0.5 * v, t, out, 0.8);
        this.osc("square", 220 * p, 80 * p, 0.15, 0.1 * v, t, out);
        break;
      case "chill":
        this.noiseBurst(
          "bandpass",
          4000,
          1200,
          0.6,
          0.25 * v,
          t,
          out,
          1.5,
          0.05,
        );
        this.osc("sine", 1400 * p, 900 * p, 0.5, 0.05 * v, t, this.reverbSend);
        break;
      case "lute":
        for (let i = 0; i < 3; i++)
          this.osc(
            "triangle",
            (523 + i * 131) * p,
            (523 + i * 131) * p,
            0.18,
            0.05 * v,
            t + i * 0.06,
            this.reverbSend,
          );
        break;
      case "feat":
        for (let i = 0; i < 5; i++)
          this.osc(
            "triangle",
            523 * 2 ** (PENTA[i + 2] / 12),
            523 * 2 ** (PENTA[i + 2] / 12),
            0.25,
            0.09 * v,
            t + i * 0.07,
            this.reverbSend,
          );
        break;
      case "magic":
        this.osc("sawtooth", 300 * p, 1200 * p, 0.2, 0.06 * v, t, out);
        this.noiseBurst("bandpass", 1500, 4000, 0.25, 0.15 * v, t, out, 2);
        break;
      case "disarm":
        this.osc("square", 1800, 1800, 0.02, 0.06 * v, t, out);
        this.osc("square", 1400, 1400, 0.02, 0.06 * v, t + 0.07, out);
        this.osc("triangle", 600, 300, 0.15, 0.1 * v, t + 0.12, out);
        break;
      case "steal":
        for (let i = 0; i < 4; i++)
          this.osc(
            "square",
            1319 - i * 180,
            1319 - i * 180,
            0.06,
            0.05 * v,
            t + i * 0.05,
            out,
          );
        break;
      case "recover":
        for (let i = 0; i < 4; i++)
          this.osc(
            "square",
            880 + i * 160,
            880 + i * 160,
            0.06,
            0.05 * v,
            t + i * 0.05,
            out,
          );
        break;
      case "escape":
        this.osc("triangle", 600, 200, 0.5, 0.18 * v, t, out);
        this.osc(
          "triangle",
          450,
          150,
          0.6,
          0.12 * v,
          t + 0.12,
          this.reverbSend,
        );
        break;
      case "rockfall":
        this.noiseBurst("lowpass", 1600, 90, 0.7, 0.7 * v, t, out, 0.6);
        this.osc("sine", 70, 30, 0.5, 0.8 * v, t, out);
        break;
      case "shriek":
        this.osc("sawtooth", 1300, 500, 0.6, 0.08 * v, t, out, 0.02, 20);
        this.osc(
          "sawtooth",
          1340,
          480,
          0.6,
          0.08 * v,
          t,
          this.reverbSend,
          0.02,
          -20,
        );
        break;
      case "nightfall":
        this.osc("sine", 146.8, 73.4, 1.8, 0.25 * v, t, this.reverbSend, 0.2);
        this.osc(
          "triangle",
          293.7,
          220,
          1.6,
          0.08 * v,
          t + 0.1,
          this.reverbSend,
          0.3,
        );
        this.noiseBurst("lowpass", 300, 80, 1.6, 0.2 * v, t, out, 0.5, 0.3);
        break;
      case "dawn":
        [587, 740, 880, 1175].forEach((f, i) =>
          this.osc(
            "triangle",
            f,
            f,
            0.6,
            0.08 * v,
            t + i * 0.09,
            this.reverbSend,
            0.01,
          ),
        );
        break;
      case "victory":
        [523, 659, 784, 1047, 784, 1047].forEach((f, i) =>
          this.osc(
            "square",
            f,
            f,
            i > 3 ? 0.5 : 0.12,
            0.06 * v,
            t + i * 0.11,
            out,
          ),
        );
        [523, 659, 784].forEach((f) =>
          this.osc(
            "triangle",
            f / 2,
            f / 2,
            1.4,
            0.07 * v,
            t + 0.55,
            this.reverbSend,
            0.05,
          ),
        );
        break;
      case "defeat":
        [392, 370, 349, 262].forEach((f, i) =>
          this.osc(
            "sawtooth",
            f,
            f * 0.98,
            i === 3 ? 1.2 : 0.3,
            0.05 * v,
            t + i * 0.3,
            this.reverbSend,
            0.02,
          ),
        );
        break;
      case "card":
        this.noiseBurst(
          "bandpass",
          2500 * p,
          1200 * p,
          0.09,
          0.1 * v,
          t,
          out,
          1.2,
        );
        break;
      case "unlock":
        [784, 988, 1175, 1568].forEach((f, i) =>
          this.osc(
            "triangle",
            f,
            f,
            0.35,
            0.07 * v,
            t + i * 0.07,
            this.reverbSend,
            0.01,
          ),
        );
        break;
      case "step":
        this.noiseBurst(
          "lowpass",
          300 + Math.random() * 300,
          200,
          0.04,
          0.035 * v,
          t,
          out,
          0.7,
        );
        break;
    }
  }

  private startMusic() {
    const ctx = this.ctx!;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 420;
    filter.Q.value = 2;
    const drone = ctx.createGain();
    drone.gain.value = 0;
    drone.gain.setTargetAtTime(0.16, ctx.currentTime, 3);
    filter.connect(drone).connect(this.musicBus);
    for (const [f, det] of [
      [73.42, -7],
      [73.42, 6],
      [110, 3],
      [36.71, 0],
    ]) {
      const o = ctx.createOscillator();
      o.type = f < 50 ? "sine" : "sawtooth";
      o.frequency.value = f;
      o.detune.value = det;
      const g = ctx.createGain();
      g.gain.value = f < 50 ? 0.9 : 0.22;
      o.connect(g).connect(filter);
      o.start();
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 180;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start();

    const pulse = ctx.createGain();
    pulse.gain.value = 0;
    pulse.connect(this.musicBus);
    const danger = ctx.createGain();
    danger.gain.value = 0;
    danger.connect(this.musicBus);

    // Feedback delay for the bells.
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.375;
    const fb = ctx.createGain();
    fb.gain.value = 0.35;
    delay.connect(fb).connect(delay);
    delay.connect(this.musicBus);

    this.music = {
      drone,
      pulse,
      danger,
      filter,
      nextNote: ctx.currentTime + 1.5,
      nextBeat: ctx.currentTime + 0.5,
      beat: 0,
      timer: 0,
    };
    const bellOut = ctx.createGain();
    bellOut.gain.value = 1;
    bellOut.connect(this.musicBus);
    bellOut.connect(delay);
    bellOut.connect(this.reverbSend);

    const schedule = () => {
      if (!this.ctx || !this.music) return;
      const m = this.music;
      const now = this.ctx.currentTime;
      const target = this.intensity;
      m.pulse.gain.setTargetAtTime(target >= 1 ? 0.5 : 0, now, 1.2);
      m.danger.gain.setTargetAtTime(target >= 2 ? 0.4 : 0, now, 0.8);
      m.filter.frequency.setTargetAtTime(target >= 1 ? 700 : 420, now, 2);
      while (m.nextNote < now + 0.2) {
        const step = PENTA[Math.floor(Math.random() * PENTA.length)];
        const f = 293.66 * 2 ** (step / 12) * (Math.random() < 0.3 ? 0.5 : 1);
        this.osc("triangle", f, f, 1.6, 0.045, m.nextNote, bellOut, 0.005);
        this.osc("sine", f * 2, f * 2, 0.8, 0.015, m.nextNote, bellOut, 0.005);
        m.nextNote +=
          target >= 1 ? 1 + Math.random() * 2 : 2 + Math.random() * 4;
      }
      // 90 BPM pulse: low tom on beats, ticks on off-beats.
      while (m.nextBeat < now + 0.12) {
        const b = m.beat % 8;
        if (b === 0 || b === 3 || b === 6) {
          this.osc("sine", 90, 45, 0.25, 0.5, m.nextBeat, m.pulse);
        }
        if (b % 2 === 1)
          this.noiseBurst(
            "highpass",
            6000,
            6000,
            0.03,
            0.05,
            m.nextBeat,
            m.pulse,
          );
        if (b === 4)
          this.noiseBurst(
            "bandpass",
            1500,
            800,
            0.08,
            0.12,
            m.nextBeat,
            m.pulse,
            1,
          );
        if (b % 2 === 0) {
          const f = [146.8, 155.6][Math.floor(m.beat / 8) % 2];
          this.osc("sawtooth", f, f, 0.3, 0.05, m.nextBeat, m.danger);
        }
        m.nextBeat += 60 / 90 / 2;
        m.beat++;
      }
    };
    this.music.timer = window.setInterval(schedule, 25);
  }
}

export const audio = new AudioEngine();
