/**
 * Game data. All tuning lives here so balance changes never touch systems.
 * Time values are in seconds; distances in tiles.
 */
export const RULES_VERSION = 2;
/** Older link versions that still decode (pieces only ever get appended). */
export const RULES_COMPAT = [1, 2];
export const TICK = 0.05; // 20 simulation ticks per second
export const MAP_W = 11;
export const MAP_H = 15;
export const NIGHTS = 10;
export const DIG_COST = 2;
export const VEIN_GOLD = 14;
export const RAID_RETREAT_AT = 150; // seconds; heroes then head home
export const RAID_HARD_LIMIT = 200;

/** Economy and scaling knobs, tuned with the balance bot (tests/bot.ts). */
export const TUNE = {
  startGold: 100,
  masonGold: 30,
  hpPerNight: 0.3,
  dmgPerNight: 0.1,
  budgetBase: 4,
  budgetPerNight: 2.8,
  tributeBase: 30,
  tributePerNight: 4,
  tributePerStar: 6,
  /** Compounding growth per abyss night (past night ten). */
  abyssHp: 1.09,
  abyssDmg: 1.04,
  /** Reinforcing a blueprint with gold: cost = piece cost × this × tier. */
  reinforce: 4,
  /** Dungeon capacity: pieces allowed = capBase + capPerNight × night. */
  capBase: 5,
  capPerNight: 2,
};

export const enum T {
  Rock = 0,
  Floor = 1,
  Bedrock = 2,
  Vein = 3,
}

export const DX = [0, 1, 0, -1] as const;
export const DY = [-1, 0, 1, 0] as const;

export type TrapId =
  | "spikes"
  | "darts"
  | "flame"
  | "boulder"
  | "trapdoor"
  | "tar"
  | "frost"
  | "spring"
  | "saw"
  | "gas"
  | "lure"
  | "keg"
  | "pylon";
export type MonsterId =
  | "skeleton"
  | "archer"
  | "slime"
  | "ogre"
  | "bat"
  | "necro"
  | "mimic"
  | "imp"
  | "ghost"
  | "spider"
  | "golem";
export type PieceId = TrapId | MonsterId;
export type HeroClass =
  | "knight"
  | "rogue"
  | "cleric"
  | "mage"
  | "ranger"
  | "dwarf"
  | "berserker"
  | "bard"
  | "windcaller"
  | "inquisitor"
  | "paladin"
  | "archmage"
  | "warlord";

/** Champions lead the final night of a descent and every fifth abyss night. */
export const CHAMPIONS = ["paladin", "archmage", "warlord"] as const;
export type ChampionId = (typeof CHAMPIONS)[number];
export const isChampion = (c: HeroClass): c is ChampionId =>
  (CHAMPIONS as readonly string[]).includes(c);
/** Classes that can't be frightened. */
export const FEARLESS: HeroClass[] = [
  "berserker",
  "inquisitor",
  "paladin",
  "archmage",
  "warlord",
];
/** Classes too heavy to fling or knock back. */
export const UNSHAKABLE: HeroClass[] = ["knight", "paladin", "warlord"];
/** Monsters that inquisitors purge. */
export const UNDEAD = ["skeleton", "risen", "ghost", "necro"];

export interface PieceDef {
  id: PieceId;
  name: string;
  kind: "trap" | "monster";
  cost: number;
  directional?: boolean;
  /** One short rule the player can hold in their head. */
  rule: string;
  /** Secondary hint for combos. */
  combo?: string;
  color: string;
}

