import { clone } from "../core/types";
import type { Dungeon, PublishedVersion, Replay } from "../core/types";
import { createStarter, fingerprint, parseDungeon } from "../core/dungeon";
import { parseReplay, reconstructReplay } from "../core/simulation";
import { validateDungeon } from "../core/validation";

export interface Preferences {
  sound: boolean;
  reducedMotion: boolean;
  showGrid: boolean;
  tutorialStep?: number;
  contrast?: boolean;
  textScale?: number;
}
export interface SaveData {
  schemaVersion: 1;
  draft: Dungeon;
  versions: PublishedVersion[];
  attempts: Replay[];
  practice: Replay[];
  certificate: Replay | null;
  preferences: Preferences;
}
export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export const STORAGE_KEY = "dungeon-architect.v1";

export class Library {
  data: SaveData;
  warning: string | null = null;
  constructor(private readonly storage: StorageAdapter) {
    this.data = {
      schemaVersion: 1,
      draft: createStarter(),
      versions: [],
      attempts: [],
      practice: [],
      certificate: null,
      preferences: { sound: false, reducedMotion: false, showGrid: true },
    };
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (raw) this.data = this.parseSave(JSON.parse(raw));
    } catch (error) {
      this.warning =
        error instanceof Error ? error.message : "storage.loadFailed";
    }
  }
  private parseSave(input: unknown): SaveData {
    const save = input as SaveData;
    if (
      !save ||
      save.schemaVersion !== 1 ||
      !Array.isArray(save.versions) ||
      save.versions.length > 100 ||
      !Array.isArray(save.attempts) ||
      save.attempts.length > 180
    )
      throw new Error("storage.loadFailed");
    const draft = parseDungeon(save.draft);
    const versions: PublishedVersion[] = save.versions.map((v) => {
      if (
        !v ||
        typeof v.id !== "string" ||
        v.id.length > 100 ||
        !Number.isInteger(v.number) ||
        v.number < 1 ||
        typeof v.publishedAt !== "string"
      )
        throw new Error("storage.loadFailed");
      const dungeon = parseDungeon(v.dungeon);
      const certificate = parseReplay(v.certificate);
      if (
        !validateDungeon(dungeon).valid ||
        fingerprint(certificate.dungeon) !== fingerprint(dungeon) ||
        reconstructReplay(certificate).state.status !== "completed"
      )
        throw new Error("storage.loadFailed");
      return {
        id: v.id,
        number: v.number,
        dungeon,
        certificate,
        publishedAt: v.publishedAt,
      };
    });
    if (new Set(versions.map((v) => v.id)).size !== versions.length)
      throw new Error("storage.loadFailed");
    const attempts = save.attempts.map((a) => parseReplay(a));
    for (const attempt of attempts) {
      const version = versions.find((v) => v.id === attempt.dungeonVersionId);
      if (
        !version ||
        fingerprint(version.dungeon) !== fingerprint(attempt.dungeon)
      )
        throw new Error("storage.loadFailed");
      reconstructReplay(attempt);
    }
    const practice = save.practice ?? [];
    if (!Array.isArray(practice) || practice.length > 20)
      throw new Error("storage.loadFailed");
    const parsedPractice = practice.map((replay) => {
      const clean = parseReplay(replay);
      reconstructReplay(clean);
      return clean;
    });
    const certificate = save.certificate ? parseReplay(save.certificate) : null;
    const preferences = save.preferences;
    if (
      !preferences ||
      typeof preferences.sound !== "boolean" ||
      typeof preferences.reducedMotion !== "boolean" ||
      typeof preferences.showGrid !== "boolean"
    )
      throw new Error("storage.loadFailed");
    return {
      schemaVersion: 1,
      draft,
      versions,
      attempts,
      practice: parsedPractice,
      certificate:
        certificate &&
        fingerprint(certificate.dungeon) === fingerprint(draft) &&
        reconstructReplay(certificate).state.status === "completed"
          ? certificate
          : null,
      preferences,
    };
  }
  persist(): boolean {
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.data));
      this.warning = null;
      return true;
    } catch {
      this.warning = "storage.saveFailed";
      return false;
    }
  }
  updateDraft(dungeon: Dungeon): void {
    if (fingerprint(dungeon) !== fingerprint(this.data.draft))
      this.data.certificate = null;
    this.data.draft = clone(dungeon);
    this.persist();
  }
  certify(replay: Replay): void {
    if (
      fingerprint(replay.dungeon) !== fingerprint(this.data.draft) ||
      reconstructReplay(replay).state.status !== "completed"
    )
      throw new Error("publish.testRequired");
    this.data.certificate = clone(replay);
    this.persist();
  }
  get tested(): boolean {
    return (
      this.data.certificate !== null &&
      fingerprint(this.data.certificate.dungeon) ===
        fingerprint(this.data.draft)
    );
  }
  latest(dungeonId = this.data.draft.id): PublishedVersion | undefined {
    return this.data.versions.filter((v) => v.dungeon.id === dungeonId).at(-1);
  }
  publish(): PublishedVersion {
    const dungeon = this.data.draft;
    if (!validateDungeon(dungeon).valid) throw new Error("publish.invalid");
    const certificate = this.data.certificate;
    if (
      !certificate ||
      fingerprint(certificate.dungeon) !== fingerprint(dungeon) ||
      reconstructReplay(certificate).state.status !== "completed"
    )
      throw new Error("publish.testRequired");
    const previous = this.latest();
    if (previous && fingerprint(previous.dungeon) === fingerprint(dungeon))
      throw new Error("publish.unchanged");
    if (this.data.versions.length >= 100) throw new Error("publish.limit");
    const version: PublishedVersion = {
      id: crypto.randomUUID(),
      number: (previous?.number ?? 0) + 1,
      dungeon: clone(dungeon),
      certificate: clone(certificate),
      publishedAt: new Date().toISOString(),
    };
    this.data.versions.push(version);
    this.persist();
    return clone(version);
  }
  record(replay: Replay): void {
    const clean = parseReplay(replay);
    const version = this.data.versions.find(
      (v) => v.id === clean.dungeonVersionId,
    );
    if (!version || fingerprint(version.dungeon) !== fingerprint(clean.dungeon))
      throw new Error("storage.invalidReplay");
    if (this.data.attempts.some((a) => a.id === clean.id)) return;
    reconstructReplay(clean);
    if (this.data.attempts.length >= 180) throw new Error("attempt.limit");
    this.data.attempts.push(clean);
    this.persist();
  }
  recordPractice(replay: Replay): void {
    const clean = parseReplay(replay);
    reconstructReplay(clean);
    if (this.data.practice.some((r) => r.id === clean.id)) return;
    this.data.practice.push(clean);
    this.data.practice = this.data.practice.slice(-20);
    this.persist();
  }
}
