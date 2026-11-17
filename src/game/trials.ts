/**
 * Trials: handcrafted puzzle dungeons. Each trial fixes the map, the party,
 * the blueprints and the gold. There are no powers and no luck: the raid is
 * fully deterministic, so a trial is solved by design alone.
 *
 * Stars: defend the hoard, leave no survivors, and do both while spending no
 * more than the trial's par. Every trial has a verified reference solution
 * (tests/trials.test.ts).
 */
import { hashString } from "../engine/math";
import { FEATS, MAP_H, MAP_W, T, type PieceId, type RelicId } from "./defs";
import { hasRoute, type Layout, type Placed } from "./grid";
import { raidMods } from "./run";
import type { PartyMember, RaidSetup } from "./sim";

export interface TrialDef {
  id: string;
  chapter: number;
  name: string;
  /** What the trial is about, shown before building. */
  brief: string;
  /** A nudge shown after a failed attempt. */
  hint: string;
  /**
   * 15 rows of 11 characters: @ bedrock, # rock, . floor, $ gold vein,
   * E stairs (top row), H hoard. Lowercase letters are fixed pieces (see `fixed`).
   */
  map: string[];
  /** Fixed pieces keyed by the letter used on the map. */
  fixed?: Record<string, { kind: PieceId; dir?: number }>;
  pieces: PieceId[];
  gold: number;
  /** Maximum pieces the player may place (fixed pieces don't count). */
  cap?: number;
  /** Digging allowed (default true). */
  dig?: boolean;
  party: PartyMember[];
  /** Hero scaling follows this night of an ordinary descent. */
  night: number;
  depth?: number;
  relics?: RelicId[];
  tiers?: Partial<Record<PieceId, number>>;
  /** Third star: defend and slay all while spending at most this much. */
  par: number;
  hoard?: number;
}

export interface TrialChapter {
  n: number;
  name: string;
  blurb: string;
  /** Stars needed (across all trials) to open the chapter. */
  needs: number;
}

export const TRIAL_CHAPTERS: TrialChapter[] = [
  { n: 1, name: "First Lessons", blurb: "Lanes, guards and fire.", needs: 0 },
  { n: 2, name: "Light Fingers", blurb: "Rogues, rangers and bait.", needs: 6 },
  {
    n: 3,
    name: "Iron and Faith",
    blurb: "Armor, healers and rage.",
    needs: 14,
  },
  { n: 4, name: "Arcane Arts", blurb: "Mages, bards and the wind.", needs: 24 },
  {
    n: 5,
    name: "Siege Breakers",
    blurb: "Diggers, bombs and roots.",
    needs: 34,
  },
  {
    n: 6,
    name: "Lords of the Deep",
    blurb: "Champions, one by one.",
    needs: 44,
  },
];

export const TRIALS: TrialDef[] = [];

const mirror = (map: string[]) => map.map((r) => [...r].reverse().join(""));
const P = (...cls: PartyMember["cls"][]): PartyMember[] =>
  cls.map((c) => ({ cls: c }));

