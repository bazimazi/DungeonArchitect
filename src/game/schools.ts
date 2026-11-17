/**
 * Rules v5 data: piece schools (synergies), piece aspects (mastery
 * sidegrades) and elite hero affixes. Pure data and helpers, DOM-free, shared
 * by the simulation, the run logic and the UI.
 */
import type { PieceId, RelicId } from "./defs";

// ---------- Schools: synergies between pieces that share a craft ----------
export type SchoolId =
  "pyre" | "steel" | "stone" | "grave" | "wild" | "arcana" | "guile";
export interface SchoolDef {
  id: SchoolId;
  name: string;
  color: string;
  /** Pieces of this school. Each piece belongs to exactly one school. */
  pieces: PieceId[];
  /** Bonus text at tier II (2 kinds placed) and tier IV (4 kinds placed). */
  tiers: [string, string];
  /** Relic that counts as one more piece of the school. */
  sigil: RelicId;
}
/** Distinct pieces of a school that must be placed to awaken each tier. */
export const SCHOOL_TIERS = [2, 4] as const;
export const SCHOOLS: Record<SchoolId, SchoolDef> = {
  pyre: {
    id: "pyre",
    name: "Pyre",
    color: "#ff7a2f",
    pieces: ["flame", "keg", "imp", "tar"],
    tiers: ["Burns last 50% longer.", "All fire damage +30%."],
    sigil: "sigilPyre",
  },
  steel: {
    id: "steel",
    name: "Steel",
    color: "#d9dde3",
    pieces: ["spikes", "darts", "saw", "beartrap", "crusher"],
    tiers: ["Steel pieces deal +20% damage.", "Steel traps rearm 25% faster."],
    sigil: "sigilSteel",
  },
  stone: {
    id: "stone",
    name: "Stone",
    color: "#a89e90",
    pieces: ["boulder", "golem", "gargoyle", "basilisk", "ogre"],
    tiers: [
      "Stone monsters have +25% health.",
      "Stone pieces deal +30% damage, and their stuns last 50% longer.",
    ],
    sigil: "sigilStone",
  },
  grave: {
    id: "grave",
    name: "Grave",
    color: "#9d7cd8",
    pieces: ["skeleton", "necro", "ghost", "wraith", "lantern"],
    tiers: [
      "Grave monsters deal +20% damage.",
      "Grave monsters rise once more after falling.",
    ],
    sigil: "sigilGrave",
  },
  wild: {
    id: "wild",
    name: "Wild",
    color: "#7fb069",
    pieces: ["bat", "spider", "slime", "archer"],
    tiers: [
      "Beasts move 20% faster and hit 15% harder.",
      "Every beast's hit slows its hero for 1s.",
    ],
    sigil: "sigilWild",
  },
  arcana: {
    id: "arcana",
    name: "Arcana",
    color: "#8fb8ff",
    pieces: ["frost", "pylon", "totem", "gas"],
    tiers: [
      "Arcane pieces deal +25% damage.",
      "Arcane hits brand heroes: +15% damage taken for 3s.",
    ],
    sigil: "sigilArcana",
  },
  guile: {
    id: "guile",
    name: "Guile",
    color: "#e8b84a",
    pieces: ["lure", "mimic", "trapdoor", "spring", "kobold"],
    tiers: [
      "Every hero slain pays +3 gold.",
      "Rogues and rangers spot traps at half range and disarm at half speed.",
    ],
    sigil: "sigilGuile",
  },
};
export const SCHOOL_IDS = Object.keys(SCHOOLS) as SchoolId[];
/** Each piece's school. */
export const PIECE_SCHOOL = Object.fromEntries(
  SCHOOL_IDS.flatMap((s) => SCHOOLS[s].pieces.map((p) => [p, s])),
) as Record<PieceId, SchoolId>;
/** Damage sources that aren't pieces but belong to one (minions). */
const SOURCE_PIECE: Record<string, PieceId> = {
  risen: "necro",
  minislime: "slime",
};
/** The piece a damage or kill source belongs to, if any. */
export function sourcePiece(source: string): PieceId | null {
  if (source in PIECE_SCHOOL) return source as PieceId;
  return SOURCE_PIECE[source] ?? null;
}
export function sourceSchool(source: string): SchoolId | null {
  const p = sourcePiece(source);
  return p ? PIECE_SCHOOL[p] : null;
}

