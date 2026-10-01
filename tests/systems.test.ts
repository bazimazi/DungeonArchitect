import { describe, expect, it } from "vitest";
import {
  createDungeon,
  createStarter,
  parseDungeon,
} from "../src/core/dungeon";
import { Editor } from "../src/core/editor";
import {
  Simulation,
  parseReplay,
  reconstructReplay,
} from "../src/core/simulation";
import { validateDungeon } from "../src/core/validation";
import type { Dungeon, DungeonObject, ObjectType } from "../src/core/types";
import { ADVANCED_OBJECTS } from "../src/core/advanced-types";
import { cameraFrame } from "../src/ui/camera";
import { simulateAdventurer } from "../src/core/adventurers";

it("requires the main treasure before an optional exit and reproduces the escape in replay and bot tests", () => {
  const d = arena();
  add(d, "exit", 2, 2);
  const sim = new Simulation(d, 17);
  sim.step({ type: "move", direction: "right" });
  expect(sim.state.status).toBe("playing");
  for (let i = 0; i < 8; i++) sim.step({ type: "move", direction: "right" });
  expect(sim.state.status).toBe("playing");
  for (let i = 0; i < 8; i++) sim.step({ type: "move", direction: "left" });
  expect(sim.state.status).toBe("completed");
  expect(reconstructReplay(sim.replay()).state).toEqual(sim.state);
  expect(
    reconstructReplay(simulateAdventurer(d, "draft", 17, 3)).state.status,
  ).toBe("completed");
  const exit = d.objects.find((o) => o.type === "exit")!;
  exit.x = 14;
  exit.y = 12;
  d.tiles[12 * 15 + 14] = 1;
  expect(validateDungeon(d).issues.some((i) => i.code === "unreachable")).toBe(
    true,
  );
});

it("records camera triggers deterministically and restores room framing after they expire", () => {
  const d = arena(),
    landmark = add(d, "statue", 7, 3);
  add(d, "camera-trigger", 2, 2, { target: landmark.id, range: 6, delay: 2 });
  const sim = new Simulation(d, 19);
  sim.step({ type: "move", direction: "right" });
  expect(cameraFrame(d, sim.state)).toEqual({ x: 7, y: 3, zoom: 2.5 });
  const replay = sim.replay();
  expect(reconstructReplay(replay).state).toEqual(sim.state);
  sim.step({ type: "wait" });
  sim.step({ type: "wait" });
  expect(cameraFrame(d, sim.state).zoom).toBeLessThan(2.5);
  expect(sim.state.player.hp).toBe(sim.state.player.maxHp);
});

function arena(): Dungeon {
  const d = createDungeon("systems", "Mechanism laboratory");
  d.schemaVersion = 2;
  d.rules = [];
  d.build = "warrior";
  for (let y = 1; y <= 5; y++)
    for (let x = 1; x <= 10; x++) d.tiles[y * 15 + x] = 1;
  add(d, "entrance", 1, 2);
  add(d, "treasure", 10, 2);
  return d;
}
function add(
  d: Dungeon,
  type: ObjectType,
  x: number,
  y: number,
  config?: DungeonObject["config"],
): DungeonObject {
  const o = {
    id: `${type}-${d.objects.length}`,
    type,
    x,
    y,
    rotation: 0,
    ...(config ? { config } : {}),
  };
  d.objects.push(o);
  return o;
}
function move(
  s: Simulation,
  direction: "up" | "down" | "left" | "right",
  count = 1,
): void {
  for (let i = 0; i < count; i++) s.step({ type: "move", direction });
}