export const PIECES: Record<PieceId, PieceDef> = {
  spikes: {
    id: "spikes",
    name: "Spike Plate",
    kind: "trap",
    cost: 14,
    rule: "Stabs whoever steps on it.",
    combo: "Springs and ogres can throw heroes onto it twice.",
    color: "#c9c2b8",
  },
  darts: {
    id: "darts",
    name: "Dart Idol",
    kind: "trap",
    cost: 22,
    directional: true,
    rule: "Fires darts down its lane at the first hero.",
    combo: "Line it up with tar so targets stay in the lane.",
    color: "#b48a5a",
  },
  flame: {
    id: "flame",
    name: "Flame Jet",
    kind: "trap",
    cost: 28,
    directional: true,
    rule: "Every 4s, burns 3 tiles ahead.",
    combo: "Ignites tar and powder kegs.",
    color: "#ff7a2f",
  },
  boulder: {
    id: "boulder",
    name: "Boulder",
    kind: "trap",
    cost: 34,
    directional: true,
    rule: "Rolls down its lane once per night, crushing all.",
    combo: "Best at the end of a long straight corridor.",
    color: "#8f877c",
  },
  trapdoor: {
    id: "trapdoor",
    name: "Trapdoor",
    kind: "trap",
    cost: 36,
    rule: "Drops a hero back to the entrance. Thieves lose their loot.",
    combo: "Long mazes make every fall hurt.",
    color: "#6b4f35",
  },
  tar: {
    id: "tar",
    name: "Tar Pool",
    kind: "trap",
    cost: 9,
    rule: "Slows heroes to half speed.",
    combo: "Fire turns it into a burning pool.",
    color: "#3a2f4a",
  },
  frost: {
    id: "frost",
    name: "Frost Rune",
    kind: "trap",
    cost: 26,
    rule: "Freezes a hero solid for 2s. Frozen heroes take +50% damage.",
    combo: "Freeze them in a flame lane.",
    color: "#8fd8ff",
  },
  spring: {
    id: "spring",
    name: "Spring Plate",
    kind: "trap",
    cost: 18,
    directional: true,
    rule: "Flings a hero 3 tiles. Knights are too heavy.",
    combo: "Fling them onto spikes or into a trapdoor.",
    color: "#d6b04a",
  },
  saw: {
    id: "saw",
    name: "Saw Track",
    kind: "trap",
    cost: 40,
    directional: true,
    rule: "A blade that sweeps its corridor back and forth.",
    combo: "Shines in long, narrow halls.",
    color: "#d9dde3",
  },
  gas: {
    id: "gas",
    name: "Miasma Vent",
    kind: "trap",
    cost: 30,
    rule: "Every 5s, a poison cloud. Ignores armor.",
    combo: "Keep heroes inside with monsters and tar.",
    color: "#89d36a",
  },
  lure: {
    id: "lure",
    name: "Bait Chest",
    kind: "trap",
    cost: 12,
    rule: "Greedy heroes detour to loot it.",
    combo: "Rogues can't resist. Lead them into a killbox.",
    color: "#e8b84a",
  },
  keg: {
    id: "keg",
    name: "Powder Keg",
    kind: "trap",
    cost: 24,
    rule: "Explodes when a hero comes close or fire touches it.",
    combo: "Chain kegs with flame for huge blasts.",
    color: "#a05a2c",
  },
  skeleton: {
    id: "skeleton",
    name: "Skeleton",
    kind: "monster",
    cost: 18,
    rule: "Fights in melee. Reassembles once after falling.",
    combo: "Holds heroes inside your trap zones.",
    color: "#e8e0cc",
  },
  archer: {
    id: "archer",
    name: "Goblin Archer",
    kind: "monster",
    cost: 24,
    rule: "Shoots heroes from range.",
    combo: "Place behind tar or skeletons.",
    color: "#7fb069",
  },
  slime: {
    id: "slime",
    name: "Gel Slime",
    kind: "monster",
    cost: 22,
    rule: "Slow and tough. Splits in two when slain.",
    combo: "Clogs corridors near gas vents.",
    color: "#5fd3a2",
  },
  ogre: {
    id: "ogre",
    name: "Cave Ogre",
    kind: "monster",
    cost: 55,
    rule: "Huge hits that knock heroes back.",
    combo: "Knock heroes into traps.",
    color: "#b57b5a",
  },
  bat: {
    id: "bat",
    name: "Bat Swarm",
    kind: "monster",
    cost: 14,
    rule: "Fast and fragile. Hunts from far away.",
    combo: "Distracts healers.",
    color: "#6e5a8a",
  },
  necro: {
    id: "necro",
    name: "Necromancer",
    kind: "monster",
    cost: 65,
    rule: "Raises fallen heroes as skeletons.",
    combo: "Every kill nearby grows your army.",
    color: "#9d7cd8",
  },
  mimic: {
    id: "mimic",
    name: "Mimic",
    kind: "monster",
    cost: 50,
    rule: "Looks like treasure. Bites the greedy.",
    combo: "Greedy rogues walk right into it.",
    color: "#c98a3a",
  },
  imp: {
    id: "imp",
    name: "Fire Imp",
    kind: "monster",
    cost: 32,
    rule: "Hurls fireballs that ignite tar and kegs.",
    combo: "A walking fuse for your tar pools.",
    color: "#ff5a3c",
  },
  ghost: {
    id: "ghost",
    name: "Wailing Ghost",
    kind: "monster",
    cost: 38,
    rule: "Its touch terrifies heroes into fleeing.",
    combo: "Fleeing heroes walk back over your traps.",
    color: "#bfe6ff",
  },
  pylon: {
    id: "pylon",
    name: "Storm Pylon",
    kind: "trap",
    cost: 36,
    rule: "Every 3s, lightning arcs through up to 3 nearby heroes.",
    combo: "Ignores armor. Clumped, slowed heroes take every arc.",
    color: "#8fb8ff",
  },
  spider: {
    id: "spider",
    name: "Cave Spider",
    kind: "monster",
    cost: 26,
    rule: "Spits webs that slow heroes to a crawl.",
    combo: "Webbed heroes linger in flame lanes and gas.",
    color: "#7a6a9a",
  },
  golem: {
    id: "golem",
    name: "Stone Golem",
    kind: "monster",
    cost: 62,
    rule: "A slow wall of stone. Heroes nearby must fight it.",
    combo: "Park it on a gas vent or saw track and let them stand there.",
    color: "#9a9488",
  },
};