/** School tiers awakened (0, 1 = II, 2 = IV) by the pieces in a dungeon. */
export type SchoolLevels = Record<SchoolId, number>;
export function schoolCounts(
  kinds: Iterable<PieceId>,
  relics: readonly string[] = [],
): Record<SchoolId, number> {
  const seen = new Set(kinds);
  const out = Object.fromEntries(SCHOOL_IDS.map((s) => [s, 0])) as Record<
    SchoolId,
    number
  >;
  for (const k of seen) if (PIECE_SCHOOL[k]) out[PIECE_SCHOOL[k]]++;
  for (const s of SCHOOL_IDS) if (relics.includes(SCHOOLS[s].sigil)) out[s]++;
  return out;
}
export function schoolLevels(
  kinds: Iterable<PieceId>,
  relics: readonly string[] = [],
): SchoolLevels {
  const counts = schoolCounts(kinds, relics);
  const out = {} as SchoolLevels;
  for (const s of SCHOOL_IDS)
    out[s] =
      counts[s] >= SCHOOL_TIERS[1] ? 2 : counts[s] >= SCHOOL_TIERS[0] ? 1 : 0;
  return out;
}

// ---------- Aspects: sidegrades unlocked by mastering a piece ----------
export interface AspectDef {
  piece: PieceId;
  name: string;
  text: string;
}
export const ASPECTS: Record<PieceId, AspectDef> = {
  spikes: {
    piece: "spikes",
    name: "Rusted Spikes",
    text: "40% less damage, but the wound festers: poisoned for 4s.",
  },
  darts: {
    piece: "darts",
    name: "Sleep Darts",
    text: "40% less damage, but every dart slows its hero for 2s.",
  },
  flame: {
    piece: "flame",
    name: "Wildfire",
    text: "The jet reaches 5 tiles, but burns 35% softer.",
  },
  boulder: {
    piece: "boulder",
    name: "Rolling Stone",
    text: "Rolls again 10s after it stops, but crushes 40% softer.",
  },
  trapdoor: {
    piece: "trapdoor",
    name: "Oubliette",
    text: "Heroes land dazed for 2s, but it rearms in 7s instead of 5s.",
  },
  tar: {
    piece: "tar",
    name: "Glue Pool",
    text: "Heroes stay slowed for 2s after leaving it, but it never burns.",
  },
  frost: {
    piece: "frost",
    name: "Rime Rune",
    text: "No freeze. Instead it chills every hero within 1.5 tiles for 4s.",
  },
  spring: {
    piece: "spring",
    name: "Catapult",
    text: "Flings heroes 5 tiles, but rearms in 4s.",
  },
  saw: {
    piece: "saw",
    name: "Bone Saw",
    text: "The blade moves 40% slower but cuts 60% deeper.",
  },
  gas: {
    piece: "gas",
    name: "Choking Fog",
    text: "The cloud spreads to 2.4 tiles, but poisons 40% softer.",
  },
  lure: {
    piece: "lure",
    name: "Gilded Idol",
    text: "Greedy heroes detour from 2 tiles further away.",
  },
  keg: {
    piece: "keg",
    name: "Black Powder",
    text: "A blast 50% wider, but 25% softer, and it lights nothing.",
  },
  pylon: {
    piece: "pylon",
    name: "Tesla Coil",
    text: "Lightning arcs through up to 6 heroes, but 35% softer.",
  },
  crusher: {
    piece: "crusher",
    name: "Piston",
    text: "Slams every 1.8s, but 30% softer and without a stun.",
  },
  totem: {
    piece: "totem",
    name: "Ward of Agony",
    text: "Hexes heroes within 3 tiles, but they take +12% instead of +20%.",
  },
  beartrap: {
    piece: "beartrap",
    name: "Snare",
    text: "No damage, but holds a hero for 4s.",
  },
  lantern: {
    piece: "lantern",
    name: "Will-o'-Wisp",
    text: "Harvests deaths within 3.5 tiles, but pays +30% instead of +60%.",
  },
  skeleton: {
    piece: "skeleton",
    name: "Bone Knight",
    text: "Never reassembles, but has 70% more health and 30% more damage.",
  },
  archer: {
    piece: "archer",
    name: "Fire Archer",
    text: "Flaming arrows burn heroes and light tar, but deal 25% less.",
  },
  slime: {
    piece: "slime",
    name: "Acid Slime",
    text: "Never splits, but every hit poisons for 3s.",
  },
  ogre: {
    piece: "ogre",
    name: "Ogre Brute",
    text: "No knockback, but hits 40% harder.",
  },
  bat: {
    piece: "bat",
    name: "Vampire Bats",
    text: "15% less health, but heals 60% of the damage it deals.",
  },
  necro: {
    piece: "necro",
    name: "Bone Lord",
    text: "Raises the dead from 5.5 tiles and keeps 5, but they have half health.",
  },
  mimic: {
    piece: "mimic",
    name: "Greedy Maw",
    text: "Lures from 3 tiles further, but bites 30% softer.",
  },
  imp: {
    piece: "imp",
    name: "Ember Imp",
    text: "Fireballs splash 1.6 tiles wide, but deal 30% less.",
  },
  ghost: {
    piece: "ghost",
    name: "Banshee",
    text: "Its touch no longer terrifies. Every 6s, a wail frightens every hero within 2 tiles.",
  },
  spider: {
    piece: "spider",
    name: "Brood Mother",
    text: "Webs hold for 4s, but bite 40% softer.",
  },
  golem: {
    piece: "golem",
    name: "Iron Golem",
    text: "Takes 35% less damage, but heroes are no longer forced to fight it.",
  },
  gargoyle: {
    piece: "gargoyle",
    name: "Sentinel",
    text: "Never sleeps as stone, but hits 30% harder.",
  },
  wraith: {
    piece: "wraith",
    name: "Soul Eater",
    text: "Drains all the damage it deals, but has 30% less health.",
  },
  basilisk: {
    piece: "basilisk",
    name: "Cockatrice",
    text: "Its gaze returns every 3.5s, but holds a hero for only 1s.",
  },
  kobold: {
    piece: "kobold",
    name: "Kobold Bomber",
    text: "No repairs. Every 6s, lobs a firebomb at the nearest hero within 3.5 tiles.",
  },
};

