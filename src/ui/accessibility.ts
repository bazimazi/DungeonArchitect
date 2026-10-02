import { CONTENT } from "../core/content";
import { isFloor } from "../core/dungeon";
import { DIRECTIONS } from "../core/types";
import type { Dungeon, GameEvent, Point, RunState } from "../core/types";
import { t } from "./i18n";
import { msg } from "./localization";

function contents(dungeon: Dungeon, point: Point, state?: RunState): string {
  if (!isFloor(dungeon, point)) return msg("Wall");
  const object = dungeon.objects.find((o) => {
    const position = state?.advanced?.positions[o.id] ?? o;
    return (
      position.x === point.x &&
      position.y === point.y &&
      !state?.collected.includes(o.id) &&
      !state?.advanced?.destroyed.includes(o.id)
    );
  });
  if (!object) return msg("Open floor");
  const enemy = state?.enemies.find((e) => e.id === object.id);
  if (enemy?.hp === 0)
    return msg("Defeated {object}", {
      object: t(CONTENT[object.type].nameKey),
    });
  if (state?.opened.includes(object.id)) return msg("Open door");
  const name = t(CONTENT[object.type].nameKey);
  return enemy
    ? msg("{object}, {health} health", { object: name, health: enemy.hp })
    : name;
}
export function describeBoard(
  dungeon: Dungeon,
  point: Point,
  state?: RunState,
  events: GameEvent[] = [],
): string {
  const location = msg(
    "Floor {floor}, row {row}, column {column}: {contents}.",
    {
      floor: Math.floor(point.y / 13) + 1,
      row: String.fromCharCode(65 + (point.y % 13)),
      column: point.x + 1,
      contents: contents(dungeon, point, state),
    },
  );
  if (!state) return location;
  const neighbours = Object.entries(DIRECTIONS)
    .map(([direction, delta]) => {
      const next = { x: point.x + delta.x, y: point.y + delta.y };
      return msg("{direction}: {contents}", {
        direction: msg(direction),
        contents:
          Math.floor(next.y / 13) !== Math.floor(point.y / 13)
            ? msg("Wall")
            : contents(dungeon, next, state),
      });
    })
    .join(". ");
  const changes = events
    .filter((e) => !["move", "spawn", "signal"].includes(e.kind))
    .slice(-4)
    .map((e) =>
      e.amount === undefined
        ? t(`event.${e.kind}`)
        : msg("{event}: {amount}", {
            event: t(`event.${e.kind}`),
            amount: e.amount,
          }),
    )
    .join(". ");
  return [
    location,
    msg("Health {health} of {maximum}. {key}. Adventure {status}.", {
      health: state.player.hp,
      maximum: state.player.maxHp,
      key: t(state.player.hasKey ? "run.key" : "run.noKey"),
      status: msg(state.status),
    }),
    neighbours,
    changes,
  ]
    .filter(Boolean)
    .join(" ");
}
