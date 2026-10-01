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

describe("dungeon editor", () => {
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
});
