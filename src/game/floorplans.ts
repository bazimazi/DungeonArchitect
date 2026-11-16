/**
 * Floorplans: the shape of a dungeon before the architect touches it. Every
 * depth has one (see `depthInfo`), so the endless ladder isn't one map with
 * harder heroes but a series of places that each ask a different question.
 *
 * A carver fills the interior of a bedrock-framed grid with rock, floor,
 * bedrock and veins, and returns where the stairs and the hoard are. The run
 * seed only varies details (mirroring, offsets), so a depth keeps its plan.
 */
import type { Rng } from "../engine/math";
import { T, type FloorplanId } from "./defs";

export interface Carve {
  w: number;
  h: number;
  tiles: number[];
  rng: Rng;
  /** Set an interior tile (the frame is never touched). */
  set(x: number, y: number, t: number): void;
  get(x: number, y: number): number;
}
export interface Carved {
  entrance: { x: number; y: number };
  hoard: { x: number; y: number };
  /** Multiplies the biome's bedrock pillars (open plans want fewer). */
  pillars?: number;
  /** Multiplies the biome's gold veins. */
  veins?: number;
}

const F = T.Floor;
const B = T.Bedrock;
const V = T.Vein;

function rect(c: Carve, x0: number, y0: number, x1: number, y1: number, t = F) {
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) c.set(x, y, t);
}
const hline = (c: Carve, x0: number, x1: number, y: number, t = F) =>
  rect(c, x0, y, x1, y, t);
const vline = (c: Carve, x: number, y0: number, y1: number, t = F) =>
  rect(c, x, y0, x, y1, t);
/** Hoard chamber: the 3×3 room around the hoard. */
const chamber = (c: Carve, x: number, y: number) =>
  rect(c, x - 1, y - 1, x + 1, y + 1);
/** Stairs on the top row plus the first step below them. */
function stairs(c: Carve, x: number) {
  c.tiles[x] = F;
  c.set(x, 1, F);
  return { x, y: 0 };
}

/** The original cellars: down, a jog, a small hall, then the hoard. */
function cellar(c: Carve, variant: Rng | null): Carved {
  const { w, h, rng } = c;
  let ex = 5;
  let hx0 = 5;
  if (variant) {
    ex = variant.pick([3, 5, 7]);
    hx0 = variant.pick([3, 5, 7]);
  }
  const entrance = stairs(c, ex);
  const hoard = { x: hx0, y: h - 3 };
  chamber(c, hoard.x, hoard.y);
  let side = rng.chance(0.5) ? -1 : 1;
  const jog = rng.int(2, 3);
  if (ex + side * jog < 2 || ex + side * jog > w - 3) side = -side;
  const jx = ex + side * jog;
  vline(c, ex, 1, 3);
  hline(c, ex, jx, 3);
  vline(c, jx, 3, 6);
  const hx = Math.max(2, Math.min(w - 4, jx - 1));
  rect(c, hx, 6, hx + 2, 8);
  const cx = hx + 1;
  vline(c, cx, 8, hoard.y - 1);
  hline(c, cx, hoard.x, hoard.y - 1);
  return { entrance, hoard };
}

/** One long straight hall from the stairs to the hoard. */
function gallery(c: Carve): Carved {
  const ex = c.rng.pick([3, 5, 7]);
  const entrance = stairs(c, ex);
  const hoard = { x: ex, y: c.h - 3 };
  chamber(c, hoard.x, hoard.y);
  vline(c, ex, 1, hoard.y);
  // Masonry buttresses along the hall keep it from being widened everywhere.
  for (let y = 3; y <= 9; y += 3) {
    c.set(ex - 1, y, B);
    c.set(ex + 1, y, B);
  }
  return { entrance, hoard, pillars: 0.5 };
}

/** The stairs split into two tunnels that meet again at the hoard. */
function fork(c: Carve): Carved {
  const { h, rng } = c;
  const entrance = stairs(c, 5);
  const hoard = { x: 5, y: h - 3 };
  chamber(c, hoard.x, hoard.y);
  const left = rng.pick([1, 2]);
  const right = 10 - rng.pick([1, 2]);
  const top = rng.pick([2, 3]);
  vline(c, 5, 1, top);
  hline(c, left, right, top);
  vline(c, left, top, 10);
  vline(c, right, top, 10);
  hline(c, left, right, 10);
  // A spine of bedrock between the tunnels: they can't simply be merged.
  vline(c, 5, top + 2, 8, B);
  return { entrance, hoard, pillars: 0.5 };
}

