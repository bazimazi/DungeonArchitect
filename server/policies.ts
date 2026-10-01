import { createHash } from "node:crypto";
import { CONTENT } from "../src/core/content";
import { budgetUsed, fingerprint } from "../src/core/dungeon";
import type { Dungeon } from "../src/core/types";
import { TAGS } from "../src/shared/community";
import type { BuildChallenge, DungeonTag } from "../src/shared/community";
import { ApiError } from "./errors";
import { currentSeason } from "../src/shared/economy";

export const contentHash = (dungeon: Dungeon): string =>
  createHash("sha256").update(fingerprint(dungeon)).digest("hex");
export function parseTags(input: unknown): DungeonTag[] {
  if (
    !Array.isArray(input) ||
    input.length > 5 ||
    !input.every(
      (tag) => typeof tag === "string" && TAGS.includes(tag as DungeonTag),
    )
  )
    throw new ApiError(
      400,
      "invalid_tags",
      "Choose up to five supported tags.",
    );
  return [...new Set(input)] as DungeonTag[];
}
export function screenText(value: string): void {
  const normalized = value
    .normalize("NFKC")
    .toLowerCase()
    .replace(
      /[013457@]/g,
      (c) =>
        ({
          "0": "o",
          "1": "i",
          "3": "e",
          "4": "a",
          "5": "s",
          "7": "t",
          "@": "a",
        })[c]!,
    );
  const blocked = (process.env.BLOCKED_TERMS ?? "fuck,shit,cunt,nigger")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (blocked.some((term) => normalized.split(/[^\p{L}]+/u).includes(term)))
    throw new ApiError(
      400,
      "inappropriate_text",
      "Choose a different name or description.",
    );
  if (
    /(?:https?:\/\/|www\.)/i.test(value) ||
    /(\S)\1{14}/u.test(value) ||
    /(?:<script|javascript:)/i.test(value)
  )
    throw new ApiError(
      400,
      "content_rejected",
      "Use a readable name or description without external links or markup.",
    );
}
export function challengeRating(dungeon: Dungeon): number {
  const danger = dungeon.objects.reduce((sum, object) => {
    const definition = CONTENT[object.type];
    const damage = object.config?.damage ?? definition.damage ?? 0;
    const health = object.config?.hp ?? definition.hp ?? 0;
    const range = object.config?.range ?? definition.range ?? 1;
    const cadence = Math.max(
      1,
      object.config?.cooldown ?? definition.cooldown ?? 3,
    );
    return (
      sum +
      (definition.behavior === "enemy"
        ? health / 8 + (damage * range) / cadence
        : definition.behavior === "trap"
          ? damage / cadence
          : definition.behavior === "heal"
            ? -5
            : definition.behavior === "door"
              ? 2
              : 0)
    );
  }, 0);
  return Math.round(
    Math.max(
      1,
      Math.min(
        100,
        danger +
          dungeon.tiles.filter(Boolean).length / 15 +
          (dungeon.rules?.length ?? 0) * 1.5 +
          (dungeon.height / 13 - 1) * 4,
      ),
    ),
  );
}
export function activeChallenges(now: Date): BuildChallenge[] {
  const dayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const dayNumber = Math.floor(dayStart.getTime() / 86400000);
  const weekStart = new Date(dayStart);
  weekStart.setUTCDate(
    weekStart.getUTCDate() - ((weekStart.getUTCDay() + 6) % 7),
  );
  const daily = [
    {
      title: "Minimalist",
      description:
        "Create a complete adventure using at most 50 construction points.",
      rules: { budget: 50 },
    },
    {
      title: "Tiny dungeon",
      description: "Tell your story in no more than 25 floor tiles.",
      rules: { maxTiles: 25 },
    },
    {
      title: "Open invitation",
      description: "Create a dungeon with no locked doors.",
      rules: { forbidden: ["door"] },
    },
    {
      title: "Monster master",
      description: "Use at least three enemies and no traps.",
      rules: {
        forbidden: Object.values(CONTENT)
          .filter((d) => d.behavior === "trap")
          .map((d) => d.id),
        requiredBehavior: "enemy",
        minCount: 3,
      },
    },
    {
      title: "Trap workshop",
      description: "Use at least three traps, with no monsters.",
      rules: {
        forbidden: Object.values(CONTENT)
          .filter((d) => d.behavior === "enemy")
          .map((d) => d.id),
        requiredBehavior: "trap",
        minCount: 3,
      },
    },
  ][dayNumber % 5];
  const season = currentSeason(now);
  const weekly = [
    {
      title: "The thoughtful gauntlet",
      description:
        "Build a fair combat adventure under 120 points, with at least two enemies.",
      rules: { budget: 120, requiredBehavior: "enemy", minCount: 2 },
    },
    {
      title: "Waterworks",
      description:
        "Connect water and electricity in a puzzle under 140 construction points.",
      rules: { budget: 140, requiredObjects: ["water", "electric-coil"] },
    },
    {
      title: "A matter of timing",
      description:
        "Use a timer and pressure plate in a dungeon under 120 construction points.",
      rules: { budget: 120, requiredObjects: ["timer", "plate"] },
    },
    {
      title: "One guardian",
      description:
        "Build around a boss and a checkpoint using no more than 140 construction points.",
      rules: { budget: 140, requiredObjects: ["boss", "checkpoint"] },
    },
  ][Math.floor(weekStart.getTime() / (7 * 86400000)) % 4];
  return [
    {
      id: `daily:${dayStart.toISOString().slice(0, 10)}`,
      kind: "daily",
      ...daily,
      startsAt: dayStart.toISOString(),
      endsAt: new Date(dayStart.getTime() + 86400000).toISOString(),
      theme: "forgotten-cave",
    },
    {
      id: `weekly:${weekStart.toISOString().slice(0, 10)}`,
      kind: "weekly",
      ...weekly,
      startsAt: weekStart.toISOString(),
      endsAt: new Date(weekStart.getTime() + 7 * 86400000).toISOString(),
      theme: "forgotten-cave",
    },
    {
      id: `season:${season.id}`,
      kind: "season",
      title: season.title,
      description: season.description,
      startsAt: season.startsAt,
      endsAt: season.endsAt,
      theme: "forgotten-cave",
      rules: {
        requiredObjects: season.id.endsWith("haunted")
          ? ["darkness", "stalker", "hidden-passage"]
          : season.id.endsWith("winter")
            ? ["water", "freezer"]
            : ["plate", "gate"],
      },
    },
  ];
}
export function checkChallenge(
  dungeon: Dungeon,
  id: string,
  now: Date,
): BuildChallenge {
  const challenge = activeChallenges(now).find((c) => c.id === id);
  if (!challenge)
    throw new ApiError(
      400,
      "challenge_closed",
      "That building challenge is not currently open.",
    );
  const rules = challenge.rules;
  if (
    (rules.budget && budgetUsed(dungeon) > rules.budget) ||
    (rules.maxTiles && dungeon.tiles.filter(Boolean).length > rules.maxTiles) ||
    dungeon.objects.some((o) => rules.forbidden?.includes(o.type)) ||
    rules.requiredObjects?.some(
      (type) => !dungeon.objects.some((o) => o.type === type),
    ) ||
    (rules.requiredBehavior &&
      dungeon.objects.filter(
        (o) => CONTENT[o.type].behavior === rules.requiredBehavior,
      ).length < (rules.minCount ?? 1))
  )
    throw new ApiError(400, "challenge_rules", challenge.description);
  return challenge;
}
