/** Persistent player profile and settings (localStorage, failure tolerant). */
import {
  BASE_POOL,
  UNLOCKS,
  type PieceId,
  type PowerId,
  type Biome,
  type ArchitectDef,
} from "./defs";
import type { RunState } from "./run";

export interface Settings {
  sfx: number;
  music: number;
  muted: boolean;
  shake: boolean;
  reduceMotion: boolean;
  speed: number;
}
export interface Profile {
  v: 1;
  renown: number;
  runs: number;
  wins: number;
  maxInfamy: number; // highest infamy level unlocked
  kills: number;
  bestCombo: number;
  tutorial: number; // 0 = not started, 99 = done
  seen: string[]; // codex entries discovered
  daily: Record<
    string,
    { stars: number; hoard: number; nights: number; won: boolean }
  >;
  settings: Settings;
  name: string;
}

const PROFILE_KEY = "da.profile.v1";
const RUN_KEY = "da.run.v1";
const WORKSHOP_KEY = "da.workshop.v1";

export function defaultProfile(): Profile {
  return {
    v: 1,
    renown: 0,
    runs: 0,
    wins: 0,
    maxInfamy: 0,
    kills: 0,
    bestCombo: 0,
    tutorial: 0,
    seen: [],
    daily: {},
    settings: {
      sfx: 0.8,
      music: 0.5,
      muted: false,
      shake: true,
      reduceMotion: false,
      speed: 1,
    },
    name: "",
  };
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function loadProfile(): Profile {
  const p = read<Profile>(PROFILE_KEY);
  if (!p || p.v !== 1) return defaultProfile();
  const d = defaultProfile();
  return { ...d, ...p, settings: { ...d.settings, ...p.settings } };
}
export const saveProfile = (p: Profile) => write(PROFILE_KEY, p);
export const loadRun = () => {
  const r = read<RunState>(RUN_KEY);
  return r && r.v === 1 ? r : null;
};
export const saveRun = (r: RunState | null) => write(RUN_KEY, r);
export const loadWorkshop = <T>() => read<T>(WORKSHOP_KEY);
export const saveWorkshop = (w: unknown) => write(WORKSHOP_KEY, w);

export function unlockedPieces(p: Profile): PieceId[] {
  return [
    ...BASE_POOL,
    ...UNLOCKS.filter((u) => u.kind === "piece" && p.renown >= u.at).map(
      (u) => u.id as PieceId,
    ),
  ];
}
export function unlockedPowers(p: Profile): PowerId[] {
  const out: PowerId[] = ["rockfall"];
  if (
    UNLOCKS.some(
      (u) => u.kind === "power" && u.id === "shriek" && p.renown >= u.at,
    )
  )
    out.push("shriek");
  return out;
}
export function unlockedBiomes(p: Profile): Biome["id"][] {
  return [
    "crypt",
    ...UNLOCKS.filter((u) => u.kind === "biome" && p.renown >= u.at).map(
      (u) => u.id as Biome["id"],
    ),
  ];
}
export function unlockedArchitects(p: Profile): ArchitectDef["id"][] {
  return [
    "mason",
    ...UNLOCKS.filter((u) => u.kind === "architect" && p.renown >= u.at).map(
      (u) => u.id as ArchitectDef["id"],
    ),
  ];
}
export function nextUnlock(p: Profile) {
  return UNLOCKS.find((u) => u.at > p.renown) ?? null;
}
export function unlocksBetween(before: number, after: number) {
  return UNLOCKS.filter((u) => u.at > before && u.at <= after);
}

export function todayKey(d = new Date()) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
