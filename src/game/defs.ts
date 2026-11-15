/**
 * Game data. All tuning lives here so balance changes never touch systems.
 * Time values are in seconds; distances in tiles.
 */
export const RULES_VERSION = 1;
export const TICK = 0.05; // 20 simulation ticks per second
export const MAP_W = 11;
export const MAP_H = 15;
export const NIGHTS = 10;
export const DIG_COST = 2;
export const VEIN_GOLD = 14;
export const RAID_RETREAT_AT = 150; // seconds; heroes then head home
export const RAID_HARD_LIMIT = 200;

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
  | "keg";
export type MonsterId =
  | "skeleton"
  | "archer"
  | "slime"
  | "ogre"
  | "bat"
  | "necro"
  | "mimic"
  | "imp"
  | "ghost";
export type PieceId = TrapId | MonsterId;
export type HeroClass =
  | "knight"
  | "rogue"
  | "cleric"
  | "mage"
  | "ranger"
  | "dwarf"
  | "berserker"
  | "paladin";

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
};

export interface Biome {
  id: "crypt" | "grotto" | "forge";
  name: string;
  blurb: string;
  ambient: [number, number, number];
  floorA: string;
  floorB: string;
  rockTop: string;
  rockFace: string;
  rockDark: string;
  accent: string;
  veins: number;
  pillars: number;
}
export const BIOMES: Record<Biome["id"], Biome> = {
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
    veins: 5,
    pillars: 5,
  },
};

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
  | "goldRush";
export interface RelicDef {
  id: RelicId;
  name: string;
  text: string;
  icon: string;
}
export const RELICS: Record<RelicId, RelicDef> = {
  bloodMoney: {
    id: "bloodMoney",
    name: "Blood Money",
    text: "+4 gold for every hero slain.",
    icon: "coin",
  },
  sharpIron: {
    id: "sharpIron",
    name: "Whetted Iron",
    text: "Spikes, saws and darts deal +40% damage.",
    icon: "blade",
  },
  restless: {
    id: "restless",
    name: "Restless Dead",
    text: "Skeletons reassemble one extra time.",
    icon: "skull",
  },
  hoardAges: {
    id: "hoardAges",
    name: "Hoard of Ages",
    text: "Restore 4 treasure and raise the maximum by 4.",
    icon: "chest",
  },
  cursedGold: {
    id: "cursedGold",
    name: "Cursed Gold",
    text: "Heroes who loot bait take +35% damage for 6s.",
    icon: "curse",
  },
  quickHands: {
    id: "quickHands",
    name: "Oiled Gears",
    text: "Traps rearm 35% faster.",
    icon: "gear",
  },
  emberHeart: {
    id: "emberHeart",
    name: "Ember Heart",
    text: "Burning lasts twice as long.",
    icon: "flame",
  },
  deepRoots: {
    id: "deepRoots",
    name: "Deep Roots",
    text: "Digging is free.",
    icon: "pick",
  },
  grimTithe: {
    id: "grimTithe",
    name: "Grim Tithe",
    text: "Gain dread 50% faster.",
    icon: "eye",
  },
  frostbite: {
    id: "frostbite",
    name: "Frostbite",
    text: "Frozen heroes take double damage.",
    icon: "snow",
  },
  warBanner: {
    id: "warBanner",
    name: "War Banner",
    text: "Monsters have +30% health.",
    icon: "banner",
  },
  despair: {
    id: "despair",
    name: "Pit of Despair",
    text: "Trapdoor falls deal 35 damage.",
    icon: "pit",
  },
  echoes: {
    id: "echoes",
    name: "Echoing Halls",
    text: "Combo gold is doubled.",
    icon: "wave",
  },
  goldRush: {
    id: "goldRush",
    name: "Gold Rush",
    text: "+30 gold now and +10 income each dawn.",
    icon: "coin",
  },
};

export type PowerId = "rockfall" | "shriek";
export interface PowerDef {
  id: PowerId;
  name: string;
  cost: number;
  cooldown: number;
  text: string;
}
export const POWERS: Record<PowerId, PowerDef> = {
  rockfall: {
    id: "rockfall",
    name: "Rockfall",
    cost: 5,
    cooldown: 5,
    text: "Collapse the ceiling on a 3×3 area. Stuns.",
  },
  shriek: {
    id: "shriek",
    name: "Dread Shriek",
    cost: 7,
    cooldown: 9,
    text: "Heroes nearby flee in terror.",
  },
};

export interface ArchitectDef {
  id: "mason" | "trickster" | "lich";
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
    text: "Starts with 40 extra gold. Dependable stone and steel.",
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
  kind: "piece" | "biome" | "power" | "architect" | "infamy";
  id: string;
  label: string;
}
export const UNLOCKS: Unlock[] = [
  { at: 6, kind: "piece", id: "bat", label: "Bat Swarm" },
  { at: 12, kind: "power", id: "shriek", label: "Dread Shriek power" },
  { at: 18, kind: "piece", id: "boulder", label: "Boulder" },
  { at: 25, kind: "architect", id: "trickster", label: "Vex the Trickster" },
  { at: 32, kind: "piece", id: "ogre", label: "Cave Ogre" },
  { at: 40, kind: "biome", id: "grotto", label: "Fungal Grotto" },
  { at: 48, kind: "piece", id: "trapdoor", label: "Trapdoor" },
  { at: 56, kind: "piece", id: "imp", label: "Fire Imp" },
  { at: 64, kind: "piece", id: "gas", label: "Miasma Vent" },
  { at: 70, kind: "architect", id: "lich", label: "Morwen the Lich" },
  { at: 80, kind: "piece", id: "ghost", label: "Wailing Ghost" },
  { at: 92, kind: "piece", id: "saw", label: "Saw Track" },
  { at: 105, kind: "biome", id: "forge", label: "Magma Forge" },
  { at: 120, kind: "piece", id: "mimic", label: "Mimic" },
  { at: 140, kind: "piece", id: "necro", label: "Necromancer" },
];

export const INFAMY_TEXT = [
  "The realm barely knows your name.",
  "Heroes have 15% more health.",
  "Parties are larger.",
  "Start with 30 less gold.",
  "Elite heroes appear more often.",
  "Your hoard starts 3 treasure lighter.",
  "Heroes move 10% faster.",
  "Sir Aldric brings an honor guard.",
];
