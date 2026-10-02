import {
  DEFAULT_DISCOVERY,
  DIFFICULTY_PREFERENCES,
  SESSION_PREFERENCES,
} from "../src/shared/discovery";
import type { DiscoveryPreferences } from "../src/shared/discovery";
import type { DungeonCard } from "../src/shared/community";
import { ApiError, objectBody } from "./errors";
import type { Database } from "./database";

export function discoveryPreferences(
  db: Database,
  userId: string,
): DiscoveryPreferences {
  return (
    db.get<DiscoveryPreferences>(
      "SELECT difficulty,session FROM discovery_preferences WHERE user_id=?",
      userId,
    ) ?? { ...DEFAULT_DISCOVERY }
  );
}
export function parseDiscovery(input: unknown): DiscoveryPreferences {
  const value = objectBody(input);
  if (
    !(DIFFICULTY_PREFERENCES as readonly unknown[]).includes(
      value.difficulty,
    ) ||
    !(SESSION_PREFERENCES as readonly unknown[]).includes(value.session)
  )
    throw new ApiError(
      400,
      "invalid_preferences",
      "Choose a supported difficulty and session length.",
    );
  return {
    difficulty: value.difficulty as DiscoveryPreferences["difficulty"],
    session: value.session as DiscoveryPreferences["session"],
  };
}
export interface PlayHistory {
  version_id: string;
  outcome: string;
  ticks: number;
  challenge_rating: number;
}
export function preferenceScorer(
  preferences: DiscoveryPreferences,
  history: PlayHistory[],
): (
  card: Pick<DungeonCard, "difficulty" | "averageSeconds"> & {
    calibration: Pick<DungeonCard["calibration"], "medianCompletionSeconds">;
  },
  rating: number,
) => number {
  // Each version contributes once, so grinding retries cannot dominate adaptation.
  const distinct = [
    ...new Map([...history].reverse().map((h) => [h.version_id, h])).values(),
  ];
  const clears = distinct.filter((h) => h.outcome === "completed");
  const mean = (values: number[]) =>
    values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  const strength = clears.length
    ? mean(clears.map((h) => h.challenge_rating))
    : Math.max(
        0,
        mean(
          distinct
            .filter((h) => h.outcome === "dead")
            .map((h) => h.challenge_rating),
        ) - 10,
      );
  const seconds = mean(clears.map((h) => h.ticks / 4));
  return (card, rating) => {
    let score = 0;
    if (preferences.difficulty === "adaptive" && strength)
      score += Math.max(0, 10 - Math.abs(rating - strength) / 5);
    else if (
      preferences.difficulty !== "any" &&
      preferences.difficulty !== "adaptive"
    ) {
      const distance = Math.abs(
        DIFFICULTY_PREFERENCES.indexOf(preferences.difficulty) -
          DIFFICULTY_PREFERENCES.indexOf(
            card.difficulty as DiscoveryPreferences["difficulty"],
          ),
      );
      score +=
        card.difficulty === "Uncalibrated" ? 4 : Math.max(0, 12 - distance * 4);
    }
    const duration =
      card.calibration.medianCompletionSeconds || card.averageSeconds;
    if (duration > 0) {
      if (preferences.session === "adaptive" && seconds)
        score += Math.max(0, 10 - Math.abs(duration - seconds) / 10);
      else if (
        (preferences.session === "short" && duration <= 60) ||
        (preferences.session === "medium" && duration > 60 && duration < 120) ||
        (preferences.session === "long" && duration >= 120)
      )
        score += 10;
    }
    return score;
  };
}

/** Expand the authenticated recommendation audience only after observed engagement. */
export function audienceLimit(card: {
  players: number;
  clearers: number;
  reactions: number;
}): number {
  if (card.players >= 10 && card.clearers >= 2) return Infinity;
  if (card.players >= 3 && (card.clearers > 0 || card.reactions >= 2))
    return 100;
  return 20;
}
