import { expect, it } from "vitest";
import { audienceLimit, preferenceScorer } from "../server/discovery";
it("weights explicit preferences without filtering unexplored work and adapts using distinct completed adventures", () => {
  const shortEasy = {
    difficulty: "Easy" as const,
    averageSeconds: 30,
    calibration: { medianCompletionSeconds: 30 },
  };
  const longHard = {
    difficulty: "Hard" as const,
    averageSeconds: 150,
    calibration: { medianCompletionSeconds: 150 },
  };
  const explicit = preferenceScorer(
    { difficulty: "Hard", session: "long" },
    [],
  );
  expect(explicit(longHard, 80)).toBeGreaterThan(explicit(shortEasy, 20));
  expect(
    explicit({ ...shortEasy, difficulty: "Uncalibrated" }, 50),
  ).toBeGreaterThan(0);
  const any = preferenceScorer({ difficulty: "any", session: "any" }, []);
  expect(any(shortEasy, 20)).toBe(any(longHard, 80));
  const history = [
    {
      version_id: "one",
      outcome: "completed",
      ticks: 120,
      challenge_rating: 20,
    },
    {
      version_id: "two",
      outcome: "completed",
      ticks: 200,
      challenge_rating: 40,
    },
  ];
  const adaptive = preferenceScorer(
    { difficulty: "adaptive", session: "adaptive" },
    history,
  );
  expect(adaptive(shortEasy, 20)).toBeGreaterThan(adaptive(longHard, 80));
  const repeated = preferenceScorer(
    { difficulty: "adaptive", session: "adaptive" },
    [...Array(100).fill(history[0]), ...history],
  );
  expect(repeated(shortEasy, 20)).toBe(adaptive(shortEasy, 20));
});
it("expands new-creator exposure after varied engagement, while repeated failures alone do not buy reach", () => {
  expect(audienceLimit({ players: 0, clearers: 0, reactions: 0 })).toBe(20);
  expect(audienceLimit({ players: 3, clearers: 1, reactions: 0 })).toBe(100);
  expect(audienceLimit({ players: 3, clearers: 0, reactions: 2 })).toBe(100);
  expect(audienceLimit({ players: 100, clearers: 0, reactions: 0 })).toBe(20);
  expect(audienceLimit({ players: 10, clearers: 2, reactions: 0 })).toBe(
    Infinity,
  );
});