export interface MonsterStats {
  hp: number;
  dmg: number;
  cd: number;
  speed: number;
  range: number; // attack range (tiles); melee ~1
  aggro: number;
  leash: number;
  magic?: boolean;
  splash?: number;
}
export const MONSTERS: Record<MonsterId, MonsterStats> = {
  skeleton: {
    hp: 70,
    dmg: 9,
    cd: 0.9,
    speed: 2.2,
    range: 0.95,
    aggro: 3,
    leash: 3,
  },
  archer: {
    hp: 40,
    dmg: 8,
    cd: 1.1,
    speed: 2.2,
    range: 4.5,
    aggro: 4.5,
    leash: 1.5,
  },
  slime: {
    hp: 95,
    dmg: 7,
    cd: 1.2,
    speed: 1.4,
    range: 0.9,
    aggro: 2.5,
    leash: 2.5,
  },
  ogre: {
    hp: 270,
    dmg: 24,
    cd: 1.8,
    speed: 1.5,
    range: 1.05,
    aggro: 3,
    leash: 3,
  },
  bat: { hp: 32, dmg: 5, cd: 0.55, speed: 4, range: 0.85, aggro: 5, leash: 6 },
  necro: {
    hp: 55,
    dmg: 7,
    cd: 1.3,
    speed: 1.8,
    range: 4,
    aggro: 4,
    leash: 1.5,
    magic: true,
  },
  mimic: {
    hp: 160,
    dmg: 14,
    cd: 1.1,
    speed: 1.6,
    range: 1,
    aggro: 2,
    leash: 2,
  },
  imp: {
    hp: 45,
    dmg: 9,
    cd: 1.4,
    speed: 2.4,
    range: 4,
    aggro: 4,
    leash: 2,
    magic: true,
    splash: 0.9,
  },
  ghost: {
    hp: 60,
    dmg: 6,
    cd: 1.2,
    speed: 2.6,
    range: 0.9,
    aggro: 3.5,
    leash: 4,
    magic: true,
  },
  spider: {
    hp: 55,
    dmg: 5,
    cd: 1.3,
    speed: 2.6,
    range: 3.5,
    aggro: 4,
    leash: 2,
  },
  golem: {
    hp: 400,
    dmg: 16,
    cd: 1.6,
    speed: 1.2,
    range: 1.05,
    aggro: 2.5,
    leash: 2,
  },
};
export const MINIONS = {
  minislime: {
    hp: 35,
    dmg: 4,
    cd: 1,
    speed: 1.9,
    range: 0.85,
    aggro: 2.5,
    leash: 3,
  },
  risen: {
    hp: 50,
    dmg: 8,
    cd: 1,
    speed: 2.1,
    range: 0.95,
    aggro: 3.5,
    leash: 4,
  },
} satisfies Record<string, MonsterStats>;

export interface HeroStats {
  name: string;
  hp: number;
  armor: number;
  dmg: number;
  cd: number;
  speed: number;
  range: number;
  engage: number;
  bounty: number;
  loot: number;
  greed: number; // tiles they'll detour for bait
  points: number; // party budget cost
  magic?: boolean;
  splash?: number;
  rule: string;
  color: string;
}
export const HEROES: Record<HeroClass, HeroStats> = {
  knight: {
    name: "Knight",
    hp: 165,
    armor: 4,
    dmg: 13,
    cd: 1,
    speed: 1.8,
    range: 0.95,
    engage: 3,
    bounty: 13,
    loot: 1,
    greed: 1.5,
    points: 4,
    rule: "Armored. Can't be flung. Monsters must fight him first.",
    color: "#9fb7d9",
  },
  rogue: {
    name: "Rogue",
    hp: 70,
    armor: 0,
    dmg: 10,
    cd: 0.6,
    speed: 2.9,
    range: 0.9,
    engage: 1.2,
    bounty: 10,
    loot: 2,
    greed: 7,
    points: 3,
    rule: "Fast. Disarms the first trap ahead. Steals double.",
    color: "#8fd694",
  },
  cleric: {
    name: "Cleric",
    hp: 95,
    armor: 1,
    dmg: 6,
    cd: 1.2,
    speed: 1.9,
    range: 0.9,
    engage: 1.5,
    bounty: 12,
    loot: 1,
    greed: 1.5,
    points: 4,
    rule: "Heals the most wounded ally and cleanses burns.",
    color: "#f2e6a6",
  },
  mage: {
    name: "Mage",
    hp: 60,
    armor: 0,
    dmg: 17,
    cd: 1.6,
    speed: 1.9,
    range: 3.5,
    engage: 3.5,
    bounty: 11,
    loot: 1,
    greed: 1.5,
    points: 4,
    magic: true,
    splash: 1,
    rule: "Fireballs hit groups of monsters — and ignite your tar.",
    color: "#c79bff",
  },
  ranger: {
    name: "Ranger",
    hp: 75,
    armor: 1,
    dmg: 11,
    cd: 0.9,
    speed: 2.1,
    range: 5,
    engage: 5,
    bounty: 10,
    loot: 1,
    greed: 2,
    points: 3,
    rule: "Long range. Spots hidden traps, so the party avoids them.",
    color: "#a8d36a",
  },
  dwarf: {
    name: "Dwarf",
    hp: 125,
    armor: 2,
    dmg: 12,
    cd: 1,
    speed: 1.7,
    range: 0.95,
    engage: 2.5,
    bounty: 14,
    loot: 1,
    greed: 4,
    points: 5,
    rule: "Digs tunnels through rock when your maze is too long.",
    color: "#e0a060",
  },
  berserker: {
    name: "Berserker",
    hp: 135,
    armor: 0,
    dmg: 17,
    cd: 0.8,
    speed: 2.1,
    range: 0.95,
    engage: 3.5,
    bounty: 14,
    loot: 1,
    greed: 2,
    points: 5,
    rule: "Fearless. Hits harder when wounded.",
    color: "#ff7b6b",
  },
  paladin: {
    name: "Sir Aldric",
    hp: 720,
    armor: 5,
    dmg: 22,
    cd: 1.1,
    speed: 1.7,
    range: 1,
    engage: 3,
    bounty: 80,
    loot: 4,
    greed: 0,
    points: 12,
    rule: "Champion of the realm. Heals nearby heroes. Fearless and unshakable.",
    color: "#ffd86b",
  },
  bard: {
    name: "Bard",
    hp: 80,
    armor: 0,
    dmg: 7,
    cd: 1.1,
    speed: 2,
    range: 3,
    engage: 3,
    bounty: 12,
    loot: 1,
    greed: 3,
    points: 4,
    magic: true,
    rule: "Inspires nearby allies: faster, stronger and fearless.",
    color: "#ff9fd0",
  },
  windcaller: {
    name: "Windcaller",
    hp: 72,
    armor: 0,
    dmg: 12,
    cd: 1.3,
    speed: 2.2,
    range: 3.5,
    engage: 3.5,
    bounty: 12,
    loot: 1,
    greed: 2,
    points: 4,
    magic: true,
    rule: "Floats over floor traps. Darts and arrows hit her 50% harder.",
    color: "#9ff0e8",
  },
  inquisitor: {
    name: "Inquisitor",
    hp: 140,
    armor: 3,
    dmg: 14,
    cd: 1.1,
    speed: 1.8,
    range: 0.95,
    engage: 3,
    bounty: 15,
    loot: 1,
    greed: 1,
    points: 5,
    rule: "Fearless. Smites the undead (+60%) so they never rise again.",
    color: "#e0e6f0",
  },
  archmage: {
    name: "Archmage Veyla",
    hp: 560,
    armor: 1,
    dmg: 20,
    cd: 1.5,
    speed: 1.7,
    range: 4,
    engage: 4,
    bounty: 80,
    loot: 4,
    greed: 0,
    points: 12,
    magic: true,
    splash: 1.2,
    rule: "Champion. Blinks 4 tiles ahead every 7s, skipping your traps. Fearless.",
    color: "#b48cff",
  },
  warlord: {
    name: "Warlord Grukk",
    hp: 980,
    armor: 3,
    dmg: 28,
    cd: 1.4,
    speed: 1.6,
    range: 1.05,
    engage: 3,
    bounty: 90,
    loot: 5,
    greed: 0,
    points: 12,
    rule: "Champion. Smashes floor traps he crosses. War cries rally his party.",
    color: "#d9763a",
  },
};

