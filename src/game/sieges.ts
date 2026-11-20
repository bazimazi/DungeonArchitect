/**
 * Rules v7: sieges. Every champion and realm lord you have slain opens an
 * endless ladder of single-night sieges against them. A siege hands you a
 * fixed treasury, every blueprint you have unlocked (at tier III), and a
 * fixed floorplan, party and seed for each level, so a level can be studied
 * and retried. The Sanctum applies in full: sieges are where lasting power
 * is put to the test.
 *
 * Clearing a level for the first time raises that champion's trophy, a
 * permanent Sanctum bonus that grows with every level cleared, and pays
 * souls, infamy and an heirloom. Siege level L faces the champion's party
 * from the final night of depth 2L + 1, with heroes as strong as night
 * 4 + L (night ten from level 6), so the ladder climbs with the depths.
 */
import { Rng, hashString } from "../engine/math";
import {
  BIOME_IDS,
  CHAMPIONS,
  HEROES,
  NIGHTS,
  RELICS,
  TUNE,
  type BiomeId,
  type RelicId,
  type ChampionId,
  type HeroClass,
} from "./defs";
import { generateLayout, type Layout } from "./grid";
import { deepCapacity, heatFor, partyFor, planFor, raidMods } from "./run";
import type { PartyMember, RaidMods } from "./sim";
import { AFFIXES, AFFIX_IDS, type AffixId } from "./schools";
import { earnMul, type RunMeta } from "./meta";
import type { FloorplanId } from "./defs";

export const SIEGE_BOSSES: readonly ChampionId[] = CHAMPIONS;

/** A siege starts where a descent ends: a full night-ten dungeon to build. */
export const TUNE_SIEGE = {
  /** Treasury: gold + goldPer × level. */
  gold: 1100,
  goldPer: 50,
  /** Pieces: as many as night ten holds, plus a few more as levels climb. */
  cap: TUNE.capBase + TUNE.capPerNight * NIGHTS,
  capMax: 6,
  /** Every blueprint starts at this tier. */
  tier: 3,
  /** Relics in the siege armory: 1, and one more every 4 levels. */
  relicsMax: 4,
};

/** The depth whose final night a siege level plays like. */
export const siegeDepth = (level: number) => 1 + 2 * Math.max(1, level);
/** Hero strength follows this night: the first levels are gentler. */
export const siegeNight = (level: number) =>
  Math.min(NIGHTS, 4 + Math.max(1, level));

export interface SiegeDef {
  boss: ChampionId;
  level: number;
  depth: number;
  seed: number;
  biome: BiomeId;
  plan: FloorplanId;
  party: PartyMember[];
  gold: number;
  /** Most pieces the player may place. */
  cap: number;
  hoard: number;
  /** Relics the siege armory lends (fixed per level). */
  relics: RelicId[];
}

/** Affixes the champion carries at a siege level. */
export const bossAffixes = (level: number) =>
  level >= 15 ? 3 : level >= 8 ? 2 : level >= 3 ? 1 : 0;

export function siegeDef(boss: ChampionId, level: number): SiegeDef {
  const L = Math.max(1, Math.floor(level));
  const depth = siegeDepth(L);
  const seed = hashString(`siege:${boss}:${L}`);
  const plan = planFor(depth);
  // Night ten of a descent at this depth, led by the chosen champion.
  const party = partyFor({ seed, depth, mutators: [], boss }, NIGHTS).map(
    (p) => ({ ...p, affixes: p.affixes ? [...p.affixes] : undefined }),
  );
  const rng = new Rng((seed ^ 0x51e6e) >>> 0);
  const lead = party.find((p) => p.cls === boss);
  const n = bossAffixes(L);
  if (lead && n) {
    const pool = rng.shuffle(
      AFFIX_IDS.filter((a) => AFFIXES[a].from <= depth),
    ) as AffixId[];
    lead.affixes = pool.slice(0, n);
  }
  return {
    boss,
    level: L,
    depth,
    seed,
    biome: BIOME_IDS[rng.int(0, BIOME_IDS.length - 1)],
    plan,
    party,
    gold: TUNE_SIEGE.gold + TUNE_SIEGE.goldPer * L,
    cap:
      TUNE_SIEGE.cap +
      deepCapacity(depth) +
      Math.min(TUNE_SIEGE.capMax, Math.floor(L / 3)),
    hoard: 12 - heatFor(depth).hoardPenalty,
    relics: rng
      .shuffle(
        (Object.keys(RELICS) as RelicId[]).filter((r) => !RELICS[r].arch),
      )
      .slice(0, Math.min(TUNE_SIEGE.relicsMax, 1 + Math.floor(L / 4))),
  };
}

/** The map of a siege level (fixed). */
export function siegeLayout(d: SiegeDef): Layout {
  return generateLayout(d.seed, d.biome, {
    veins: 1,
    variant: d.seed,
    plan: d.plan,
  });
}

/** Raid rules for a siege: night ten at its depth, plus the Sanctum. */
export function siegeMods(
  d: SiegeDef,
  o: {
    architect: string;
    tiers: RaidMods["tiers"];
    aspects?: RaidMods["aspects"];
    meta?: RunMeta | null;
    /** Relics in play (defaults to the siege's own). */
    relics?: RelicId[];
  },
): RaidMods {
  return raidMods({
    night: siegeNight(d.level),
    depth: d.depth,
    mutators: [],
    architect: o.architect as never,
    relics: o.relics ?? d.relics,
    tiers: o.tiers,
    aspects: o.aspects ?? [],
    ...(o.meta ? { meta: o.meta } : {}),
  });
}

/** Stars: the champion slain (and the hoard kept), nothing stolen, no survivors. */
export function siegeStars(o: {
  bossSlain: boolean;
  hoardLeft: number;
  stolen: number;
  escaped: number;
}) {
  if (!o.bossSlain || o.hoardLeft <= 0) return 0;
  return 1 + (o.stolen === 0 ? 1 : 0) + (o.escaped === 0 ? 1 : 0);
}

/** Can this champion be besieged yet? (Slay them once in a descent.) */
export const siegeOpen = (
  p: { bestiary: Record<string, number> },
  boss: ChampionId,
) => (p.bestiary[boss] ?? 0) >= 1;
/** Highest level that may be attempted: one past the best cleared. */
export const siegeFrontier = (
  p: { trophies: Record<string, number> },
  boss: string,
) => (p.trophies[boss] ?? 0) + 1;

/** What clearing a level pays. Replays pay a tenth of the souls. */
export function siegeReward(
  level: number,
  stars: number,
  first: boolean,
  soulBonus = 0,
) {
  const depth = siegeDepth(level);
  const mul = earnMul({ depth, night: NIGHTS });
  const starMul = 1 + 0.25 * Math.max(0, stars - 1);
  const souls = Math.round(
    (60 + 30 * level) * mul * starMul * (first ? 1 : 0.1) * (1 + soulBonus),
  );
  const infamy = first ? Math.round((30 + 10 * level) * mul) : 0;
  return { souls, infamy, heirloom: first };
}

/** Classes a siege party can show (for previews). */
export const siegeRoster = (d: SiegeDef): HeroClass[] =>
  d.party.map((p) => p.cls).filter((c) => !!HEROES[c]);
