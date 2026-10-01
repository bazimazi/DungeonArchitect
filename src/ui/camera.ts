import type { Dungeon, RunState } from "../core/types";
import { identifyRooms } from "../core/rooms";
import { pointKey } from "../core/types";
const cache = new WeakMap<
  Dungeon,
  Map<string, { x: number; y: number; span: number }>
>();

/** Presentation framing is derived from immutable geometry and replay state. */
export function cameraFrame(
  dungeon: Dungeon,
  state: RunState,
): { x: number; y: number; zoom: number } {
  const p = state.player,
    cue = state.advanced?.camera;
  if (
    cue &&
    state.tick < cue.until &&
    Math.floor(cue.y / 13) === Math.floor(p.y / 13)
  )
    return { x: cue.x, y: cue.y, zoom: Math.min(2.5, 15 / cue.span) };
  let frames = cache.get(dungeon);
  if (!frames) {
    frames = new Map();
    const rooms = identifyRooms(dungeon),
      bounds = new Map<
        number,
        { left: number; right: number; top: number; bottom: number }
      >();
    for (const [key, room] of rooms) {
      const [x, y] = key.split(",").map(Number),
        b = bounds.get(room.id) ?? { left: x, right: x, top: y, bottom: y };
      b.left = Math.min(b.left, x);
      b.right = Math.max(b.right, x);
      b.top = Math.min(b.top, y);
      b.bottom = Math.max(b.bottom, y);
      bounds.set(room.id, b);
    }
    for (const [key, room] of rooms) {
      const b = bounds.get(room.id)!;
      frames.set(key, {
        x: (b.left + b.right) / 2,
        y: (b.top + b.bottom) / 2,
        span: Math.max(b.right - b.left + 1, b.bottom - b.top + 1),
      });
    }
    cache.set(dungeon, frames);
  }
  const room = frames.get(pointKey(p));
  return room
    ? {
        x: (room.x + p.x) / 2,
        y: (room.y + p.y) / 2,
        zoom: Math.max(1.12, Math.min(1.35, 15 / (room.span + 4))),
      }
    : { x: p.x, y: p.y, zoom: 1.12 };
}
