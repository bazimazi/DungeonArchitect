import { describe, expect, it } from "vitest";
import {
  budgetUsed,
  createDungeon,
  createStarter,
  fingerprint,
  parseDungeon,
} from "../src/core/dungeon";
import { Editor } from "../src/core/editor";
import { validateDungeon } from "../src/core/validation";
import { identifyRooms } from "../src/core/rooms";

describe("dungeon editor", () => {
  it("transforms patrol routes with copies, moves and mirrors and rejects invalid routes atomically", () => {
    const d = createDungeon();
    d.schemaVersion = 2;
    d.tiles.fill(1);
    d.budget = 320;
    d.objects = [
      {
        id: "guard",
        type: "skeleton",
        x: 2,
        y: 2,
        rotation: 1,
        config: { patrol: [{ x: 3, y: 2 }] },
      },
    ];
    const e = new Editor(d);
    e.paste(e.copy(["guard"]), { x: 6, y: 4 });
    const copied = e.dungeon.objects.find((o) => o.id !== "guard")!;
    expect(copied.config?.patrol).toEqual([{ x: 7, y: 4 }]);
    e.move([copied.id], { x: 1, y: 1 });
    expect(e.dungeon.objects[1].config?.patrol).toEqual([{ x: 8, y: 5 }]);
    e.mirror([copied.id], "horizontal");
    expect(e.dungeon.objects[1].config?.patrol).toEqual([{ x: 6, y: 5 }]);
    const before = fingerprint(e.dungeon);
    expect(() => e.paste(e.copy(["guard"]), { x: 14, y: 12 })).toThrow(
      "editor.needsFloor",
    );
    expect(fingerprint(e.dungeon)).toBe(before);
  });
  it("identifies chambers across a narrow corridor without merging floors", () => {
    const d = createDungeon();
    d.height = 26;
    d.tiles = Array(390).fill(0);
    for (const [left, top] of [
      [1, 1],
      [7, 1],
      [1, 14],
    ])
      for (let y = top; y < top + 3; y++)
        for (let x = left; x < left + 3; x++) d.tiles[y * d.width + x] = 1;
    for (let x = 4; x < 7; x++) d.tiles[2 * d.width + x] = 1;
    const rooms = identifyRooms(d);
    expect(rooms.get("1,1")?.id).not.toBe(rooms.get("7,1")?.id);
    expect(rooms.has("5,2")).toBe(false);
    expect(rooms.get("1,14")?.floor).toBe(2);
  });
  it("copies linked mechanisms, remaps their wiring, and mirrors transactionally", () => {
    const d = createDungeon();
    d.schemaVersion = 2;
    d.budget = 320;
    d.tiles.fill(1);
    d.objects = [
      { id: "lever", type: "lever", x: 2, y: 2, rotation: 1 },
      { id: "gate", type: "gate", x: 4, y: 2, rotation: 3 },
    ];
    d.rules = [
      {
        id: "wire",
        source: "lever",
        event: "OnActivate",
        target: "gate",
        action: "open",
        delay: 0,
      },
    ];
    const e = new Editor(d),
      copy = e.copy(["lever", "gate"]);
    e.paste(copy, { x: 2, y: 4 });
    expect(e.dungeon.rules).toHaveLength(2);
    const rule = e.dungeon.rules![1];
    expect(rule.source).not.toBe("lever");
    expect(e.dungeon.objects.find((o) => o.id === rule.target)?.y).toBe(4);
    e.mirror([rule.source, rule.target], "horizontal");
    expect(e.dungeon.objects.find((o) => o.id === rule.source)).toMatchObject({
      x: 4,
      y: 4,
      rotation: 3,
    });
    e.undo();
    expect(e.dungeon.objects.find((o) => o.id === rule.source)?.x).toBe(2);
    const before = fingerprint(e.dungeon);
    expect(() => e.paste(copy, { x: 2, y: 2 })).toThrow("editor.occupied");
    expect(fingerprint(e.dungeon)).toBe(before);
  });
  it("places a room transactionally and restores it with undo/redo", () => {
    const editor = new Editor(createDungeon("test"));
    editor.place("room", { x: 3, y: 3 });
    expect(budgetUsed(editor.dungeon)).toBe(9);
    editor.undo();
    expect(budgetUsed(editor.dungeon)).toBe(0);
    editor.redo();
    expect(budgetUsed(editor.dungeon)).toBe(9);
  });
  it("enforces floor, occupancy, and budget without changing history", () => {
    const editor = new Editor(createDungeon("test"));
    expect(() => editor.place("skeleton", { x: 2, y: 2 })).toThrow(
      "editor.needsFloor",
    );
    editor.place("room", { x: 2, y: 2 });
    editor.place("skeleton", { x: 2, y: 2 });
    expect(() => editor.place("key", { x: 2, y: 2 })).toThrow(
      "editor.occupied",
    );
    editor.dungeon.budget = budgetUsed(editor.dungeon);
    const before = fingerprint(editor.dungeon);
    expect(() => editor.place("floor", { x: 8, y: 8 })).toThrow(
      "editor.budgetExceeded",
    );
    expect(fingerprint(editor.dungeon)).toBe(before);
  });
  it("moves, duplicates, rotates, and deletes objects with undo", () => {
    const editor = new Editor(createStarter());
    const skeleton = editor.dungeon.objects.find((o) => o.type === "skeleton")!;
    editor.rotate([skeleton.id]);
    expect(
      editor.dungeon.objects.find((o) => o.id === skeleton.id)!.rotation,
    ).toBe(1);
    editor.move([skeleton.id], { x: 0, y: -1 }, true);
    expect(
      editor.dungeon.objects.filter((o) => o.type === "skeleton"),
    ).toHaveLength(2);
    editor.remove([skeleton.id]);
    expect(editor.dungeon.objects.some((o) => o.id === skeleton.id)).toBe(
      false,
    );
    editor.undo();
    expect(editor.dungeon.objects.some((o) => o.id === skeleton.id)).toBe(true);
  });
  it("round trips a stable package and rejects malformed or unsupported data", () => {
    const dungeon = createStarter();
    expect(parseDungeon(JSON.parse(JSON.stringify(dungeon)))).toEqual(dungeon);
    expect(() => parseDungeon({ ...dungeon, schemaVersion: 99 })).toThrow(
      "storage.dungeonVersion",
    );
    expect(() => parseDungeon({ ...dungeon, tiles: [] })).toThrow(
      "storage.invalidDungeon",
    );
    expect(() =>
      parseDungeon({
        ...dungeon,
        objects: [...dungeon.objects, dungeon.objects[0]],
      }),
    ).toThrow("storage.invalidDungeon");
    expect(() =>
      parseDungeon({
        ...dungeon,
        objects: [{ ...dungeon.objects[0], type: "__proto__" }],
      }),
    ).toThrow();
  });
});

