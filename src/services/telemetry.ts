import { CommunityApi } from "./community";
import type { ClientEvent } from "../shared/telemetry";
/** Opt-in, bounded product measurements. Never sends a layout, title, password or input recording. */
export class Telemetry {
  enabled = false;
  private clientId = crypto.randomUUID();
  private pending: { type: ClientEvent; durationMs: number }[] = [];
  private sending = false;
  constructor(private api: CommunityApi) {
    try {
      this.enabled = localStorage.getItem("da.usage-consent") === "yes";
      const saved = localStorage.getItem("da.usage-id");
      if (saved)
        this.clientId =
          saved as `${string}-${string}-${string}-${string}-${string}`;
    } catch {
      /* No consent without readable settings. */
    }
    setInterval(() => void this.flush(), 15000);
  }
  toggle(): void {
    this.enabled = !this.enabled;
    if (!this.enabled) this.pending = [];
    try {
      localStorage.setItem("da.usage-consent", this.enabled ? "yes" : "no");
      if (this.enabled) localStorage.setItem("da.usage-id", this.clientId);
      else localStorage.removeItem("da.usage-id");
    } catch {
      this.enabled = false;
    }
  }
  track(type: ClientEvent, durationMs = 0): void {
    if (this.enabled && this.pending.length < 50)
      this.pending.push({
        type,
        durationMs: Math.max(0, Math.min(3600000, Math.round(durationMs))),
      });
  }
  async flush(): Promise<void> {
    if (!this.enabled || this.sending || !this.pending.length) return;
    this.sending = true;
    const events = this.pending.splice(0, 20);
    try {
      await this.api.request("/usage", "POST", {
        clientId: this.clientId,
        events,
      });
    } catch {
      /* Usage measurements never block gameplay or grow an offline queue. */
    } finally {
      this.sending = false;
    }
  }
}
