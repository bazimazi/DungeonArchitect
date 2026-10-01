import { describe, expect, it } from "vitest";
import { createDungeon, createStarter } from "../src/core/dungeon";
import { Simulation, reconstructReplay } from "../src/core/simulation";
import { simulateAdventurer } from "../src/core/adventurers";
import { MAX_TICKS } from "../src/core/types";
import type { ObjectType } from "../src/core/types";

function corridor(
  types: ObjectType[] = ["entrance", "key", "door", "treasure"],
) {
  const d = createDungeon("corridor");
  for (let x = 1; x <= types.length; x++) {
    d.tiles[2 * d.width + x] = 1;
    d.objects.push({ id: `o-${x}`, type: types[x - 1], x, y: 2, rotation: 0 });
  }
  return d;
}
describe("deterministic simulation", () => {
  it("collides with walls, collects keys, opens doors, and completes at treasure", () => {
    const sim = new Simulation(corridor(), 42);
    sim.step({ type: "move", direction: "up" });
    expect(sim.state.player.y).toBe(2);
    sim.step({ type: "move", direction: "right" });
    expect(sim.state.player.hasKey).toBe(true);
    sim.step({ type: "move", direction: "right" });
    expect(sim.state.opened).toEqual(["o-3"]);
    sim.step({ type: "move", direction: "right" });
    expect(sim.state.status).toBe("completed");
    expect(
      reconstructReplay(JSON.parse(JSON.stringify(sim.replay()))).state,
    ).toEqual(sim.state);
  });
  it("blocks doors without a key", () => {
    const sim = new Simulation(corridor(["entrance", "door", "treasure"]));
    sim.step({ type: "move", direction: "right" });
    expect(sim.state.player.x).toBe(1);
    expect(sim.state.events.at(-1)?.reason).toBe("door");
  });
  it("uses seeded adjacent combat, blocks live enemies, and stops dead enemies attacking", () => {
    const sim = new Simulation(
      corridor(["entrance", "skeleton", "treasure"]),
      4,
    );
    sim.step({ type: "move", direction: "right" });
    expect(sim.state.player.x).toBe(1);
    expect(sim.state.player.hp).toBeLessThan(100);
    sim.step({ type: "attack" });
    expect(sim.state.enemies[0].hp).toBe(0);
    const hp = sim.state.player.hp;
    sim.step({ type: "move", direction: "right" });
    expect(sim.state.player.x).toBe(2);
    expect(sim.state.player.hp).toBe(hp);
    expect(reconstructReplay(sim.replay()).state).toEqual(sim.state);
  });
  it("fires traps on cooldown, heals once, and records the actual death cell", () => {
    const sim = new Simulation(
      corridor(["entrance", "fire", "potion", "treasure"]),
    );
    sim.step({ type: "move", direction: "right" });
    expect(sim.state.player.hp).toBe(88);
    sim.step({ type: "wait" });
    expect(sim.state.player.hp).toBe(88);
    sim.step({ type: "wait" });
    expect(sim.state.player.hp).toBe(76);
    sim.step({ type: "move", direction: "right" });
    expect(sim.state.player.hp).toBe(100);
    sim.step({ type: "move", direction: "left" });
    while (sim.state.status === "playing") sim.step({ type: "wait" });
    expect(sim.state.status).toBe("dead");
    expect(sim.state.events.at(-1)).toMatchObject({
      kind: "death",
      x: 2,
      y: 2,
      reason: "fire",
    });
  });
  it("bounds cycles and rejects future simulation versions or invalid input streams", () => {
    const sim = new Simulation(corridor());
    for (let i = 0; i < MAX_TICKS + 2; i++) sim.step({ type: "wait" });
    expect(sim.state.status).toBe("abandoned");
    expect(sim.actions.length).toBe(MAX_TICKS);
    const replay = sim.replay();
    expect(() =>
      reconstructReplay({ ...replay, simulationVersion: 99 }),
    ).toThrow("storage.replayVersion");
    expect(() =>
      reconstructReplay({
        ...replay,
        actions: [{ type: "move", direction: "diagonal" as "up" }],
      }),
    ).toThrow("storage.invalidReplay");
  });
  it("simulated adventurers obey the same rules and produce reproducible recorded runs", () => {
    for (let i = 0; i < 6; i++) {
      const replay = simulateAdventurer(createStarter(), "v1", 40 + i, i);
      const again = simulateAdventurer(createStarter(), "v1", 40 + i, i);
      expect(replay.actions).toEqual(again.actions);
      expect(reconstructReplay(replay).state.status).toBe("completed");
    }
  });
});
