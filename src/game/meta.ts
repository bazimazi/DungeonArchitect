/**
 * Rules v6: the Sanctum. Long-term progression that does raise numbers,
 * paid for with souls and infamy earned in every descent.
 *
 * - Souls: a spendable currency earned every night (more at greater depth,
 *   heat and in the abyss), from bounties, dailies, trials, feats and the
 *   Soul Well that fills while you are away.
 * - Dungeon Heart: attribute upgrades bought with souls. Most never cap;
 *   costs grow geometrically, so there is always a next step.
 * - The Forge: every piece has its own level (capped by its mastery rank
 *   until rank IV, then endless) and three rows of talents to choose from.
 * - Infamy: an endless architect-wide level. Each level is a talent point
 *   for the Dark Arts tree (three branches, keystones and endless paragon
 *   nodes). Respecs are free.
 * - Heirlooms: equipment found in descents, with a rarity, an item level
 *   that follows depth, rolled affixes and legendary powers. Temper them
 *   with souls or salvage them for souls.
 *
 * A run snapshots every bonus when it starts (`RunMeta`), so a descent keeps
 * the same rules from first night to last and replays stay deterministic.
 * Dailies, trials, the workshop and raid links never use the Sanctum, so
 * shared and seeded content stays fair. A descent can also be started with
 * the Sanctum's power sealed (a "pure" descent) for records and feats.
 */
import { Rng, hashString } from "../engine/math";
import {
  NIGHTS,
  PIECES,
  heatOf,
  heatRenown,
  isLordDepth,
  type OmenId,
  type PieceId,
} from "./defs";
import { masteryRank } from "./progression";

// ---------------- stats ----------------
/** Every bonus the Sanctum can grant. Percent stats are fractions (0.1 = +10%). */
export type MetaStat =
  | "trapDmg"
  | "monsterHp"
  | "monsterDmg"
  | "monsterSpd"
  | "rearm"
  | "fireDmg"
  | "powerDmg"
  | "bossDmg"
  | "bounty"
  | "tribute"
  | "startGold"
  | "hoard"
  | "dread"
  | "capacity"
  | "souls"
  | "infamy"
  | "reroll"
  | "refund"
  | "reinforce"
  | "draft"
  | "luck"
  | "well";

export interface StatInfo {
  name: string;
  /** Percent stats show as +x%; flat stats as +x. */
  pct: boolean;
  /** Hard cap on the summed value, where one is needed. */
  cap?: number;
}
export const STATS: Record<MetaStat, StatInfo> = {
  trapDmg: { name: "Trap damage", pct: true },
  monsterHp: { name: "Monster health", pct: true },
  monsterDmg: { name: "Monster damage", pct: true },
  monsterSpd: { name: "Monster speed", pct: true, cap: 0.3 },
  rearm: { name: "Trap rearm speed", pct: true, cap: 0.5 },
  fireDmg: { name: "Fire & poison damage", pct: true },
  powerDmg: { name: "Power damage", pct: true },
  bossDmg: { name: "Damage to elites & champions", pct: true },
  bounty: { name: "Hero bounty gold", pct: true, cap: 1 },
  tribute: { name: "Dawn tribute", pct: true, cap: 1 },
  startGold: { name: "Starting gold", pct: false, cap: 150 },
  hoard: { name: "Treasure in the hoard", pct: false, cap: 6 },
  dread: { name: "Starting & max dread", pct: false, cap: 6 },
  capacity: { name: "Piece capacity", pct: false, cap: 4 },
  souls: { name: "Souls earned", pct: true },
  infamy: { name: "Infamy earned", pct: true },
  reroll: { name: "Draft reroll discount (gold)", pct: false, cap: 30 },
  refund: { name: "Sell refund", pct: true, cap: 0.25 },
  reinforce: { name: "Reinforce discount", pct: true, cap: 0.6 },
  draft: { name: "Cards per draft", pct: false, cap: 2 },
  luck: { name: "Heirloom find chance", pct: true },
  well: { name: "Soul Well output", pct: true },
};
export const STAT_IDS = Object.keys(STATS) as MetaStat[];
export type StatBlock = Partial<Record<MetaStat, number>>;

const r2 = (v: number) => Math.round(v * 1000) / 1000;
export function statText(stat: MetaStat, v: number) {
  const s = STATS[stat];
  if (s.pct) {
    const p = Math.round(v * 1000) / 10;
    return `${p >= 0 ? "+" : ""}${p}% ${s.name.toLowerCase()}`;
  }
  return `${v >= 0 ? "+" : ""}${Math.round(v * 10) / 10} ${s.name.toLowerCase()}`;
}
const add = (into: StatBlock, stat: MetaStat, v: number) => {
  if (!v) return;
  into[stat] = r2((into[stat] ?? 0) + v);
};

