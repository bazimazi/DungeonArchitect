/**
 * Rules v5 meta progression: piece mastery (unlocks aspects), the bestiary,
 * daily bounties and architect levels. Everything here widens options or
 * pays renown; nothing permanently raises your dungeon's numbers.
 */
import { Rng, hashString } from "../engine/math";
import {
  HEROES,
  PIECES,
  isChampion,
  roman,
  type ArchitectId,
  type HeroClass,
  type PieceId,
  type RelicId,
} from "./defs";
import {
  ASPECTS,
  SCHOOLS,
  SCHOOL_IDS,
  sourcePiece,
  type SchoolId,
} from "./schools";
import type { RaidResult } from "./sim";

// ---------- Piece mastery ----------
/** Lifetime kills needed for each mastery rank (I–IV). */
export const MASTERY_AT = [10, 40, 120, 300] as const;
/** Renown paid on reaching each rank. */
export const MASTERY_RENOWN = [1, 3, 6, 10] as const;
/** The rank (index + 1) that unlocks a piece's aspect. */
export const ASPECT_RANK = 2;
export const MASTERY_NAMES = [
  "Unranked",
  "Adept",
  "Expert",
  "Master",
  "Mythic",
];
export function masteryRank(kills: number) {
  let r = 0;
  while (r < MASTERY_AT.length && kills >= MASTERY_AT[r]) r++;
  return r;
}
export function masteryProgress(kills: number) {
  const rank = masteryRank(kills);
  const prev = rank > 0 ? MASTERY_AT[rank - 1] : 0;
  const next = rank < MASTERY_AT.length ? MASTERY_AT[rank] : null;
  return {
    rank,
    name: MASTERY_NAMES[rank],
    prev,
    next,
    frac: next === null ? 1 : (kills - prev) / (next - prev),
  };
}
export const aspectUnlocked = (kills: number) =>
  masteryRank(kills) >= ASPECT_RANK;

// ---------- Bestiary ----------
/** Kills of a class for each bestiary mark; champions need far fewer. */
export const BESTIARY_AT = [10, 50, 200] as const;
export const BESTIARY_CHAMPION_AT = [1, 5, 15] as const;
export const BESTIARY_RENOWN = [1, 2, 4] as const;
export const BESTIARY_NAMES = ["Sighted", "Studied", "Mastered"];
export function bestiaryMarks(cls: HeroClass, kills: number) {
  const at = isChampion(cls) ? BESTIARY_CHAMPION_AT : BESTIARY_AT;
  let m = 0;
  while (m < at.length && kills >= at[m]) m++;
  return m;
}
export function bestiaryNext(cls: HeroClass, kills: number) {
  const at = isChampion(cls) ? BESTIARY_CHAMPION_AT : BESTIARY_AT;
  const m = bestiaryMarks(cls, kills);
  return m < at.length ? at[m] : null;
}
/** A line of lore per class, revealed by the second bestiary mark. */
export const LORE: Record<HeroClass, string> = {
  knight:
    "Third sons of minor houses, sworn to whichever banner pays for the polish.",
  rogue: "Guild cutpurses who learned that dungeons don't call the watch.",
  cleric:
    "The temples tithe every hoard they recover. Their healers walk behind for a reason.",
  mage: "College dropouts with a fireball and a debt.",
  ranger: "They read a trapped corridor the way farmers read the weather.",
  dwarf: "Every dwarf believes the shortest route is through the wall.",
  berserker:
    "Northmen who drink before the raid and don't remember the way out.",
  bard: "They come for the song, not the gold. The song is about the gold.",
  windcaller: "Sky-priests who never touch the floor, on principle.",
  inquisitor:
    "The Order keeps a list of every dungeon that raises its dead. Yours is on it.",
  sapper: "The engineers' guild charges by the trap.",
  druid: "The moss remembers who dug these halls, and takes it personally.",
  paladin:
    "Sir Aldric has led eleven crusades. He has never once taken the stairs back.",
  archmage:
    "Veyla writes a monograph about every dungeon she robs. They are unflattering.",
  warlord: "Grukk counts his victories in broken floor plates.",
  thane: "Brannoc's clan dug these tunnels first. He wants the rent.",
  shade: "No one has seen Nyx. Several have seen where she was.",
  revenant: "The Hollow King died in a dungeon like yours. He liked it.",
  monk: "They spend ten years learning to catch a dart. They practise on yours.",
  templar:
    "The shield-wall of the Church Militant. Where he stands, the faithful stand longer.",
  witch: "Morrigan has unmade a hundred clockworks. She finds yours charming.",
};

