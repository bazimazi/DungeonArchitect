import { expect, it } from "vitest";
import { createStarter } from "../src/core/dungeon";
import { Simulation } from "../src/core/simulation";
import { describeBoard } from "../src/ui/accessibility";

it("describes editor coordinates and current run state including boundary walls and recent damage", () => {
  const dungeon = createStarter();
  const entrance = dungeon.objects.find((o) => o.type === "entrance")!;
  expect(describeBoard(dungeon, entrance)).toContain("Entrance");
  expect(describeBoard(dungeon, { x: 0, y: 13 })).toContain(
    "Floor 2, row A, column 1",
  );
  const simulation = new Simulation(dungeon, 1);
  const state = simulation.state;
  state.player.y = 0;
  const text = describeBoard(dungeon, state.player, state, [
    { kind: "damage", amount: 9, x: 1, y: 0, tick: 1 },
  ]);
  expect(text).toContain(`Health ${state.player.hp} of ${state.player.maxHp}`);
  expect(text).toContain("up: Wall");
  expect(text).toContain("9");
  expect(text).not.toContain("event.");
});
