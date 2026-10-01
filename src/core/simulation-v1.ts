import { CONTENT_V1 as CONTENT } from "./content-v1";
import { isFloor, objectAt } from "./dungeon";
import { clone, DIRECTIONS, MAX_TICKS } from "./types";
import type {
  Action,
  Dungeon,
  DungeonObject,
  GameEvent,
  Point,
  Replay,
  RunState,
} from "./types";

export function nextRandom(state: number): number {
  let value = state || 1;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return value >>> 0;
}
export function lineOfSight(
  dungeon: Dungeon,
  from: Point,
  to: Point,
  opened: string[],
): boolean {
  if (from.x !== to.x && from.y !== to.y) return false;
  const length = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  for (let n = 1; n < length; n++) {
    const point = { x: from.x + dx * n, y: from.y + dy * n };
    const object = objectAt(dungeon, point);
    if (
      !isFloor(dungeon, point) ||
      (object?.type === "door" && !opened.includes(object.id))
    )
      return false;
  }
  return true;
}

export class Simulation {
  readonly dungeon: Dungeon;
  readonly seed: number;
  readonly actions: Action[] = [];
  readonly state: RunState;
  constructor(dungeon: Dungeon, seed = 1, definitions = CONTENT) {
    this.dungeon = clone(dungeon);
    this.seed = seed >>> 0;
    const spawn = dungeon.objects.find((o) => o.type === "entrance");
    if (!spawn || !isFloor(dungeon, spawn))
      throw new Error("validation.entrance");
    this.state = {
      tick: 0,
      randomState: this.seed || 1,
      player: {
        x: spawn.x,
        y: spawn.y,
        hp: 100,
        maxHp: 100,
        hasKey: false,
        facing: "down",
      },
      enemies: dungeon.objects
        .filter((o) => definitions[o.type].behavior === "enemy")
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map((o) => ({ id: o.id, hp: definitions[o.type].hp!, nextAttack: 1 })),
      collected: [],
      opened: [],
      trapCooldowns: {},
      status: "playing",
      damageTaken: 0,
      events: [{ tick: 0, kind: "spawn", x: spawn.x, y: spawn.y }],
    };
  }
  private event(
    kind: GameEvent["kind"],
    point: Point,
    extra: Partial<GameEvent> = {},
  ): void {
    this.state.events.push({
      tick: this.state.tick,
      kind,
      x: point.x,
      y: point.y,
      ...extra,
    });
  }
  private damage(amount: number, object: DungeonObject): void {
    const actual = Math.min(this.state.player.hp, amount);
    this.state.player.hp -= actual;
    this.state.damageTaken += actual;
    this.event("damage", this.state.player, {
      amount: actual,
      objectId: object.id,
      reason: object.type,
    });
    if (this.state.player.hp <= 0) {
      this.state.status = "dead";
      this.event("death", this.state.player, {
        objectId: object.id,
        reason: object.type,
      });
    }
  }
  private attack(object: DungeonObject): void {
    const enemy = this.state.enemies.find((e) => e.id === object.id);
    if (!enemy || enemy.hp <= 0) return;
    this.state.randomState = nextRandom(this.state.randomState);
    const amount = 18 + (this.state.randomState % 5);
    enemy.hp = Math.max(0, enemy.hp - amount);
    this.event("attack", object, { amount, objectId: object.id });
    if (enemy.hp === 0)
      this.event("kill", object, { objectId: object.id, reason: object.type });
  }
  step(action: Action): RunState {
    if (this.state.status !== "playing") return this.state;
    this.actions.push(clone(action));
    this.state.tick++;
    const player = this.state.player;
    if (action.type === "move") {
      player.facing = action.direction;
      const delta = DIRECTIONS[action.direction];
      const target = { x: player.x + delta.x, y: player.y + delta.y };
      const object = objectAt(this.dungeon, target);
      const enemy =
        object &&
        this.state.enemies.find((e) => e.id === object.id && e.hp > 0);
      if (!isFloor(this.dungeon, target))
        this.event("blocked", target, { reason: "wall" });
      else if (enemy && object) this.attack(object);
      else if (
        object?.type === "door" &&
        !player.hasKey &&
        !this.state.opened.includes(object.id)
      )
        this.event("blocked", target, { reason: "door", objectId: object.id });
      else {
        player.x = target.x;
        player.y = target.y;
        this.event("move", player);
        if (object?.type === "door" && !this.state.opened.includes(object.id)) {
          this.state.opened.push(object.id);
          this.event("door", player, { objectId: object.id });
        }
        if (
          object?.type === "key" &&
          !this.state.collected.includes(object.id)
        ) {
          player.hasKey = true;
          this.state.collected.push(object.id);
          this.event("key", player, { objectId: object.id });
        }
        if (
          object?.type === "potion" &&
          !this.state.collected.includes(object.id)
        ) {
          const amount = Math.min(
            player.maxHp - player.hp,
            CONTENT.potion.damage!,
          );
          player.hp += amount;
          this.state.collected.push(object.id);
          this.event("heal", player, { amount, objectId: object.id });
        }
        if (object?.type === "treasure") {
          this.state.status = "completed";
          this.event("complete", player, { objectId: object.id });
        }
      }
    } else if (action.type === "attack") {
      const facing = DIRECTIONS[player.facing];
      const candidates = this.dungeon.objects.filter(
        (o) =>
          this.state.enemies.some((e) => e.id === o.id && e.hp > 0) &&
          Math.abs(o.x - player.x) + Math.abs(o.y - player.y) === 1,
      );
      const target =
        candidates.find(
          (o) => o.x === player.x + facing.x && o.y === player.y + facing.y,
        ) ?? candidates[0];
      if (target) this.attack(target);
      else this.event("attack", player, { amount: 0 });
    }
    if (this.state.status === "playing") {
      const trap = objectAt(this.dungeon, player);
      if (
        trap &&
        CONTENT[trap.type].behavior === "trap" &&
        this.state.tick >= (this.state.trapCooldowns[trap.id] ?? 0)
      ) {
        this.state.trapCooldowns[trap.id] =
          this.state.tick + CONTENT[trap.type].cooldown!;
        this.event("trap", player, { objectId: trap.id, reason: trap.type });
        this.damage(CONTENT[trap.type].damage!, trap);
      }
      for (const enemy of this.state.enemies) {
        if (this.state.status !== "playing") break;
        if (enemy.hp <= 0 || enemy.nextAttack > this.state.tick) continue;
        const object = this.dungeon.objects.find((o) => o.id === enemy.id)!;
        const definition = CONTENT[object.type];
        const distance =
          Math.abs(object.x - player.x) + Math.abs(object.y - player.y);
        if (
          distance <= definition.range! &&
          lineOfSight(this.dungeon, object, player, this.state.opened)
        ) {
          enemy.nextAttack = this.state.tick + definition.cooldown!;
          this.damage(definition.damage!, object);
        }
      }
    }
    if (this.state.status === "playing" && this.state.tick >= MAX_TICKS) {
      this.state.status = "abandoned";
      this.event("timeout", player);
    }
    return this.state;
  }
  replay(adventurer = "Architect", dungeonVersionId = "draft"): Replay {
    return {
      schemaVersion: 1,
      simulationVersion: 1,
      id: crypto.randomUUID(),
      dungeonVersionId,
      adventurer,
      seed: this.seed,
      dungeon: clone(this.dungeon),
      actions: clone(this.actions),
      createdAt: new Date().toISOString(),
    };
  }
}
