import { CONTENT_V1 } from "./content-v1";
import { CONTENT } from "./content";
import { clone, DUNGEON_SCHEMA_VERSION } from "./types";
import type { Dungeon, DungeonObject, ObjectType, Point } from "./types";
import {
  BUILDS,
  THEMES,
  isAdvancedObject,
  parseConfig,
  parseRules,
} from "./configuration";

export function inBounds(dungeon: Dungeon, p: Point): boolean {
  return (
    Number.isInteger(p.x) &&
    Number.isInteger(p.y) &&
    p.x >= 0 &&
    p.y >= 0 &&
    p.x < dungeon.width &&
    p.y < dungeon.height
  );
}
export function isFloor(dungeon: Dungeon, p: Point): boolean {
  return inBounds(dungeon, p) && dungeon.tiles[p.y * dungeon.width + p.x] === 1;
}
export function objectAt(
  dungeon: Dungeon,
  p: Point,
): DungeonObject | undefined {
  return dungeon.objects.find((o) => o.x === p.x && o.y === p.y);
}
export function budgetUsed(dungeon: Dungeon): number {
  return (
    dungeon.tiles.reduce((sum, tile) => sum + tile, 0) +
    dungeon.objects.reduce((sum, o) => {
      const def =
        dungeon.schemaVersion === 1 ? CONTENT_V1[o.type] : CONTENT[o.type];
      const configurationCost =
        dungeon.schemaVersion === 2 && o.config
          ? Math.ceil(
              Math.max(0, (o.config.hp ?? def.hp ?? 0) - (def.hp ?? 0)) / 20,
            ) +
            Math.ceil(
              Math.max(
                0,
                (o.config.damage ?? def.damage ?? 0) - (def.damage ?? 0),
              ) / 5,
            ) +
            Math.max(0, (o.config.range ?? def.range ?? 0) - (def.range ?? 0))
          : 0;
      return sum + def.cost + configurationCost;
    }, 0)
  );
}
export function fingerprint(dungeon: Dungeon): string {
  return JSON.stringify({
    ...dungeon,
    objects: [...dungeon.objects].sort((a, b) =>
      a.id.localeCompare(b.id, "en"),
    ),
  });
}
export function createDungeon(
  id: string = crypto.randomUUID(),
  title = "Untitled dungeon",
): Dungeon {
  return {
    schemaVersion: 1,
    id,
    title,
    theme: "forgotten-cave",
    width: 15,
    height: 13,
    budget: 160,
    tiles: Array<number>(195).fill(0),
    objects: [],
  };
}
export function createStarter(): Dungeon {
  const dungeon = createDungeon("mossveil-crypt", "Mossveil Crypt");
  const carve = (x: number, y: number, w: number, h: number) => {
    for (let row = y; row < y + h; row++)
      for (let col = x; col < x + w; col++)
        dungeon.tiles[row * dungeon.width + col] = 1;
  };
  carve(1, 1, 5, 4);
  carve(9, 1, 5, 4);
  carve(1, 8, 5, 4);
  carve(9, 8, 5, 4);
  carve(6, 3, 3, 1);
  carve(6, 9, 3, 1);
  carve(3, 5, 1, 3);
  carve(11, 5, 1, 3);
  const add = (type: ObjectType, x: number, y: number) =>
    dungeon.objects.push({
      id: `${type}-${dungeon.objects.length + 1}`,
      type,
      x,
      y,
      rotation: 0,
    });
  add("entrance", 2, 2);
  add("key", 4, 3);
  add("skeleton", 10, 3);
  add("spikes", 11, 6);
  add("door", 8, 9);
  add("fire", 6, 9);
  add("slime", 4, 9);
  add("treasure", 12, 10);
  return dungeon;
}

/** Parse a bounded, stable data package. Drafts may be incomplete, never malformed. */
export function parseDungeon(input: unknown): Dungeon {
  if (!input || typeof input !== "object")
    throw new Error("storage.invalidDungeon");
  const d = input as Dungeon;
  if (![1, DUNGEON_SCHEMA_VERSION].includes(d.schemaVersion))
    throw new Error("storage.dungeonVersion");
  if (
    typeof d.id !== "string" ||
    !d.id.length ||
    d.id.length > 100 ||
    typeof d.title !== "string" ||
    !d.title.trim() ||
    d.title.length > 60 ||
    !THEMES.includes(d.theme) ||
    (d.schemaVersion === 1 && d.theme !== "forgotten-cave")
  )
    throw new Error("storage.invalidDungeon");
  if (
    d.width !== 15 ||
    ![13, ...(d.schemaVersion === 2 ? [26, 39, 52] : [])].includes(d.height) ||
    d.budget !== 160 * (d.height / 13) ||
    !Array.isArray(d.tiles) ||
    d.tiles.length !== d.width * d.height ||
    !d.tiles.every((t) => t === 0 || t === 1)
  )
    throw new Error("storage.invalidDungeon");
  if (!Array.isArray(d.objects) || d.objects.length > d.tiles.length)
    throw new Error("storage.invalidDungeon");
  const ids = new Set<string>();
  const positions = new Set<string>();
  for (const o of d.objects) {
    if (
      !o ||
      typeof o.id !== "string" ||
      !o.id.length ||
      o.id.length > 100 ||
      !Object.hasOwn(CONTENT, o.type) ||
      (d.schemaVersion === 1 && isAdvancedObject(o.type)) ||
      !isFloor(d, o) ||
      !Number.isInteger(o.rotation) ||
      o.rotation < 0 ||
      o.rotation > 3 ||
      ids.has(o.id) ||
      positions.has(`${o.x},${o.y}`)
    )
      throw new Error("storage.invalidDungeon");
    ids.add(o.id);
    positions.add(`${o.x},${o.y}`);
  }
  if (budgetUsed(d) > d.budget) throw new Error("editor.budgetExceeded");
  if (
    d.schemaVersion === 2 &&
    d.build !== undefined &&
    !Object.hasOwn(BUILDS, d.build)
  )
    throw new Error("storage.invalidConfiguration");
  if (
    d.objective &&
    (d.schemaVersion !== 2 ||
      !["treasure", "defeat-all", "survive", "escape"].includes(
        d.objective.kind,
      ) ||
      !Number.isInteger(d.objective.ticks) ||
      d.objective.ticks < 1 ||
      d.objective.ticks > 2400)
  )
    throw new Error("storage.invalidConfiguration");
  return clone({
    schemaVersion: d.schemaVersion,
    id: d.id,
    title: d.title,
    theme: d.theme,
    width: d.width,
    height: d.height,
    budget: d.budget,
    tiles: d.tiles,
    ...(d.schemaVersion === 2
      ? {
          rules: parseRules(d.rules ?? [], d),
          build: d.build ?? "warrior",
          ...(d.objective
            ? {
                objective: { kind: d.objective.kind, ticks: d.objective.ticks },
              }
            : {}),
        }
      : {}),
    objects: d.objects.map(({ id, type, x, y, rotation, config }) => ({
      id,
      type,
      x,
      y,
      rotation,
      ...(d.schemaVersion === 2 && config !== undefined
        ? { config: parseConfig(config, d) }
        : {}),
    })),
  });
}
