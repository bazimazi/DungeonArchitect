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
      if (tool === "room" || tool === "floor") {
        const radius = tool === "room" ? 1 : 0;
        for (let y = point.y - radius; y <= point.y + radius; y++)
          for (let x = point.x - radius; x <= point.x + radius; x++)
            if (inBounds(next, { x, y })) next.tiles[y * next.width + x] = 1;
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
          type: tool,
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
  move(ids: string[], offset: Point, duplicate = false): boolean {
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