// ---------------- currencies ----------------
/** What the Sanctum keeps in a profile. */
export interface MetaProfile {
  /** Souls in hand. */
  souls: number;
  /** Infamy experience (lifetime). */
  infamyXp: number;
  /** Dungeon Heart upgrade levels. */
  heart: Record<string, number>;
  /** Forge level of each piece. */
  forge: Record<string, number>;
  /** Forge talent picks per piece: one entry per row, -1 for none. */
  ptalents: Record<string, number[]>;
  /** Dark Arts ranks per talent. */
  talents: Record<string, number>;
  /** Heirlooms owned. */
  heirlooms: Heirloom[];
  /** Ids of equipped heirlooms. */
  equipped: number[];
  /** Next heirloom id. */
  nextItem: number;
  /** When the Soul Well was last emptied (ms since epoch; 0 = never). */
  wellAt: number;
  /** The last descent was started with the Sanctum sealed. */
  pure?: boolean;
}
export const defaultMeta = (): MetaProfile => ({
  souls: 0,
  infamyXp: 0,
  heart: {},
  forge: {},
  ptalents: {},
  talents: {},
  heirlooms: [],
  equipped: [],
  nextItem: 1,
  wellAt: 0,
});

// ---------------- infamy ----------------
/** Infamy needed to go from level l to l + 1. */
export const infamyStep = (l: number) => 40 + 20 * (l - 1);
export function infamyLevel(xp: number) {
  let l = 1;
  let at = 0;
  // Levels are cheap to walk: even a million XP is ~300 levels.
  while (xp >= at + infamyStep(l)) {
    at += infamyStep(l);
    l++;
  }
  const step = infamyStep(l);
  return { level: l, prev: at, next: at + step, frac: (xp - at) / step };
}
/** Total talent points earned: one per level past the first. */
export const talentPoints = (xp: number) => infamyLevel(xp).level - 1;
/** Heirloom slots: 3, a fourth at infamy 10 and a fifth at infamy 25. */
export const SLOT_LEVELS = [1, 1, 1, 10, 25];
export const heirloomSlots = (xp: number) =>
  SLOT_LEVELS.filter((l) => infamyLevel(xp).level >= l).length;

// ---------------- earning ----------------
export interface EarnCtx {
  depth: number;
  omens?: readonly OmenId[];
  /** Night number (past ten is the abyss). */
  night: number;
}
/** Shared multiplier: deeper, hotter and abyssal nights pay more. */
export function earnMul(c: EarnCtx) {
  const depth = Math.max(1, c.depth);
  const abyss = c.night > NIGHTS ? 1.5 : 1;
  return (1 + 0.12 * (depth - 1)) * heatRenown(heatOf(c.omens ?? [])) * abyss;
}
/** Souls for one raid night. */
export function nightSouls(
  c: EarnCtx,
  o: { killed: number; stars: number },
  bonus = 0,
) {
  const base = 2 + o.killed + 3 * o.stars;
  return Math.round(base * earnMul(c) * (1 + bonus));
}
/** Souls for conquering a depth (night ten). Realm lords pay half again. */
export function winSouls(c: Omit<EarnCtx, "night">, bonus = 0) {
  const base = (30 + 10 * c.depth) * (isLordDepth(c.depth) ? 1.5 : 1);
  return Math.round(base * earnMul({ ...c, night: NIGHTS }) * (1 + bonus));
}
/** Infamy for one raid night (survived or not). */
export function nightInfamy(
  c: EarnCtx,
  o: { killed: number; stars: number },
  bonus = 0,
) {
  const base = 3 + 2 * o.stars + o.killed * 0.5;
  return Math.round(base * earnMul(c) * (1 + bonus));
}
export function winInfamy(c: Omit<EarnCtx, "night">, bonus = 0) {
  return Math.round(
    (40 + 8 * c.depth) * earnMul({ ...c, night: NIGHTS }) * (1 + bonus),
  );
}
/** Souls paid by other parts of the game. */
export const SOULS = {
  bounty: 15,
  board: 25,
  /** Per renown a feat pays. */
  feat: 5,
  trialStar: 10,
  daily: 30,
  dailyStar: 4,
} as const;

