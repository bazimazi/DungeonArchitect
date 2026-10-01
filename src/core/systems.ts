import { CONTENT } from "./content";
import { BUILDS } from "./advanced-types";
import { isFloor } from "./dungeon";
import { clone, DIRECTIONS, MAX_TICKS, pointKey } from "./types";
import { nextRandom } from "./simulation-v1";
import type {
  Action,
  Dungeon,
  DungeonObject,
  GameEvent,
  Point,
  RunState,
} from "./types";
import type {
  AdvancedState,
  BossPhase,
  RuleAction,
  SignalEvent,
} from "./advanced-types";

const distance = (a: Point, b: Point) =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const solid = new Set([
  "gate",
  "block",
  "barrel",
  "pillar",
  "breakable-wall",
  "hidden-passage",
]);
const directions = ["up", "right", "down", "left"] as const;
const phases: BossPhase[] = [
  { threshold: 25, attack: "cross", cooldown: 2, damage: 16, armor: 0 },
  { threshold: 50, attack: "summon", cooldown: 5, damage: 12, armor: 2 },
  { threshold: 75, attack: "shatter", cooldown: 4, damage: 14, armor: 3 },
  { threshold: 100, attack: "melee", cooldown: 3, damage: 12, armor: 5 },
];

/** Bounded, integer-only interactions. All clocks advance from the recorded input stream. */
export class Systems {
  readonly a: AdvancedState;
  private processing = false;
  private objectsById: Map<string, DungeonObject>;
  constructor(
    private dungeon: Dungeon,
    private state: RunState,
    private actions: Action[],
  ) {
    this.objectsById = new Map(dungeon.objects.map((o) => [o.id, o]));
    const build = dungeon.build ?? "warrior";
    state.player.hp = state.player.maxHp = BUILDS[build].health;
    this.a = state.advanced = {
      alliances: [],
      supplies: {},
      build,
      keys: 0,
      abilityReady: 0,
      effectUntil: 0,
      slowedUntil: 0,
      checkpoint: null,
      active: {},
      counters: {},
      positions: {},
      destroyed: [],
      scheduled: [],
      signals: [],
      signalOverflow: false,
      environment: {},
      loot: { gold: 0, equipment: 0, artifacts: 0, resources: 0, cosmetics: 0 },
      visited: [],
      quests: [],
      facing: "down",
    };
    for (const o of dungeon.objects) {
      this.a.active[o.id] =
        o.config?.enabled ??
        ![
          "gate",
          "lever",
          "button",
          "plate",
          "color-switch",
          "timer",
          "counter",
          "and-gate",
          "or-gate",
          "not-gate",
          "proximity",
          "platform",
          "elevator",
          "spawn-zone",
        ].includes(o.type);
      this.a.counters[o.id] = 0;
      if (o.type === "npc") this.a.supplies[o.id] = o.config?.threshold ?? 2;
      this.a.positions[o.id] = { x: o.x, y: o.y };
      if (
        ["water", "oil", "wind", "darkness", "light", "smoke", "lava"].includes(
          o.type,
        )
      )
        this.a.environment[pointKey(o)] =
          o.type as AdvancedState["environment"][string];
      const enemy = state.enemies.find((e) => e.id === o.id);
      if (enemy) enemy.hp = o.config?.hp ?? CONTENT[o.type].hp!;
      this.signal(o.id, "OnSpawn");
    }
    this.flush();
  }
  private emit(
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
  private object(id: string): DungeonObject | undefined {
    const o = this.objectsById.get(id);
    if (!o || this.a.destroyed.includes(id)) return undefined;
    const p = this.a.positions[id];
    return p && (p.x !== o.x || p.y !== o.y) ? { ...o, ...p } : o;
  }
  private at(point: Point): DungeonObject | undefined {
    let found: DungeonObject | undefined;
    for (const raw of this.dungeon.objects) {
      const p = this.a.positions[raw.id];
      if (
        p.x !== point.x ||
        p.y !== point.y ||
        this.a.destroyed.includes(raw.id)
      )
        continue;
      const o = this.object(raw.id)!;
      if (solid.has(o.type) || this.living(o.id)) return o;
      found ??= o;
    }
    return found;
  }
  private living(id: string): boolean {
    const faction = this.objectsById.get(id)?.config?.faction;
    if (faction && this.a.alliances.includes(faction)) return false;
    return this.state.enemies.some((e) => e.id === id && e.hp > 0);
  }
  private passable(p: Point): boolean {
    const o = this.at(p);
    return (
      isFloor(this.dungeon, p) &&
      !this.dungeon.objects.some(
        (v) =>
          v.type === "bridge" &&
          this.a.destroyed.includes(v.id) &&
          v.x === p.x &&
          v.y === p.y,
      ) &&
      (!o ||
        (!this.living(o.id) &&
          (!solid.has(o.type) || this.state.opened.includes(o.id)) &&
          (o.type !== "door" ||
            this.state.player.hasKey ||
            this.state.opened.includes(o.id))))
    );
  }
  private sight(from: Point, to: Point): boolean {
    if (
      Math.floor(from.y / 13) !== Math.floor(to.y / 13) ||
      (from.x !== to.x && from.y !== to.y)
    )
      return false;
    for (let n = 1; n < distance(from, to); n++) {
      const p = {
        x: from.x + Math.sign(to.x - from.x) * n,
        y: from.y + Math.sign(to.y - from.y) * n,
      };
      const o = this.at(p);
      if (
        !isFloor(this.dungeon, p) ||
        this.a.environment[pointKey(p)] === "smoke" ||
        (o &&
          (solid.has(o.type) || o.type === "door") &&
          !this.state.opened.includes(o.id))
      )
        return false;
    }
    return true;
  }
  private signal(source: string, event: SignalEvent): void {
    if (this.a.signals.length < 256) this.a.signals.push({ source, event });
    else this.a.signalOverflow = true;
  }
  private setActive(o: DungeonObject, enabled: boolean): void {
    if (this.a.active[o.id] === enabled) return;
    this.a.active[o.id] = enabled;
    if (enabled && ["timer", "repeater"].includes(o.type))
      this.a.counters[o.id] = this.state.tick;
    this.signal(o.id, enabled ? "OnActivate" : "OnDeactivate");
    if (o.type === "gate" || o.type === "door") {
      if (enabled && !this.state.opened.includes(o.id))
        this.state.opened.push(o.id);
      if (!enabled)
        this.state.opened = this.state.opened.filter((id) => id !== o.id);
    }
    if (enabled && o.type === "spawn-zone" && o.config?.target)
      this.effect(o.id, o.config.target, "spawn", 0);
    if (enabled && o.type === "platform")
      this.shift(o, DIRECTIONS[directions[o.rotation]]);
  }
  private effect(
    source: string,
    target: string,
    action: RuleAction,
    value: number,
  ): void {
    const o = this.object(target);
    if (!o) return;
    if (
      ["and-gate", "or-gate", "not-gate"].includes(o.type) &&
      ["activate", "deactivate", "toggle", "open", "close"].includes(action)
    ) {
      const inputs = (this.dungeon.rules ?? [])
        .filter((r) => r.target === o.id)
        .map((r) => r.source);
      this.setActive(
        o,
        !!inputs.length &&
          (o.type === "and-gate"
            ? inputs.every((id) => this.a.active[id])
            : o.type === "or-gate"
              ? inputs.some((id) => this.a.active[id])
              : !this.a.active[inputs[0]]),
      );
      return;
    }
    if (action === "activate" || action === "open") {
      this.setActive(o, true);
      if (action === "open" && !this.state.opened.includes(o.id))
        this.state.opened.push(o.id);
    } else if (action === "deactivate" || action === "close") {
      this.setActive(o, false);
      if (action === "close")
        this.state.opened = this.state.opened.filter((id) => id !== o.id);
    } else if (action === "toggle") this.setActive(o, !this.a.active[o.id]);
    else if (action === "increment" || action === "set") {
      this.a.counters[o.id] = Math.min(
        1000,
        action === "set" ? value : this.a.counters[o.id] + Math.max(1, value),
      );
      if (this.a.counters[o.id] >= (o.config?.threshold ?? 3)) {
        this.setActive(o, true);
        this.signal(o.id, "OnTrigger");
      }
    } else if (action === "destroy") this.destroy(o);
    else if (action === "damage") {
      if (distance(o, this.state.player) <= (o.config?.range ?? 1))
        this.hurt(o.config?.damage ?? 10, o);
    } else if (action === "heal") {
      const amount = Math.min(
        20,
        this.state.player.maxHp - this.state.player.hp,
      );
      this.state.player.hp += amount;
      this.emit("heal", this.state.player, { amount, objectId: o.id });
    } else if (action === "spawn") {
      const enemy = this.state.enemies.find((e) => e.id === o.id);
      if (enemy && enemy.hp === 0 && distance(o, this.state.player) > 0) {
        enemy.hp = o.config?.hp ?? CONTENT[o.type].hp!;
        enemy.nextAttack = this.state.tick + 2;
        this.emit("spawn", o, { objectId: o.id });
        this.signal(o.id, "OnSpawn");
      }
    } else if (action === "teleport") this.teleport(o);
    this.emit("signal", o, {
      objectId: o.id,
      reason: action,
      message: `${source} → ${target}`,
    });
  }
  private flush(): void {
    if (this.processing) return;
    this.processing = true;
    let count = 0;
    while (this.a.signals.length && count++ < 256) {
      const signal = this.a.signals.shift()!;
      for (const rule of this.dungeon.rules ?? []) {
        if (rule.source !== signal.source || rule.event !== signal.event)
          continue;
        let action: RuleAction | undefined = rule.action;
        if (rule.condition) {
          const c = rule.condition;
          if (c.variable === "random")
            this.state.randomState = nextRandom(this.state.randomState);
          const actual =
            c.variable === "keys"
              ? this.a.keys
              : c.variable === "health"
                ? this.state.player.hp
                : c.variable === "random"
                  ? this.state.randomState % 100
                  : (this.a.counters[rule.source] ?? 0);
          const passes =
            c.operator === "gte"
              ? actual >= c.value
              : c.operator === "lte"
                ? actual <= c.value
                : actual === c.value;
          if (!passes) action = rule.otherwise;
        }
        if (!action) continue;
        if (rule.delay) {
          if (this.a.scheduled.length < 512)
            this.a.scheduled.push({
              tick: this.state.tick + rule.delay,
              source: rule.source,
              target: rule.target,
              action,
              value: 1,
            });
          else this.a.signalOverflow = true;
        } else this.effect(rule.source, rule.target, action, 1);
      }
      // Logic nodes evaluate the states of their explicitly wired sources.
      for (const gate of this.dungeon.objects.filter((o) =>
        ["and-gate", "or-gate", "not-gate"].includes(o.type),
      )) {
        const inputs = (this.dungeon.rules ?? [])
          .filter((r) => r.target === gate.id)
          .map((r) => r.source);
        if (!inputs.includes(signal.source) || !inputs.length) continue;
        const enabled =
          gate.type === "and-gate"
            ? inputs.every((id) => this.a.active[id])
            : gate.type === "or-gate"
              ? inputs.some((id) => this.a.active[id])
              : !this.a.active[inputs[0]];
        this.setActive(gate, enabled);
      }
    }
    this.processing = false;
    if (this.a.signals.length || this.a.signalOverflow) {
      this.a.signals = [];
      this.a.signalOverflow = true;
      this.state.status = "abandoned";
      this.emit("timeout", this.state.player, { reason: "logic-overflow" });
    }
  }
  private hurt(amount: number, source: DungeonObject): void {
    if (this.state.status !== "playing") return;
    const guard =
      this.a.build === "warrior" && this.a.effectUntil > this.state.tick;
    const actual = Math.min(
      this.state.player.hp,
      Math.max(
        1,
        Math.floor(amount / (guard ? 2 : 1)) -
          BUILDS[this.a.build].defense -
          this.a.loot.artifacts,
      ),
    );
    this.state.player.hp -= actual;
    this.state.damageTaken += actual;
    this.emit("damage", this.state.player, {
      amount: actual,
      objectId: source.id,
      reason: source.type,
    });
    this.signal(source.id, "OnDamage");
    if (this.state.player.hp <= 0) {
      this.state.status = "dead";
      this.emit("death", this.state.player, {
        objectId: source.id,
        reason: source.type,
      });
      this.signal(source.id, "OnDeath");
    }
  }
  private destroy(o: DungeonObject): void {
    if (this.a.destroyed.includes(o.id)) return;
    this.a.destroyed.push(o.id);
    const enemy = this.state.enemies.find((e) => e.id === o.id);
    if (enemy && enemy.hp > 0) {
      enemy.hp = 0;
      this.signal(o.id, "OnDeath");
    }
    this.signal(o.id, "OnDestroy");
    this.emit("kill", o, { objectId: o.id, reason: o.type });
    if (o.type === "barrel") {
      if (distance(o, this.state.player) <= 1) this.hurt(22, o);
      for (const target of this.dungeon.objects.map((v) => this.object(v.id)))
        if (target && distance(o, target) <= 1) {
          if (
            [
              "barrel",
              "bridge",
              "breakable-wall",
              "pillar",
              "block",
              "gate",
            ].includes(target.type)
          )
            this.destroy(target);
          const enemy = this.state.enemies.find((e) => e.id === target.id);
          if (enemy && enemy.hp > 0) this.hit(target, 35);
        }
      this.a.environment[pointKey(o)] = "fire";
    }
    if (o.type === "bridge" && distance(o, this.state.player) === 0) {
      this.hurt(25, o);
      if (this.a.checkpoint)
        Object.assign(this.state.player, this.a.checkpoint);
    }
  }
  private hit(o: DungeonObject, fixed?: number): void {
    if (o.config?.faction && this.a.alliances.includes(o.config.faction))
      return;
    const enemy = this.state.enemies.find((e) => e.id === o.id && e.hp > 0);
    if (!enemy) {
      if (
        ["barrel", "breakable-wall", "pillar", "block", "gate"].includes(o.type)
      )
        this.destroy(o);
      return;
    }
    this.state.randomState = nextRandom(this.state.randomState);
    let amount =
      fixed ??
      BUILDS[this.a.build].attack +
        (this.state.randomState % 5) +
        this.a.loot.equipment * 2;
    if (o.type === "shield") {
      const d = DIRECTIONS[directions[o.rotation]];
      if (
        Math.sign(this.state.player.x - o.x) === d.x &&
        Math.sign(this.state.player.y - o.y) === d.y
      )
        amount = Math.max(1, amount - 12);
    }
    if (o.type === "boss")
      amount = Math.max(1, amount - this.phase(o, enemy.hp).armor);
    enemy.hp = Math.max(0, enemy.hp - amount);
    this.emit("attack", o, { amount, objectId: o.id });
    this.signal(o.id, "OnDamage");
    if (!enemy.hp) {
      this.emit("kill", o, { objectId: o.id, reason: o.type });
      this.signal(o.id, "OnDeath");
    }
  }
  private phase(o: DungeonObject, health: number): BossPhase {
    return (
      (o.config?.phases ?? phases).find(
        (p) =>
          health * 100 <= (o.config?.hp ?? CONTENT[o.type].hp!) * p.threshold,
      ) ?? (o.config?.phases ?? phases).at(-1)!
    );
  }
  private shift(o: DungeonObject, delta: Point): boolean {
    const target = { x: o.x + delta.x, y: o.y + delta.y };
    if (
      !isFloor(this.dungeon, target) ||
      Math.floor(target.y / 13) !== Math.floor(o.y / 13) ||
      (this.at(target) &&
        !["plate", "lever", "button", "color-switch"].includes(
          this.at(target)!.type,
        ))
    )
      return false;
    this.a.positions[o.id] = target;
    if (o.type === "platform" && distance(o, this.state.player) === 0) {
      Object.assign(this.state.player, target);
      this.emit("move", target, { objectId: o.id, reason: "platform" });
    }
    const plate = this.dungeon.objects.find(
      (p) =>
        ["plate", "lever", "button", "color-switch"].includes(p.type) &&
        p.x === target.x &&
        p.y === target.y,
    );
    if (plate) {
      this.setActive(plate, true);
      this.signal(plate.id, "OnEnter");
      this.signal(plate.id, "OnCollision");
      this.signal(plate.id, "OnTrigger");
    }
    const previousPlate = this.dungeon.objects.find(
      (p) => p.type === "plate" && p.x === o.x && p.y === o.y,
    );
    if (previousPlate) {
      this.setActive(previousPlate, false);
      this.signal(previousPlate.id, "OnExit");
    }
    return true;
  }
  private teleport(source: DungeonObject): void {
    const target = source.config?.target
      ? this.object(source.config.target)
      : source;
    if (!target || !isFloor(this.dungeon, target) || this.living(target.id))
      return;
    Object.assign(this.state.player, { x: target.x, y: target.y });
    this.emit("teleport", target, { objectId: source.id });
  }
  private enter(o: DungeonObject): void {
    const p = this.state.player;
    this.signal(o.id, "OnEnter");
    if (o.type === "door" && !this.state.opened.includes(o.id)) {
      this.state.opened.push(o.id);
      this.emit("door", p, { objectId: o.id });
      this.signal(o.id, "OnActivate");
    }
    if (o.type === "plate") this.setActive(o, true);
    if (
      ["teleporter", "stairs", "elevator"].includes(o.type) &&
      this.a.active[o.id]
    )
      this.teleport(o);
    if (this.state.collected.includes(o.id)) return;
    if (o.type === "key") {
      this.a.keys++;
      p.hasKey = true;
      this.state.collected.push(o.id);
      this.emit("key", p, { objectId: o.id });
    }
    if (o.type === "potion" || o.type === "checkpoint") {
      const amount = Math.min(
        p.maxHp - p.hp,
        o.type === "checkpoint" ? 25 : 35,
      );
      p.hp += amount;
      this.state.collected.push(o.id);
      if (o.type === "checkpoint") this.a.checkpoint = { x: p.x, y: p.y };
      this.emit("heal", p, { amount, objectId: o.id });
    }
    const loot = (
      {
        gold: "gold",
        equipment: "equipment",
        artifact: "artifacts",
        resource: "resources",
        cosmetic: "cosmetics",
      } as const
    )[o.type as "gold"];
    if (loot) {
      this.a.loot[loot] += o.type === "gold" ? 5 : 1;
      this.state.collected.push(o.id);
      this.emit("loot", p, { objectId: o.id, reason: o.type });
    }
    if (o.type === "treasure") {
      const goal = this.dungeon.objective;
      if (
        (goal?.kind === "defeat-all" &&
          this.state.enemies.some((e) => this.living(e.id))) ||
        (goal?.kind === "survive" && this.state.tick < goal.ticks)
      )
        this.emit("blocked", p, {
          reason: "objective",
          message:
            goal.kind === "defeat-all"
              ? "Defeat all monsters before claiming the treasure."
              : `Survive until turn ${goal.ticks}.`,
        });
      else {
        this.state.status = "completed";
        this.emit("complete", p, { objectId: o.id });
      }
    }
  }
  private move(direction: keyof typeof DIRECTIONS, forced = false): void {
    const p = this.state.player;
    p.facing = direction;
    this.a.facing = direction;
    if (
      !forced &&
      this.a.slowedUntil > this.state.tick &&
      this.state.tick % 2
    ) {
      this.emit("blocked", p, { reason: "slowed" });
      return;
    }
    const delta = DIRECTIONS[direction],
      target = { x: p.x + delta.x, y: p.y + delta.y },
      o = this.at(target);
    if (
      Math.floor(target.y / 13) !== Math.floor(p.y / 13) ||
      !isFloor(this.dungeon, target)
    ) {
      this.emit("blocked", target, { reason: "wall" });
      return;
    }
    if (o && this.living(o.id)) {
      this.hit(o);
      return;
    }
    if (o && ["block", "barrel"].includes(o.type) && this.shift(o, delta))
      this.signal(o.id, "OnCollision");
    if (!this.passable(target)) {
      this.emit("blocked", target, { reason: o?.type ?? "wall" });
      return;
    }
    const prior = this.at(p);
    if (prior) {
      this.signal(prior.id, "OnExit");
      if (prior.type === "plate") this.setActive(prior, false);
    }
    Object.assign(p, target);
    this.emit("move", p);
    const arrived = this.at(p);
    if (arrived) this.enter(arrived);
    const key = pointKey(p);
    if (!this.a.visited.includes(key)) this.a.visited.push(key);
  }
  private interact(): void {
    const p = this.state.player,
      delta = DIRECTIONS[p.facing];
    const standing = this.at(p);
    const o =
      standing &&
      ["lever", "button", "color-switch", "timer", "mirror", "npc"].includes(
        standing.type,
      )
        ? standing
        : (this.at({ x: p.x + delta.x, y: p.y + delta.y }) ?? standing);
    if (!o || distance(o, p) > 1) return;
    this.signal(o.id, "OnInteract");
    this.emit("interact", o, { objectId: o.id, reason: o.type });
    if (
      ["lever", "button", "color-switch", "mirror", "timer"].includes(o.type)
    ) {
      this.a.counters[o.id] =
        (this.a.counters[o.id] + 1) %
        (o.type === "mirror" || o.type === "color-switch" ? 4 : 1000);
      this.setActive(o, !this.a.active[o.id]);
      this.signal(o.id, "OnTrigger");
      if (o.type === "button")
        this.a.scheduled.push({
          tick: this.state.tick + (o.config?.delay ?? 2),
          source: o.id,
          target: o.id,
          action: "deactivate",
          value: 0,
        });
    }
    if (o.type === "hidden-passage") {
      this.state.opened.push(o.id);
      this.signal(o.id, "OnActivate");
    }
    if (o.type === "npc") {
      this.emit("quest", o, {
        objectId: o.id,
        message: o.config?.dialogue ?? "Every passage has a story.",
        reason: o.config?.faction ?? "Wanderer",
      });
      const q = o.config?.quest;
      if (
        q &&
        !this.a.quests.includes(o.id) &&
        ((q === "key" && this.a.keys > 0) ||
          (q === "monster" && this.state.enemies.some((e) => e.hp === 0)) ||
          (q === "treasure" && this.a.loot.gold > 0))
      ) {
        this.a.quests.push(o.id);
        if (o.config?.faction && !this.a.alliances.includes(o.config.faction))
          this.a.alliances.push(o.config.faction);
        this.a.loot.resources++;
        this.signal(o.id, "OnTrigger");
        this.emit("loot", o, { reason: "quest" });
      }
    }
  }
  private ability(): void {
    if (this.a.abilityReady > this.state.tick) {
      this.emit("blocked", this.state.player, { reason: "cooldown" });
      return;
    }
    const p = this.state.player;
    this.a.abilityReady = this.state.tick + BUILDS[this.a.build].cooldown;
    this.a.effectUntil = this.state.tick + 4;
    this.emit("ability", p, { reason: this.a.build });
    if (this.a.build === "rogue") {
      this.move(p.facing, true);
      if (this.state.status === "playing") this.move(p.facing, true);
    }
    if (this.a.build === "mage")
      for (const o of this.dungeon.objects.map((o) => this.object(o.id)))
        if (o && distance(o, p) <= 2) {
          const enemy = this.state.enemies.find((e) => e.id === o.id);
          if (enemy) enemy.nextAttack = this.state.tick + 4;
          if (this.a.environment[pointKey(o)] === "water")
            this.a.environment[pointKey(o)] = "ice";
        }
    if (this.a.build === "engineer")
      for (const o of this.dungeon.objects.map((o) => this.object(o.id)))
        if (o && distance(o, p) <= 1) {
          if (CONTENT[o.type].behavior === "trap") {
            this.setActive(o, false);
            this.a.scheduled.push({
              tick: this.state.tick + 4,
              source: o.id,
              target: o.id,
              action: "activate",
              value: 0,
            });
          } else this.signal(o.id, "OnInteract");
        }
    if (this.a.build === "explorer") {
      const amount = Math.min(12, p.maxHp - p.hp);
      p.hp += amount;
      this.emit("heal", p, { amount });
      for (const o of this.dungeon.objects)
        if (
          o.type === "hidden-passage" &&
          distance(o, p) <= 3 &&
          !this.state.opened.includes(o.id)
        )
          this.state.opened.push(o.id);
    }
  }
  private environment(): void {
    const next = { ...this.a.environment };
    for (const [key, type] of Object.entries(this.a.environment)) {
      const [x, y] = key.split(",").map(Number);
      const adjacent = Object.values(DIRECTIONS)
        .map((d) => ({ x: x + d.x, y: y + d.y }))
        .filter(
          (p) =>
            isFloor(this.dungeon, p) &&
            Math.floor(p.y / 13) === Math.floor(y / 13),
        );
      for (const p of adjacent) {
        const other = this.a.environment[pointKey(p)];
        if (type === "fire" && other === "oil") next[pointKey(p)] = "fire";
        if (type === "water" && other === "fire") next[pointKey(p)] = "smoke";
        if (type === "water" && other === "lava") delete next[pointKey(p)];
        if (type === "electricity" && other === "water")
          next[pointKey(p)] = "electricity";
        if (type === "ice" && other === "water") next[pointKey(p)] = "ice";
        if (
          (type === "light" && other === "darkness") ||
          (type === "wind" && other === "smoke")
        )
          delete next[pointKey(p)];
      }
    }
    this.a.environment = next;
    const type = next[pointKey(this.state.player)];
    const source =
      this.at(this.state.player) ??
      ({
        id: "environment",
        type: "fire",
        rotation: 0,
        x: this.state.player.x,
        y: this.state.player.y,
      } as DungeonObject);
    if (["fire", "poison", "electricity", "lava"].includes(type))
      this.hurt(type === "lava" ? 15 : type === "electricity" ? 8 : 5, source);
    if (type === "ice") this.a.slowedUntil = this.state.tick + 2;
  }
  private hazards(): void {
    for (const raw of this.dungeon.objects) {
      const o = this.object(raw.id);
      if (!o || !this.a.active[o.id] || this.state.status !== "playing")
        continue;
      if (["conveyor", "wind"].includes(o.type)) {
        const delta = DIRECTIONS[directions[o.rotation]];
        if (distance(o, this.state.player) === 0)
          this.move(directions[o.rotation], true);
        for (const other of this.dungeon.objects.map((v) => this.object(v.id)))
          if (
            other &&
            ["barrel", "block"].includes(other.type) &&
            distance(o, other) === 0
          )
            this.shift(other, delta);
      }
      if (
        CONTENT[o.type].behavior !== "trap" ||
        this.state.tick < (this.state.trapCooldowns[o.id] ?? 0)
      )
        continue;
      const d = distance(o, this.state.player);
      let hits = d === 0;
      if (["arrow-trap", "launcher"].includes(o.type)) {
        let p = { x: o.x, y: o.y },
          direction = directions[o.rotation];
        for (let n = 0; n < (o.config?.range ?? 5); n++) {
          const delta = DIRECTIONS[direction];
          p = { x: p.x + delta.x, y: p.y + delta.y };
          if (
            !isFloor(this.dungeon, p) ||
            Math.floor(p.y / 13) !== Math.floor(o.y / 13)
          )
            break;
          if (distance(p, this.state.player) === 0) hits = true;
          const obstacle = this.at(p);
          if (obstacle?.type === "mirror")
            direction =
              directions[
                (directions.indexOf(direction) +
                  ((obstacle.rotation + this.a.counters[obstacle.id]) % 2
                    ? 3
                    : 1)) %
                  4
              ];
          else if (
            obstacle &&
            solid.has(obstacle.type) &&
            !this.state.opened.includes(obstacle.id)
          )
            break;
        }
      }
      if (o.type === "blade") hits = d <= 1;
      if (o.type === "saw") {
        this.shift(o, DIRECTIONS[directions[o.rotation]]);
        hits = distance(this.a.positions[o.id], this.state.player) === 0;
      }
      if (o.type === "gravity-trap" && d > 0 && d <= 3) {
        const p = this.state.player;
        const direction =
          Math.abs(o.x - p.x) >= Math.abs(o.y - p.y)
            ? o.x > p.x
              ? "right"
              : "left"
            : o.y > p.y
              ? "down"
              : "up";
        this.move(direction, true);
        hits = distance(o, p) === 0;
      }
      if (
        o.type === "poison-gas" ||
        o.type === "freezer" ||
        o.type === "electric-coil"
      ) {
        for (const delta of Object.values(DIRECTIONS)) {
          const p = { x: o.x + delta.x, y: o.y + delta.y };
          if (!isFloor(this.dungeon, p)) continue;
          const key = pointKey(p);
          if (o.type === "poison-gas") this.a.environment[key] = "poison";
          else if (this.a.environment[key] === "water")
            this.a.environment[key] =
              o.type === "freezer" ? "ice" : "electricity";
        }
        if (o.type === "electric-coil")
          hits =
            d <= (o.config?.range ?? 4) && this.sight(o, this.state.player);
      }
      this.state.trapCooldowns[o.id] =
        this.state.tick + (o.config?.cooldown ?? CONTENT[o.type].cooldown ?? 4);
      this.signal(o.id, "OnTrigger");
      if (!hits) continue;
      this.emit("trap", this.state.player, { objectId: o.id, reason: o.type });
      this.hurt(o.config?.damage ?? CONTENT[o.type].damage ?? 10, o);
      if (o.type === "pit" && this.a.checkpoint)
        Object.assign(this.state.player, this.a.checkpoint);
      if (o.type === "teleport-trap") this.teleport(o);
      if (o.type === "time-trap" || o.type === "freezer")
        this.a.slowedUntil = this.state.tick + 4;
      if (o.type === "fire") this.a.environment[pointKey(o)] = "fire";
    }
  }
  private inhabitants(): void {
    if (this.state.tick % 8 !== 0) return;
    for (const raw of this.dungeon.objects) {
      const o = this.object(raw.id);
      if (!o || o.type !== "npc" || !this.a.active[o.id]) continue;
      this.a.supplies[o.id] = Math.max(0, (this.a.supplies[o.id] ?? 0) - 1);
      const supply = this.dungeon.objects
        .filter(
          (v) =>
            v.type === "resource" &&
            !this.state.collected.includes(v.id) &&
            !this.a.destroyed.includes(v.id) &&
            Math.floor(v.y / 13) === Math.floor(o.y / 13),
        )
        .sort(
          (x, y) =>
            distance(x, o) - distance(y, o) || x.id.localeCompare(y.id, "en"),
        )[0];
      if (this.a.supplies[o.id] === 0 && supply) {
        if (distance(o, supply) <= 1) {
          this.state.collected.push(supply.id);
          this.a.supplies[o.id] = 3;
          this.emit("loot", o, {
            objectId: o.id,
            reason: "supplies",
            amount: 3,
          });
          this.signal(o.id, "OnTrigger");
        } else {
          const step = Object.values(DIRECTIONS)
            .map((d) => ({ x: o.x + d.x, y: o.y + d.y }))
            .filter(
              (p) =>
                this.passable(p) &&
                distance(p, this.state.player) > 0 &&
                distance(p, supply) < distance(o, supply),
            )
            .sort((x, y) => distance(x, supply) - distance(y, supply))[0];
          if (step) this.a.positions[o.id] = step;
        }
      }
      this.signal(o.id, "OnTimer");
    }
  }
  private monsters(): void {
    for (const enemy of this.state.enemies) {
      if (this.state.status !== "playing") break;
      const o = this.object(enemy.id);
      if (
        !o ||
        enemy.hp <= 0 ||
        !this.a.active[o.id] ||
        (o.config?.faction !== undefined &&
          this.a.alliances.includes(o.config.faction)) ||
        enemy.nextAttack > this.state.tick
      )
        continue;
      const p = this.state.player;
      if (Math.floor(p.y / 13) !== Math.floor(o.y / 13)) continue;
      const d = distance(o, p),
        hidden =
          (this.a.build === "rogue" && this.a.effectUntil > this.state.tick) ||
          (this.a.environment[pointKey(p)] === "darkness" && d > 1);
      const phase = o.type === "boss" ? this.phase(o, enemy.hp) : null;
      if (phase && this.a.counters[o.id] !== phase.threshold) {
        this.a.counters[o.id] = phase.threshold;
        this.emit("phase", o, {
          objectId: o.id,
          amount: phase.threshold,
          reason: phase.attack,
        });
        this.signal(o.id, "OnTrigger");
      }
      if (o.type === "summoner" || phase?.attack === "summon") {
        const fallen = this.state.enemies.find(
          (e) => e.hp === 0 && distance(this.a.positions[e.id], o) <= 5,
        );
        if (fallen) this.effect(o.id, fallen.id, "spawn", 0);
      }
      if (o.type === "healer")
        for (const ally of this.state.enemies)
          if (ally.hp > 0 && distance(this.a.positions[ally.id], o) <= 3) {
            const target = this.object(ally.id)!;
            ally.hp = Math.min(
              target.config?.hp ?? CONTENT[target.type].hp!,
              ally.hp + 5,
            );
          }
      if (phase?.attack === "shatter")
        for (const target of this.dungeon.objects.map((v) => this.object(v.id)))
          if (
            target &&
            distance(o, target) <= 2 &&
            ["pillar", "bridge", "breakable-wall"].includes(target.type)
          )
            this.destroy(target);
      const range =
        phase?.attack === "cross"
          ? 5
          : (o.config?.range ?? CONTENT[o.type].range ?? 1);
      if (!hidden && d <= range && this.sight(o, p)) {
        this.hurt(
          phase?.damage ?? o.config?.damage ?? CONTENT[o.type].damage!,
          o,
        );
        enemy.nextAttack =
          this.state.tick +
          (phase?.cooldown ??
            o.config?.cooldown ??
            (o.type === "bat" ? 2 : CONTENT[o.type].cooldown!));
      } else if (
        [
          "bat",
          "stalker",
          "summoner",
          "healer",
          "patrol",
          "ambusher",
          "shield",
          "mimic",
          "boss",
        ].includes(o.type)
      ) {
        if (hidden || (["ambusher", "mimic"].includes(o.type) && d > 2))
          continue;
        let destination: Point = p;
        if (o.type === "patrol" && o.config?.patrol?.length && d > 3) {
          const index = this.a.counters[o.id] % o.config.patrol.length;
          destination = o.config.patrol[index];
          if (!distance(destination, o)) this.a.counters[o.id]++;
        }
        const moves = Object.values(DIRECTIONS)
          .map((delta) => ({ x: o.x + delta.x, y: o.y + delta.y }))
          .filter(
            (v) =>
              Math.floor(v.y / 13) === Math.floor(o.y / 13) &&
              this.passable(v) &&
              distance(v, p) > 0,
          )
          .sort((a, b) => distance(a, destination) - distance(b, destination));
        if (
          moves[0] &&
          distance(moves[0], destination) < distance(o, destination)
        )
          this.a.positions[o.id] = moves[0];
        enemy.nextAttack =
          this.state.tick +
          (o.type === "bat" || phase?.attack === "charge" ? 1 : 2);
      }
    }
  }
  step(action: Action): RunState {
    if (this.state.status !== "playing") return this.state;
    this.actions.push(clone(action));
    this.state.tick++;
    const due = this.a.scheduled.filter((e) => e.tick <= this.state.tick);
    this.a.scheduled = this.a.scheduled.filter((e) => e.tick > this.state.tick);
    for (const e of due) this.effect(e.source, e.target, e.action, e.value);
    for (const o of this.dungeon.objects) {
      if (
        ["timer", "repeater"].includes(o.type) &&
        this.a.active[o.id] &&
        this.state.tick - this.a.counters[o.id] >= (o.config?.delay ?? 4)
      ) {
        this.a.counters[o.id] = this.state.tick;
        this.signal(o.id, "OnTimer");
        if (o.type === "timer") this.setActive(o, false);
      }
      if (o.type === "proximity") {
        const active =
          distance(this.a.positions[o.id], this.state.player) <=
          (o.config?.range ?? 2);
        if (active !== this.a.active[o.id]) {
          this.setActive(o, active);
          this.signal(o.id, active ? "OnEnter" : "OnExit");
        }
      }
    }
    this.flush();
    if (this.state.status !== "playing") return this.state;
    if (action.type === "move") this.move(action.direction);
    if (action.type === "attack") {
      const p = this.state.player,
        delta = DIRECTIONS[p.facing];
      const target =
        this.at({ x: p.x + delta.x, y: p.y + delta.y }) ??
        this.dungeon.objects
          .map((o) => this.object(o.id))
          .find((o) => o && this.living(o.id) && distance(o, p) === 1);
      if (target) this.hit(target);
      else this.emit("attack", p, { amount: 0 });
    }
    if (action.type === "interact") this.interact();
    if (action.type === "ability") this.ability();
    this.flush();
    if (this.state.status === "playing") {
      this.inhabitants();
      this.hazards();
      this.environment();
      this.monsters();
      this.flush();
    }
    if (
      this.state.tick >=
        (this.dungeon.objective?.kind === "escape"
          ? this.dungeon.objective.ticks
          : MAX_TICKS) &&
      this.state.status === "playing"
    ) {
      this.state.status = "abandoned";
      this.emit("timeout", this.state.player);
    }
    return this.state;
  }
}
