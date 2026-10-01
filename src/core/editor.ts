import { CONTENT } from "./content";
import {
  budgetUsed,
  fingerprint,
  inBounds,
  isFloor,
  objectAt,
} from "./dungeon";
import { clone } from "./types";
import type { Dungeon, Point, Tool } from "./types";
import { parseConfig, parseRules } from "./configuration";
import type {
  AdventurerBuild,
  LogicRule,
  ObjectConfig,
  Theme,
} from "./advanced-types";
import { ROOM_TOOLS } from "./rooms";
import type { RoomTool } from "./rooms";

export class Editor {
  dungeon: Dungeon;
  private past: Dungeon[] = [];
  private future: Dungeon[] = [];
  constructor(dungeon: Dungeon) {
    this.dungeon = clone(dungeon);
  }
  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }

  private commit(edit: (next: Dungeon) => void): boolean {
    const next = clone(this.dungeon);
    edit(next);
    if (next.rules)
      next.rules = next.rules.filter(
        (r) =>
          next.objects.some((o) => o.id === r.source) &&
          next.objects.some((o) => o.id === r.target),
      );
    for (const object of next.objects)
      if (
        object.config?.target &&
        !next.objects.some((o) => o.id === object.config!.target)
      )
        delete object.config.target;
    if (budgetUsed(next) > next.budget)
      throw new Error("editor.budgetExceeded");
    if (fingerprint(next) === fingerprint(this.dungeon)) return false;
    this.past.push(clone(this.dungeon));
    if (this.past.length > 100) this.past.shift();
    this.future = [];
    this.dungeon = next;
    return true;
  }
  place(tool: Tool, point: Point, rotation = 0): boolean {
    if (!inBounds(this.dungeon, point)) throw new Error("editor.outside");
    if (tool === "select") return false;
    return this.commit((next) => {
      if (Object.hasOwn(ROOM_TOOLS, tool) || tool === "floor") {
        const shape = ROOM_TOOLS[tool as RoomTool] ?? { width: 1, height: 1 };
        for (
          let y = point.y - Math.floor(shape.height / 2);
          y < point.y - Math.floor(shape.height / 2) + shape.height;
          y++
        )
          for (
            let x = point.x - Math.floor(shape.width / 2);
            x < point.x - Math.floor(shape.width / 2) + shape.width;
            x++
          )
            if (
              inBounds(next, { x, y }) &&
              Math.floor(y / 13) === Math.floor(point.y / 13)
            )
              next.tiles[y * next.width + x] = 1;
      } else if (tool === "wall" || tool === "erase") {
        next.objects = next.objects.filter(
          (o) => o.x !== point.x || o.y !== point.y,
        );
        if (tool === "wall" || !objectAt(this.dungeon, point))
          next.tiles[point.y * next.width + point.x] = 0;
      } else {
        if (!isFloor(next, point)) throw new Error("editor.needsFloor");
        if (objectAt(next, point)) throw new Error("editor.occupied");
        if (tool === "entrance" || tool === "treasure")
          next.objects = next.objects.filter((o) => o.type !== tool);
        next.objects.push({
          id: crypto.randomUUID(),
          type: tool as Dungeon["objects"][number]["type"],
          ...point,
          rotation,
        });
      }
    });
  }
  rename(title: string): boolean {
    const clean = title.trim().slice(0, 60);
    if (!clean) throw new Error("editor.emptyTitle");
    return this.commit((d) => {
      d.title = clean;
    });
  }
  upgrade(): boolean {
    return this.commit((d) => {
      d.schemaVersion = 2;
      d.rules ??= [];
      d.build ??= "warrior";
    });
  }
  settings(theme: Theme, build: AdventurerBuild): boolean {
    return this.commit((d) => {
      d.schemaVersion = 2;
      d.rules ??= [];
      d.theme = theme;
      d.build = build;
    });
  }
  addFloor(): boolean {
    return this.commit((d) => {
      if (d.height >= 52) throw new Error("editor.maxFloors");
      d.schemaVersion = 2;
      d.rules ??= [];
      d.height += 13;
      d.budget += 160;
      d.tiles.push(...Array<number>(195).fill(0));
    });
  }
  configure(id: string, config: ObjectConfig): boolean {
    return this.commit((d) => {
      const object = d.objects.find((o) => o.id === id);
      if (!object) return;
      d.schemaVersion = 2;
      d.rules ??= [];
      object.config = parseConfig(config, d);
    });
  }
  rules(rules: LogicRule[]): boolean {
    return this.commit((d) => {
      d.schemaVersion = 2;
      d.rules = parseRules(rules, d);
    });
  }
  remove(ids: string[]): boolean {
    return this.commit((d) => {
      d.objects = d.objects.filter((o) => !ids.includes(o.id));
    });
  }
  rotate(ids: string[]): boolean {
    return this.commit((d) => {
      for (const o of d.objects)
        if (ids.includes(o.id)) o.rotation = (o.rotation + 1) % 4;
    });
  }
  copy(ids: string[]): { objects: Dungeon["objects"]; rules: LogicRule[] } {
    return clone({
      objects: this.dungeon.objects.filter((o) => ids.includes(o.id)),
      rules: (this.dungeon.rules ?? []).filter(
        (r) => ids.includes(r.source) && ids.includes(r.target),
      ),
    });
  }
  paste(clipboard: ReturnType<Editor["copy"]>, point: Point): boolean {
    if (!clipboard.objects.length) return false;
    return this.commit((d) => {
      if (
        clipboard.objects.some(
          (o) =>
            ["entrance", "treasure"].includes(o.type) &&
            d.objects.some((v) => v.type === o.type),
        )
      )
        throw new Error("editor.unique");
      const origin = {
        x: Math.min(...clipboard.objects.map((o) => o.x)),
        y: Math.min(...clipboard.objects.map((o) => o.y)),
      };
      const ids = new Map(
        clipboard.objects.map((o) => [o.id, crypto.randomUUID()]),
      );
      const objects = clone(clipboard.objects).map((o) => ({
        ...o,
        id: ids.get(o.id)!,
        x: o.x - origin.x + point.x,
        y: o.y - origin.y + point.y,
      }));
      for (const o of objects) {
        if (!isFloor(d, o)) throw new Error("editor.needsFloor");
        if (objectAt(d, o)) throw new Error("editor.occupied");
        if (o.config?.target)
          o.config.target = ids.get(o.config.target) ?? o.config.target;
        if (o.config?.patrol) {
          o.config.patrol = o.config.patrol.map((p) => ({
            x: p.x - origin.x + point.x,
            y: p.y - origin.y + point.y,
          }));
          if (
            o.config.patrol.some(
              (p) =>
                !isFloor(d, p) || Math.floor(p.y / 13) !== Math.floor(o.y / 13),
            )
          )
            throw new Error("editor.needsFloor");
        }
      }
      d.objects.push(...objects);
      if (
        clipboard.rules.length ||
        objects.some(
          (o) =>
            o.config ||
            ![
              "entrance",
              "treasure",
              "key",
              "door",
              "spikes",
              "fire",
              "skeleton",
              "archer",
              "slime",
              "guardian",
              "potion",
            ].includes(o.type),
        )
      ) {
        d.schemaVersion = 2;
        d.rules ??= [];
      }
      if (clipboard.rules.length)
        d.rules!.push(
          ...clipboard.rules.map((r) => ({
            ...clone(r),
            id: crypto.randomUUID(),
            source: ids.get(r.source)!,
            target: ids.get(r.target)!,
          })),
        );
    });
  }
  mirror(ids: string[], axis: "horizontal" | "vertical"): boolean {
    return this.commit((d) => {
      const selected = d.objects.filter((o) => ids.includes(o.id));
      if (!selected.length) return;
      const coordinate = axis === "horizontal" ? "x" : "y";
      const sum =
        Math.min(...selected.map((o) => o[coordinate])) +
        Math.max(...selected.map((o) => o[coordinate]));
      for (const o of selected) {
        o[coordinate] = sum - o[coordinate];
        if (o.config?.patrol) {
          o.config.patrol = o.config.patrol.map((p) => ({
            ...p,
            [coordinate]: sum - p[coordinate],
          }));
          if (
            o.config.patrol.some(
              (p) =>
                !isFloor(d, p) || Math.floor(p.y / 13) !== Math.floor(o.y / 13),
            )
          )
            throw new Error("editor.needsFloor");
        }
        o.rotation =
          axis === "horizontal"
            ? (4 - o.rotation) % 4
            : (2 - o.rotation + 4) % 4;
      }
      for (const o of selected) {
        if (!isFloor(d, o)) throw new Error("editor.needsFloor");
        if (
          d.objects.some(
            (v) => !ids.includes(v.id) && v.x === o.x && v.y === o.y,
          )
        )
          throw new Error("editor.occupied");
      }
    });
  }
  move(ids: string[], offset: Point, duplicate = false): boolean {
    if (duplicate) {
      const clipboard = this.copy(ids);
      if (!clipboard.objects.length) return false;
      return this.paste(clipboard, {
        x: Math.min(...clipboard.objects.map((o) => o.x)) + offset.x,
        y: Math.min(...clipboard.objects.map((o) => o.y)) + offset.y,
      });
    }
    return this.commit((d) => {
      const sources = d.objects.filter((o) => ids.includes(o.id));
      if (
        duplicate &&
        sources.some(
          (o) =>
            CONTENT[o.type].behavior === "spawn" ||
            CONTENT[o.type].behavior === "goal",
        )
      )
        throw new Error("editor.unique");
      const targets = sources.map((o) => ({
        ...o,
        x: o.x + offset.x,
        y: o.y + offset.y,
        id: duplicate ? crypto.randomUUID() : o.id,
      }));
      for (const t of targets) {
        if (!isFloor(d, t)) throw new Error("editor.needsFloor");
        if (t.config?.patrol) {
          t.config.patrol = t.config.patrol.map((p) => ({
            x: p.x + offset.x,
            y: p.y + offset.y,
          }));
          if (
            t.config.patrol.some(
              (p) =>
                !isFloor(d, p) || Math.floor(p.y / 13) !== Math.floor(t.y / 13),
            )
          )
            throw new Error("editor.needsFloor");
        }
        if (
          d.objects.some(
            (o) =>
              (duplicate || !ids.includes(o.id)) && o.x === t.x && o.y === t.y,
          )
        )
          throw new Error("editor.occupied");
      }
      if (!duplicate) d.objects = d.objects.filter((o) => !ids.includes(o.id));
      d.objects.push(...targets);
    });
  }
  undo(): boolean {
    const previous = this.past.pop();
    if (!previous) return false;
    this.future.push(clone(this.dungeon));
    this.dungeon = previous;
    return true;
  }
  redo(): boolean {
    const next = this.future.pop();
    if (!next) return false;
    this.past.push(clone(this.dungeon));
    this.dungeon = next;
    return true;
  }
}
