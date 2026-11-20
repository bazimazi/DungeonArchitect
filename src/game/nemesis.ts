/**
 * Rules v7: nemeses. A hero who escapes with your treasure doesn't forget
 * the way back. The thief joins a Rogues' Gallery that persists between
 * descents, returns in later descents stronger, and grows every time it
 * gets away again. Slaying a nemesis pays a large bounty in souls and
 * infamy and always drops an heirloom.
 *
 * Everything is fixed by the run seed and the night, so raids stay
 * deterministic: a descent snapshots the nemeses it will meet when it
 * begins (`RunState.nemeses`), and parties are built from that snapshot.
 */
import { Rng, hashString } from "../engine/math";
import { HEROES, NIGHTS, isChampion, type HeroClass } from "./defs";
import { AFFIXES, AFFIX_IDS, type AffixId } from "./schools";

export interface Nemesis {
  id: number;
  cls: HeroClass;
  name: string;
  /** 1 when born; +1 every time it survives a raid. */
  level: number;
  affixes: AffixId[];
  /** Raids it got away from. */
  escapes: number;
  /** Treasure it has carried off, all told. */
  stolen: number;
  /** Depth where it first got away. */
  born: number;
}
/** A nemesis as one descent knows it. */
export interface RunNemesis {
  id: number;
  cls: HeroClass;
  name: string;
  level: number;
  affixes: AffixId[];
  /** Night it is scheduled to return (abyss returns are computed). */
  night: number;
  /** Slain during this descent. */
  slain?: boolean;
  /** Got away during this descent (it won't return until the abyss). */
  fled?: boolean;
}
/** A slain nemesis, remembered in the gallery. */
export interface Vanquished {
  name: string;
  cls: HeroClass;
  level: number;
  depth: number;
}

export const NEMESIS_MAX = 8;
export const NEMESIS_DEPTH = 2;
/** Nights a nemesis may return on in a descent. */
export const NEMESIS_NIGHTS = [3, 5, 7, 9] as const;
/** Health and damage gained per level, on top of being an elite. */
export const NEM_HP = 0.25;
export const NEM_DMG = 0.08;
/** Levels at which a nemesis gains another affix (up to four). */
export const NEM_AFFIX_AT = [3, 6, 10] as const;
/** Abyss nights on which a surviving nemesis of the run comes back. */
export const isNemesisAbyssNight = (n: number) =>
  n > NIGHTS && (n - NIGHTS) % 4 === 2;

/** How many nemeses a descent at this depth meets. */
export const nemesesPerRun = (depth: number) =>
  depth < NEMESIS_DEPTH ? 0 : depth < 8 ? 1 : depth < 20 ? 2 : 3;

const FIRST = [
  "Vessa",
  "Bram",
  "Odo",
  "Kesk",
  "Marta",
  "Ivo",
  "Sable",
  "Torvin",
  "Ilse",
  "Gerrit",
  "Rook",
  "Wenna",
  "Corvin",
  "Hask",
  "Liesl",
  "Dunstan",
  "Mira",
  "Fenwick",
  "Yarra",
  "Osric",
  "Tamsin",
  "Brecc",
  "Nell",
  "Aldo",
];
const EPITHETS: Partial<Record<HeroClass, string[]>> = {
  knight: ["the Unbowed", "Ironhand", "the Stubborn", "Shieldbreaker"],
  rogue: ["Quickfingers", "the Shadow", "Lightpurse", "the Unseen"],
  cleric: ["the Undying", "Lightbringer", "the Mender", "the Faithful"],
  mage: ["Emberhand", "the Scorched", "Spellthief", "the Kindler"],
  ranger: ["Hawkeye", "the Tracker", "Farshot", "the Pathfinder"],
  dwarf: ["Deepdelver", "Stonechewer", "the Burrower", "Picksworn"],
  berserker: ["Bloodmad", "the Howler", "Skullsplitter", "the Unchained"],
  bard: ["Silvertongue", "the Balladeer", "Songthief", "the Rousing"],
  windcaller: ["Stormborn", "the Drifter", "Featherfall", "Galeheart"],
  inquisitor: ["the Zealous", "Ashbrand", "the Purifier", "Witchfinder"],
  sapper: ["Blackpowder", "the Demolisher", "Fusewick", "the Breacher"],
  druid: ["Thornroot", "the Overgrown", "Mossback", "Wildheart"],
  monk: ["Stillwater", "the Serene", "Arrowcatcher", "the Patient"],
  templar: ["the Bulwark", "Oathkeeper", "the Steadfast", "Dawnshield"],
};
/** A new nemesis's name, fixed by where it got away. */
export function nemesisName(cls: HeroClass, seed: number) {
  const rng = new Rng(seed);
  const first = rng.pick(FIRST);
  const ep = rng.pick(EPITHETS[cls] ?? ["the Thief"]);
  return `${first} ${ep}`;
}
/** A title that grows with a nemesis's notoriety. */
export function nemesisRank(level: number) {
  return level >= 12
    ? "Legend"
    : level >= 8
      ? "Dread"
      : level >= 5
        ? "Notorious"
        : level >= 3
          ? "Infamous"
          : "Wanted";
}

/**
 * The nemeses a new descent will meet: the most dangerous first, each on its
 * own night, in an order fixed by the seed.
 */
