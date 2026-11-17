/** Persistent player profile and settings (localStorage, failure tolerant). */
import {
  BASE_POOL,
  FEATS,
  FLOORPLANS,
  NIGHTS,
  REALM_SIZE,
  UNLOCKS,
  heatOf,
  realmOf,
  type ArchitectId,
  type BiomeId,
  type FeatDef,
  type FloorplanId,
  type OmenId,
  type PieceId,
  type PowerId,
  type StatId,
} from "./defs";
import { migrateRun, planFor, type RunState } from "./run";
import {
  ARCH_LEVEL_AT,
  BOARD_BONUS,
  WIN_XP,
  archLevel,
  archLevelRenown,
  aspectUnlocked,
  bestiaryMarks,
  boardFor,
  bountyGain,
  isRecord,
  masteryRank,
  MASTERY_RENOWN,
  BESTIARY_RENOWN,
  nightXp,
  type Bounty,
  type BountyBoard,
} from "./progression";
import { SCHOOL_IDS, sourcePiece, type SchoolId } from "./schools";
import type { RaidResult } from "./sim";
import type { HeroClass } from "./defs";

export interface Settings {
  sfx: number;
  music: number;
  muted: boolean;
  shake: boolean;
  reduceMotion: boolean;
  speed: number;
}
export interface Profile {
  v: 2;
  renown: number;
  runs: number;
  wins: number;
  /** Deepest depth unlocked (1-based). Winning at depth d unlocks d + 1. */
  maxDepth: number;
  /** Deepest depth conquered. */
  bestDepth: number;
  /** Furthest abyss night survived. */
  bestAbyss: number;
  kills: number;
  bestCombo: number;
  tutorial: number; // 0 = not started, 99 = done
  seen: string[]; // codex entries discovered
  daily: Record<
    string,
    { stars: number; hoard: number; nights: number; won: boolean }
  >;
  /** Lifetime counters behind feats. */
  stats: Record<StatId, number>;
  /** Feats earned. */
  feats: string[];
  /** Architects that have won a descent. */
  archWins: ArchitectId[];
  settings: Settings;
  name: string;
  /** Highest heat at which a descent was won. */
  bestHeat: number;
  /** Omens chosen last time (pre-selected on the setup screen). */
  omens: OmenId[];
  /** Best stars per trial id. */
  trials: Record<string, number>;
  /** Records per depth (keyed by depth number). */
  depths: Record<string, DepthRecord>;
  /** Floorplans a descent has been won on. */
  planWins: FloorplanId[];
  /** Lifetime kills credited to each piece (mastery). */
  mastery: Record<string, number>;
  /** Pieces whose unlocked aspect is equipped for new descents. */
  aspects: PieceId[];
  /** Lifetime kills of each hero class (bestiary). */
  bestiary: Record<string, number>;
  /** Today's bounty board. */
  bounties: BountyBoard | null;
  /** Experience earned with each architect. */
  archXp: Record<string, number>;
  /** Starting kit chosen per architect (0 = standard, 1 = alternate). */
  kits: Record<string, number>;
  /** Schools whose fourth tier has been awakened in a raid. */
  schools4: SchoolId[];
  /** Architect picked for the last descent (pre-selected on setup). */
  lastArch?: ArchitectId;
}

/** What a player has achieved on one depth. */
export interface DepthRecord {
  wins: number;
  /** Bit mask of crowns (see CROWNS). */
  crowns: number;
  /** Most stars in a won descent (out of 30). */
  bestStars: number;
  /** Highest heat it was won at (-1: never won). */
  bestHeat: number;
}

/** Three crowns per depth: conquer it, without losing treasure, and under omens. */
export const CROWNS = [
  {
    bit: 1,
    name: "Conquered",
    text: "Win a descent at this depth.",
    renown: 0,
  },
  {
    bit: 2,
    name: "Flawless",
    text: "Win without losing a single treasure.",
    renown: 4,
  },
  {
    bit: 4,
    name: "Ascendant",
    text: "Win at heat 5 or more.",
    renown: 6,
  },
] as const;
export const ASCENDANT_HEAT = 5;
export const crownCount = (mask: number) =>
  (mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1);
export function totalCrowns(p: Pick<Profile, "depths">) {
  let n = 0;
  for (const r of Object.values(p.depths)) n += crownCount(r?.crowns ?? 0);
  return n;
}

const PROFILE_KEY = "da.profile.v1";
const RUN_KEY = "da.run.v1";
const WORKSHOP_KEY = "da.workshop.v1";

