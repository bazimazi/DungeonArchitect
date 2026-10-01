import type { Dungeon } from "../core/types";
export interface CampaignNode {
  id: string;
  versionId: string;
  title: string;
  story: string;
  requires?: string;
  condition: "clear" | "flawless" | "treasure";
}
export interface Campaign {
  id: string;
  ownerId: string;
  author: string;
  title: string;
  description: string;
  revision: number;
  nodes: CampaignNode[];
  createdAt: string;
  progress?: { nodeId: string; available: boolean; completed: boolean }[];
}
export interface SharedWorkshop {
  id: string;
  ownerId: string;
  owner: string;
  title: string;
  dungeon: Dungeon;
  revision: number;
  members: { handle: string; role: string }[];
  updatedAt: string;
}
export interface Guild {
  worlds: { id: string; title: string; author: string; addedBy: string }[];
  id: string;
  ownerId: string;
  name: string;
  description: string;
  code: string;
  members: { id: string; handle: string; role: string }[];
}
