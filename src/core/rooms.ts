import type { Dungeon } from "./types";
import { pointKey } from "./types";
import { isFloor } from "./dungeon";

/** Chambers are connected open areas at least two tiles wide; narrow corridors remain separate. */
export function identifyRooms(
  dungeon: Dungeon,
): Map<string, { id: number; floor: number }> {
  const wide = new Set<string>();
  for (let y = 0; y < dungeon.height - 1; y++) {
    if (y % 13 === 12) continue;
    for (let x = 0; x < dungeon.width - 1; x++) {
      const cells = [
        { x, y },
        { x: x + 1, y },
        { x, y: y + 1 },
        { x: x + 1, y: y + 1 },
      ];
      if (cells.every((p) => isFloor(dungeon, p)))
        for (const p of cells) wide.add(pointKey(p));
    }
  }
  const rooms = new Map<string, { id: number; floor: number }>();
  let id = 0;
  for (const key of wide) {
    if (rooms.has(key)) continue;
    const [x, y] = key.split(",").map(Number),
      room = { id: ++id, floor: Math.floor(y / 13) + 1 },
      queue = [{ x, y }];
    rooms.set(key, room);
    for (let i = 0; i < queue.length; i++) {
      const p = queue[i];
      for (const q of [
        { x: p.x - 1, y: p.y },
        { x: p.x + 1, y: p.y },
        { x: p.x, y: p.y - 1 },
        { x: p.x, y: p.y + 1 },
      ]) {
        const next = pointKey(q);
        if (
          Math.floor(q.y / 13) + 1 === room.floor &&
          wide.has(next) &&
          !rooms.has(next)
        ) {
          rooms.set(next, room);
          queue.push(q);
        }
      }
    }
  }
  return rooms;
}

export const ROOM_TOOLS = {
  room: { name: "Small room", width: 3, height: 3 },
  "large-room": { name: "Large room", width: 5, height: 5 },
  hall: { name: "Hall", width: 7, height: 3 },
  chamber: { name: "Chamber", width: 5, height: 4 },
  arena: { name: "Arena", width: 7, height: 7 },
  "treasure-room": { name: "Treasure room", width: 4, height: 4 },
  "boss-room": { name: "Boss room", width: 7, height: 6 },
  "puzzle-room": { name: "Puzzle room", width: 5, height: 5 },
  "secret-room": { name: "Secret room", width: 3, height: 2 },
} as const;
export type RoomTool = keyof typeof ROOM_TOOLS;