// ---------------- Dungeon Heart ----------------
export interface HeartDef {
  id: string;
  name: string;
  stat: MetaStat;
  /** Effect per level. */
  per: number;
  /** Highest level (none: endless). */
  max?: number;
  /** Cost of the first level and growth per level. */
  base: number;
  growth: number;
  /** Infamy level that reveals the upgrade. */
  infamy: number;
  flavor: string;
}
export const HEART: HeartDef[] = [
  {
    id: "whetstone",
    name: "Whetstone",
    stat: "trapDmg",
    per: 0.015,
    base: 25,
    growth: 1.13,
    infamy: 1,
    flavor: "Every blade in the dungeon, sharpened by restless hands.",
  },
  {
    id: "ironhide",
    name: "Iron Hide",
    stat: "monsterHp",
    per: 0.02,
    base: 25,
    growth: 1.13,
    infamy: 1,
    flavor: "The Heart's pulse thickens the hide of everything it feeds.",
  },
  {
    id: "bloodlust",
    name: "Bloodlust",
    stat: "monsterDmg",
    per: 0.015,
    base: 25,
    growth: 1.13,
    infamy: 1,
    flavor: "Your creatures can smell the gold the heroes carry.",
  },
  {
    id: "coffers",
    name: "Deep Coffers",
    stat: "startGold",
    per: 4,
    max: 20,
    base: 30,
    growth: 1.15,
    infamy: 1,
    flavor: "A purse put aside before the first night.",
  },
  {
    id: "brimstone",
    name: "Brimstone",
    stat: "fireDmg",
    per: 0.02,
    base: 30,
    growth: 1.14,
    infamy: 2,
    flavor: "Sulphur seeps from the walls and feeds every flame.",
  },
  {
    id: "tithe",
    name: "Tithe",
    stat: "tribute",
    per: 0.02,
    max: 25,
    base: 35,
    growth: 1.15,
    infamy: 2,
    flavor: "The surface villages pay more, and pay sooner.",
  },
  {
    id: "wrath",
    name: "Wrath of the Deep",
    stat: "powerDmg",
    per: 0.04,
    base: 30,
    growth: 1.14,
    infamy: 3,
    flavor: "Your rockfalls land heavier, your chills bite deeper.",
  },
  {
    id: "bloodprice",
    name: "Blood Price",
    stat: "bounty",
    per: 0.02,
    max: 25,
    base: 35,
    growth: 1.15,
    infamy: 3,
    flavor: "Fence the heroes' gear before the bodies cool.",
  },
  {
    id: "cogs",
    name: "Oiled Cogs",
    stat: "rearm",
    per: 0.015,
    max: 20,
    base: 40,
    growth: 1.16,
    infamy: 4,
    flavor: "Springs wound tighter. Gears that never squeal.",
  },
  {
    id: "slayer",
    name: "Giant Slayer",
    stat: "bossDmg",
    per: 0.02,
    base: 40,
    growth: 1.14,
    infamy: 5,
    flavor: "The bigger the hero, the more the dungeon hates them.",
  },
  {
    id: "harvest",
    name: "Soul Harvest",
    stat: "souls",
    per: 0.05,
    base: 60,
    growth: 1.2,
    infamy: 5,
    flavor: "Not a single soul slips through the cracks.",
  },
  {
    id: "dreadwell",
    name: "Dread Well",
    stat: "dread",
    per: 1,
    max: 3,
    base: 120,
    growth: 1.8,
    infamy: 6,
    flavor: "Fear pools in the deepest cistern, waiting for nightfall.",
  },
  {
    id: "library",
    name: "Black Library",
    stat: "infamy",
    per: 0.05,
    max: 20,
    base: 50,
    growth: 1.18,
    infamy: 7,
    flavor: "Every raid is studied. Every scream is catalogued.",
  },
  {
    id: "vault",
    name: "Vault Walls",
    stat: "hoard",
    per: 1,
    max: 3,
    base: 150,
    growth: 2,
    infamy: 8,
    flavor: "A deeper vault holds more treasure to lose.",
  },
  {
    id: "fortune",
    name: "Fortune",
    stat: "luck",
    per: 0.05,
    max: 20,
    base: 60,
    growth: 1.18,
    infamy: 9,
    flavor: "Heroes carry family treasures. Now they leave them behind.",
  },
  {
    id: "spring",
    name: "Deep Spring",
    stat: "well",
    per: 0.1,
    max: 20,
    base: 50,
    growth: 1.17,
    infamy: 10,
    flavor: "The Soul Well draws from a deeper spring.",
  },
  {
    id: "expanse",
    name: "Expanse",
    stat: "capacity",
    per: 1,
    max: 2,
    base: 600,
    growth: 3,
    infamy: 12,
    flavor: "The halls stretch further than the heroes' maps.",
  },
];
export const heartDef = (id: string) => HEART.find((h) => h.id === id);
export function heartCost(def: HeartDef, level: number) {
  if (def.max !== undefined && level >= def.max) return null;
  return Math.round(def.base * Math.pow(def.growth, level));
}

// ---------------- the Forge ----------------
/** Forge level cap for each mastery rank (rank IV: endless). */
export const FORGE_CAP = [3, 8, 15, 25, Infinity] as const;
export const FORGE_PER = 0.015;
export const forgeCap = (kills: number) => FORGE_CAP[masteryRank(kills)];
export function forgeCost(level: number) {
  return Math.round(15 * Math.pow(1.15, level));
}
/** Forge level that opens each talent row. */
export const FORGE_ROWS = [5, 15, 30] as const;
export interface PieceTalent {
  name: string;
  text: string;
}
/** Two choices per row, the same for every piece. Bait chests skip row one. */
export const PIECE_TALENTS: [PieceTalent, PieceTalent][] = [
  [
    { name: "Honed", text: "+10% power." },
    { name: "Thrifty", text: "Costs 20% less gold." },
  ],
  [
    { name: "Blood Price", text: "Heroes it kills pay 50% more gold." },
    { name: "Terror", text: "Each kill it makes gives 1 more dread." },
  ],
  [
    { name: "Heirloom", text: "Joins your dungeon one tier higher." },
    { name: "Masterwork", text: "Reinforcing it costs 40% less." },
  ],
];
/** What the Forge does for one piece in a run. */
export interface PieceMeta {
  /** Extra power (0.3 = +30% damage, and health for monsters). */
  pow?: number;
  /** Gold cost discount. */
  cost?: number;
  /** Extra bounty gold on its kills. */
  gold?: number;
  /** Extra dread per kill. */
  dread?: number;
  /** Tiers added when it joins the dungeon. */
  tier?: number;
  /** Reinforce discount. */
  reinforce?: number;
}
export function pieceMeta(
  level: number,
  picks: readonly number[] = [],
): PieceMeta {
  const out: PieceMeta = {};
  if (level > 0) out.pow = r2(level * FORGE_PER);
  const pick = (row: number) => (level >= FORGE_ROWS[row] ? picks[row] : -1);
  if (pick(0) === 0) out.pow = r2((out.pow ?? 0) + 0.1);
  if (pick(0) === 1) out.cost = 0.2;
  if (pick(1) === 0) out.gold = 0.5;
  if (pick(1) === 1) out.dread = 1;
  if (pick(2) === 0) out.tier = 1;
  if (pick(2) === 1) out.reinforce = 0.4;
  return out;
}

