export const DUNGEON_SCHEMA_VERSION = 1;
export const SIMULATION_VERSION = 1;
export const TICK_MS = 250;
export const MAX_TICKS = 2_400;

export type ObjectType =
  | "entrance"
  | "treasure"
  | "key"
  | "door"
  | "spikes"
  | "fire"
  | "skeleton"
  | "archer"
  | "slime"
  | "guardian"
  | "potion";
export type Category = "rooms" | "traps" | "monsters" | "objects";
export type Tool = "select" | "room" | "floor" | "wall" | "erase" | ObjectType;
export type Direction = "up" | "right" | "down" | "left";
export interface Point {
  x: number;
  y: number;
}
export interface DungeonObject extends Point {
  id: string;
  type: ObjectType;
  rotation: number;
}
export interface Dungeon {
  schemaVersion: number;
  id: string;
  title: string;
  theme: "forgotten-cave";
  width: number;
  height: number;
  budget: number;
  tiles: number[];
  objects: DungeonObject[];
}
export interface ContentDefinition {
  id: ObjectType;
  nameKey: string;
  descriptionKey: string;
  category: Category;
  cost: number;
  behavior: "spawn" | "goal" | "key" | "door" | "trap" | "enemy" | "heal";
  hp?: number;
  damage?: number;
  range?: number;
  cooldown?: number;
  color: string;
}
export type Action =
  | { type: "move"; direction: Direction }
  | { type: "attack" }
  | { type: "wait" };
export type RunStatus = "playing" | "completed" | "dead" | "abandoned";
export interface GameEvent extends Point {
  tick: number;
  kind:
    | "spawn"
    | "move"
    | "blocked"
    | "attack"
    | "damage"
    | "kill"
    | "trap"
    | "key"
    | "door"
    | "heal"
    | "complete"
    | "death"
    | "timeout";
  amount?: number;
  objectId?: string;
  reason?: string;
}
export interface EnemyState {
  id: string;
  hp: number;
  nextAttack: number;
}
export interface RunState {
  tick: number;
  randomState: number;
  player: Point & {
    hp: number;
    maxHp: number;
    hasKey: boolean;
    facing: Direction;
  };
  enemies: EnemyState[];
  collected: string[];
  opened: string[];
  trapCooldowns: Record<string, number>;
  status: RunStatus;
  damageTaken: number;
  events: GameEvent[];
}
export interface Replay {
  schemaVersion: 1;
  simulationVersion: number;
  id: string;
  dungeonVersionId: string;
  adventurer: string;
  seed: number;
  dungeon: Dungeon;
  actions: Action[];
  createdAt: string;
}
export interface PublishedVersion {
  id: string;
  number: number;
  dungeon: Dungeon;
  certificate: Replay;
  publishedAt: string;
}
export interface ValidationIssue {
  code: string;
  messageKey: string;
  point?: Point;
}
export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  reachable: Set<string>;
  path: Point[];
}

export const pointKey = (p: Point): string => `${p.x},${p.y}`;
export const DIRECTIONS: Record<Direction, Point> = {
  up: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};
export function clone<T>(value: T): T {
  return structuredClone(value);
}
