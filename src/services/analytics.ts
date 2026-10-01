import { reconstructReplay } from "../core/simulation";
import { pointKey, TICK_MS } from "../core/types";
import type { Point, Replay } from "../core/types";

export interface DungeonAnalytics {
  attempts: number;
  completions: number;
  deaths: number;
  completionRate: number;
  averageSeconds: number;
  deathCells: Map<string, { point: Point; count: number }>;
  traffic: Map<string, number>;
  deadliest: { objectId: string; count: number } | null;
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
  };
  const killers = new Map<string, number>();
  let ticks = 0;
  for (const replay of attempts) {
    const state = reconstructReplay(replay).state;
    ticks += state.tick;
    if (state.status === "completed") result.completions++;
    if (state.status === "dead") result.deaths++;
    for (const event of state.events) {
      if (event.kind === "move" || event.kind === "spawn")
        result.traffic.set(
          pointKey(event),
          (result.traffic.get(pointKey(event)) ?? 0) + 1,
        );
      if (event.kind === "death") {
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
  result.completionRate = attempts.length
    ? (result.completions / attempts.length) * 100
    : 0;
  result.averageSeconds = attempts.length
    ? (ticks * TICK_MS) / 1000 / attempts.length
    : 0;
  return result;
}