// ---------------- Dark Arts ----------------
export type Branch = "engineer" | "warlord" | "overseer";
export interface TalentDef {
  id: string;
  branch: Branch;
  /** Row 0–3; row r needs 5 × r points spent in the branch. */
  row: number;
  name: string;
  stat: MetaStat;
  per: number;
  /** Ranks (none: endless paragon node). */
  max?: number;
  /** Special rule granted at rank 1 (see RunMeta.keys). */
  key?: string;
  text: string;
}
export const BRANCHES: Record<Branch, { name: string; text: string }> = {
  engineer: { name: "Engineer", text: "Traps, fire and the late-game sinks." },
  warlord: { name: "Warlord", text: "Monsters, dread and your powers." },
  overseer: { name: "Overseer", text: "Gold, treasure, drafts and souls." },
};
export const ROW_POINTS = 5;
export const TALENTS: TalentDef[] = [
  // Engineer
  {
    id: "edges",
    branch: "engineer",
    row: 0,
    name: "Honed Edges",
    stat: "trapDmg",
    per: 0.02,
    max: 5,
    text: "Traps deal more damage.",
  },
  {
    id: "hands",
    branch: "engineer",
    row: 0,
    name: "Quick Hands",
    stat: "rearm",
    per: 0.02,
    max: 5,
    text: "Traps rearm faster.",
  },
  {
    id: "kindling",
    branch: "engineer",
    row: 1,
    name: "Kindling",
    stat: "fireDmg",
    per: 0.03,
    max: 5,
    text: "Fire and poison burn hotter.",
  },
  {
    id: "salvage",
    branch: "engineer",
    row: 1,
    name: "Salvager",
    stat: "refund",
    per: 0.05,
    max: 5,
    text: "Old pieces sell for more.",
  },
  {
    id: "mason",
    branch: "engineer",
    row: 2,
    name: "Master Mason",
    stat: "reinforce",
    per: 0.05,
    max: 5,
    text: "Reinforcing costs less.",
  },
  {
    id: "siege",
    branch: "engineer",
    row: 2,
    name: "Siege Breaker",
    stat: "bossDmg",
    per: 0.03,
    max: 5,
    text: "More damage to elites and champions.",
  },
  {
    id: "design",
    branch: "engineer",
    row: 3,
    name: "Grand Design",
    stat: "capacity",
    per: 1,
    max: 1,
    text: "Keystone: the dungeon holds one more piece.",
  },
  {
    id: "engParagon",
    branch: "engineer",
    row: 3,
    name: "Paragon of Steel",
    stat: "trapDmg",
    per: 0.005,
    text: "Endless: traps deal 0.5% more per rank.",
  },
  // Warlord
  {
    id: "hide",
    branch: "warlord",
    row: 0,
    name: "Thick Hide",
    stat: "monsterHp",
    per: 0.03,
    max: 5,
    text: "Monsters have more health.",
  },
  {
    id: "claws",
    branch: "warlord",
    row: 0,
    name: "Cruel Claws",
    stat: "monsterDmg",
    per: 0.02,
    max: 5,
    text: "Monsters hit harder.",
  },
  {
    id: "hunt",
    branch: "warlord",
    row: 1,
    name: "Swift Hunters",
    stat: "monsterSpd",
    per: 0.02,
    max: 5,
    text: "Monsters move faster.",
  },
  {
    id: "terror",
    branch: "warlord",
    row: 1,
    name: "Terror",
    stat: "dread",
    per: 1,
    max: 2,
    text: "Start raids with more dread, and hold more.",
  },
  {
    id: "wrath",
    branch: "warlord",
    row: 2,
    name: "Dark Wrath",
    stat: "powerDmg",
    per: 0.05,
    max: 5,
    text: "Your powers deal more damage.",
  },
  {
    id: "grim",
    branch: "warlord",
    row: 2,
    name: "Grim Harvest",
    stat: "bounty",
    per: 0.03,
    max: 5,
    text: "Heroes pay more gold when they die.",
  },
  {
    id: "legion",
    branch: "warlord",
    row: 3,
    name: "Legion",
    stat: "monsterHp",
    per: 0,
    max: 1,
    key: "legion",
    text: "Keystone: every descent starts with an extra monster blueprint.",
  },
  {
    id: "warParagon",
    branch: "warlord",
    row: 3,
    name: "Paragon of Fangs",
    stat: "monsterDmg",
    per: 0.005,
    text: "Endless: monsters deal 0.5% more per rank.",
  },
  // Overseer
  {
    id: "pockets",
    branch: "overseer",
    row: 0,
    name: "Deep Pockets",
    stat: "startGold",
    per: 5,
    max: 5,
    text: "Start each descent with more gold.",
  },
  {
    id: "tithe",
    branch: "overseer",
    row: 0,
    name: "Tax Collector",
    stat: "tribute",
    per: 0.03,
    max: 5,
    text: "Dawn tribute pays more.",
  },
  {
    id: "haggler",
    branch: "overseer",
    row: 1,
    name: "Haggler",
    stat: "reroll",
    per: 2,
    max: 5,
    text: "Draft rerolls cost less gold.",
  },
  {
    id: "hoarder",
    branch: "overseer",
    row: 1,
    name: "Hoarder",
    stat: "hoard",
    per: 1,
    max: 2,
    text: "The hoard holds more treasure.",
  },
  {
    id: "siphon",
    branch: "overseer",
    row: 2,
    name: "Soul Siphon",
    stat: "souls",
    per: 0.05,
    max: 5,
    text: "Earn more souls.",
  },
  {
    id: "finder",
    branch: "overseer",
    row: 2,
    name: "Treasure Finder",
    stat: "luck",
    per: 0.08,
    max: 5,
    text: "Heirlooms turn up more often.",
  },
  {
    id: "fourth",
    branch: "overseer",
    row: 3,
    name: "Fourth Card",
    stat: "draft",
    per: 1,
    max: 1,
    text: "Keystone: every draft offers one more card.",
  },
  {
    id: "ovParagon",
    branch: "overseer",
    row: 3,
    name: "Paragon of Greed",
    stat: "souls",
    per: 0.01,
    text: "Endless: earn 1% more souls per rank.",
  },
];
export const talentDef = (id: string) => TALENTS.find((t) => t.id === id);
export function branchSpent(t: Record<string, number>, b: Branch) {
  let n = 0;
  for (const d of TALENTS) if (d.branch === b) n += t[d.id] ?? 0;
  return n;
}
export function spentPoints(t: Record<string, number>) {
  let n = 0;
  for (const d of TALENTS) n += t[d.id] ?? 0;
  return n;
}
/** Points spent in a branch's rows above (shallower than) `row`. */
export function pointsBelow(t: Record<string, number>, b: Branch, row: number) {
  let n = 0;
  for (const d of TALENTS) if (d.branch === b && d.row < row) n += t[d.id] ?? 0;
  return n;
}
/** Every ranked talent has the points it needs in the rows before it. */
export function talentsValid(t: Record<string, number>) {
  return TALENTS.every(
    (d) =>
      !(t[d.id] ?? 0) ||
      ((d.max === undefined || (t[d.id] ?? 0) <= d.max) &&
        pointsBelow(t, d.branch, d.row) >= d.row * ROW_POINTS),
  );
}
/** Why a talent can't take another point, or null if it can. */
export function canRaise(
  p: Pick<MetaProfile, "talents" | "infamyXp">,
  id: string,
): "points" | "max" | "row" | "none" | null {
  const d = talentDef(id);
  if (!d) return "none";
  const rank = p.talents[id] ?? 0;
  if (d.max !== undefined && rank >= d.max) return "max";
  if (pointsBelow(p.talents, d.branch, d.row) < d.row * ROW_POINTS)
    return "row";
  if (spentPoints(p.talents) >= talentPoints(p.infamyXp)) return "points";
  return null;
}
/** Can a point come back out without stranding a deeper row? */
export function canLower(p: Pick<MetaProfile, "talents">, id: string) {
  const rank = p.talents[id] ?? 0;
  if (!talentDef(id) || !rank) return false;
  return talentsValid({ ...p.talents, [id]: rank - 1 });
}