export function scheduleNemeses(
  roster: readonly Nemesis[],
  seed: number,
  depth: number,
): RunNemesis[] {
  const n = Math.min(nemesesPerRun(depth), roster.length);
  if (!n) return [];
  const picks = [...roster]
    .sort((a, b) => b.level - a.level || a.id - b.id)
    .slice(0, n);
  const rng = new Rng((seed ^ 0x6e3e51) >>> 0);
  const nights = rng
    .shuffle([...NEMESIS_NIGHTS])
    .slice(0, n)
    .sort((a, b) => a - b);
  // The strongest comes last, as the run builds to its climax.
  const order = [...picks].sort((a, b) => a.level - b.level || a.id - b.id);
  return order.map((x, i) => ({
    id: x.id,
    cls: x.cls,
    name: x.name,
    level: x.level,
    affixes: [...x.affixes],
    night: nights[i],
  }));
}

/** The nemesis who joins tonight's party, if any. */
export function nemesisFor(
  list: readonly RunNemesis[] | undefined,
  n: number,
): RunNemesis | null {
  if (!list?.length) return null;
  if (n <= NIGHTS) return list.find((x) => x.night === n && !x.slain) ?? null;
  if (!isNemesisAbyssNight(n)) return null;
  const alive = list.filter((x) => !x.slain);
  if (!alive.length) return null;
  return alive[Math.floor((n - NIGHTS - 2) / 4) % alive.length];
}

/** Affixes a nemesis is born with: its own, or one fitting the depth. */
function bornAffixes(
  carried: readonly AffixId[] | undefined,
  depth: number,
  rng: Rng,
): AffixId[] {
  if (carried?.length) return [...carried].slice(0, 2);
  const pool = AFFIX_IDS.filter((a) => AFFIXES[a].from <= Math.max(2, depth));
  return [rng.pick(pool)];
}
function growAffixes(x: { affixes: AffixId[]; level: number }, rng: Rng) {
  if (!NEM_AFFIX_AT.includes(x.level as 3 | 6 | 10)) return;
  if (x.affixes.length >= 4) return;
  const pool = AFFIX_IDS.filter((a) => !x.affixes.includes(a));
  if (pool.length) x.affixes.push(rng.pick(pool));
}

/** What a raid tells the gallery. */
export interface NemesisReport {
  /** Nemeses (by id) that met their end tonight. */
  slain: number[];
  /** Nemeses (by id) that lived through the night, and the loot they took. */
  survived: { id: number; loot: number }[];
  /** Ordinary heroes who escaped carrying treasure. */
  thieves: { cls: HeroClass; affixes: AffixId[]; loot: number }[];
}
export interface NemesisOutcome {
  born: Nemesis | null;
  slain: Nemesis[];
  grew: Nemesis[];
}
export interface GalleryOwner {
  nemeses: Nemesis[];
  nextNemesis: number;
  vanquished: Vanquished[];
}
export const VANQUISHED_KEEP = 24;

/**
 * Settle one night with the gallery: slain nemeses leave it, survivors grow,
 * and the greediest escaped thief may become a new nemesis.
 */
export function settleNemeses(
  p: GalleryOwner,
  run: { seed: number; night: number; depth: number; nemeses?: RunNemesis[] },
  r: NemesisReport,
): NemesisOutcome {
  const out: NemesisOutcome = { born: null, slain: [], grew: [] };
  const rng = new Rng(hashString(`nemesis:${run.seed}:${run.night}`));
  for (const id of r.slain) {
    const x = p.nemeses.find((q) => q.id === id);
    const snap = run.nemeses?.find((q) => q.id === id);
    if (snap) snap.slain = true;
    if (!x) continue;
    p.nemeses = p.nemeses.filter((q) => q.id !== id);
    p.vanquished.unshift({
      name: x.name,
      cls: x.cls,
      level: x.level,
      depth: run.depth,
    });
    p.vanquished.length = Math.min(p.vanquished.length, VANQUISHED_KEEP);
    out.slain.push(x);
  }
  for (const s of r.survived) {
    const x = p.nemeses.find((q) => q.id === s.id);
    const snap = run.nemeses?.find((q) => q.id === s.id);
    if (!x) continue;
    x.level++;
    x.escapes++;
    x.stolen += s.loot;
    growAffixes(x, rng);
    if (snap) {
      snap.level = x.level;
      snap.affixes = [...x.affixes];
      snap.fled = true;
    }
    out.grew.push(x);
  }
  // The greediest thief (most loot, then the toughest class) is remembered.
  const thief = [...r.thieves]
    .filter((t) => !isChampion(t.cls))
    .sort(
      (a, b) =>
        b.loot - a.loot ||
        HEROES[b.cls].points - HEROES[a.cls].points ||
        a.cls.localeCompare(b.cls),
    )[0];
  if (thief && run.depth >= NEMESIS_DEPTH && p.nemeses.length < NEMESIS_MAX) {
    const x: Nemesis = {
      id: p.nextNemesis++,
      cls: thief.cls,
      name: nemesisName(thief.cls, rng.int(0, 2 ** 30)),
      level: 1,
      affixes: bornAffixes(thief.affixes, run.depth, rng),
      escapes: 1,
      stolen: thief.loot,
      born: run.depth,
    };
    p.nemeses.push(x);
    out.born = x;
  }
  return out;
}

/** Souls and infamy for slaying a nemesis (before the depth multiplier). */
export const nemesisBounty = (level: number) => ({
  souls: 20 * level + 10,
  infamy: 12 * level + 8,
});
