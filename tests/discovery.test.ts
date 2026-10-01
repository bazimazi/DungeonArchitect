import { expect, it } from "vitest";
import { audienceLimit } from "../server/discovery";
it("expands new-creator exposure after varied engagement, while repeated failures alone do not buy reach", () => {
  expect(audienceLimit({ players: 0, clearers: 0, reactions: 0 })).toBe(20);
  expect(audienceLimit({ players: 3, clearers: 1, reactions: 0 })).toBe(100);
  expect(audienceLimit({ players: 3, clearers: 0, reactions: 2 })).toBe(100);
  expect(audienceLimit({ players: 100, clearers: 0, reactions: 0 })).toBe(20);
  expect(audienceLimit({ players: 10, clearers: 2, reactions: 0 })).toBe(
    Infinity,
  );
});