// ---------------- heirlooms ----------------
export type HeirloomBase =
  | "whetstone"
  | "fang"
  | "carapace"
  | "cog"
  | "censer"
  | "skull"
  | "ledger"
  | "chalice"
  | "crown"
  | "coin";
export const BASES: Record<
  HeirloomBase,
  { name: string; stat: MetaStat; glyph: string }
> = {
  whetstone: { name: "Whetstone", stat: "trapDmg", glyph: "sword" },
  fang: { name: "Fang Idol", stat: "monsterDmg", glyph: "skull" },
  carapace: { name: "Carapace", stat: "monsterHp", glyph: "rock" },
  cog: { name: "Clockwork Cog", stat: "rearm", glyph: "reroll" },
  censer: { name: "Ember Censer", stat: "fireDmg", glyph: "relic" },
  skull: { name: "Screaming Skull", stat: "powerDmg", glyph: "shriek" },
  ledger: { name: "Black Ledger", stat: "bounty", glyph: "book" },
  chalice: { name: "Soul Chalice", stat: "souls", glyph: "dread" },
  crown: { name: "Tarnished Crown", stat: "bossDmg", glyph: "crown" },
  coin: { name: "Lucky Coin", stat: "luck", glyph: "coin" },
};
export const BASE_IDS = Object.keys(BASES) as HeirloomBase[];
/** Base value per affix at item level 1 (percent stats grow with level). */
const AFFIX_BASE: Partial<Record<MetaStat, number>> = {
  trapDmg: 0.02,
  monsterHp: 0.025,
  monsterDmg: 0.02,
  monsterSpd: 0.015,
  rearm: 0.015,
  fireDmg: 0.03,
  powerDmg: 0.05,
  bossDmg: 0.03,
  bounty: 0.04,
  tribute: 0.04,
  startGold: 5,
  souls: 0.05,
  infamy: 0.05,
  luck: 0.06,
  reroll: 2,
};
const AFFIX_STATS = Object.keys(AFFIX_BASE) as MetaStat[];
/** Stats whose value never grows with item level. */
const FLAT_AFFIX = new Set<MetaStat>([
  "reroll",
  "monsterSpd",
  "rearm",
  "startGold",
]);
export const RARITIES = [
  { name: "Common", affixes: 0, temper: 2, salvage: 6, color: "#b9b2a4" },
  { name: "Magic", affixes: 1, temper: 4, salvage: 15, color: "#6aa8ff" },
  { name: "Rare", affixes: 2, temper: 6, salvage: 35, color: "#ffd166" },
  { name: "Epic", affixes: 3, temper: 8, salvage: 80, color: "#c27bff" },
  { name: "Legendary", affixes: 3, temper: 10, salvage: 200, color: "#ff8a3d" },
] as const;
export type LegendId =
  | "crownDeep"
  | "purse"
  | "mountain"
  | "eye"
  | "banner"
  | "midas"
  | "engine"
  | "tyrant";