/** One-line counter advice shown with a hero's rule. */
export const HERO_COUNTER: Record<HeroClass, string> = {
  knight: "Fire, poison and magic ignore armor. Trapdoors.",
  rogue: "Monsters, cheap decoy traps, bait into a kill box.",
  cleric: "Burst damage; bats and archers that reach the back line.",
  mage: "Spread monsters out; keep tar away from the front.",
  ranger: "Loops, so the avoided route is just as deadly.",
  dwarf: "Traps near the hoard; bedrock walls.",
  berserker: "Burst damage and crowd control.",
  bard: "Bats and archers reach the back line. Kill the music first.",
  windcaller: "Darts, archers, flame, gas and storm pylons.",
  inquisitor: "Living monsters and traps; undead fall for good.",
  paladin: "Everything you've got.",
  archmage: "Guards at the hoard; saws and pylons she can't skip.",
  warlord: "Darts, flame, gas and monsters. Floor traps break.",
};

export type BiomeId = "crypt" | "grotto" | "forge" | "glacier" | "abyss";
export interface Biome {
  id: BiomeId;
  name: string;
  blurb: string;
  ambient: [number, number, number];
  floorA: string;
  floorB: string;
  rockTop: string;
  rockFace: string;
  rockDark: string;
  accent: string;
  /** Torch light colour. */
  torch: string;
  veins: number;
  pillars: number;
}
export const BIOMES: Record<BiomeId, Biome> = {
  crypt: {
    id: "crypt",
    name: "Sunken Crypt",
    blurb: "Cold stone and older bones.",
    ambient: [92, 80, 122],
    floorA: "#564b62",
    floorB: "#4e4459",
    rockTop: "#2a2433",
    rockFace: "#433a52",
    rockDark: "#120e17",
    accent: "#ffb347",
    torch: "#ffb050",
    veins: 4,
    pillars: 3,
  },
  grotto: {
    id: "grotto",
    name: "Fungal Grotto",
    blurb: "Glowing caps, rich veins of gold.",
    ambient: [70, 100, 104],
    floorA: "#455a53",
    floorB: "#3e524b",
    rockTop: "#1d2927",
    rockFace: "#30443e",
    rockDark: "#0c1413",
    accent: "#7ef0c8",
    torch: "#7ef0c8",
    veins: 7,
    pillars: 4,
  },
  forge: {
    id: "forge",
    name: "Magma Forge",
    blurb: "Molten seams light the halls.",
    ambient: [112, 72, 62],
    floorA: "#5c4840",
    floorB: "#54413a",
    rockTop: "#2b1f1c",
    rockFace: "#47332d",
    rockDark: "#150d0b",
    accent: "#ff6a2a",
    torch: "#ffb050",
    veins: 5,
    pillars: 5,
  },
  glacier: {
    id: "glacier",
    name: "Frozen Depths",
    blurb: "Blue ice and buried kings.",
    ambient: [86, 104, 132],
    floorA: "#56687a",
    floorB: "#4e6072",
    rockTop: "#1f2a38",
    rockFace: "#36485c",
    rockDark: "#0c121a",
    accent: "#9fe4ff",
    torch: "#a8dcff",
    veins: 5,
    pillars: 4,
  },
  abyss: {
    id: "abyss",
    name: "Abyssal Rift",
    blurb: "Where the world thins. Few veins, many pillars.",
    ambient: [84, 64, 104],
    floorA: "#4a3f5c",
    floorB: "#433853",
    rockTop: "#1e1529",
    rockFace: "#352646",
    rockDark: "#0b0710",
    accent: "#d07aff",
    torch: "#c38cff",
    veins: 3,
    pillars: 6,
  },
};
export const BIOME_IDS = Object.keys(BIOMES) as BiomeId[];

