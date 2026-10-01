export class GameAudio {
  enabled = false;
  private context?: AudioContext;
  play(
    kind: "place" | "attack" | "damage" | "success" | "error" | "step",
  ): void {
    if (!this.enabled) return;
    try {
      this.context ??= new AudioContext();
      void this.context.resume();
      const context = this.context;
      const now = context.currentTime;
      const notes =
        kind === "success"
          ? [392, 494, 587]
          : kind === "place"
            ? [330, 440]
            : kind === "error"
              ? [140, 100]
              : kind === "damage"
                ? [100]
                : kind === "attack"
                  ? [180]
                  : [210];
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