export const LEGENDS: Record<
  LegendId,
  { name: string; text: string; stats: StatBlock; key?: string }
> = {
  crownDeep: {
    name: "of the Sprawling Deep",
    text: "+1 piece capacity.",
    stats: { capacity: 1 },
  },
  purse: {
    name: "of Bottomless Purses",
    text: "+1 card in every draft.",
    stats: { draft: 1 },
  },
  mountain: {
    name: "of the Mountain's Heart",
    text: "+2 treasure in the hoard.",
    stats: { hoard: 2 },
  },
  eye: {
    name: "of the Unblinking Eye",
    text: "+2 starting and max dread.",
    stats: { dread: 2 },
  },
  banner: {
    name: "of the Endless Legion",
    text: "Every descent starts with an extra monster blueprint.",
    stats: {},
    key: "legion",
  },
  midas: {
    name: "of Midas",
    text: "+20% bounty gold and dawn tribute.",
    stats: { bounty: 0.2, tribute: 0.2 },
  },
  engine: {
    name: "of the Soul Engine",
    text: "+30% souls earned.",
    stats: { souls: 0.3 },
  },
  tyrant: {
    name: "of the Tyrant",
    text: "+15% damage to elites and champions, +5% trap damage.",
    stats: { bossDmg: 0.15, trapDmg: 0.05 },
  },
};
export const LEGEND_IDS = Object.keys(LEGENDS) as LegendId[];

export interface Heirloom {
  id: number;
  base: HeirloomBase;
  /** 0 Common … 4 Legendary. */
  rarity: number;
  /** Item level: the depth it was found at (plus abyss nights). */
  ilvl: number;
  /** Implicit stat (the base's) followed by rolled affixes, as [stat, roll 0–1]. */
  affixes: [MetaStat, number][];
  /** Tempering level (+8% to every value each). */
  temper: number;
  legend?: LegendId;
  locked?: boolean;
}
/** Value of one affix on an item. The first (implicit) affix is half again stronger. */
export function affixValue(
  it: Pick<Heirloom, "ilvl" | "temper">,
  stat: MetaStat,
  roll: number,
  implicit = false,
) {
  const base = AFFIX_BASE[stat] ?? 0;
  const lvl = FLAT_AFFIX.has(stat) ? 1 : 1 + 0.05 * (Math.max(1, it.ilvl) - 1);
  const v =
    base *
    lvl *
    (0.6 + 0.4 * roll) *
    (implicit ? 1.5 : 1) *
    (1 + 0.08 * it.temper);
  return STATS[stat].pct ? r2(v) : Math.round(v * 10) / 10;
}
export function heirloomStats(it: Heirloom): StatBlock {
  const out: StatBlock = {};
  it.affixes.forEach(([stat, roll], i) =>
    add(out, stat, affixValue(it, stat, roll, i === 0)),
  );
  if (it.legend)
    for (const [k, v] of Object.entries(LEGENDS[it.legend].stats))
      add(out, k as MetaStat, v);
  return out;
}
export const heirloomName = (it: Heirloom) =>
  `${BASES[it.base].name}${it.legend ? ` ${LEGENDS[it.legend].name}` : ""}`;
