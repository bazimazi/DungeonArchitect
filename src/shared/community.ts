import type { Action, Dungeon, Replay } from "../core/types";

export const TAGS = [
  "Combat",
  "Puzzle",
  "Trap",
  "Stealth",
  "Speed",
  "Boss",
  "Vertical",
  "Maze",
  "Resource Management",
  "Precision",
  "Exploration",
] as const;
export type DungeonTag = (typeof TAGS)[number];
export type FeedCategory =
  | "recommended"
  | "new"
  | "trending"
  | "challenging"
  | "clever"
  | "short"
  | "long"
  | "puzzle"
  | "combat"
  | "trap"
  | "favorites"
  | "following"
  | "mine";
export type Visibility = "public" | "unlisted" | "private";
export interface PlayerProfile {
  id: string;
  handle: string;
  displayName: string;
  role: "player" | "moderator" | "admin";
  xp: number;
  level: number;
  gold: number;
  materials: number;
  essence: number;
  interests: DungeonTag[];
  mastery: Record<string, number>;
  achievements: string[];
  followers: number;
  following: number;
  dungeons: number;
  completions: number;
  createdAt: string;
  publishingDisabled: boolean;
}
export interface DungeonCard {
  calibration: {
    medianCompletionSeconds: number;
    averageDamage: number;
    retryRate: number;
    returnEligiblePlayers: number;
    returningPlayers: number;
  };
  id: string;
  sourceId: string;
  title: string;
  description: string;
  tags: DungeonTag[];
  ownerId: string;
  author: string;
  authorName: string;
  shareCode: string;
  versionId: string;
  version: number;
  visibility: Visibility;
  lifecycle: string;
  attempts: number;
  completions: number;
  completionRate: number;
  likes: number;
  favorites: number;
  averageSeconds: number;
  difficulty:
    "Uncalibrated" | "Very easy" | "Easy" | "Moderate" | "Hard" | "Extreme";
  liked: boolean;
  favorited: boolean;
  following: boolean;
  fairness: string[];
  createdAt: string;
  updatedAt: string;
}
export interface CreatorProfile {
  id: string;
  handle: string;
  displayName: string;
  level: number;
  followers: number;
  following: boolean;
  achievements: string[];
  reputation: {
    attempts: number;
    uniqueAdventurers: number;
    favorites: number;
    clears: number;
  };
  dungeons: DungeonCard[];
}
export interface CommunityVersion {
  id: string;
  number: number;
  dungeon: Dungeon;
  createdAt: string;
  attempts: number;
  completions: number;
}
export interface CommunityDungeon {
  card: DungeonCard;
  versions: CommunityVersion[];
}
export interface AttemptTicket {
  id: string;
  seed: number;
  versionId: string;
  dungeon: Dungeon;
  expiresAt: string;
}
export interface AttemptResult {
  id: string;
  outcome: string;
  ticks: number;
  health: number;
  damageTaken: number;
  kills: number;
  rewards: { xp: number; gold: number; materials: number; essence: number };
  profile: PlayerProfile;
}
export interface CommunityAttempt {
  id: string;
  player: string;
  outcome: string;
  ticks: number;
  health: number;
  createdAt: string;
  death: { x: number; y: number } | null;
}
export interface Notification {
  id: string;
  kind: string;
  payload: Record<string, string | number>;
  read: boolean;
  createdAt: string;
}
export interface FriendChallenge {
  ticks?: number;
  damage?: number;
  secrets?: number;
  deaths?: number;
  id: string;
  sender: string;
  recipient: string;
  versionId: string;
  dungeonTitle: string;
  status: string;
  resultId: string | null;
  expiresAt: string;
}
export interface BuildChallenge {
  id: string;
  kind: "daily" | "weekly" | "season";
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  rules: {
    budget?: number;
    maxTiles?: number;
    forbidden?: string[];
    requiredBehavior?: string;
    minCount?: number;
    requiredObjects?: string[];
  };
  theme: string;
}
export interface PublishRequest {
  dungeon: Dungeon;
  proof: Replay;
  description: string;
  tags: DungeonTag[];
  visibility: Visibility;
  dungeonId?: string;
  expectedVersion?: number;
  challengeId?: string;
}
export interface SubmitAttemptRequest {
  actions: Action[];
  abandon?: boolean;
}
export interface LeaderboardEntry {
  metric: string;
  value: number;
  rank: number;
  playerId: string;
  player: string;
  dungeon: string;
  versionId: string;
  ticks: number;
  health: number;
  createdAt: string;
}

export const ERAS = [
  {
    id: "forgotten-cave",
    name: "Forgotten Cave",
    level: 1,
    unlocks: ["rooms", "monsters", "traps", "doors"],
  },
  {
    id: "ancient-ruins",
    name: "Ancient Ruins",
    level: 3,
    unlocks: ["switches", "puzzles", "hidden passages"],
  },
  {
    id: "castle",
    name: "Castle",
    level: 5,
    unlocks: ["patrols", "gates", "elevators"],
  },
  {
    id: "fortress",
    name: "Fortress",
    level: 8,
    unlocks: ["multi-floor", "defenses", "siege"],
  },
  {
    id: "temple",
    name: "Temple",
    level: 12,
    unlocks: ["elements", "magic", "mirrors"],
  },
  {
    id: "underground-city",
    name: "Underground City",
    level: 16,
    unlocks: ["NPCs", "factions", "transport"],
  },
  {
    id: "hell",
    name: "Hell",
    level: 21,
    unlocks: ["demons", "portals", "corruption"],
  },
  {
    id: "alien-facility",
    name: "Alien Facility",
    level: 27,
    unlocks: ["lasers", "drones", "gravity", "time"],
  },
] as const;
export function architectLevel(xp: number): number {
  return 1 + Math.floor(Math.sqrt(Math.max(0, xp) / 50));
}
export function nextLevelXp(level: number): number {
  return level * level * 50;
}