describe("key-aware validation", () => {
  it("rejects an optional one-way passage into a sealed room even when the treasure has a clear path", () => {
    const d = createDungeon();
    d.schemaVersion = 2;
    d.tiles.fill(0);
    for (const [x, y] of [
      [1, 1],
      [2, 1],
      [3, 1],
      [2, 2],
      [8, 8],
      [9, 8],
    ])
      d.tiles[y * d.width + x] = 1;
    d.objects = [
      { id: "start", type: "entrance", x: 1, y: 1, rotation: 0 },
      { id: "goal", type: "treasure", x: 3, y: 1, rotation: 0 },
      {
        id: "out",
        type: "teleporter",
        x: 2,
        y: 2,
        rotation: 0,
        config: { target: "arrival" },
      },
      { id: "arrival", type: "banner", x: 8, y: 8, rotation: 0 },
    ];
    expect(validateDungeon(d).issues.map((i) => i.code)).toContain("softlock");
    d.objects[2].type = "teleport-trap";
    expect(validateDungeon(d).issues.map((i) => i.code)).toContain("softlock");
    d.objects.push({
      id: "back",
      type: "stairs",
      x: 9,
      y: 8,
      rotation: 0,
      config: { target: "start" },
    });
    expect(validateDungeon(d).valid).toBe(true);
  });
  it("accepts the starter and harmless loops", () => {
    expect(validateDungeon(createStarter()).valid).toBe(true);
  });
  it("rejects missing required objects", () => {
    expect(
      validateDungeon(createDungeon("test")).issues.map((i) => i.code),
    ).toEqual(["entrance", "treasure"]);
  });
  it("rejects an unreachable treasure and a key locked behind its own door", () => {
    const dungeon = createDungeon("test");
    for (let x = 1; x < 6; x++) dungeon.tiles[2 * dungeon.width + x] = 1;
    dungeon.objects = [
      { id: "e", type: "entrance", x: 1, y: 2, rotation: 0 },
      { id: "d", type: "door", x: 2, y: 2, rotation: 0 },
      { id: "k", type: "key", x: 3, y: 2, rotation: 0 },
      { id: "t", type: "treasure", x: 5, y: 2, rotation: 0 },
    ];
    expect(validateDungeon(dungeon).issues.map((i) => i.code)).toEqual([
      "unreachable",
      "key",
    ]);
    dungeon.objects[2].x = 1;
    dungeon.objects[2].y = 3;
    dungeon.tiles[3 * dungeon.width + 1] = 1;
    expect(validateDungeon(dungeon).valid).toBe(true);
  });
  it("rejects an immediately threatened spawn", () => {
    const dungeon = createStarter();
    dungeon.objects.find((o) => o.type === "skeleton")!.x = 3;
    dungeon.objects.find((o) => o.type === "skeleton")!.y = 2;
    expect(
      validateDungeon(dungeon).issues.some((i) => i.code === "spawn"),
    ).toBe(true);
  });
  it("uses configured attack range when checking spawn safety", () => {
    const dungeon = createStarter();
    dungeon.schemaVersion = 2;
    const enemy = dungeon.objects.find((o) => o.type === "skeleton")!;
    enemy.x = 5;
    enemy.y = 2;
    enemy.config = { range: 6 };
    expect(
      validateDungeon(dungeon).issues.some((i) => i.code === "spawn"),
    ).toBe(true);
  });
});
