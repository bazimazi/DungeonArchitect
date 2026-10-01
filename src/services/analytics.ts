import { reconstructReplay } from "../core/simulation";
import { pointKey, TICK_MS } from "../core/types";
import type { Point, Replay } from "../core/types";
import { CONTENT } from "../core/content";
import { identifyRooms } from "../core/rooms";

export interface DungeonAnalytics {
  attempts: number;
  completions: number;
  deaths: number;
  completionRate: number;
  averageSeconds: number;
  deathCells: Map<string, { point: Point; count: number }>;
  traffic: Map<string, number>;
  deadliest: { objectId: string; count: number } | null;
  averageDamage: number;
  averageDeaths: number;
  firstDeath: Point | null;
  dangerousArea: { floor: number; x: number; y: number; deaths: number } | null;
  dangerousRoom: { id: number; floor: number; deaths: number } | null;
  commonRoute: { points: Point[]; count: number } | null;
}
export type AnalyticsSnapshot = Omit<
  DungeonAnalytics,
  "deathCells" | "traffic"
> & {
  deathCells: [string, { point: Point; count: number }][];
  traffic: [string, number][];
};
export function readAnalytics(snapshot: AnalyticsSnapshot): DungeonAnalytics {
  return {
    ...snapshot,
    deathCells: new Map(snapshot.deathCells),
    traffic: new Map(snapshot.traffic),
  };
}
export function analyze(attempts: Replay[]): DungeonAnalytics {
  const result: DungeonAnalytics = {
    attempts: attempts.length,
    completions: 0,
    deaths: 0,
    completionRate: 0,
    averageSeconds: 0,
    deathCells: new Map(),
    traffic: new Map(),
    deadliest: null,
    averageDamage: 0,
    averageDeaths: 0,
    firstDeath: null,
    dangerousArea: null,
    dangerousRoom: null,
    commonRoute: null,
  };
  const killers = new Map<string, number>();
  const areas = new Map<
    string,
    { floor: number; x: number; y: number; deaths: number }
  >();
  const routes = new Map<string, { points: Point[]; count: number }>();
  const roomDeaths = new Map<
    string,
    { id: number; floor: number; deaths: number }
  >();
  let firstDate = Infinity;
  let ticks = 0;
  for (const replay of attempts) {
    const rooms = identifyRooms(replay.dungeon);
    const state = reconstructReplay(replay).state;
    ticks += state.tick;
    result.averageDamage += state.damageTaken;
    if (state.status === "completed") {
      const points = state.events
        .filter((e) => e.kind === "move" || e.kind === "teleport")
        .map((e) => ({ x: e.x, y: e.y }));
      const key = points.map(pointKey).join(";");
      const route = routes.get(key) ?? { points, count: 0 };
      route.count++;
      routes.set(key, route);
    }
    if (state.status === "completed") result.completions++;
    if (state.status === "dead") result.deaths++;
    for (const event of state.events) {
      if (event.kind === "move" || event.kind === "spawn")
        result.traffic.set(
          pointKey(event),
          (result.traffic.get(pointKey(event)) ?? 0) + 1,
        );
      if (event.kind === "death") {
        const room = rooms.get(pointKey(event));
        if (room) {
          const roomKey = `${replay.dungeonVersionId}/${room.id}`,
            count = roomDeaths.get(roomKey) ?? { ...room, deaths: 0 };
          count.deaths++;
          roomDeaths.set(roomKey, count);
        }
        if (Date.parse(replay.createdAt) < firstDate) {
          firstDate = Date.parse(replay.createdAt);
          result.firstDeath = { x: event.x, y: event.y };
        }
        const floor = Math.floor(event.y / 13),
          x = Math.floor(event.x / 5),
          y = Math.floor((event.y % 13) / 5),
          areaKey = `${floor}/${x}/${y}`;
        const area = areas.get(areaKey) ?? {
          floor: floor + 1,
          x: x + 1,
          y: y + 1,
          deaths: 0,
        };
        area.deaths++;
        areas.set(areaKey, area);
        const key = pointKey(event);
        const cell = result.deathCells.get(key) ?? {
          point: { x: event.x, y: event.y },
          count: 0,
        };
        cell.count++;
        result.deathCells.set(key, cell);
        if (event.objectId)
          killers.set(event.objectId, (killers.get(event.objectId) ?? 0) + 1);
      }
    }
  }
  for (const [objectId, count] of killers)
    if (!result.deadliest || count > result.deadliest.count)
      result.deadliest = { objectId, count };
  for (const area of areas.values())
    if (!result.dangerousArea || area.deaths > result.dangerousArea.deaths)
      result.dangerousArea = area;
  for (const route of routes.values())
    if (!result.commonRoute || route.count > result.commonRoute.count)
      result.commonRoute = route;
  for (const room of roomDeaths.values())
    if (!result.dangerousRoom || room.deaths > result.dangerousRoom.deaths)
      result.dangerousRoom = room;
  result.averageDamage = attempts.length
    ? result.averageDamage / attempts.length
    : 0;
  result.averageDeaths = attempts.length ? result.deaths / attempts.length : 0;
  result.completionRate = attempts.length
    ? (result.completions / attempts.length) * 100
    : 0;
  result.averageSeconds = attempts.length
    ? (ticks * TICK_MS) / 1000 / attempts.length
    : 0;
  return result;
}
export function improvementIdeas(replay: Replay): string[] {
  const state = reconstructReplay(replay).state,
    ideas: string[] = [];
  const traps = replay.dungeon.objects.filter(
    (o) => CONTENT[o.type].behavior === "trap",
  );
  if (state.status === "dead")
    ideas.push(
      "Add cover, a recovery item, or a second route before the fatal encounter.",
    );
  if (state.damageTaken === 0 && traps.length)
    ideas.push(
      "Your hazards were avoidable. Keep that safe route and place optional treasure near the risky one.",
    );
  if (state.tick < 30)
    ideas.push(
      "Try a side chamber with an optional reward to give adventurers a decision.",
    );
  if (state.events.filter((e) => e.kind === "blocked").length > state.tick / 4)
    ideas.push(
      "Check confusing dead ends and clearly signal the mechanism that opens each gate.",
    );
  if (!replay.dungeon.rules?.length && replay.dungeon.schemaVersion === 2)
    ideas.push(
      "Connect a pressure plate to a gate, then add a second way to open it.",
    );
  return ideas.length
    ? ideas
    : [
        "Preserve the route that worked. Change one encounter and compare the next version’s replays.",
      ];
}
