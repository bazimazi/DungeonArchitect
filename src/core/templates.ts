import { createDungeon, createStarter, parseDungeon } from "./dungeon";
import { nextRandom } from "./simulation-v1";
import type { Dungeon, DungeonObject, ObjectType } from "./types";
export const TEMPLATES = [
  {
    id: "classic",
    name: "Classic Dungeon",
    description: "Connected chambers, a key, and a risky shortcut.",
  },
  {
    id: "gauntlet",
    name: "Gauntlet",
    description: "A line of battles with carefully spaced recovery.",
  },
  {
    id: "puzzle-box",
    name: "Puzzle Box",
    description: "A lever opens the only gate. Add your own conditions.",
  },
  {
    id: "maze",
    name: "Maze",
    description: "A seeded branching maze with a guaranteed route.",
  },
  {
    id: "trap-house",
    name: "Trap House",
    description: "Two routes with different hazards.",
  },
  {
    id: "boss-rush",
    name: "Boss Rush",
    description: "Defeat both bosses before claiming the treasure.",
  },
  {
    id: "escape",
    name: "Escape Dungeon",
    description: "Reach the exit within forty turns.",
  },
  {
    id: "survival",
    name: "Survival",
    description: "Last thirty turns, then claim the treasure.",
  },
] as const;
export function createTemplate(id: string, seed = 1): Dungeon {
  if (id === "classic") {
    const d = createStarter();
    d.id = crypto.randomUUID();
    return d;
  }
  const d = createDungeon();
  d.schemaVersion = 2;
  d.rules = [];
  d.build = "warrior";
  d.title = TEMPLATES.find((t) => t.id === id)?.name ?? "Architect’s sketch";
  const carve = (x: number, y: number, w = 1, h = 1) => {
    for (let row = y; row < y + h; row++)
      for (let col = x; col < x + w; col++) d.tiles[row * 15 + col] = 1;
  };
  const add = (
    type: ObjectType,
    x: number,
    y: number,
    config?: DungeonObject["config"],
  ) => {
    const o: DungeonObject = {
      id: `${type}-${d.objects.length}`,
      type,
      x,
      y,
      rotation: 0,
      ...(config ? { config } : {}),
    };
    d.objects.push(o);
    return o;
  };
  if (id === "maze") {
    let random = seed >>> 0;
    const stack = [{ x: 1, y: 1 }];
    carve(1, 1);
    while (stack.length) {
      const p = stack.at(-1)!;
      const options = [
        { x: 2, y: 0 },
        { x: 0, y: 2 },
        { x: -2, y: 0 },
        { x: 0, y: -2 },
      ]
        .map((v) => ({ x: p.x + v.x, y: p.y + v.y }))
        .filter(
          (v) =>
            v.x > 0 &&
            v.x < 14 &&
            v.y > 0 &&
            v.y < 12 &&
            !d.tiles[v.y * 15 + v.x],
        );
      if (!options.length) {
        stack.pop();
        continue;
      }
      random = nextRandom(random);
      const n = options[random % options.length];
      carve((p.x + n.x) / 2, (p.y + n.y) / 2);
      carve(n.x, n.y);
      stack.push(n);
    }
    add("entrance", 1, 1);
    add("treasure", 13, 11);
  } else if (id === "puzzle-box") {
    carve(1, 4, 4, 5);
    carve(6, 4, 5, 5);
    carve(5, 6);
    add("entrance", 2, 6);
    const lever = add("lever", 3, 5),
      gate = add("gate", 5, 6);
    add("treasure", 9, 6);
    d.rules = [
      {
        id: "lever-gate",
        source: lever.id,
        event: "OnActivate",
        target: gate.id,
        action: "open",
        delay: 0,
      },
    ];
  } else if (id === "trap-house") {
    carve(1, 2, 12);
    carve(1, 8, 12);
    carve(1, 3, 1, 5);
    carve(12, 3, 1, 5);
    add("entrance", 1, 2);
    add("treasure", 12, 8);
    add("spikes", 5, 2);
    add("fire", 9, 2);
    add("potion", 12, 5);
    add("water", 1, 5);
    add("gold", 5, 8);
    add("blade", 8, 8);
  } else if (id === "boss-rush" || id === "survival") {
    carve(1, 4, 13, 5);
    add("entrance", 2, 6);
    add("treasure", 13, 6);
    add("boss", 7, 6, {
      hp: 80,
      damage: 8,
      phases: [
        { threshold: 50, attack: "cross", damage: 6, armor: 0, cooldown: 3 },
        { threshold: 100, attack: "melee", damage: 8, armor: 2, cooldown: 3 },
      ],
    });
    add("potion", 5, 4);
    add("pillar", 8, 5);
    if (id === "boss-rush") {
      add("boss", 11, 7, { hp: 70 });
      add("checkpoint", 9, 8);
      d.objective = { kind: "defeat-all", ticks: 2400 };
    } else {
      const slime = add("slime", 9, 8),
        waves = add("repeater", 3, 4, { delay: 10 });
      d.rules = [
        {
          id: "waves",
          source: waves.id,
          event: "OnTimer",
          target: slime.id,
          action: "spawn",
          delay: 0,
        },
      ];
      d.objective = { kind: "survive", ticks: 30 };
    }
  } else {
    carve(1, 6, 13);
    carve(4, 5, 3, 3);
    carve(10, 5, 3, 3);
    add("entrance", 1, 6);
    add("treasure", 13, 6);
    add("skeleton", 5, 6);
    add("potion", 7, 6);
    add("slime", 10, 6);
    add("gold", 11, 5);
    if (id === "escape") d.objective = { kind: "escape", ticks: 40 };
  }
  return parseDungeon(d);
}