export function temperCost(it: Heirloom) {
  if (it.temper >= RARITIES[it.rarity].temper) return null;
  return Math.round(
    RARITIES[it.rarity].salvage * 0.6 * (1 + 0.1 * it.ilvl) * (it.temper + 1),
  );
}
export function salvageValue(it: Heirloom) {
  return Math.round(
    RARITIES[it.rarity].salvage *
      (1 + 0.1 * (it.ilvl - 1)) *
      (1 + 0.25 * it.temper),
  );
}
/** Rarity odds: deeper dungeons tip the scales toward the rare end. */
export function rarityWeights(depth: number, minRarity = 0) {
  const d = Math.max(1, depth);
  const w = [60, 26 + d * 0.4, 10 + d * 0.5, 3 + d * 0.3, 0.6 + d * 0.12];
  for (let i = 0; i < minRarity; i++) w[i] = 0;
  return w;
}
export function rollHeirloom(
  rng: Rng,
  id: number,
  ilvl: number,
  minRarity = 0,
): Heirloom {
  const w = rarityWeights(ilvl, minRarity);
  let total = 0;
  for (const x of w) total += x;
  let roll = rng.next() * total;
  let rarity = 0;
  for (; rarity < w.length - 1; rarity++) {
    roll -= w[rarity];
    if (roll < 0) break;
  }
  const base = rng.pick(BASE_IDS);
  const affixes: [MetaStat, number][] = [[BASES[base].stat, rng.next()]];
  const pool = AFFIX_STATS.filter((s) => s !== BASES[base].stat);
  rng.shuffle(pool);
  for (let i = 0; i < RARITIES[rarity].affixes; i++)
    affixes.push([pool[i], rng.next()]);
  const it: Heirloom = {
    id,
    base,
    rarity,
    ilvl: Math.max(1, Math.floor(ilvl)),
    affixes: affixes.map(([s, v]) => [s, r2(v)]),
    temper: 0,
  };
  if (rarity === 4) it.legend = rng.pick(LEGEND_IDS);
  return it;
}
/** Most heirlooms a profile keeps; further finds are salvaged. */
export const VAULT_SIZE = 40;

/**
 * Does tonight drop an heirloom? Fixed by the run seed and night, so a
 * reload can't roll again. Conquering a depth always drops one (a realm
 * lord's at least Rare); good nights sometimes do.
 */
export function heirloomDrop(
  o: {
    seed: number;
    depth: number;
    night: number;
    stars: number;
    won: boolean;
    luck: number;
  },
  id: number,
): Heirloom | null {
  const rng = new Rng(hashString(`heirloom:${o.seed}:${o.night}`));
  const abyss = o.night > NIGHTS;
  const ilvl = o.depth + (abyss ? Math.floor((o.night - NIGHTS) / 2) : 0);
  if (o.won && o.night === NIGHTS)
    return rollHeirloom(rng, id, ilvl, isLordDepth(o.depth) ? 2 : 1);
  const chance =
    (abyss
      ? o.stars >= 1
        ? 0.3
        : 0
      : o.stars >= 2
        ? 0.12 + 0.03 * o.stars
        : 0) *
    (1 + o.luck);
  if (!chance || !rng.chance(Math.min(0.9, chance))) return null;
  // Every fifth abyss night (a champion) drops at least a Rare.
  return rollHeirloom(rng, id, ilvl, abyss && o.night % 5 === 0 ? 2 : 0);
}

// ---------------- Soul Well ----------------
/** Hours of output the well holds before it stops filling. */
export const WELL_HOURS = 12;
export const wellRate = (bestDepth: number, well = 0) =>
  (3 + 1.5 * Math.max(0, bestDepth)) * (1 + well);
/** Souls waiting in the well. It opens after the first conquest. */
export function wellAmount(
  p: Pick<MetaProfile, "wellAt">,
  bestDepth: number,
  well: number,
  now: number,
) {
  if (bestDepth < 1 || !p.wellAt) return 0;
  const hours = Math.min(WELL_HOURS, Math.max(0, (now - p.wellAt) / 3_600_000));
  return Math.floor(hours * wellRate(bestDepth, well));
}

// ---------------- the snapshot a run carries ----------------
export interface RunMeta {
  /** Summed stats (caps applied). */
  s: StatBlock;
  /** Forge bonuses per piece. */
  p: Partial<Record<PieceId, PieceMeta>>;
  /** Special rules: "legion". */
  keys: string[];
}
/** Every bonus the Sanctum grants right now. */
export function metaBonus(p: MetaProfile): RunMeta {
  const s: StatBlock = {};
  for (const d of HEART) add(s, d.stat, (p.heart[d.id] ?? 0) * d.per);
  const keys = new Set<string>();
  for (const d of TALENTS) {
    const rank = p.talents[d.id] ?? 0;
    if (!rank) continue;
    add(s, d.stat, rank * d.per);
    if (d.key) keys.add(d.key);
  }
  const legends = new Set<LegendId>();
  for (const id of p.equipped) {
    const it = p.heirlooms.find((x) => x.id === id);
    if (!it) continue;
    // Two copies of one legendary power don't stack.
    const copy = it.legend && legends.has(it.legend);
    const st = heirloomStats(copy ? { ...it, legend: undefined } : it);
    for (const [k, v] of Object.entries(st)) add(s, k as MetaStat, v);
    if (it.legend && !copy) {
      legends.add(it.legend);
      if (LEGENDS[it.legend].key) keys.add(LEGENDS[it.legend].key!);
    }
  }
  for (const k of STAT_IDS) {
    const cap = STATS[k].cap;
    if (cap !== undefined && (s[k] ?? 0) > cap) s[k] = cap;
  }
  const pieces: Partial<Record<PieceId, PieceMeta>> = {};
  for (const id of Object.keys(PIECES) as PieceId[]) {
    const m = pieceMeta(p.forge[id] ?? 0, p.ptalents[id]);
    if (Object.keys(m).length) pieces[id] = m;
  }
  return { s, p: pieces, keys: [...keys] };
}
/** A stat from a run's snapshot (0 when the run has none). */
export const ms = (m: RunMeta | undefined | null, k: MetaStat) => m?.s[k] ?? 0;
export const pm = (m: RunMeta | undefined | null, id: PieceId) => m?.p[id];