export type RelicId =
  | "bloodMoney"
  | "sharpIron"
  | "restless"
  | "hoardAges"
  | "cursedGold"
  | "quickHands"
  | "emberHeart"
  | "deepRoots"
  | "grimTithe"
  | "frostbite"
  | "warBanner"
  | "despair"
  | "echoes"
  | "goldRush"
  | "ironMaiden"
  | "quicksilver"
  | "blastCaps"
  | "huntersMark"
  | "miser"
  | "wardStones"
  | "soulSiphon"
  | "treasury"
  | "thornHides"
  | "deathKnell"
  | "sprawl";
export interface RelicDef {
  id: RelicId;
  name: string;
  text: string;
  icon: string;
  rarity: "common" | "rare" | "legendary";
}
export const RELICS: Record<RelicId, RelicDef> = {
  bloodMoney: {
    id: "bloodMoney",
    name: "Blood Money",
    text: "+4 gold for every hero slain.",
    icon: "coin",
    rarity: "common",
  },
  sharpIron: {
    id: "sharpIron",
    name: "Whetted Iron",
    text: "Spikes, saws and darts deal +40% damage.",
    icon: "blade",
    rarity: "rare",
  },
  restless: {
    id: "restless",
    name: "Restless Dead",
    text: "Skeletons reassemble one extra time.",
    icon: "skull",
    rarity: "common",
  },
  hoardAges: {
    id: "hoardAges",
    name: "Hoard of Ages",
    text: "Restore 4 treasure and raise the maximum by 4.",
    icon: "chest",
    rarity: "common",
  },
  cursedGold: {
    id: "cursedGold",
    name: "Cursed Gold",
    text: "Heroes who loot bait take +35% damage for 6s.",
    icon: "curse",
    rarity: "common",
  },
  quickHands: {
    id: "quickHands",
    name: "Oiled Gears",
    text: "Traps rearm 35% faster.",
    icon: "gear",
    rarity: "rare",
  },
  emberHeart: {
    id: "emberHeart",
    name: "Ember Heart",
    text: "Burning lasts twice as long.",
    icon: "flame",
    rarity: "common",
  },
  deepRoots: {
    id: "deepRoots",
    name: "Deep Roots",
    text: "Digging is free.",
    icon: "pick",
    rarity: "common",
  },
  grimTithe: {
    id: "grimTithe",
    name: "Grim Tithe",
    text: "Gain dread 50% faster.",
    icon: "eye",
    rarity: "common",
  },
  frostbite: {
    id: "frostbite",
    name: "Frostbite",
    text: "Frozen heroes take double damage.",
    icon: "snow",
    rarity: "common",
  },
  warBanner: {
    id: "warBanner",
    name: "War Banner",
    text: "Monsters have +30% health.",
    icon: "banner",
    rarity: "rare",
  },
  despair: {
    id: "despair",
    name: "Pit of Despair",
    text: "Trapdoor falls deal 35 damage.",
    icon: "pit",
    rarity: "common",
  },
  echoes: {
    id: "echoes",
    name: "Echoing Halls",
    text: "Combo gold is doubled.",
    icon: "wave",
    rarity: "common",
  },
  goldRush: {
    id: "goldRush",
    name: "Gold Rush",
    text: "+30 gold now and +10 income each dawn.",
    icon: "coin",
    rarity: "common",
  },
  ironMaiden: {
    id: "ironMaiden",
    name: "Iron Maiden",
    text: "Spike plates rearm almost instantly, stabbing every hero in line.",
    icon: "blade",
    rarity: "rare",
  },
  quicksilver: {
    id: "quicksilver",
    name: "Quicksilver Tar",
    text: "Tar slows heroes to a crawl.",
    icon: "wave",
    rarity: "common",
  },
  blastCaps: {
    id: "blastCaps",
    name: "Blasting Caps",
    text: "Powder kegs blast 50% harder and wider.",
    icon: "flame",
    rarity: "rare",
  },
  huntersMark: {
    id: "huntersMark",
    name: "Hunter's Mark",
    text: "Elite heroes and champions take +25% damage.",
    icon: "eye",
    rarity: "rare",
  },
  miser: {
    id: "miser",
    name: "Miser's Ledger",
    text: "Selling always refunds the full price.",
    icon: "coin",
    rarity: "common",
  },
  wardStones: {
    id: "wardStones",
    name: "Ward Stones",
    text: "Rogues and rangers spot traps at half range.",
    icon: "eye",
    rarity: "common",
  },
  soulSiphon: {
    id: "soulSiphon",
    name: "Soul Siphon",
    text: "Raids begin with 8 dread, and dread can reach 20.",
    icon: "eye",
    rarity: "rare",
  },
  treasury: {
    id: "treasury",
    name: "Royal Treasury",
    text: "Interest: each dawn, +1 gold per 8 you saved (max 20).",
    icon: "chest",
    rarity: "rare",
  },
  thornHides: {
    id: "thornHides",
    name: "Thorned Hides",
    text: "Monsters return 35% of melee damage to the attacker.",
    icon: "blade",
    rarity: "common",
  },
  sprawl: {
    id: "sprawl",
    name: "Sprawling Halls",
    text: "Your dungeon holds 4 more pieces.",
    icon: "pick",
    rarity: "rare",
  },
  deathKnell: {
    id: "deathKnell",
    name: "Death Knell",
    text: "Each kill stuns heroes within 2 tiles for 1s.",
    icon: "skull",
    rarity: "legendary",
  },
};

