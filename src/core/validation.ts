import { CONTENT } from "./content";
import { budgetUsed, isFloor, objectAt } from "./dungeon";
import { DIRECTIONS, pointKey } from "./types";
import type {
  Dungeon,
  Point,
  ValidationIssue,
  ValidationResult,
} from "./types";

export function validateDungeon(dungeon: Dungeon): ValidationResult {
  const issues: ValidationIssue[] = [];
  const add = (code: string, point?: Point) =>
    issues.push({ code, messageKey: `validation.${code}`, point });
  const spawns = dungeon.objects.filter((o) => o.type === "entrance");
  const goals = dungeon.objects.filter((o) => o.type === "treasure");
  if (spawns.length !== 1) add("entrance");
  if (goals.length !== 1) add("treasure");
  if (budgetUsed(dungeon) > dungeon.budget) add("budget");
  for (const o of dungeon.objects) if (!isFloor(dungeon, o)) add("floor", o);
  const reachable = new Set<string>();
  if (!spawns.length) return { valid: false, issues, reachable, path: [] };
  const start = { x: spawns[0].x, y: spawns[0].y, key: false, parent: -1 };
  const queue = [start];
  const seen = new Set([`${pointKey(start)}:false`]);
  let goalIndex = -1;
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    reachable.add(pointKey(current));
    if (
      goals.some((g) => g.x === current.x && g.y === current.y) &&
      goalIndex < 0
    )
      goalIndex = i;
    for (const delta of Object.values(DIRECTIONS)) {
      const next = {
        x: current.x + delta.x,
        y: current.y + delta.y,
        key: current.key,
        parent: i,
      };
      if (!isFloor(dungeon, next)) continue;
      const o = objectAt(dungeon, next);
      if (o?.type === "door" && !current.key) continue;
      if (o?.type === "key") next.key = true;
      const key = `${pointKey(next)}:${next.key}`;
      if (!seen.has(key)) {
        seen.add(key);
        queue.push(next);
      }
    }
  }
  if (goals.length && goalIndex < 0) add("unreachable", goals[0]);
  for (const o of dungeon.objects)
    if (
      o.type === "door" &&
      !queue.some((p) => p.key && p.x === o.x && p.y === o.y)
    )
      add("key", o);
  // The enemies are stationary in v1. A safe spawn has no immediate line of attack.
  const spawn = spawns[0];
  for (const o of dungeon.objects) {
    const def = CONTENT[o.type];
    if (def.behavior !== "enemy") continue;
    const distance = Math.abs(o.x - spawn.x) + Math.abs(o.y - spawn.y);
    if (distance <= (def.range ?? 1) && (o.x === spawn.x || o.y === spawn.y)) {
      let clear = true;
      const dx = Math.sign(spawn.x - o.x);
      const dy = Math.sign(spawn.y - o.y);
      for (let n = 1; n < distance; n++) {
        const p = { x: o.x + dx * n, y: o.y + dy * n };
        if (!isFloor(dungeon, p) || objectAt(dungeon, p)?.type === "door")
          clear = false;
      }
      if (clear) add("spawn", spawn);
    }
  }
  const path: Point[] = [];
  while (goalIndex >= 0) {
    const p = queue[goalIndex];
    path.unshift({ x: p.x, y: p.y });
    goalIndex = p.parent;
  }
  return { valid: issues.length === 0, issues, reachable, path };
}