const LONG_HALL = [
  "@@@@@E@@@@@",
  "@####.####@",
  "@####.####@",
  "@####.####@",
  "@####.####@",
  "@####.####@",
  "@####.####@",
  "@####.####@",
  "@####.####@",
  "@####.####@",
  "@###...###@",
  "@###.H.###@",
  "@###...###@",
  "@#########@",
  "@@@@@@@@@@@",
];
const SWITCHBACK = [
  "@@@E@@@@@@@",
  "@##.######@",
  "@##.######@",
  "@##.ttt...@",
  "@########.@",
  "@########.@",
  "@####.....@",
  "@####.####@",
  "@####.####@",
  "@####.....@",
  "@########.@",
  "@######...@",
  "@######.H.@",
  "@######...@",
  "@@@@@@@@@@@",
];
const GATEHOUSE = [
  "@@@@@E@@@@@",
  "@####.####@",
  "@####.####@",
  "@####.####@",
  "@###...###@",
  "@###...###@",
  "@####.####@",
  "@####.####@",
  "@####.####@",
  "@##.....##@",
  "@##.....##@",
  "@##..H..##@",
  "@##.....##@",
  "@#########@",
  "@@@@@@@@@@@",
];
const POCKET = [
  "@@@@@E@@@@@",
  "@####.####@",
  "@####.####@",
  "@####.####@",
  "@####.####@",
  "@####.####@",
  "@####.....@",
  "@####.####@",
  "@####.####@",
  "@####.####@",
  "@####.####@",
  "@###...###@",
  "@###.H.###@",
  "@###...###@",
  "@@@@@@@@@@@",
];
const ZIGZAG = [
  "@@@@@E@@@@@",
  "@####.####@",
  "@####.####@",
  "@#.....###@",
  "@#.#######@",
  "@#.#######@",
  "@#.......#@",
  "@#######.#@",
  "@#######.#@",
  "@###.....#@",
  "@###.#####@",
  "@###.#####@",
  "@##..H..##@",
  "@##.....##@",
  "@@@@@@@@@@@",
];
const TREASURE_NOOK = [
  "@@@@@E@@@@@",
  "@####.####@",
  "@####.####@",
  "@####.####@",
  "@####.####@",
  "@####.....@",
  "@####.###.@",
  "@####.##..@",
  "@####.##..@",
  "@####.####@",
  "@####.####@",
  "@###...###@",
  "@###.H.###@",
  "@###...###@",
  "@@@@@@@@@@@",
];
const TWIN_HALLS = [
  "@@@@@E@@@@@",
  "@####.####@",
  "@####.####@",
  "@##.....##@",
  "@##.###.##@",
  "@##.###.##@",
  "@##.###.##@",
  "@##.###.##@",
  "@##.....##@",
  "@####.####@",
  "@####.####@",
  "@###...###@",
  "@###.H.###@",
  "@###...###@",
  "@@@@@@@@@@@",
];
const SERPENT = [
  "@E@@@@@@@@@",
  "@.........@",
  "@########.@",
  "@.........@",
  "@.########@",
  "@.........@",
  "@########.@",
  "@.........@",
  "@.########@",
  "@.........@",
  "@########.@",
  "@######...@",
  "@######.H.@",
  "@######...@",
  "@@@@@@@@@@@",
];
const BARRACKS = [
  "@@@@@E@@@@@",
  "@####.####@",
  "@####.####@",
  "@###...###@",
  "@###...###@",
  "@###...###@",
  "@####.####@",
  "@####.####@",
  "@####.####@",
  "@###...###@",
  "@###...###@",
  "@###...###@",
  "@####H####@",
  "@#########@",
  "@@@@@@@@@@@",
];
const CHAPEL = [
  "@@E@@@@@@@@",
  "@#.#######@",
  "@#.#######@",
  "@#......##@",
  "@######.##@",
  "@######.##@",
  "@##.....##@",
  "@##.######@",
  "@##.######@",
  "@##.....##@",
  "@######.##@",
  "@#####...#@",
  "@#####.H.#@",
  "@#####...#@",
  "@@@@@@@@@@@",
];
const RING = [
  "@@@@@@@E@@@",
  "@######.##@",
  "@######.##@",
  "@######.##@",
  "@##......#@",
  "@##.####.#@",
  "@##.####.#@",
  "@##......#@",
  "@#####.###@",
  "@#####.###@",
  "@#####.###@",
  "@####...##@",
  "@####.H.##@",
  "@####...##@",
  "@@@@@@@@@@@",
];
const ELBOW = [
  "@E@@@@@@@@@",
  "@.########@",
  "@.########@",
  "@.########@",
  "@.########@",
  "@.........@",
  "@########.@",
  "@########.@",
  "@########.@",
  "@########.@",
  "@########.@",
  "@######...@",
  "@######.H.@",
  "@######...@",
  "@@@@@@@@@@@",
];
const GREAT_HALL = [
  "@@@@@E@@@@@",
  "@####.####@",
  "@####.####@",
  "@##.....##@",
  "@##.....##@",
  "@##.....##@",
  "@####.####@",
  "@####.####@",
  "@##.....##@",
  "@##.....##@",
  "@##.....##@",
  "@####.####@",
  "@####H####@",
  "@#########@",
  "@@@@@@@@@@@",
];
const WINDWAY = [
  "@@@@@@@@@E@",
  "@########.@",
  "@#........@",
  "@#.#######@",
  "@#.#######@",
  "@#........@",
  "@########.@",
  "@########.@",
  "@#........@",
  "@#.#######@",
  "@#.#######@",
  "@#...#####@",
  "@#.H.#####@",
  "@#...#####@",
  "@@@@@@@@@@@",
];
const CHOKE = [
  "@@@@@E@@@@@",
  "@####.####@",
  "@####.####@",
  "@####.####@",
  "@####.####@",
  "@####.####@",
  "@###...###@",
  "@###...###@",
  "@####.####@",
  "@####.####@",
  "@####.####@",
  "@####.####@",
  "@###.H.###@",
  "@###...###@",
  "@@@@@@@@@@@",
];
const MINEWORKS = [
  "@@E@@@@@@@@",
  "@#.#######@",
  "@#.#######@",
  "@#.....###@",
  "@#####.###@",
  "@#####.###@",
  "@#####....@",
  "@########.@",
  "@########.@",
  "@###......@",
  "@###.#####@",
  "@###.#####@",
  "@##..H..##@",
  "@##.....##@",
  "@@@@@@@@@@@",
];
const GROVE = [
  "@@@@@@E@@@@",
  "@#####.###@",
  "@#####.###@",
  "@###.....#@",
  "@###.###.#@",
  "@###.###.#@",
  "@###.....#@",
  "@#####.###@",
  "@#####.###@",
  "@#####.###@",
  "@###.....#@",
  "@###.....#@",
  "@###..H..#@",
  "@###.....#@",
  "@@@@@@@@@@@",
];
const DEEP_SNAKE = [
  "@@@@@E@@@@@",
  "@.........@",
  "@.########@",
  "@.........@",
  "@########.@",
  "@.........@",
  "@.########@",
  "@.........@",
  "@########.@",
  "@.........@",
  "@.########@",
  "@.........@",
  "@....H....@",
  "@.........@",
  "@@@@@@@@@@@",
];