export function defaultProfile(): Profile {
  return {
    v: 2,
    renown: 0,
    runs: 0,
    wins: 0,
    maxDepth: 1,
    bestDepth: 0,
    bestAbyss: 0,
    kills: 0,
    bestCombo: 0,
    tutorial: 0,
    seen: [],
    daily: {},
    stats: {
      kills: 0,
      fireKills: 0,
      falls: 0,
      powerKills: 0,
      dailies: 0,
      trialStars: 0,
      abyssNights: 0,
      encounters: 0,
      crowns: 0,
      aspects: 0,
      bestiary: 0,
      affixKills: 0,
      contracts: 0,
      schoolKills: 0,
    },
    feats: [],
    archWins: [],
    settings: {
      sfx: 0.8,
      music: 0.5,
      muted: false,
      shake: true,
      reduceMotion: false,
      speed: 1,
    },
    name: "",
    bestHeat: -1,
    omens: [],
    trials: {},
    depths: {},
    planWins: [],
    mastery: {},
    aspects: [],
    bestiary: {},
    bounties: null,
    archXp: {},
    kits: {},
    schools4: [],
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

const obj = <T>(v: T | undefined): T =>
  (v && typeof v === "object" ? { ...v } : {}) as T;

/** Load a profile, upgrading older saves (infamy became depth). */
export function migrateProfile(raw: unknown): Profile {
  const d = defaultProfile();
  const p = raw as Omit<Partial<Profile>, "v"> & {
    v?: number;
    maxInfamy?: number;
  };
  if (!p || typeof p !== "object" || (p.v !== 1 && p.v !== 2)) return d;
  const out: Profile = {
    ...d,
    ...p,
    v: 2,
    settings: { ...d.settings, ...p.settings },
    stats: { ...d.stats, ...p.stats },
    feats: Array.isArray(p.feats) ? p.feats : [],
    archWins: Array.isArray(p.archWins) ? p.archWins : [],
    daily: p.daily ?? {},
    seen: Array.isArray(p.seen) ? p.seen : [],
    omens: Array.isArray(p.omens) ? p.omens : [],
    trials: p.trials && typeof p.trials === "object" ? p.trials : {},
    depths: p.depths && typeof p.depths === "object" ? { ...p.depths } : {},
    planWins: Array.isArray(p.planWins) ? p.planWins : [],
    mastery: obj(p.mastery),
    aspects: Array.isArray(p.aspects) ? p.aspects : [],
    bestiary: obj(p.bestiary),
    bounties: p.bounties && typeof p.bounties === "object" ? p.bounties : null,
    archXp: obj(p.archXp),
    kits: obj(p.kits),
    schools4: Array.isArray(p.schools4) ? p.schools4 : [],
    bestHeat: typeof p.bestHeat === "number" ? p.bestHeat : p.wins ? 0 : -1,
  };
  // Trial stars are derived from the per-trial record.
  out.stats.trialStars = Object.values(out.trials).reduce(
    (a, v) => a + (Number(v) || 0),
    0,
  );
  if (p.v === 1) {
    out.maxDepth = (p.maxInfamy ?? 0) + 1;
    out.bestDepth = p.wins ? Math.max(1, p.maxInfamy ?? 0) : 0;
    out.stats.kills = p.kills ?? 0;
    out.stats.dailies = Object.keys(p.daily ?? {}).length;
    delete (out as Partial<{ maxInfamy: number }>).maxInfamy;
    // Honour what veterans already achieved before feats existed.
    const inf = p.maxInfamy ?? 0;
    if (out.kills > 0) award(out, "firstBlood");
    if (out.wins > 0) award(out, "aldric");
    if (out.bestCombo >= 5) award(out, "combo5");
    if (out.bestCombo >= 8) award(out, "combo8");
    if (inf >= 3) award(out, "depth3");
    if (inf >= 6) award(out, "depth6");
    awardStats(out);
  }
  out.maxDepth = Math.max(1, Math.floor(out.maxDepth || 1));
  // Depths conquered before crowns existed keep their first crown.
  for (let d = 1; d <= Math.min(out.bestDepth, 500); d++) {
    const r = out.depths[d];
    if (!r) out.depths[d] = { wins: 1, crowns: 1, bestStars: 0, bestHeat: 0 };
  }
  out.stats.crowns = totalCrowns(out);
  out.stats.aspects = unlockedAspects(out).length;
  out.stats.bestiary = totalMarks(out);
  return out;
}

// ---------- Rules v5 progression ----------
/** Pieces whose aspect has been unlocked through mastery. */
export function unlockedAspects(p: Pick<Profile, "mastery">): PieceId[] {
  return (Object.keys(p.mastery) as PieceId[]).filter((k) =>
    aspectUnlocked(p.mastery[k] ?? 0),
  );
}
/** Equipped aspects that are actually unlocked. */
export function activeAspects(p: Pick<Profile, "mastery" | "aspects">) {
  const open = new Set(unlockedAspects(p));
  return p.aspects.filter((a) => open.has(a));
}
export function totalMarks(p: Pick<Profile, "bestiary">) {
  let n = 0;
  for (const [cls, k] of Object.entries(p.bestiary))
    n += bestiaryMarks(cls as HeroClass, k ?? 0);
  return n;
}
export const archLevelOf = (p: Pick<Profile, "archXp">, a: ArchitectId) =>
  archLevel(p.archXp[a] ?? 0).level;
/** Today's board, rolled over to a fresh one at UTC midnight. */
export function currentBoard(p: Profile, day = todayKey()) {
  p.bounties = boardFor(day, p.bounties);
  return p.bounties;
}

/** What one night (or a won descent) added to long-term progression. */
export interface Progress {
  renown: number;
  /** Pieces that reached a new mastery rank: [piece, rank]. */
  mastery: [PieceId, number][];
  /** Aspects newly unlocked. */
  aspects: PieceId[];
  /** Classes that earned a new bestiary mark: [class, mark]. */
  bestiary: [HeroClass, number][];
  /** Bounties completed tonight. */
  bounties: Bounty[];
  /** The whole board was cleared tonight. */
  boardDone: boolean;
  /** New architect level, if one was reached. */
  archLevel: number | null;
}
export const noProgress = (): Progress => ({
  renown: 0,
  mastery: [],
  aspects: [],
  bestiary: [],
  bounties: [],
  boardDone: false,
  archLevel: null,
});

/** Architect XP: a level pays renown. */
function addXp(p: Profile, a: ArchitectId, xp: number, out: Progress) {
  const before = archLevel(p.archXp[a] ?? 0).level;
  p.archXp[a] = (p.archXp[a] ?? 0) + xp;
  const after = archLevel(p.archXp[a]).level;
  for (let l = before + 1; l <= after; l++) {
    out.renown += archLevelRenown(l);
    out.archLevel = l;
  }
}

/**
 * Credit a finished raid night to mastery, the bestiary, today's bounties and
 * the architect. Renown is added to the profile and returned in the summary.
 */
export function recordNight(
  p: Profile,
  run: Pick<RunState, "architect">,
  r: RaidResult,
  stars: number,
  survived: boolean,
  day = todayKey(),
): Progress {
  const out = noProgress();
  // Mastery: kills by piece (minions count for their maker).
  for (const [src, k] of Object.entries(r.kills)) {
    const piece = sourcePiece(src);
    if (!piece || !k) continue;
    const before = p.mastery[piece] ?? 0;
    const after = before + k;
    p.mastery[piece] = after;
    const r0 = masteryRank(before);
    const r1 = masteryRank(after);
    for (let rank = r0 + 1; rank <= r1; rank++) {
      out.renown += MASTERY_RENOWN[rank - 1];
      out.mastery.push([piece, rank]);
    }
    if (!aspectUnlocked(before) && aspectUnlocked(after)) {
      out.aspects.push(piece);
      // A freshly unlocked aspect starts equipped; the armory can switch it off.
      if (!p.aspects.includes(piece)) p.aspects.push(piece);
    }
  }
  // Bestiary: kills by class.
  for (const [cls, k] of Object.entries(r.classKills ?? {})) {
    if (!k) continue;
    const before = p.bestiary[cls] ?? 0;
    p.bestiary[cls] = before + k;
    const m0 = bestiaryMarks(cls as HeroClass, before);
    const m1 = bestiaryMarks(cls as HeroClass, before + k);
    for (let m = m0 + 1; m <= m1; m++) {
      out.renown += BESTIARY_RENOWN[m - 1];
      out.bestiary.push([cls as HeroClass, m]);
    }
  }
  // Schools awakened to tier IV.
  for (const s of SCHOOL_IDS)
    if ((r.schools?.[s] ?? 0) >= 2 && !p.schools4.includes(s))
      p.schools4.push(s);
  // Bounties.
  const board = currentBoard(p, day);
  board.bounties.forEach((b, i) => {
    if (board.paid[i]) return;
    const gain = bountyGain(b, r, stars);
    board.progress[i] = isRecord(b)
      ? Math.max(board.progress[i], gain)
      : board.progress[i] + gain;
    if (board.progress[i] >= b.goal) {
      board.paid[i] = true;
      out.renown += b.renown;
      out.bounties.push(b);
      p.stats.contracts++;
    }
  });
  if (out.bounties.length && board.paid.every(Boolean)) {
    out.boardDone = true;
    out.renown += BOARD_BONUS;
  }
  if (survived) addXp(p, run.architect, nightXp(stars), out);
  p.stats.affixKills += r.affixKills ?? 0;
  p.stats.schoolKills += r.schoolKills ?? 0;
  p.stats.aspects = unlockedAspects(p).length;
  p.stats.bestiary = totalMarks(p);
  p.renown += out.renown;
  return out;
}
/** A won descent: bonus architect XP. */
export function recordWinXp(p: Profile, a: ArchitectId): Progress {
  const out = noProgress();
  addXp(p, a, WIN_XP, out);
  p.renown += out.renown;
  return out;
}
export { ARCH_LEVEL_AT };

/**
 * Record a won descent on the ladder: depth record, crowns and floorplans.
 * Returns the crowns newly earned (renown for them is added to the profile).
 */
export function recordDepthWin(p: Profile, run: RunState) {
  const d = run.depth;
  const rec: DepthRecord = p.depths[d]
    ? { ...p.depths[d] }
    : { wins: 0, crowns: 0, bestStars: 0, bestHeat: -1 };
  const descent = run.history.filter((h) => h.night <= NIGHTS);
  const stars = descent.reduce((a, h) => a + h.stars, 0);
  const heat = heatOf(run.omens ?? []);
  let mask = 1;
  if (descent.every((h) => h.stolen === 0)) mask |= 2;
  if (heat >= ASCENDANT_HEAT) mask |= 4;
  const fresh = CROWNS.filter((c) => mask & c.bit && !(rec.crowns & c.bit));
  rec.wins++;
  rec.crowns |= mask;
  rec.bestStars = Math.max(rec.bestStars, stars);
  rec.bestHeat = Math.max(rec.bestHeat, heat);
  p.depths[d] = rec;
  let renown = 0;
  for (const c of fresh) renown += c.renown;
  p.renown += renown;
  p.stats.crowns = totalCrowns(p);
  const plan = planFor(d);
  if (!p.planWins.includes(plan)) p.planWins.push(plan);
  return { crowns: fresh.map((c) => c.name), renown };
}

/** Every crown on every depth of the realm that holds `depth`. */
export function realmSwept(p: Pick<Profile, "depths">, depth: number) {
  const first = (realmOf(depth) - 1) * REALM_SIZE + 1;
  for (let d = first; d < first + REALM_SIZE; d++)
    if ((p.depths[d]?.crowns ?? 0) !== 7) return false;
  return true;
}
export const allPlansWon = (p: Pick<Profile, "planWins">) =>
  (Object.keys(FLOORPLANS) as FloorplanId[]).every((f) =>
    p.planWins.includes(f),
  );

export function loadProfile(): Profile {
  return migrateProfile(read<unknown>(PROFILE_KEY));
}
export const saveProfile = (p: Profile) => write(PROFILE_KEY, p);
export const loadRun = () => migrateRun(read<unknown>(RUN_KEY));
export const saveRun = (r: RunState | null) => write(RUN_KEY, r);
export const loadWorkshop = () => migrateRun(read<unknown>(WORKSHOP_KEY));
export const saveWorkshop = (w: RunState | null) => write(WORKSHOP_KEY, w);

export function unlockedPieces(p: Pick<Profile, "renown">): PieceId[] {
  return [
    ...BASE_POOL,
    ...UNLOCKS.filter((u) => u.kind === "piece" && p.renown >= u.at).map(
      (u) => u.id as PieceId,
    ),
  ];
}
export function unlockedPowers(p: Pick<Profile, "renown">): PowerId[] {
  return [
    "rockfall",
    ...UNLOCKS.filter((u) => u.kind === "power" && p.renown >= u.at).map(
      (u) => u.id as PowerId,
    ),
  ];
}
export function unlockedBiomes(p: Pick<Profile, "renown">): BiomeId[] {
  return [
    "crypt",
    ...UNLOCKS.filter((u) => u.kind === "biome" && p.renown >= u.at).map(
      (u) => u.id as BiomeId,
    ),
  ];
}
export function unlockedArchitects(p: Pick<Profile, "renown">): ArchitectId[] {
  return [
    "mason",
    ...UNLOCKS.filter((u) => u.kind === "architect" && p.renown >= u.at).map(
      (u) => u.id as ArchitectId,
    ),
  ];
}
export function nextUnlock(p: Pick<Profile, "renown">) {
  return UNLOCKS.find((u) => u.at > p.renown) ?? null;
}
export function unlocksBetween(before: number, after: number) {
  return UNLOCKS.filter((u) => u.at > before && u.at <= after);
}

/** Award a feat once. Returns it if newly earned (renown is added). */
export function award(p: Profile, id: string): FeatDef | null {
  if (p.feats.includes(id)) return null;
  const f = FEATS.find((x) => x.id === id);
  if (!f) return null;
  p.feats.push(id);
  p.renown += f.renown;
  return f;
}
/** Award every counter feat whose goal has been reached. */
export function awardStats(p: Profile): FeatDef[] {
  const out: FeatDef[] = [];
  for (const f of FEATS) {
    if (!f.stat || !f.goal) continue;
    if (p.stats[f.stat] >= f.goal) {
      const got = award(p, f.id);
      if (got) out.push(got);
    }
  }
  return out;
}

export function todayKey(d = new Date()) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