/** A great pillared hall between the stairs and the hoard. */
function pillars(c: Carve): Carved {
  const ex = c.rng.pick([3, 5, 7]);
  const hx = c.rng.pick([3, 5, 7]);
  const entrance = stairs(c, ex);
  const hoard = { x: hx, y: c.h - 3 };
  chamber(c, hoard.x, hoard.y);
  vline(c, ex, 1, 3);
  rect(c, 2, 4, 8, 9);
  for (let y = 5; y <= 8; y += 3)
    for (let x = 3; x <= 7; x += 2) c.set(x, y, B);
  vline(c, hx, 9, hoard.y);
  return { entrance, hoard, pillars: 0, veins: 0.8 };
}

/** Ancient masonry walls, each pierced by a single gap. */
function labyrinth(c: Carve): Carved {
  const { h, rng } = c;
  const flip = rng.chance(0.5);
  const fx = (x: number) => (flip ? 10 - x : x);
  const entrance = stairs(c, fx(3));
  const hoard = { x: fx(6), y: h - 3 };
  // Walls at rows 4 and 9; gaps at opposite ends force a switchback.
  hline(c, 1, 9, 4, B);
  hline(c, 1, 9, 9, B);
  c.set(fx(8), 4, F);
  c.set(fx(2), 9, F);
  vline(c, fx(3), 1, 3);
  hline(c, fx(3), fx(8), 3);
  vline(c, fx(8), 3, 6);
  hline(c, fx(2), fx(8), 6);
  vline(c, fx(2), 6, 10);
  hline(c, fx(2), fx(6), 10);
  chamber(c, hoard.x, hoard.y);
  return { entrance, hoard, pillars: 0.3 };
}

/** The hoard sits in a sealed vault whose only door faces away. */
function vault(c: Carve): Carved {
  const { rng } = c;
  const flip = rng.chance(0.5);
  const fx = (x: number) => (flip ? 10 - x : x);
  const entrance = stairs(c, 5);
  const hoard = { x: 5, y: 7 };
  // Bedrock ring around the 3×3 vault, with a door at the bottom.
  rect(c, 3, 5, 7, 9, B);
  chamber(c, hoard.x, hoard.y);
  c.set(5, 9, F);
  vline(c, 5, 1, 2);
  hline(c, 5, fx(2), 2);
  vline(c, fx(2), 2, 11);
  hline(c, fx(2), 5, 11);
  vline(c, 5, 10, 11);
  return { entrance, hoard, pillars: 0.5 };
}

/** A bedrock wall across the map, crossed by two narrow gaps. */
function chasm(c: Carve): Carved {
  const { h, rng } = c;
  const ex = rng.pick([3, 5, 7]);
  const hx = rng.pick([3, 5, 7]);
  const entrance = stairs(c, ex);
  const hoard = { x: hx, y: h - 3 };
  chamber(c, hoard.x, hoard.y);
  const wy = rng.pick([6, 7]);
  hline(c, 1, 9, wy, B);
  hline(c, 1, 9, wy + 1, B);
  const gaps = [2, 8];
  for (const g of gaps) {
    c.set(g, wy, F);
    c.set(g, wy + 1, F);
  }
  const g = rng.pick(gaps);
  vline(c, ex, 1, wy - 2);
  hline(c, ex, g, wy - 2);
  vline(c, g, wy - 2, wy + 3);
  hline(c, g, hx, wy + 3);
  vline(c, hx, wy + 3, hoard.y);
  return { entrance, hoard, pillars: 0.4 };
}