TRIALS.push(
  // ---- Chapter 1: First Lessons ----
  {
    id: "1-1",
    chapter: 1,
    name: "The Long Hall",
    brief:
      "Two knights march straight down a long hall. A dart idol at the far end fires up the whole lane.",
    hint: "Face a dart idol up the hall so every step is under fire. Spikes add a sting.",
    map: LONG_HALL,
    pieces: ["darts", "spikes", "skeleton"],
    gold: 120,
    par: 80,
    party: P("knight", "knight"),
    night: 2,
  },
  {
    id: "1-2",
    chapter: 1,
    name: "Fire and Tar",
    brief:
      "Tar already pools in the first bend. Knights shrug off steel, but fire ignores armor.",
    hint: "A flame jet that reaches the tar sets the whole pool burning.",
    map: SWITCHBACK,
    fixed: { t: { kind: "tar" } },
    pieces: ["flame", "spikes", "tar"],
    gold: 105,
    par: 65,
    party: P("knight", "knight", "knight"),
    night: 3,
  },
  {
    id: "1-3",
    chapter: 1,
    name: "Bones at the Door",
    brief:
      "The hoard sits in an open chamber. Guards hold heroes in place while archers shoot.",
    hint: "Skeletons in front, archers behind them. Spikes where the guards hold the line.",
    map: GATEHOUSE,
    pieces: ["skeleton", "archer", "spikes"],
    gold: 180,
    par: 130,
    party: P("knight", "knight", "knight"),
    night: 3,
  },
  {
    id: "1-4",
    chapter: 1,
    name: "Spring Loaded",
    brief:
      "A dead-end pocket opens off the hall. Springs throw heroes into it, and they have to walk back out.",
    hint: "A spring facing the pocket flings heroes three tiles in. Line the way back with spikes.",
    map: POCKET,
    pieces: ["spring", "spikes"],
    gold: 130,
    par: 90,
    party: P("berserker", "berserker", "rogue"),
    night: 3,
  },
  // ---- Chapter 2: Light Fingers ----
  {
    id: "2-1",
    chapter: 2,
    name: "Decoys",
    brief:
      "Each rogue disarms the first trap in their path. Give them something cheap to waste it on.",
    hint: "Tar can't be disarmed, but a cheap spike plate up front will soak a disarm.",
    map: ZIGZAG,
    pieces: ["spikes", "darts", "flame", "tar"],
    gold: 130,
    par: 90,
    party: P("knight", "rogue", "rogue"),
    night: 3,
  },
  {
    id: "2-2",
    chapter: 2,
    name: "Greed",
    brief:
      "Rogues can't resist treasure. A nook off the hall is close enough to tempt them.",
    hint: "Bait chests deep in the nook pull each rogue into a kill box. One chest per rogue.",
    map: TREASURE_NOOK,
    pieces: ["lure", "flame", "gas", "spikes", "tar"],
    gold: 145,
    par: 105,
    party: P("rogue", "rogue", "rogue"),
    night: 4,
  },
  {
    id: "2-3",
    chapter: 2,
    name: "Eagle Eyes",
    brief:
      "Rangers spot traps, and the party takes the other hall if one is safe. Make both deadly.",
    hint: "Two halls, two kill zones. Monsters aren't spotted, so they guard either way.",
    map: TWIN_HALLS,
    pieces: ["spikes", "darts", "flame", "skeleton"],
    gold: 150,
    par: 110,
    party: P("knight", "ranger", "knight"),
    night: 4,
  },
  {
    id: "2-4",
    chapter: 2,
    name: "Down You Go",
    brief:
      "Fast thieves on a long road. A trapdoor sends them back to the stairs, and thieves drop their loot.",
    hint: "Put the trapdoor near the hoard so every fall costs a whole lap.",
    map: SERPENT,
    pieces: ["trapdoor", "darts", "skeleton", "tar"],
    gold: 190,
    par: 140,
    party: P("rogue", "rogue", "rogue", "rogue"),
    night: 4,
  },
  // ---- Chapter 3: Iron and Faith ----
  {
    id: "3-1",
    chapter: 3,
    name: "Tin Cans",
    brief: "Four knights in heavy plate. Steel barely scratches them.",
    hint: "Fire, poison and lightning ignore armor. Tar keeps them in the cloud.",
    map: BARRACKS,
    pieces: ["spikes", "flame", "gas", "tar", "pylon"],
    gold: 190,
    par: 140,
    party: P("knight", "knight", "knight", "knight"),
    night: 4,
  },
  {
    id: "3-2",
    chapter: 3,
    name: "Field Medics",
    brief: "Two clerics keep the knights standing. Slow damage won't do.",
    hint: "Bats hunt from afar and reach the back line. Kill the healers first.",
    map: CHAPEL,
    pieces: ["bat", "archer", "spikes", "darts", "skeleton"],
    gold: 290,
    par: 215,
    party: P("knight", "knight", "cleric", "cleric"),
    night: 3,
  },
  {
    id: "3-3",
    chapter: 3,
    name: "Bloodrage",
    brief:
      "Berserkers fear nothing and hit harder when wounded. Don't let them reach your monsters hurt.",
    hint: "Frost freezes them in a flame lane. Frozen heroes take more damage.",
    map: RING,
    pieces: ["frost", "flame", "spikes", "tar", "ogre"],
    gold: 200,
    par: 150,
    party: P("berserker", "berserker", "berserker"),
    night: 5,
  },
  {
    id: "3-4",
    chapter: 3,
    name: "Cold Steel",
    brief:
      "An inquisitor smites the undead, and a cleric heals. The halls are long and narrow.",
    hint: "Saw blades sweep long corridors. Frost holds heroes under the blade.",
    map: ELBOW,
    pieces: ["saw", "frost", "skeleton", "darts"],
    gold: 290,
    par: 215,
    party: P("knight", "inquisitor", "berserker", "cleric"),
    night: 5,
  },
  // ---- Chapter 4: Arcane Arts ----
  {
    id: "4-1",
    chapter: 4,
    name: "Firebrand",
    brief: "Mages hurl fireballs that burst on clumps of monsters.",
    hint: "Spread your monsters out. Slimes split when they fall.",
    map: GREAT_HALL,
    pieces: ["skeleton", "archer", "slime", "tar", "flame"],
    gold: 145,
    par: 105,
    party: P("knight", "knight", "mage", "mage"),
    night: 5,
  },
  {
    id: "4-2",
    chapter: 4,
    name: "Gone with the Wind",
    brief:
      "Windcallers float over floor plates. Darts and arrows hit them harder.",
    hint: "Spikes and frost runes do nothing here. Dart lanes and storm pylons do.",
    map: WINDWAY,
    pieces: ["spikes", "frost", "darts", "pylon", "archer"],
    gold: 110,
    par: 70,
    party: P("windcaller", "windcaller", "windcaller"),
    night: 5,
  },
  {
    id: "4-3",
    chapter: 4,
    name: "Battle Hymn",
    brief:
      "A bard keeps the party fearless and quick. Ghosts won't scare anyone while the music plays.",
    hint: "Bats and archers reach the bard at the back. Silence the song.",
    map: mirror(TWIN_HALLS),
    pieces: ["bat", "archer", "ghost", "spikes", "darts"],
    gold: 320,
    par: 240,
    party: P("knight", "berserker", "knight", "bard"),
    night: 5,
  },
  {
    id: "4-4",
    chapter: 4,
    name: "Storm Front",
    brief: "A crowd of six pushes through one chokepoint.",
    hint: "Tar can't be disarmed. Slowed, clumped heroes take every arc of a storm pylon.",
    map: CHOKE,
    pieces: ["pylon", "tar", "spikes", "gas"],
    gold: 170,
    par: 125,
    party: P("rogue", "rogue", "ranger", "mage", "mage", "cleric"),
    night: 4,
  },
  // ---- Chapter 5: Siege Breakers ----
  {
    id: "5-1",
    chapter: 5,
    name: "Tunnelers",
    brief:
      "Dwarves dig through rock when your road is long. The serpent won't hold them.",
    hint: "Expect them to cut corners. Guard the hoard itself.",
    map: mirror(SERPENT),
    pieces: ["spikes", "skeleton", "ogre", "darts", "slime"],
    gold: 340,
    par: 250,
    party: P("dwarf", "dwarf", "dwarf", "knight"),
    night: 6,
  },
  {
    id: "5-2",
    chapter: 5,
    name: "Bombs Away",
    brief: "Sappers bomb the most dangerous trap they can see.",
    hint: "Hide your best traps around corners, and kill the sappers before they get close.",
    map: MINEWORKS,
    pieces: ["spikes", "flame", "crusher", "skeleton", "tar"],
    gold: 210,
    par: 155,
    party: P("knight", "knight", "sapper", "sapper"),
    night: 6,
  },
  {
    id: "5-3",
    chapter: 5,
    name: "Roots and Stone",
    brief: "Druids root your monsters in place. Traps don't care.",
    hint: "A hex totem makes every hit count. Crushers stun heroes under the hammer.",
    map: GROVE,
    pieces: ["crusher", "totem", "skeleton", "spikes", "archer"],
    gold: 350,
    par: 260,
    party: P("knight", "druid", "berserker", "druid"),
    night: 6,
  },
  {
    id: "5-4",
    chapter: 5,
    name: "The Thane",
    brief:
      "Thane Brannoc tunnels straight for your hoard. Your road means nothing to him.",
    hint: "Meet him at the hoard: golems demand a fight, crushers and gas do the rest.",
    map: DEEP_SNAKE,
    pieces: ["golem", "crusher", "ogre", "spikes", "gas", "tar"],
    gold: 460,
    par: 340,
    party: P("thane", "dwarf", "dwarf"),
    night: 5,
  },
  // ---- Chapter 6: Lords of the Deep ----
  {
    id: "6-1",
    chapter: 6,
    name: "Kingslayer",
    brief: "Sir Aldric heals every hero near him. His knights shield him.",
    hint: "Burst him down where he stands: frost, then everything at once.",
    map: mirror(GREAT_HALL),
    pieces: ["frost", "flame", "keg", "spikes", "skeleton", "gas"],
    gold: 340,
    par: 255,
    party: P("paladin", "knight", "cleric"),
    night: 5,
  },
  {
    id: "6-2",
    chapter: 6,
    name: "Spellbreaker",
    brief: "Archmage Veyla blinks four tiles ahead, skipping your traps.",
    hint: "She can't blink past a saw that sweeps the whole hall, or guards at the hoard.",
    map: mirror(ELBOW),
    pieces: ["saw", "darts", "skeleton", "archer", "pylon"],
    gold: 330,
    par: 245,
    party: P("archmage", "mage", "ranger"),
    night: 5,
  },
  {
    id: "6-3",
    chapter: 6,
    name: "Giant Killer",
    brief:
      "Warlord Grukk smashes every floor plate he steps on, and his war cries rally the party.",
    hint: "Floor plates break. Dart lanes, flame jets and gas don't.",
    map: mirror(RING),
    pieces: ["spikes", "darts", "flame", "gas", "tar", "ogre"],
    gold: 560,
    par: 415,
    party: P("warlord", "berserker", "berserker"),
    night: 5,
  },
  {
    id: "6-4",
    chapter: 6,
    name: "Lightbringer",
    brief:
      "Nyx the Shade vanishes from your monsters' sight every few seconds.",
    hint: "Traps still bite in the dark. Line her whole road.",
    map: mirror(ZIGZAG),
    pieces: ["spikes", "darts", "flame", "tar", "skeleton", "crusher"],
    gold: 470,
    par: 350,
    party: P("shade", "rogue", "rogue"),
    night: 5,
  },
  {
    id: "6-5",
    chapter: 6,
    name: "Unmaker",
    brief:
      "The Hollow King raises the heroes who fall near him. His court marches close.",
    hint: "Split them up with a trapdoor or a boulder lane. Kill the king and the court stays down.",
    map: mirror(CHAPEL),
    pieces: ["trapdoor", "boulder", "flame", "skeleton", "darts", "gas"],
    gold: 230,
    par: 170,
    party: P("revenant", "knight", "knight", "knight"),
    night: 5,
  },
);

