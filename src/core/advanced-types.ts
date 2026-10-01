import type { Direction, Point } from "./types";

export const THEMES = [
  "forgotten-cave",
  "ancient-ruins",
  "castle",
  "fortress",
  "temple",
  "underground-city",
  "hell",
  "alien-facility",
] as const;
export type Theme = (typeof THEMES)[number];
export const ADVANCED_OBJECTS = [
  "plate",
  "lever",
  "button",
  "color-switch",
  "gate",
  "block",
  "barrel",
  "mirror",
  "timer",
  "counter",
  "and-gate",
  "or-gate",
  "not-gate",
  "proximity",
  "repeater",
  "teleporter",
  "stairs",
  "elevator",
  "checkpoint",
  "bridge",
  "breakable-wall",
  "hidden-passage",
  "platform",
  "conveyor",
  "pillar",
  "spawn-zone",
  "arrow-trap",
  "falling-rock",
  "saw",
  "pit",
  "crusher",
  "launcher",
  "blade",
  "poison-gas",
  "lava",
  "freezer",
  "electric-coil",
  "gravity-trap",
  "teleport-trap",
  "time-trap",
  "water",
  "oil",
  "wind",
  "darkness",
  "light",
  "smoke",
  "bat",
  "stalker",
  "summoner",
  "healer",
  "patrol",
  "ambusher",
  "shield",
  "mimic",
  "boss",
  "gold",
  "equipment",
  "artifact",
  "resource",
  "cosmetic",
  "npc",
] as const;
export type AdvancedObjectType = (typeof ADVANCED_OBJECTS)[number];
export type SignalEvent =
  | "OnEnter"
  | "OnExit"
  | "OnTrigger"
  | "OnDamage"
  | "OnDeath"
  | "OnInteract"
  | "OnActivate"
  | "OnDeactivate"
  | "OnTimer"
  | "OnCollision"
  | "OnDestroy"
  | "OnSpawn";
export type RuleAction =
  | "activate"
  | "deactivate"
  | "toggle"
  | "open"
  | "close"
  | "damage"
  | "heal"
  | "spawn"
  | "destroy"
  | "increment"
  | "set"
  | "teleport";
export interface LogicRule {
  id: string;
  source: string;
  event: SignalEvent;
  target: string;
  action: RuleAction;
  delay: number;
  condition?: {
    variable: "keys" | "health" | "counter" | "random";
    operator: "gte" | "lte" | "eq";
    value: number;
  };
  otherwise?: RuleAction;
}
export interface BossPhase {
  threshold: number;
  attack: "melee" | "cross" | "charge" | "summon" | "shatter";
  cooldown: number;
  damage: number;
  armor: number;
}
export interface ObjectConfig {
  body?: "brute" | "serpent" | "sentinel";
  damage?: number;
  cooldown?: number;
  range?: number;
  enabled?: boolean;
  channel?: number;
  target?: string;
  delay?: number;
  threshold?: number;
  hp?: number;
  patrol?: Point[];
  phases?: BossPhase[];
  dialogue?: string;
  faction?: string;
  quest?: "key" | "monster" | "treasure";
}
export type AdventurerBuild =
  "warrior" | "rogue" | "mage" | "engineer" | "explorer";
export const BUILDS: Record<
  AdventurerBuild,
  {
    health: number;
    attack: number;
    defense: number;
    cooldown: number;
    description: string;
  }
> = {
  warrior: {
    health: 110,
    attack: 22,
    defense: 2,
    cooldown: 6,
    description: "Guard halves incoming damage for three turns.",
  },
  rogue: {
    health: 85,
    attack: 18,
    defense: 0,
    cooldown: 6,
    description:
      "Vanish from enemies for three turns; move two tiles with a dash.",
  },
  mage: {
    health: 80,
    attack: 16,
    defense: 0,
    cooldown: 5,
    description: "Cast a freezing pulse that stops enemies and freezes water.",
  },
  engineer: {
    health: 95,
    attack: 17,
    defense: 1,
    cooldown: 5,
    description: "Disable nearby traps and activate nearby mechanisms.",
  },
  explorer: {
    health: 100,
    attack: 18,
    defense: 1,
    cooldown: 7,
    description: "Recover health and reveal hidden passages nearby.",
  },
};
export interface AdvancedState {
  alliances: string[];
  supplies: Record<string, number>;
  build: AdventurerBuild;
  keys: number;
  abilityReady: number;
  effectUntil: number;
  slowedUntil: number;
  checkpoint: Point | null;
  active: Record<string, boolean>;
  counters: Record<string, number>;
  positions: Record<string, Point>;
  destroyed: string[];
  scheduled: {
    tick: number;
    source: string;
    target: string;
    action: RuleAction;
    value: number;
  }[];
  signals: { source: string; event: SignalEvent }[];
  signalOverflow: boolean;
  environment: Record<
    string,
    | "fire"
    | "water"
    | "ice"
    | "poison"
    | "electricity"
    | "lava"
    | "wind"
    | "darkness"
    | "light"
    | "smoke"
    | "oil"
  >;
  loot: {
    gold: number;
    equipment: number;
    artifacts: number;
    resources: number;
    cosmetics: number;
  };
  visited: string[];
  quests: string[];
  facing: Direction;
}