export type PowerId = "rockfall" | "shriek" | "chill";
export interface PowerDef {
  id: PowerId;
  name: string;
  cost: number;
  cooldown: number;
  text: string;
  hint: string;
}
export const POWERS: Record<PowerId, PowerDef> = {
  rockfall: {
    id: "rockfall",
    name: "Rockfall",
    cost: 5,
    cooldown: 5,
    text: "Collapse the ceiling on a 3×3 area. Stuns.",
    hint: "Tap where the ceiling should fall",
  },
  shriek: {
    id: "shriek",
    name: "Dread Shriek",
    cost: 7,
    cooldown: 9,
    text: "Heroes nearby flee in terror.",
    hint: "Tap near heroes to terrify them",
  },
  chill: {
    id: "chill",
    name: "Grave Chill",
    cost: 4,
    cooldown: 7,
    text: "A freezing gust slows heroes nearby for 4s.",
    hint: "Tap to chill the heroes around it",
  },
};

export type ArchitectId =
  "mason" | "trickster" | "lich" | "beastmaster" | "alchemist";
export interface ArchitectDef {
  id: ArchitectId;
  name: string;
  title: string;
  text: string;
  start: PieceId[];
  unlockRenown: number;
}
export const ARCHITECTS: ArchitectDef[] = [
  {
    id: "mason",
    name: "Grimwald",
    title: "the Mason",
    text: "Starts with 30 extra gold. Dependable stone and steel.",
    start: ["spikes", "darts", "skeleton", "lure"],
    unlockRenown: 0,
  },
  {
    id: "trickster",
    name: "Vex",
    title: "the Trickster",
    text: "Traps cost 20% less. Starts with springs and tar.",
    start: ["spikes", "spring", "tar", "lure"],
    unlockRenown: 25,
  },
  {
    id: "lich",
    name: "Morwen",
    title: "the Lich",
    text: "Monsters have +25% health. Starts with the dead.",
    start: ["skeleton", "archer", "slime", "lure"],
    unlockRenown: 70,
  },
  {
    id: "beastmaster",
    name: "Brakka",
    title: "the Beastmaster",
    text: "Monsters cost 15% less and hit 15% harder. Starts with the pack.",
    start: ["bat", "spider", "skeleton", "lure"],
    unlockRenown: 130,
  },
  {
    id: "alchemist",
    name: "Seraphine",
    title: "the Alchemist",
    text: "Fire and poison deal 30% more. Starts with tar, flame and gas.",
    start: ["tar", "flame", "gas", "lure"],
    unlockRenown: 200,
  },
];

/** Pieces available in drafts before any meta unlocks. */
export const BASE_POOL: PieceId[] = [
  "spikes",
  "darts",
  "skeleton",
  "archer",
  "slime",
  "tar",
  "lure",
  "spring",
  "frost",
  "flame",
  "keg",
];
/** Meta unlock track: renown thresholds add pieces, biomes, powers. */
export interface Unlock {
  at: number;
  kind: "piece" | "biome" | "power" | "architect";
  id: string;
  label: string;
}
export const UNLOCKS: Unlock[] = [
  { at: 6, kind: "piece", id: "bat", label: "Bat Swarm" },
  { at: 12, kind: "power", id: "shriek", label: "Dread Shriek power" },
  { at: 18, kind: "piece", id: "boulder", label: "Boulder" },
  { at: 25, kind: "architect", id: "trickster", label: "Vex the Trickster" },
  { at: 32, kind: "piece", id: "ogre", label: "Cave Ogre" },
  { at: 38, kind: "piece", id: "spider", label: "Cave Spider" },
  { at: 45, kind: "biome", id: "grotto", label: "Fungal Grotto" },
  { at: 52, kind: "piece", id: "trapdoor", label: "Trapdoor" },
  { at: 60, kind: "piece", id: "imp", label: "Fire Imp" },
  { at: 70, kind: "architect", id: "lich", label: "Morwen the Lich" },
  { at: 78, kind: "piece", id: "gas", label: "Miasma Vent" },
  { at: 88, kind: "piece", id: "ghost", label: "Wailing Ghost" },
  { at: 98, kind: "power", id: "chill", label: "Grave Chill power" },
  { at: 108, kind: "piece", id: "saw", label: "Saw Track" },
  { at: 120, kind: "biome", id: "forge", label: "Magma Forge" },
  {
    at: 130,
    kind: "architect",
    id: "beastmaster",
    label: "Brakka the Beastmaster",
  },
  { at: 142, kind: "piece", id: "pylon", label: "Storm Pylon" },
  { at: 156, kind: "piece", id: "mimic", label: "Mimic" },
  { at: 172, kind: "biome", id: "glacier", label: "Frozen Depths" },
  { at: 188, kind: "piece", id: "golem", label: "Stone Golem" },
  {
    at: 200,
    kind: "architect",
    id: "alchemist",
    label: "Seraphine the Alchemist",
  },
  { at: 220, kind: "piece", id: "necro", label: "Necromancer" },
  { at: 250, kind: "biome", id: "abyss", label: "Abyssal Rift" },
];