// Trial feats track the real number of stars on offer.
for (const f of FEATS) {
  if (f.id === "trials90") f.goal = TRIALS.length * 3;
  if (f.id === "trials45") f.goal = Math.round(TRIALS.length * 1.5);
}

export const trialById = (id: string) => TRIALS.find((t) => t.id === id);
export const trialStarsTotal = (rec: Record<string, number>) =>
  TRIALS.reduce((a, t) => a + Math.min(3, rec[t.id] ?? 0), 0);
export const chapterOpen = (c: TrialChapter, rec: Record<string, number>) =>
  trialStarsTotal(rec) >= c.needs;

/** Build the layout of a trial from its map. */
export function trialLayout(t: TrialDef): Layout {
  if (t.map.length !== MAP_H)
    throw new Error(`${t.id}: map needs ${MAP_H} rows`);
  const tiles: number[] = [];
  const objects: Placed[] = [];
  let entrance = { x: -1, y: -1 };
  let hoard = { x: -1, y: -1 };
  let nextId = 1;
  t.map.forEach((row, y) => {
    if (row.length !== MAP_W)
      throw new Error(`${t.id}: row ${y} needs ${MAP_W} columns`);
    for (let x = 0; x < MAP_W; x++) {
      const c = row[x];
      let tile: number = T.Floor;
      if (c === "@") tile = T.Bedrock;
      else if (c === "#") tile = T.Rock;
      else if (c === "$") tile = T.Vein;
      else if (c === "E") entrance = { x, y };
      else if (c === "H") hoard = { x, y };
      else if (c !== ".") {
        const f = t.fixed?.[c];
        if (!f) throw new Error(`${t.id}: unknown map letter ${c}`);
        objects.push({ id: nextId++, kind: f.kind, x, y, dir: f.dir ?? 2 });
      }
      tiles.push(tile);
    }
  });
  const l: Layout = {
    w: MAP_W,
    h: MAP_H,
    tiles,
    entrance,
    hoard,
    objects,
    nextId,
  };
  if (entrance.x < 0 || hoard.x < 0 || !hasRoute(l))
    throw new Error(`${t.id}: needs stairs, a hoard and a route`);
  return l;
}

export interface TrialOutcome {
  defended: boolean;
  slain: boolean;
  underPar: boolean;
  stars: number;
}
export function trialStars(
  t: TrialDef,
  stolen: number,
  escaped: number,
  spent: number,
): TrialOutcome {
  const defended = stolen === 0;
  const slain = escaped === 0;
  const underPar = defended && slain && spent <= t.par;
  return {
    defended,
    slain,
    underPar,
    stars: (defended ? 1 : 0) + (slain ? 1 : 0) + (underPar ? 1 : 0),
  };
}

/** Raid modifiers for a trial (an ordinary night at the trial's depth). */
export function trialSetup(t: TrialDef, layout: Layout): RaidSetup {
  return {
    layout,
    party: t.party.map((p) => ({ ...p })),
    seed: hashString(`trial-${t.id}`),
    night: t.night,
    hoard: t.hoard ?? 12,
    mods: {
      ...raidMods({
        night: t.night,
        depth: t.depth ?? 1,
        mutators: [],
        architect: "mason",
        relics: t.relics ?? [],
        tiers: t.tiers ?? {},
      }),
      // Trials are fixed puzzles: schools never awaken in them.
      schools: false,
    },
  };
}