/** Total Heart and Forge levels (feat counters). */
export const heartLevels = (p: Pick<MetaProfile, "heart">) =>
  Object.values(p.heart).reduce((a, v) => a + (v ?? 0), 0);
export const forgeLevels = (p: Pick<MetaProfile, "forge">) =>
  Object.values(p.forge).reduce((a, v) => a + (v ?? 0), 0);

// ---------------- actions (pure profile edits; the UI saves) ----------------
type Owner = MetaProfile & { mastery: Record<string, number> };

export function buyHeart(p: MetaProfile, id: string) {
  const d = heartDef(id);
  if (!d || infamyLevel(p.infamyXp).level < d.infamy) return false;
  const cost = heartCost(d, p.heart[id] ?? 0);
  if (cost === null || p.souls < cost) return false;
  p.souls -= cost;
  p.heart[id] = (p.heart[id] ?? 0) + 1;
  return true;
}
export function forgePiece(p: Owner, id: PieceId) {
  const level = p.forge[id] ?? 0;
  if (level >= forgeCap(p.mastery[id] ?? 0)) return false;
  const cost = forgeCost(level);
  if (p.souls < cost) return false;
  p.souls -= cost;
  p.forge[id] = level + 1;
  return true;
}
/** Pick (or clear, with -1) a forge talent. Rows open at forge 5, 15 and 30. */
export function setPieceTalent(
  p: MetaProfile,
  id: PieceId,
  row: number,
  choice: number,
) {
  if (row < 0 || row >= FORGE_ROWS.length) return false;
  if ((p.forge[id] ?? 0) < FORGE_ROWS[row]) return false;
  const picks = [...(p.ptalents[id] ?? [-1, -1, -1])];
  while (picks.length < FORGE_ROWS.length) picks.push(-1);
  picks[row] = choice === 0 || choice === 1 ? choice : -1;
  p.ptalents[id] = picks;
  return true;
}
/** Talent rows opened but not chosen (a hint for the UI). */
export function openPieceRows(p: MetaProfile, id: PieceId) {
  const level = p.forge[id] ?? 0;
  const picks = p.ptalents[id] ?? [];
  return FORGE_ROWS.filter((at, r) => level >= at && !(picks[r] >= 0)).length;
}
export function raiseTalent(p: MetaProfile, id: string) {
  if (canRaise(p, id) !== null) return false;
  p.talents[id] = (p.talents[id] ?? 0) + 1;
  return true;
}
export function lowerTalent(p: MetaProfile, id: string) {
  if (!canLower(p, id)) return false;
  p.talents[id] = (p.talents[id] ?? 0) - 1;
  if (!p.talents[id]) delete p.talents[id];
  return true;
}
/** Respecs are free. */
export function resetTalents(p: MetaProfile) {
  p.talents = {};
}
export const unspentPoints = (p: Pick<MetaProfile, "talents" | "infamyXp">) =>
  Math.max(0, talentPoints(p.infamyXp) - spentPoints(p.talents));

/** Keep a new heirloom, or salvage it when the vault is full. */
export function keepHeirloom(p: MetaProfile, it: Heirloom) {
  if (p.heirlooms.length >= VAULT_SIZE) {
    const v = salvageValue(it);
    p.souls += v;
    return v;
  }
  p.heirlooms.push(it);
  return 0;
}
export function equip(p: MetaProfile, id: number) {
  if (p.equipped.includes(id)) return false;
  if (!p.heirlooms.some((x) => x.id === id)) return false;
  if (p.equipped.length >= heirloomSlots(p.infamyXp)) return false;
  p.equipped.push(id);
  return true;
}
export function unequip(p: MetaProfile, id: number) {
  const n = p.equipped.length;
  p.equipped = p.equipped.filter((x) => x !== id);
  return p.equipped.length !== n;
}
export function temper(p: MetaProfile, id: number) {
  const it = p.heirlooms.find((x) => x.id === id);
  if (!it) return false;
  const cost = temperCost(it);
  if (cost === null || p.souls < cost) return false;
  p.souls -= cost;
  it.temper++;
  return true;
}
/** Salvage one heirloom for souls (equipped and locked ones are kept). */
export function salvage(p: MetaProfile, id: number) {
  const it = p.heirlooms.find((x) => x.id === id);
  if (!it || it.locked || p.equipped.includes(id)) return 0;
  const v = salvageValue(it);
  p.heirlooms = p.heirlooms.filter((x) => x.id !== id);
  p.souls += v;
  return v;
}
/** Salvage every unequipped, unlocked heirloom up to a rarity. */
export function salvageAll(p: MetaProfile, maxRarity: number) {
  let v = 0;
  for (const it of [...p.heirlooms])
    if (it.rarity <= maxRarity) v += salvage(p, it.id);
  return v;
}
/** Empty the Soul Well into the purse. */
export function collectWell(p: MetaProfile, bestDepth: number, now: number) {
  const well = metaBonus(p).s.well ?? 0;
  const v = wellAmount(p, bestDepth, well, now);
  if (bestDepth >= 1) p.wellAt = now;
  p.souls += v;
  return v;
}