// ---------- Affixes: elite heroes carry a visible extra rule ----------
export type AffixId =
  | "vampiric"
  | "warded"
  | "swift"
  | "steadfast"
  | "thorned"
  | "regen"
  | "salamander"
  | "gilded";
export interface AffixDef {
  id: AffixId;
  name: string;
  text: string;
  color: string;
  /** First depth where it rolls (any depth in the abyss). */
  from: number;
}
export const AFFIXES: Record<AffixId, AffixDef> = {
  swift: {
    id: "swift",
    name: "Swift",
    text: "Moves 20% faster.",
    color: "#9fe0ff",
    from: 2,
  },
  warded: {
    id: "warded",
    name: "Warded",
    text: "A ward absorbs damage equal to a quarter of its health.",
    color: "#c9d8ff",
    from: 2,
  },
  gilded: {
    id: "gilded",
    name: "Gilded",
    text: "Pays triple bounty, but steals 2 extra treasure.",
    color: "#ffd166",
    from: 2,
  },
  vampiric: {
    id: "vampiric",
    name: "Vampiric",
    text: "Heals 30% of the damage it deals.",
    color: "#ff5a6a",
    from: 3,
  },
  regen: {
    id: "regen",
    name: "Regenerating",
    text: "Recovers 2% of its health every second.",
    color: "#7fe0a0",
    from: 4,
  },
  thorned: {
    id: "thorned",
    name: "Thorned",
    text: "Monsters that strike it take 30% of the damage back.",
    color: "#b5e07a",
    from: 5,
  },
  steadfast: {
    id: "steadfast",
    name: "Steadfast",
    text: "Stuns, freezes and fear wear off twice as fast.",
    color: "#e0c090",
    from: 6,
  },
  salamander: {
    id: "salamander",
    name: "Salamander",
    text: "Takes 60% less fire and poison damage.",
    color: "#ff9a4a",
    from: 7,
  },
};
export const AFFIX_IDS = Object.keys(AFFIXES) as AffixId[];
