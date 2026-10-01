import { ADVANCED_OBJECTS, BUILDS, THEMES } from "./advanced-types";
import type { BossPhase, LogicRule, ObjectConfig } from "./advanced-types";
import type { Dungeon } from "./types";

export { THEMES, BUILDS };
const events = [
  "OnEnter",
  "OnExit",
  "OnTrigger",
  "OnDamage",
  "OnDeath",
  "OnInteract",
  "OnActivate",
  "OnDeactivate",
  "OnTimer",
  "OnCollision",
  "OnDestroy",
  "OnSpawn",
];
const actions = [
  "activate",
  "deactivate",
  "toggle",
  "open",
  "close",
  "damage",
  "heal",
  "spawn",
  "destroy",
  "increment",
  "set",
  "teleport",
];
const bad = () => {
  throw new Error("storage.invalidConfiguration");
};
function integer(value: unknown, min: number, max: number): number {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max)
    bad();
  return Number(value);
}
export function parseConfig(
  input: unknown,
  dungeon: Dungeon,
): ObjectConfig | undefined {
  if (input === undefined) return undefined;
  if (!input || typeof input !== "object" || Array.isArray(input)) return bad();
  const raw = input as ObjectConfig,
    result: ObjectConfig = {};
  if (raw.body !== undefined) {
    if (!["brute", "serpent", "sentinel"].includes(raw.body)) bad();
    result.body = raw.body;
  }
  for (const key of [
    "damage",
    "cooldown",
    "range",
    "channel",
    "delay",
    "threshold",
    "hp",
  ] as const)
    if (raw[key] !== undefined)
      result[key] = integer(
        raw[key],
        ["cooldown", "delay", "threshold", "hp"].includes(key) ? 1 : 0,
        key === "hp" ? 500 : key === "damage" ? 50 : key === "range" ? 8 : 100,
      );
  if (raw.enabled !== undefined) {
    if (typeof raw.enabled !== "boolean") bad();
    result.enabled = raw.enabled;
  }
  if (raw.target !== undefined) {
    if (
      typeof raw.target !== "string" ||
      !dungeon.objects.some((o) => o.id === raw.target)
    )
      bad();
    result.target = raw.target;
  }
  if (raw.patrol !== undefined) {
    if (!Array.isArray(raw.patrol) || raw.patrol.length > 16) bad();
    result.patrol = raw.patrol.map((p) => ({
      x: integer(p.x, 0, dungeon.width - 1),
      y: integer(p.y, 0, dungeon.height - 1),
    }));
  }
  if (raw.phases !== undefined) {
    if (
      !Array.isArray(raw.phases) ||
      raw.phases.length < 1 ||
      raw.phases.length > 4
    )
      bad();
    result.phases = raw.phases
      .map((p) => {
        if (
          !["melee", "cross", "charge", "summon", "shatter"].includes(p.attack)
        )
          bad();
        return {
          threshold: integer(p.threshold, 1, 100),
          attack: p.attack,
          cooldown: integer(p.cooldown, 1, 20),
          damage: integer(p.damage, 1, 40),
          armor: integer(p.armor, 0, 15),
        } as BossPhase;
      })
      .sort((a, b) => a.threshold - b.threshold);
  }
  for (const key of ["dialogue", "faction"] as const)
    if (raw[key] !== undefined) {
      if (
        typeof raw[key] !== "string" ||
        raw[key]!.length > (key === "dialogue" ? 300 : 40) ||
        /[<>\x00-\x08]/.test(raw[key]!)
      )
        bad();
      result[key] = raw[key];
    }
  if (raw.quest !== undefined) {
    if (!["key", "monster", "treasure"].includes(raw.quest)) bad();
    result.quest = raw.quest;
  }
  return result;
}
export function parseRules(input: unknown, dungeon: Dungeon): LogicRule[] {
  if (!Array.isArray(input) || input.length > 128) return bad();
  const ids = new Set<string>();
  return input.map((r: LogicRule) => {
    if (
      !r ||
      typeof r.id !== "string" ||
      !r.id ||
      r.id.length > 100 ||
      ids.has(r.id) ||
      !events.includes(r.event) ||
      !actions.includes(r.action) ||
      !dungeon.objects.some((o) => o.id === r.source) ||
      !dungeon.objects.some((o) => o.id === r.target)
    )
      bad();
    ids.add(r.id);
    const rule: LogicRule = {
      id: r.id,
      source: r.source,
      event: r.event,
      target: r.target,
      action: r.action,
      delay: integer(r.delay, 0, 100),
    };
    if (r.condition) {
      if (
        !["keys", "health", "counter", "random"].includes(
          r.condition.variable,
        ) ||
        !["gte", "lte", "eq"].includes(r.condition.operator)
      )
        bad();
      rule.condition = {
        variable: r.condition.variable,
        operator: r.condition.operator,
        value: integer(r.condition.value, 0, 1000),
      };
    }
    if (r.otherwise) {
      if (!actions.includes(r.otherwise)) bad();
      rule.otherwise = r.otherwise;
    }
    return rule;
  });
}
export function isAdvancedObject(type: string): boolean {
  return (ADVANCED_OBJECTS as readonly string[]).includes(type);
}
export function dangerRating(dungeon: Dungeon): number {
  return Math.min(
    100,
    Math.round(
      dungeon.objects.reduce(
        (total, o) =>
          total +
          ((o.config?.damage ??
            (["boss", "guardian"].includes(o.type)
              ? 16
              : ["spikes", "fire", "skeleton", "archer", "slime"].includes(
                    o.type,
                  )
                ? 8
                : isAdvancedObject(o.type) && o.type.includes("trap")
                  ? 10
                  : 0)) *
            (1 + (o.config?.range ?? 1) / 4)) /
            Math.max(1, o.config?.cooldown ?? 3),
        0,
      ),
    ),
  );
}
