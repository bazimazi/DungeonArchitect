import type { Action } from "../core/types";
import type { AttemptResult, PlayerProfile } from "../shared/community";
import { Capacitor, CapacitorHttp } from "@capacitor/core";

export class CommunityApi {
  private nativeToken: string | null = null;
  player: PlayerProfile | null = null;
  async request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    if (Capacitor.isNativePlatform()) {
      const base = import.meta.env.VITE_API_URL as string | undefined;
      if (!base || !base.startsWith("https://"))
        throw new Error(
          "This native build needs an HTTPS community server. The offline workshop is available.",
        );
      const response = await CapacitorHttp.request({
        url: `${base.replace(/\/$/, "")}/api${path}`,
        method,
        headers: {
          "Content-Type": "application/json",
          "X-Dungeon-Native": "1",
          ...(this.nativeToken
            ? { Authorization: `Bearer ${this.nativeToken}` }
            : {}),
        },
        data: body,
        connectTimeout: 15000,
        readTimeout: 15000,
        responseType: "json",
      });
      if (response.status >= 400)
        throw new Error(
          response.data?.message ?? "The community request failed.",
        );
      const token = Object.entries(response.headers).find(
        ([key]) => key.toLowerCase() === "x-dungeon-session",
      )?.[1];
      if (token) this.nativeToken = token;
      if (path === "/auth/logout") this.nativeToken = null;
      return response.data as T;
    }
    let response: Response;
    try {
      response = await fetch(`/api${path}`, {
        method,
        credentials: "same-origin",
        headers:
          body === undefined ? {} : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new Error(
        "The community server is unavailable. Your local workshop is still saved.",
      );
    }
    const value = await response.json().catch(() => null);
    if (!response.ok || value === null)
      throw new Error(
        value?.message ??
          "The community server could not complete this request.",
      );
    return value as T;
  }
  async refresh(): Promise<void> {
    this.player = (
      await this.request<{ player: PlayerProfile | null }>("/me")
    ).player;
  }
  async submit(
    id: string,
    actions: Action[],
    abandon: boolean,
  ): Promise<AttemptResult> {
    const result = await this.request<AttemptResult>(
      `/attempts/${id}`,
      "POST",
      { actions, abandon },
    );
    if (this.player?.id === result.profile.id) this.player = result.profile;
    return result;
  }
}