describe("versioned systemic dungeon rules", () => {
  it("resupplies inhabitants and earns a faction alliance through a verified quest", () => {
    const d = arena();
    const npc = add(d, "npc", 2, 2, {
      faction: "Keepers",
      quest: "key",
      threshold: 1,
    });
    add(d, "key", 1, 3);
    add(d, "resource", 2, 3);
    const guard = add(d, "guardian", 5, 2, { faction: "Keepers", damage: 50 });
    const s = new Simulation(d);
    move(s, "down");
    move(s, "right");
    move(s, "up");
    s.step({ type: "interact" });
    expect(s.state.advanced!.alliances).toContain("Keepers");
    expect(s.state.advanced!.quests).toContain(npc.id);
    // Supply was collected by the adventurer first, so the inhabitant cannot duplicate it.
    while (s.state.tick < 8) s.step({ type: "wait" });
    expect(s.state.advanced!.supplies[npc.id]).toBe(0);
    move(s, "right", 3);
    expect(s.state.enemies.find((e) => e.id === guard.id)!.hp).toBeGreaterThan(
      0,
    );
    expect(s.state.player.x).toBe(5);
    expect(reconstructReplay(s.replay()).state).toEqual(s.state);
    const supplied = arena();
    const keeper = add(supplied, "npc", 4, 4, { threshold: 1 });
    add(supplied, "resource", 5, 4);
    const second = new Simulation(supplied);
    for (let i = 0; i < 8; i++) second.step({ type: "wait" });
    expect(second.state.advanced!.supplies[keeper.id]).toBe(3);
  });
  it("serializes and replays every advanced object through a mixed input sequence", () => {
    for (const type of ADVANCED_OBJECTS) {
      const d = arena();
      const o = add(d, type, 4, 2);
      if (["stairs", "teleporter", "teleport-trap", "elevator"].includes(type))
        o.config = { target: d.objects[0].id };
      const s = new Simulation(parseDungeon(d), 731);
      for (let turn = 0; turn < 18 && s.state.status === "playing"; turn++)
        s.step(
          turn < 4
            ? { type: "move", direction: "right" }
            : turn % 3 === 0
              ? { type: "interact" }
              : turn % 3 === 1
                ? { type: "ability" }
                : { type: "wait" },
        );
      expect(reconstructReplay(s.replay()).state, type).toEqual(s.state);
    }
  });
  it("does not pulse an AND output early and starts timers relative to activation", () => {
    const d = arena();
    const first = add(d, "lever", 2, 2),
      second = add(d, "lever", 3, 2),
      logic = add(d, "and-gate", 4, 3),
      timer = add(d, "timer", 5, 3, { delay: 3 }),
      gate = add(d, "gate", 6, 2);
    d.rules = [
      {
        id: "a",
        source: first.id,
        event: "OnActivate",
        target: logic.id,
        action: "activate",
        delay: 0,
      },
      {
        id: "b",
        source: second.id,
        event: "OnActivate",
        target: logic.id,
        action: "activate",
        delay: 0,
      },
      {
        id: "t",
        source: logic.id,
        event: "OnActivate",
        target: timer.id,
        action: "activate",
        delay: 0,
      },
      {
        id: "g",
        source: timer.id,
        event: "OnTimer",
        target: gate.id,
        action: "open",
        delay: 0,
      },
    ];
    const s = new Simulation(d);
    move(s, "right");
    s.step({ type: "interact" }); // The control underfoot takes precedence.
    expect(s.state.advanced!.active[logic.id]).toBe(false);
    expect(s.state.opened).not.toContain(gate.id);
    move(s, "right");
    s.step({ type: "interact" });
    expect(s.state.advanced!.active[logic.id]).toBe(true);
    s.step({ type: "wait" });
    s.step({ type: "wait" });
    expect(s.state.opened).not.toContain(gate.id);
    s.step({ type: "wait" });
    expect(s.state.opened).toContain(gate.id);
  });
  it("opens a gate from a pressure plate and reproduces the entire state from inputs", () => {
    const d = arena();
    const plate = add(d, "plate", 2, 2),
      gate = add(d, "gate", 3, 2);
    d.rules = [
      {
        id: "wire",
        source: plate.id,
        event: "OnEnter",
        target: gate.id,
        action: "open",
        delay: 0,
      },
    ];
    const s = new Simulation(parseDungeon(d), 97);
    move(s, "right", 9);
    expect(s.state.status).toBe("completed");
    expect(s.state.opened).toContain(gate.id);
    expect(reconstructReplay(s.replay()).state).toEqual(s.state);
  });
  it("pushes a block onto a plate while retaining solid occupancy", () => {
    const d = arena();
    const block = add(d, "block", 2, 2),
      plate = add(d, "plate", 3, 2),
      gate = add(d, "gate", 5, 2);
    d.rules = [
      {
        id: "weight",
        source: plate.id,
        event: "OnEnter",
        target: gate.id,
        action: "open",
        delay: 0,
      },
    ];
    const s = new Simulation(d);
    move(s, "right");
    expect(s.state.player.x).toBe(2);
    expect(s.state.advanced!.positions[block.id]).toEqual({ x: 3, y: 2 });
    expect(s.state.opened).toContain(gate.id);
    move(s, "right");
    expect(s.state.player.x).toBe(3);
    expect(s.state.advanced!.positions[block.id].x).toBe(4);
  });
  it("applies conditional delayed counters and rejects unbounded signal cycles", () => {
    const d = arena();
    const lever = add(d, "lever", 2, 2),
      counter = add(d, "counter", 3, 3, { threshold: 2 }),
      gate = add(d, "gate", 4, 2);
    d.rules = [
      {
        id: "count",
        source: lever.id,
        event: "OnInteract",
        target: counter.id,
        action: "increment",
        delay: 2,
      },
      {
        id: "open",
        source: counter.id,
        event: "OnTrigger",
        target: gate.id,
        action: "open",
        delay: 0,
        condition: { variable: "counter", operator: "gte", value: 2 },
      },
    ];
    const s = new Simulation(d);
    move(s, "right");
    s.step({ type: "interact" });
    s.step({ type: "interact" });
    s.step({ type: "wait" });
    s.step({ type: "wait" });
    expect(s.state.opened).toContain(gate.id);
    d.rules = [
      {
        id: "on",
        source: lever.id,
        event: "OnActivate",
        target: lever.id,
        action: "toggle",
        delay: 0,
      },
      {
        id: "off",
        source: lever.id,
        event: "OnDeactivate",
        target: lever.id,
        action: "toggle",
        delay: 0,
      },
    ];
    const loop = new Simulation(d);
    move(loop, "right");
    loop.step({ type: "interact" });
    expect(loop.state.status).toBe("abandoned");
    expect(loop.state.advanced!.signalOverflow).toBe(true);
  });
  it("conducts electricity through connected water and spreads fire through oil deterministically", () => {
    const d = arena();
    add(d, "electric-coil", 5, 4);
    add(d, "water", 4, 4);
    add(d, "water", 3, 4);
    add(d, "fire", 2, 2);
    add(d, "oil", 2, 3);
    add(d, "oil", 3, 3);
    const s = new Simulation(d);
    move(s, "right");
    s.step({ type: "wait" });
    s.step({ type: "wait" });
    expect(s.state.advanced!.environment["3,4"]).toBe("electricity");
    expect(s.state.advanced!.environment["3,3"]).toBe("fire");
    expect(reconstructReplay(s.replay()).state).toEqual(s.state);
  });
  it("traverses linked floors and validates the destination path", () => {
    const d = arena();
    d.height = 26;
    d.budget = 320;
    d.tiles.push(...Array<number>(195).fill(0));
    for (let x = 1; x <= 5; x++) d.tiles[14 * 15 + x] = 1;
    const goal = d.objects.find((o) => o.type === "treasure")!;
    goal.x = 5;
    goal.y = 14;
    const first = add(d, "stairs", 3, 2),
      second = add(d, "stairs", 1, 14);
    first.config = { target: second.id };
    second.config = { target: first.id };
    expect(validateDungeon(parseDungeon(d)).valid).toBe(true);
    const s = new Simulation(d);
    move(s, "right", 2);
    expect(s.state.player.y).toBe(14);
    move(s, "right", 4);
    expect(s.state.status).toBe("completed");
    expect(reconstructReplay(s.replay()).state).toEqual(s.state);
  });
  it("supports boss phases, arena triggers, and optional equipment without permanent power creep", () => {
    const d = arena();
    add(d, "equipment", 2, 2);
    const boss = add(d, "boss", 4, 2, {
        hp: 60,
        phases: [
          { threshold: 50, attack: "cross", damage: 1, armor: 0, cooldown: 1 },
          { threshold: 100, attack: "melee", damage: 1, armor: 0, cooldown: 1 },
        ],
      }),
      gate = add(d, "gate", 7, 2);
    d.rules = [
      {
        id: "defeat",
        source: boss.id,
        event: "OnDeath",
        target: gate.id,
        action: "open",
        delay: 0,
      },
    ];
    const s = new Simulation(d, 44);
    move(s, "right", 8);
    expect(
      s.state.events.some((e) => e.kind === "phase" && e.amount === 50),
    ).toBe(true);
    expect(s.state.opened).toContain(gate.id);
    expect(s.state.advanced!.loot.equipment).toBe(1);
    expect(new Simulation(d).state.advanced!.loot.equipment).toBe(0);
  });
  it("uses normalized builds and cooldowns and retains old replay behavior", () => {
    const d = arena();
    d.build = "mage";
    add(d, "water", 2, 2);
    const s = new Simulation(d);
    expect(s.state.player.maxHp).toBe(80);
    s.step({ type: "ability" });
    expect(s.state.advanced!.environment["2,2"]).toBe("ice");
    const ready = s.state.advanced!.abilityReady;
    s.step({ type: "ability" });
    expect(s.state.advanced!.abilityReady).toBe(ready);
    const old = new Simulation(createStarter(), 2026);
    move(old, "down");
    move(old, "right", 11);
    move(old, "down", 7);
    move(old, "right");
    expect(old.replay().simulationVersion).toBe(1);
    expect(old.state.status).toBe("completed");
    expect(old.state.player.maxHp).toBe(100);
    expect(old.state.advanced).toBeUndefined();
    expect(reconstructReplay(old.replay()).state).toEqual(old.state);
    expect(() =>
      parseReplay({ ...old.replay(), actions: [{ type: "ability" }] }),
    ).toThrow();
  });
  it("persists configuration, bounds imported rules, and undoes floor and graph edits atomically", () => {
    const d = arena();
    const plate = add(d, "plate", 2, 2),
      gate = add(d, "gate", 3, 2);
    const editor = new Editor(d);
    editor.configure(gate.id, { enabled: false });
    editor.rules([
      {
        id: "wire",
        source: plate.id,
        event: "OnEnter",
        target: gate.id,
        action: "open",
        delay: 1,
      },
    ]);
    editor.addFloor();
    expect(parseDungeon(editor.dungeon).height).toBe(26);
    editor.undo();
    expect(editor.dungeon.height).toBe(13);
    editor.remove([plate.id]);
    expect(editor.dungeon.rules).toHaveLength(0);
    editor.undo();
    expect(editor.dungeon.rules).toHaveLength(1);
    expect(() =>
      parseDungeon({
        ...d,
        objects: d.objects.map((o) => ({ ...o, config: { damage: 999 } })),
      }),
    ).toThrow();
    expect(() =>
      parseDungeon({
        ...d,
        rules: [
          {
            id: "bad",
            source: "missing",
            target: gate.id,
            event: "OnEnter",
            action: "open",
            delay: 0,
          },
        ],
      }),
    ).toThrow();
  });
});