/** Open natural caverns: little to dig and much to fill. */
function caves(c: Carve): Carved {
  const { w, h, rng } = c;
  const ex = rng.pick([3, 5, 7]);
  const hx = rng.pick([3, 5, 7]);
  // Cellular caves in the middle band.
  let open = new Set<number>();
  for (let y = 2; y <= h - 5; y++)
    for (let x = 1; x < w - 1; x++) if (rng.chance(0.47)) open.add(y * w + x);
  for (let it = 0; it < 3; it++) {
    const next = new Set<number>();
    for (let y = 2; y <= h - 5; y++)
      for (let x = 1; x < w - 1; x++) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++)
            if ((dx || dy) && open.has((y + dy) * w + x + dx)) n++;
        if (n >= 5 || (open.has(y * w + x) && n >= 4)) next.add(y * w + x);
      }
    open = next;
  }
  for (const k of open) c.set(k % w, Math.floor(k / w), F);
  const entrance = stairs(c, ex);
  const hoard = { x: hx, y: h - 3 };
  chamber(c, hoard.x, hoard.y);
  // A meandering walk guarantees the caves connect the stairs to the hoard.
  let x = ex;
  for (let y = 1; y < hoard.y; y++) {
    c.set(x, y, F);
    if (y % 2 === 0 && rng.chance(0.7)) {
      const nx = Math.max(1, Math.min(w - 2, x + rng.pick([-2, -1, 1, 2])));
      hline(c, x, nx, y);
      x = nx;
    }
  }
  hline(c, x, hoard.x, hoard.y - 1);
  return { entrance, hoard, pillars: 0.6, veins: 1.4 };
}

/** Stairs in one corner, the hoard in the far other. */
function corner(c: Carve): Carved {
  const { h, rng } = c;
  const flip = rng.chance(0.5);
  const fx = (x: number) => (flip ? 10 - x : x);
  const entrance = stairs(c, fx(1));
  const hoard = { x: fx(8), y: h - 3 };
  chamber(c, hoard.x, hoard.y);
  vline(c, fx(1), 1, 4);
  hline(c, fx(1), fx(4), 4);
  vline(c, fx(4), 4, 8);
  hline(c, fx(4), fx(8), 8);
  vline(c, fx(8), 8, hoard.y);
  return { entrance, hoard };
}

/** Abandoned shafts lined with gold, joined by ladders that switch sides. */
function mine(c: Carve): Carved {
  const { h, rng } = c;
  const ex = rng.pick([4, 5, 6]);
  const side = rng.chance(0.5) ? -1 : 1;
  const xa = Math.max(2, Math.min(8, ex + side * 3));
  const xb = Math.max(2, Math.min(8, ex - side * 3));
  const entrance = stairs(c, ex);
  const hoard = { x: ex, y: h - 3 };
  chamber(c, hoard.x, hoard.y);
  for (const y of [3, 6, 9]) hline(c, 2, 8, y);
  vline(c, ex, 1, 3);
  vline(c, xa, 3, 6);
  vline(c, xb, 6, 9);
  vline(c, ex, 9, hoard.y);
  // Gold seams line the shaft walls.
  for (const y of [3, 6, 9])
    for (let x = 2; x <= 8; x++)
      for (const sy of [y - 1, y + 1])
        if (c.get(x, sy) === T.Rock && rng.chance(0.22)) c.set(x, sy, V);
  return { entrance, hoard, veins: 0.4 };
}

/** A lord's hall: two galleries meet before a columned nave and the hoard. */
function throne(c: Carve): Carved {
  const { h } = c;
  const entrance = stairs(c, 5);
  const hoard = { x: 5, y: h - 3 };
  vline(c, 5, 1, 2);
  hline(c, 2, 8, 2);
  vline(c, 2, 2, 7);
  vline(c, 8, 2, 7);
  hline(c, 2, 8, 7);
  // A masonry spine between the galleries, and the nave's columns.
  vline(c, 5, 3, 6, B);
  rect(c, 3, 8, 7, 12);
  c.set(3, 9, B);
  c.set(7, 9, B);
  c.set(3, 11, B);
  c.set(7, 11, B);
  return { entrance, hoard, pillars: 0.4 };
}

export const CARVERS: Record<
  FloorplanId,
  (c: Carve, variant: Rng | null) => Carved
> = {
  cellar,
  gallery,
  fork,
  pillars,
  labyrinth,
  vault,
  chasm,
  caves,
  corner,
  mine,
  throne,
};
