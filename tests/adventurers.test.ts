import { expect, it } from "vitest";
import { simulateAdventurer } from "../src/core/adventurers";
import { createTemplate } from "../src/core/templates";
import { reconstructReplay } from "../src/core/simulation";

it("systemic playtesters operate a lever gate and clear each starting template", () => {
  for (const id of [
    "gauntlet",
    "puzzle-box",
    "maze",
    "trap-house",
    "boss-rush",
    "escape",
    "survival",
  ]) {
    const dungeon = createTemplate(id, 71);
    const runs = Array.from({ length: 6 }, (_, i) =>
      simulateAdventurer(dungeon, "template", 71 + i, i),
    );
    const states = runs.map((r) => reconstructReplay(r).state);
    expect(
      states.some((s) => s.status === "completed"),
      `${id}: ${states.map((s) => s.status + "/" + s.tick)}`,
    ).toBe(true);
    expect(runs.every((r) => r.actions.length <= 600)).toBe(true);
  }
});

it("playtesters navigate linked stairs and record ordinary player inputs", () => {
  const d = createTemplate("puzzle-box");
  d.height = 26;
  d.budget = 320;
  d.tiles.push(...Array(195).fill(0));
  for (let x = 1; x < 8; x++) d.tiles[16 * 15 + x] = 1;
  d.objects.find((o) => o.type === "treasure")!.y = 16;
  d.objects.find((o) => o.type === "treasure")!.x = 7;
  d.objects.push(
    {
      id: "stair-a",
      type: "stairs",
      x: 8,
      y: 6,
      rotation: 0,
      config: { target: "stair-b" },
    },
    { id: "stair-b", type: "stairs", x: 1, y: 16, rotation: 0 },
  );
  const r = simulateAdventurer(d, "floors", 41, 0);
  expect(reconstructReplay(r).state.status).toBe("completed");
});
