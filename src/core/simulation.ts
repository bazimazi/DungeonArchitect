import { parseDungeon } from "./dungeon";
import { clone, DIRECTIONS, MAX_TICKS, SIMULATION_VERSION } from "./types";
import type { Action, Dungeon, Replay, RunState } from "./types";
import { Simulation as LegacySimulation } from "./simulation-v1";
import { Systems } from "./systems";
import { CONTENT } from "./content";
export { nextRandom, lineOfSight } from "./simulation-v1";

export class Simulation extends LegacySimulation {
  private readonly systems?: Systems;
  readonly version: number;
  constructor(
    dungeon: Dungeon,
    seed = 1,
    version = dungeon.schemaVersion === 1 ? 1 : 2,
  ) {
    super(dungeon, seed, dungeon.schemaVersion === 1 ? undefined : CONTENT);
    if (version !== (dungeon.schemaVersion === 1 ? 1 : 2))
      throw new Error("storage.replayVersion");
    this.version = version;
    if (version === 2)
      this.systems = new Systems(this.dungeon, this.state, this.actions);
  }
  override step(action: Action): RunState {
    return this.systems ? this.systems.step(action) : super.step(action);
  }
  override replay(
    adventurer = "Architect",
    dungeonVersionId = "draft",
  ): Replay {
    return {
      ...super.replay(adventurer, dungeonVersionId),
      simulationVersion: this.version,
    };
  }
}

export function parseReplay(input: unknown): Replay {
  if (!input || typeof input !== "object")
    throw new Error("storage.invalidReplay");
  const r = input as Replay;
  if (
    r.schemaVersion !== 1 ||
    ![1, SIMULATION_VERSION].includes(r.simulationVersion)
  )
    throw new Error("storage.replayVersion");
  if ((r.dungeon?.schemaVersion === 1 ? 1 : 2) !== r.simulationVersion)
    throw new Error("storage.replayVersion");
  for (const value of [r.id, r.dungeonVersionId, r.adventurer, r.createdAt])
    if (typeof value !== "string" || !value.length || value.length > 100)
      throw new Error("storage.invalidReplay");
  if (
    !Number.isInteger(r.seed) ||
    r.seed < 0 ||
    r.seed > 0xffffffff ||
    !Array.isArray(r.actions) ||
    r.actions.length > MAX_TICKS
  )
    throw new Error("storage.invalidReplay");
  for (const action of r.actions) {
    if (
      !action ||
      (action.type !== "wait" &&
        action.type !== "attack" &&
        !(
          r.simulationVersion === 2 &&
          ["interact", "ability"].includes(action.type)
        ) &&
        action.type !== "move") ||
      (action.type === "move" && !Object.hasOwn(DIRECTIONS, action.direction))
    )
      throw new Error("storage.invalidReplay");
  }
  return clone({
    ...r,
    dungeon: parseDungeon(r.dungeon),
    actions: r.actions.map((a) =>
      a.type === "move"
        ? { type: "move", direction: a.direction }
        : { type: a.type },
    ),
  });
}
export function reconstructReplay(
  replay: Replay,
  until = replay.actions.length,
): Simulation {
  const r = parseReplay(replay);
  const simulation = new Simulation(r.dungeon, r.seed, r.simulationVersion);
  for (const action of r.actions.slice(0, Math.max(0, until))) {
    if (simulation.state.status !== "playing")
      throw new Error("storage.invalidReplay");
    simulation.step(action);
  }
  return simulation;
}