// ---------- Architect levels ----------
/** Architect XP for each level (level 1 at 0). */
export const ARCH_LEVEL_AT = [0, 12, 30, 55, 90, 135, 190, 255, 330, 420];
export const ARCH_MAX_LEVEL = ARCH_LEVEL_AT.length;
/** What each level grants (besides renown). */
export const ARCH_REWARDS: Record<number, string> = {
  2: "Alternate starting kit",
  4: "Signature relic joins your drafts",
  7: "Gilded portrait",
  10: "Paragon title",
};
export const archLevelRenown = (level: number) => 2 + level;
export const ALT_KIT_LEVEL = 2;
export const SIGNATURE_LEVEL = 4;
export function archLevel(xp: number) {
  let l = 1;
  while (l < ARCH_MAX_LEVEL && xp >= ARCH_LEVEL_AT[l]) l++;
  const prev = ARCH_LEVEL_AT[l - 1];
  const next = l < ARCH_MAX_LEVEL ? ARCH_LEVEL_AT[l] : null;
  return {
    level: l,
    prev,
    next,
    frac: next === null ? 1 : (xp - prev) / (next - prev),
  };
}
/** XP for surviving a night: 1, plus 1 per star. A won descent adds 10. */
export const nightXp = (stars: number) => 1 + stars;
export const WIN_XP = 10;
/** Alternate kits, unlocked at architect level 2. */
export const ALT_KITS: Record<ArchitectId, { name: string; start: PieceId[] }> =
  {
    mason: {
      name: "Stonewright",
      start: ["spikes", "boulder", "skeleton", "lure"],
    },
    trickster: {
      name: "Prankster",
      start: ["spring", "trapdoor", "keg", "lure"],
    },
    lich: { name: "Gravecaller", start: ["skeleton", "ghost", "bat", "lure"] },
    beastmaster: {
      name: "Packlord",
      start: ["slime", "archer", "spider", "lure"],
    },
    alchemist: {
      name: "Toxicologist",
      start: ["gas", "spider", "frost", "lure"],
    },
    tinkerer: { name: "Clockmaker", start: ["pylon", "saw", "kobold", "lure"] },
    warden: {
      name: "Jailer",
      start: ["trapdoor", "beartrap", "skeleton", "lure"],
    },
  };
/** The signature relic each architect brings to their drafts at level 4. */
export const SIGNATURE: Record<ArchitectId, RelicId> = {
  mason: "masterTools",
  trickster: "loadedDice",
  lich: "soulJar",
  beastmaster: "alphaHowl",
  alchemist: "flask",
  tinkerer: "clockwork",
  warden: "vaultSeal",
};

// ---------- Bounties: three daily contracts ----------
export type BountyKind =
  | "classKills"
  | "schoolKills"
  | "stars"
  | "flawless"
  | "combo"
  | "fireKills"
  | "falls"
  | "powerKills"
  | "eliteKills"
  | "gold"
  | "awaken"
  | "pieceKills";
