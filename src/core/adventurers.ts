import { CONTENT } from "./content";
import { isFloor, objectAt } from "./dungeon";
import { nextRandom, Simulation } from "./simulation";
import { DIRECTIONS, MAX_TICKS } from "./types";
import type { Direction, Dungeon, Point, Replay } from "./types";

interface PathNode extends Point {
  key: boolean;
  cost: number;
  parent: number;
}
function route(
  dungeon: Dungeon,
  start: Point,
  hasKey: boolean,
  caution: number,
  defeated: string[],
): Point[] {
  const goal = dungeon.objects.find((o) => o.type === "treasure");
  if (!goal) return [];
  const nodes: PathNode[] = [{ ...start, key: hasKey, cost: 0, parent: -1 }];
  const pending = [0];
  const costs = new Map<string, number>([
    [`${start.x},${start.y}:${hasKey}`, 0],
  ]);
  while (pending.length) {
    pending.sort((a, b) => nodes[a].cost - nodes[b].cost || a - b);
    const index = pending.shift()!;
    const current = nodes[index];
    if (current.x === goal.x && current.y === goal.y) {
      const result: Point[] = [];
      let cursor = index;
      while (cursor >= 0) {
        result.unshift({ x: nodes[cursor].x, y: nodes[cursor].y });
        cursor = nodes[cursor].parent;
      }
      return result;
    }
    for (const delta of Object.values(DIRECTIONS)) {
      const next = {
        x: current.x + delta.x,
        y: current.y + delta.y,
        key: current.key,
        cost: current.cost + 1,
        parent: index,
      };
      if (!isFloor(dungeon, next)) continue;
      const object = objectAt(dungeon, next);
      if (object?.type === "door" && !current.key) continue;
      if (object?.type === "key") next.key = true;
      if (object && !defeated.includes(object.id)) {
        const definition = CONTENT[object.type];
        if (definition.behavior === "trap")
          next.cost += (caution * definition.damage!) / 4;
        if (definition.behavior === "enemy")
          next.cost += (caution * definition.hp!) / 12;
      }
      const key = `${next.x},${next.y}:${next.key}`;
      if (next.cost < (costs.get(key) ?? Infinity)) {
        costs.set(key, next.cost);
        nodes.push(next);
        pending.push(nodes.length - 1);
      }
    }
  }
  return [];
}

export function simulateAdventurer(
  dungeon: Dungeon,
  versionId: string,
  seed: number,
  index: number,
): Replay {
  const simulation = new Simulation(dungeon, seed);
  const cautions = [0, 0.8, 2, 5, 0.2, 3];
  const caution = cautions[index % cautions.length];
  const names = [
    "Bram · the bold",
    "Lyra · pathfinder",
    "Orin · the patient",
    "Mira · scout",
    "Pip · apprentice",
    "Sable · veteran",
  ];
  let policyState = (seed ^ 0xabc123) >>> 0;
  for (let i = 0; i < MAX_TICKS && simulation.state.status === "playing"; i++) {
    const state = simulation.state;
    const path = route(
      dungeon,
      state.player,
      state.player.hasKey,
      caution,
      state.enemies.filter((e) => e.hp === 0).map((e) => e.id),
    );
    if (path.length < 2) break;
    policyState = nextRandom(policyState);
    const target = path[1];
    const object = objectAt(dungeon, target);
    const aliveEnemy =
      object && state.enemies.some((e) => e.id === object.id && e.hp > 0);
    // The apprentice hesitates in combat; every policy still uses normalized player stats.
    if (index % 6 === 4 && aliveEnemy && policyState % 3 !== 0)
      simulation.step({ type: "wait" });
    else {
      const direction = (
        Object.entries(DIRECTIONS) as [Direction, Point][]
      ).find(
        ([, d]) =>
          d.x === target.x - state.player.x &&
          d.y === target.y - state.player.y,
      )![0];
      simulation.step({ type: "move", direction });
    }
  }
  return simulation.replay(names[index % names.length], versionId);
}
