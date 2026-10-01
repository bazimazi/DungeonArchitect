import type { Theme } from "../core/advanced-types";
const SOUNDSCAPES: Record<Theme, [number, number, OscillatorType]> = {
  "forgotten-cave": [55, 450, "sine"],
  "ancient-ruins": [65.4, 700, "sine"],
  castle: [73.4, 1000, "triangle"],
  fortress: [49, 350, "triangle"],
  temple: [82.4, 1400, "sine"],
  "underground-city": [61.7, 800, "triangle"],
  hell: [41.2, 250, "sawtooth"],
  "alien-facility": [92.5, 2000, "sine"],
};
export class GameAudio {
  private active = false;
  get enabled(): boolean {
    return this.active;
  }
  set enabled(value: boolean) {
    this.active = value;
    if (!value && this.ambientGain && this.context)
      this.ambientGain.gain.setTargetAtTime(0, this.context.currentTime, 0.15);
  }
  private context?: AudioContext;
  private ambientGain?: GainNode;
  private drone?: OscillatorNode;
  private filter?: BiquadFilterNode;
  private intensity = "";
  private ambient(): void {
    if (!this.context || this.ambientGain) return;
    const context = this.context;
    this.ambientGain = context.createGain();
    this.ambientGain.gain.value = 0;
    this.ambientGain.connect(context.destination);
    this.drone = context.createOscillator();
    this.drone.type = "sine";
    this.drone.frequency.value = 55;
    this.drone.connect(this.ambientGain);
    this.drone.start();
    const buffer = context.createBuffer(
      1,
      context.sampleRate * 2,
      context.sampleRate,
    );
    const data = buffer.getChannelData(0);
    let previous = 0;
    for (let i = 0; i < data.length; i++) {
      previous = (previous + (Math.random() * 2 - 1) * 0.025) / 1.025;
      data[i] = previous * 0.2;
    }
    const wind = context.createBufferSource();
    wind.buffer = buffer;
    wind.loop = true;
    const filter = (this.filter = context.createBiquadFilter());
    filter.type = "lowpass";
    filter.frequency.value = 450;
    wind.connect(filter);
    filter.connect(this.ambientGain);
    wind.start();
  }
  update(danger: number, boss = false, theme: Theme = "forgotten-cave"): void {
    if (!this.enabled || !this.context) return;
    this.ambient();
    const level = boss ? 2 : danger > 0 ? 1 : 0;
    const key = `${level}/${theme}`;
    if (key === this.intensity) return;
    this.intensity = key;
    const [base, cutoff, wave] = SOUNDSCAPES[theme];
    this.drone!.type = wave;
    this.filter!.frequency.setTargetAtTime(
      cutoff + level * 150,
      this.context.currentTime,
      0.8,
    );
    this.drone!.frequency.setTargetAtTime(
      base * (level === 2 ? 1.5 : level === 1 ? 1.2 : 1),
      this.context.currentTime,
      0.8,
    );
    this.ambientGain!.gain.setTargetAtTime(
      level === 2 ? 0.025 : level === 1 ? 0.018 : 0.012,
      this.context.currentTime,
      0.5,
    );
  }
  play(
    kind:
      | "place"
      | "attack"
      | "damage"
      | "success"
      | "error"
      | "step"
      | "trap"
      | "door"
      | "switch"
      | "treasure"
      | "discovery"
      | "death"
      | "follower",
  ): void {
    if (!this.enabled) return;
    try {
      this.context ??= new AudioContext();
      this.intensity = "";
      void this.context.resume();
      const context = this.context;
      const now = context.currentTime;
      const cues: Partial<Record<typeof kind, number[]>> = {
        trap: [90, 240, 90],
        door: [120, 160],
        switch: [520, 390],
        treasure: [660, 880, 1100],
        discovery: [440, 554, 830],
        death: [160, 120, 60],
        follower: [523, 659, 784],
      };
      const notes =
        cues[kind] ??
        (kind === "success"
          ? [392, 494, 587]
          : kind === "place"
            ? [330, 440]
            : kind === "error"
              ? [140, 100]
              : kind === "damage"
                ? [100]
                : kind === "attack"
                  ? [180]
                  : [210]);
      notes.forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type =
          kind === "damage" || kind === "attack" ? "triangle" : "sine";
        oscillator.frequency.setValueAtTime(frequency, now + index * 0.06);
        gain.gain.setValueAtTime(0, now + index * 0.06);
        gain.gain.linearRampToValueAtTime(
          kind === "step" ? 0.025 : 0.07,
          now + index * 0.06 + 0.01,
        );
        gain.gain.exponentialRampToValueAtTime(
          0.001,
          now + index * 0.06 + 0.14,
        );
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(now + index * 0.06);
        oscillator.stop(now + index * 0.06 + 0.15);
      });
    } catch {
      /* Audio feedback is optional; visual feedback remains available. */
    }
  }
}