export interface Bounty {
  kind: BountyKind;
  /** Class, school or piece the bounty names. */
  ref?: string;
  goal: number;
  renown: number;
}
export interface BountyBoard {
  day: string;
  bounties: Bounty[];
  progress: number[];
  /** Renown already paid for each bounty. */
  paid: boolean[];
}
const BOUNTY_CLASSES: HeroClass[] = [
  "knight",
  "rogue",
  "cleric",
  "ranger",
  "mage",
  "dwarf",
  "berserker",
];
const BOUNTY_PIECES: PieceId[] = [
  "spikes",
  "darts",
  "skeleton",
  "archer",
  "slime",
  "flame",
  "frost",
  "keg",
  "spring",
  "tar",
];
type BountyMaker = (r: Rng) => Bounty;
const MAKERS: BountyMaker[] = [
  (r) => ({
    kind: "classKills",
    ref: r.pick(BOUNTY_CLASSES),
    goal: r.int(6, 10),
    renown: 3,
  }),
  (r) => ({
    kind: "schoolKills",
    ref: r.pick(SCHOOL_IDS),
    goal: r.int(8, 14),
    renown: 5,
  }),
  (r) => ({ kind: "stars", goal: r.int(10, 16), renown: 4 }),
  (r) => ({ kind: "flawless", goal: r.int(2, 4), renown: 4 }),
  (r) => ({ kind: "combo", goal: r.int(4, 6), renown: 4 }),
  (r) => ({ kind: "fireKills", goal: r.int(6, 10), renown: 4 }),
  (r) => ({ kind: "falls", goal: r.int(4, 8), renown: 3 }),
  (r) => ({ kind: "powerKills", goal: r.int(3, 6), renown: 3 }),
  (r) => ({ kind: "eliteKills", goal: r.int(2, 4), renown: 5 }),
  (r) => ({ kind: "gold", goal: 50 * r.int(5, 9), renown: 3 }),
  (r) => ({ kind: "awaken", ref: r.pick(SCHOOL_IDS), goal: 2, renown: 5 }),
  (r) => ({
    kind: "pieceKills",
    ref: r.pick(BOUNTY_PIECES),
    goal: r.int(6, 10),
    renown: 3,
  }),
];
/** Bonus renown for clearing the whole board. */
export const BOARD_BONUS = 5;
/** The day's three bounties: the same for everyone, no two of a kind. */
export function bountiesFor(day: string): Bounty[] {
  const r = new Rng(hashString(`bounty:${day}`));
  const makers = r.shuffle([...MAKERS.keys()]).slice(0, 3);
  return makers.map((i) => MAKERS[i](r));
}
export function boardFor(day: string, old?: BountyBoard | null): BountyBoard {
  if (old && old.day === day && old.bounties?.length === 3) return old;
  return {
    day,
    bounties: bountiesFor(day),
    progress: [0, 0, 0],
    paid: [false, false, false],
  };
}
const n = (v: number) => (v === 1 ? "" : "s");
export function bountyText(b: Bounty) {
  switch (b.kind) {
    case "classKills":
      return `Slay ${b.goal} ${HEROES[b.ref as HeroClass].name.toLowerCase()}${n(b.goal)}.`;
    case "schoolKills":
      return `Slay ${b.goal} heroes with ${SCHOOLS[b.ref as SchoolId].name} pieces.`;
    case "stars":
      return `Earn ${b.goal} stars.`;
    case "flawless":
      return `Earn three stars on ${b.goal} nights.`;
    case "combo":
      return `Reach a ${b.goal}× kill combo.`;
    case "fireKills":
      return `Burn ${b.goal} heroes to death.`;
    case "falls":
      return `Drop heroes into pits ${b.goal} times.`;
    case "powerKills":
      return `Slay ${b.goal} heroes with your powers.`;
    case "eliteKills":
      return `Slay ${b.goal} elite heroes.`;
    case "gold":
      return `Collect ${b.goal} gold in bounties.`;
    case "awaken":
      return `Win a night with ${SCHOOLS[b.ref as SchoolId].name} at tier IV.`;
    case "pieceKills":
      return `Slay ${b.goal} heroes with the ${PIECES[b.ref as PieceId].name}.`;
  }
}
/** What one night contributes to a bounty. */
export function bountyGain(
  b: Bounty,
  r: Pick<
    RaidResult,
    | "kills"
    | "classKills"
    | "fireKills"
    | "falls"
    | "powerKills"
    | "eliteKills"
    | "gold"
    | "bestCombo"
    | "schools"
  >,
  stars: number,
): number {
  switch (b.kind) {
    case "classKills":
      return r.classKills?.[b.ref!] ?? 0;
    case "schoolKills": {
      let k = 0;
      for (const [src, v] of Object.entries(r.kills)) {
        const p = sourcePiece(src);
        if (p && SCHOOLS[b.ref as SchoolId].pieces.includes(p)) k += v;
      }
      return k;
    }
    case "stars":
      return stars;
    case "flawless":
      return stars === 3 ? 1 : 0;
    case "combo":
      // A high-water mark, not a sum.
      return r.bestCombo;
    case "fireKills":
      return r.fireKills;
    case "falls":
      return r.falls;
    case "powerKills":
      return r.powerKills;
    case "eliteKills":
      return r.eliteKills ?? 0;
    case "gold":
      return r.gold;
    case "awaken":
      return stars > 0 && (r.schools?.[b.ref as SchoolId] ?? 0) >= 2 ? 2 : 0;
    case "pieceKills": {
      let k = 0;
      for (const [src, v] of Object.entries(r.kills))
        if (sourcePiece(src) === b.ref) k += v;
      return k;
    }
  }
}
/** Bounties whose progress is a best value rather than a running total. */
export const isRecord = (b: Bounty) =>
  b.kind === "combo" || b.kind === "awaken";

/** Short label for a mastery rank. */
export const rankLabel = (rank: number) =>
  rank === 0 ? MASTERY_NAMES[0] : `${roman(rank)} · ${MASTERY_NAMES[rank]}`;
export const aspectOf = (p: PieceId) => ASPECTS[p];