/** Architect ranks: titles that keep climbing after the unlock track ends. */
export const RANKS = [
  "Apprentice",
  "Tunneler",
  "Trapwright",
  "Warden",
  "Master Builder",
  "Dread Architect",
  "Dungeon Lord",
  "Overlord",
  "Abyssal Sovereign",
  "Eternal Architect",
];
/** Renown needed for each rank; past the table, every 120 renown adds a level. */
export const RANK_AT = [0, 15, 40, 80, 130, 190, 260, 340, 430, 530];
const RANK_STEP = 120;
export function rankFor(renown: number) {
  let i = 0;
  while (i + 1 < RANK_AT.length && renown >= RANK_AT[i + 1]) i++;
  const last = i === RANK_AT.length - 1;
  const extra = last ? Math.floor((renown - RANK_AT[i]) / RANK_STEP) : 0;
  const prev = last ? RANK_AT[i] + extra * RANK_STEP : RANK_AT[i];
  const next = last ? prev + RANK_STEP : RANK_AT[i + 1];
  return {
    level: i + 1 + extra,
    title: extra > 0 ? `${RANKS[i]} ${roman(extra + 1)}` : RANKS[i],
    prev,
    next,
  };
}
export function roman(n: number) {
  const map: [number, string][] = [
    [1000, "M"],
    [900, "CM"],
    [500, "D"],
    [400, "CD"],
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let out = "";
  for (const [v, s] of map)
    while (n >= v) {
      out += s;
      n -= v;
    }
  return out;
}

// ---------- Depths: the endless ladder of dungeons ----------
export type MutatorId =
  | "ironclad"
  | "horde"
  | "bloodMoon"
  | "zealots"
  | "scouts"
  | "haste"
  | "famine"
  | "hardRock"
  | "blessed"
  | "gilded"
  | "ancient"
  | "armory";
export interface MutatorDef {
  id: MutatorId;
  name: string;
  text: string;
  good: boolean;
  /** First depth where it can roll. */
  from: number;
}
export const MUTATORS: Record<MutatorId, MutatorDef> = {
  ironclad: {
    id: "ironclad",
    name: "Ironclad",
    text: "Heroes wear +2 armor.",
    good: false,
    from: 3,
  },
  horde: {
    id: "horde",
    name: "The Horde",
    text: "Parties are 30% larger, but heroes have 15% less health.",
    good: false,
    from: 2,
  },
  bloodMoon: {
    id: "bloodMoon",
    name: "Blood Moon",
    text: "From night 3, every party is led by an elite.",
    good: false,
    from: 4,
  },
  zealots: {
    id: "zealots",
    name: "Zealots",
    text: "Heroes can't be frightened.",
    good: false,
    from: 3,
  },
  scouts: {
    id: "scouts",
    name: "Cartographers",
    text: "Heroes know where every trap is.",
    good: false,
    from: 5,
  },
  haste: {
    id: "haste",
    name: "Haste",
    text: "Heroes move 12% faster.",
    good: false,
    from: 2,
  },
  famine: {
    id: "famine",
    name: "Lean Times",
    text: "Dawn tribute is 25% lower.",
    good: false,
    from: 2,
  },
  hardRock: {
    id: "hardRock",
    name: "Hard Rock",
    text: "Digging costs 3 times as much.",
    good: false,
    from: 2,
  },
  blessed: {
    id: "blessed",
    name: "Blessed",
    text: "Heroes heal 50% more and inspiration lasts longer.",
    good: false,
    from: 4,
  },
  gilded: {
    id: "gilded",
    name: "Gilded Veins",
    text: "Twice as many gold veins, each worth 50% more.",
    good: true,
    from: 2,
  },
  ancient: {
    id: "ancient",
    name: "Ancient Hoard",
    text: "Your hoard holds 4 more treasure.",
    good: true,
    from: 3,
  },
  armory: {
    id: "armory",
    name: "Old Armory",
    text: "Start with an extra blueprint.",
    good: true,
    from: 2,
  },
};

/** Fixed difficulty steps for the first depths (each adds to the last). */
export const DEPTH_HEAT = [
  "",
  "",
  "Heroes have 15% more health.",
  "Parties are larger.",
  "Start with 30 less gold.",
  "Elite heroes appear more often.",
  "Your hoard starts 3 treasure lighter.",
  "Heroes move 10% faster.",
  "Champions bring an honor guard.",
];
/** Classes that only join parties from a given depth (or in the abyss). */
export const HERO_DEPTH: Partial<Record<HeroClass, number>> = {
  bard: 2,
  windcaller: 3,
  inquisitor: 4,
};

const DEPTH_NAMES_A = [
  "Weeping",
  "Hollow",
  "Gilded",
  "Drowned",
  "Silent",
  "Burning",
  "Forgotten",
  "Shattered",
  "Howling",
  "Starless",
  "Crimson",
  "Ashen",
  "Sunless",
  "Bleeding",
  "Whispering",
  "Iron",
];
const DEPTH_NAMES_B = [
  "Vaults",
  "Catacombs",
  "Warrens",
  "Halls",
  "Cisterns",
  "Labyrinth",
  "Ossuary",
  "Undercroft",
  "Pits",
  "Barrows",
  "Sepulchre",
  "Mines",
  "Deeps",
  "Galleries",
];
const FIXED_DEPTH_NAMES = [
  "The Old Cellars",
  "The Hollow Vaults",
  "The Weeping Catacombs",
];
/** Deterministic name for a depth. */
export function depthName(depth: number) {
  if (depth <= FIXED_DEPTH_NAMES.length) return FIXED_DEPTH_NAMES[depth - 1];
  let h = Math.imul(depth, 0x9e3779b1) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  const a = DEPTH_NAMES_A[h % DEPTH_NAMES_A.length];
  const b = DEPTH_NAMES_B[(h >>> 8) % DEPTH_NAMES_B.length];
  return `The ${a} ${b}`;
}

// ---------- Feats: long-term goals that pay renown ----------
export type StatId = "kills" | "fireKills" | "falls" | "powerKills" | "dailies";
export interface FeatDef {
  id: string;
  name: string;
  text: string;
  renown: number;
  /** Lifetime counter and target, for feats with a progress bar. */
  stat?: StatId;
  goal?: number;
}
export const FEATS: FeatDef[] = [
  {
    id: "firstBlood",
    name: "First Blood",
    text: "Slay your first hero.",
    renown: 2,
  },
  {
    id: "flawless",
    name: "Flawless",
    text: "Earn 3 stars on a night.",
    renown: 3,
  },
  {
    id: "combo5",
    name: "Chain Reaction",
    text: "Reach a 5× kill combo.",
    renown: 5,
  },
  {
    id: "combo8",
    name: "Massacre",
    text: "Reach an 8× kill combo.",
    renown: 10,
  },
  { id: "aldric", name: "Kingslayer", text: "Defeat Sir Aldric.", renown: 5 },
  {
    id: "veyla",
    name: "Spellbreaker",
    text: "Defeat Archmage Veyla.",
    renown: 8,
  },
  {
    id: "grukk",
    name: "Giant Killer",
    text: "Defeat Warlord Grukk.",
    renown: 8,
  },
  { id: "depth3", name: "Into the Dark", text: "Conquer depth 3.", renown: 8 },
  { id: "depth6", name: "Deep Delver", text: "Conquer depth 6.", renown: 15 },
  { id: "depth10", name: "Abyss Gazer", text: "Conquer depth 10.", renown: 25 },
  { id: "depth15", name: "Bottomless", text: "Conquer depth 15.", renown: 40 },
  {
    id: "abyss15",
    name: "Abyss Walker",
    text: "Survive night 15 in the abyss.",
    renown: 10,
  },
  {
    id: "abyss20",
    name: "Abyss Lord",
    text: "Survive night 20 in the abyss.",
    renown: 20,
  },
  {
    id: "abyss30",
    name: "Endless Night",
    text: "Survive night 30 in the abyss.",
    renown: 40,
  },
  {
    id: "perfect",
    name: "Perfect Descent",
    text: "Win a descent without losing any treasure.",
    renown: 20,
  },
  {
    id: "allStars",
    name: "Constellation",
    text: "Earn 3 stars on every night of a descent.",
    renown: 30,
  },
  {
    id: "kills100",
    name: "Slayer",
    text: "Slay 100 heroes.",
    renown: 5,
    stat: "kills",
    goal: 100,
  },
  {
    id: "kills500",
    name: "Butcher",
    text: "Slay 500 heroes.",
    renown: 15,
    stat: "kills",
    goal: 500,
  },
  {
    id: "kills2000",
    name: "Legend of Dread",
    text: "Slay 2,000 heroes.",
    renown: 40,
    stat: "kills",
    goal: 2000,
  },
  {
    id: "fire50",
    name: "Pyromaniac",
    text: "Burn 50 heroes to death.",
    renown: 10,
    stat: "fireKills",
    goal: 50,
  },
  {
    id: "fall25",
    name: "Bottomless Pit",
    text: "Drop heroes through trapdoors 25 times.",
    renown: 8,
    stat: "falls",
    goal: 25,
  },
  {
    id: "power50",
    name: "Hand of Doom",
    text: "Slay 50 heroes with your powers.",
    renown: 8,
    stat: "powerKills",
    goal: 50,
  },
  {
    id: "hoarder",
    name: "Hoarder",
    text: "End a raid with 400 gold to spend.",
    renown: 6,
  },
  {
    id: "minimal",
    name: "Less Is More",
    text: "Win night 6 or later with 6 pieces or fewer.",
    renown: 12,
  },
  {
    id: "collector",
    name: "Collector",
    text: "Own 14 blueprints in one descent.",
    renown: 8,
  },
  {
    id: "relics6",
    name: "Reliquary",
    text: "Hold 6 relics in one descent.",
    renown: 8,
  },
  {
    id: "tier3",
    name: "Masterwork",
    text: "Upgrade a piece to tier III.",
    renown: 4,
  },
  {
    id: "allArchitects",
    name: "Guild of Five",
    text: "Win a descent with every architect.",
    renown: 30,
  },
  {
    id: "daily7",
    name: "Devoted",
    text: "Finish 7 daily dungeons.",
    renown: 12,
    stat: "dailies",
    goal: 7,
  },
  {
    id: "noDig",
    name: "Squatter",
    text: "Win a descent without digging a single tile.",
    renown: 15,
  },
];
