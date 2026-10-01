import { CONTENT } from "./content";
import { isFloor } from "./dungeon";
import { Simulation } from "./simulation";
import { DIRECTIONS, pointKey } from "./types";
import type { Direction, Dungeon, DungeonObject, Point, Replay } from "./types";

/** Deliberately bounded playtest policies, not a puzzle-solvability oracle. */
export function simulateSystemicAdventurer(
  dungeon: Dungeon,
  versionId: string,
  seed: number,
  index: number,
): Replay {
  const sim = new Simulation(dungeon, seed);
  const names = [
    "Bram · the bold",
    "Lyra · pathfinder",
    "Orin · the patient",
    "Mira · scout",
    "Pip · apprentice",
    "Sable · veteran",
  ];
  const caution = [0, 0.8, 2, 5, 0.2, 3][index % 6];
  const used = new Set<string>();
  const solid = new Set([
    "gate",
    "block",
    "barrel",
    "pillar",
    "breakable-wall",
    "hidden-passage",
  ]);
  let idle = 0;
  for (let turn = 0; turn < 600 && sim.state.status === "playing"; turn++) {
    const s = sim.state,
      a = s.advanced!,
      p = s.player;
    const objects = dungeon.objects
      .filter((o) => !a.destroyed.includes(o.id))
      .map((o) => ({ ...o, ...a.positions[o.id] }));
    const living = (o: DungeonObject) =>
      !(o.config?.faction && a.alliances.includes(o.config.faction)) &&
      s.enemies.some((e) => e.id === o.id && e.hp > 0);
    const at = (q: Point) =>
      objects.find(
        (o) => o.x === q.x && o.y === q.y && (solid.has(o.type) || living(o)),
      ) ?? objects.find((o) => o.x === q.x && o.y === q.y);
    // Search current world state on every turn: monsters, gates and portals can move.
    const nodes: { p: Point; cost: number; first?: Direction }[] = [
      { p: { x: p.x, y: p.y }, cost: 0 },
    ];
    const reached = new Map<string, (typeof nodes)[number]>();
    while (nodes.length) {
      nodes.sort((x, y) => x.cost - y.cost);
      const n = nodes.shift()!,
        key = pointKey(n.p);
      if (reached.has(key)) continue;
      reached.set(key, n);
      for (const [direction, delta] of Object.entries(DIRECTIONS) as [
        Direction,
        Point,
      ][]) {
        let q = { x: n.p.x + delta.x, y: n.p.y + delta.y };
        if (
          !isFloor(dungeon, q) ||
          Math.floor(q.y / 13) !== Math.floor(n.p.y / 13)
        )
          continue;
        const o = at(q);
        if (
          o &&
          ((solid.has(o.type) && !s.opened.includes(o.id)) ||
            (o.type === "door" && !p.hasKey && !s.opened.includes(o.id)))
        )
          continue;
        if (
          dungeon.objects.some(
            (v) =>
              v.type === "bridge" &&
              a.destroyed.includes(v.id) &&
              v.x === q.x &&
              v.y === q.y,
          )
        )
          continue;
        let cost = n.cost + 1;
        if (o) {
          const def = CONTENT[o.type];
          if (def.behavior === "trap")
            cost += (caution * (o.config?.damage ?? def.damage ?? 0)) / 4;
          if (living(o))
            cost += (caution * s.enemies.find((e) => e.id === o.id)!.hp) / 12;
          if (
            ["stairs", "teleporter", "elevator"].includes(o.type) &&
            a.active[o.id] &&
            o.config?.target
          ) {
            const target = objects.find((v) => v.id === o.config!.target);
            if (target) q = { x: target.x, y: target.y };
          }
        }
        if (!reached.has(pointKey(q)))
          nodes.push({ p: q, cost, first: n.first ?? direction });
      }
    }
    const reachable = (list: DungeonObject[]) =>
      list
        .map((o) => ({ o, n: reached.get(pointKey(o)) }))
        .filter((v) => v.n)
        .sort((x, y) => x.n!.cost - y.n!.cost)[0];
    const goal = objects.find((o) => o.type === "treasure");
    const ready =
      dungeon.objective?.kind !== "survive" ||
      s.tick >= dungeon.objective.ticks;
    let target =
      dungeon.objective?.kind === "defeat-all" && objects.some(living)
        ? reachable(objects.filter(living))
        : ready && goal
          ? reachable([goal])
          : undefined;
    if (!target)
      target = reachable(
        objects.filter(
          (o) =>
            (o.type === "key" && !s.collected.includes(o.id)) ||
            (["lever", "button", "timer", "color-switch", "plate"].includes(
              o.type,
            ) &&
              !used.has(o.id)),
        ),
      );
    if (p.hp < p.maxHp / 2 && s.tick >= a.abilityReady && a.build !== "rogue") {
      sim.step({ type: "ability" });
      continue;
    }
    if (target?.n?.first) {
      idle = 0;
      sim.step({ type: "move", direction: target.n.first });
    } else if (
      target &&
      ["lever", "button", "timer", "color-switch"].includes(target.o.type)
    ) {
      used.add(target.o.id);
      sim.step({ type: "interact" });
      idle = 0;
    } else if (target?.o.type === "treasure") {
      // A survival objective is checked on entry, so leave and re-enter if necessary.
      const next = [...reached.values()].find((n) => n.first);
      if (next?.first) sim.step({ type: "move", direction: next.first });
      else break;
    } else {
      if (target) used.add(target.o.id);
      sim.step({ type: "wait" });
      if (++idle > 40 && dungeon.objective?.kind !== "survive") break;
    }
  }
  return sim.replay(names[index % names.length], versionId);
}
