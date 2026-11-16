import { Rng } from "../engine/math";
import {
  BIOMES,
  DX,
  DY,
  MAP_H,
  MAP_W,
  T,
  type Biome,
  type FloorplanId,
  type PieceId,
} from "./defs";
import { CARVERS, type Carve } from "./floorplans";

export interface Placed {
  id: number;
  kind: PieceId;
  x: number;
  y: number;
  dir: number;
}
export interface Layout {
  w: number;
  h: number;
  tiles: number[];
  entrance: { x: number; y: number };
  hoard: { x: number; y: number };
  objects: Placed[];
  nextId: number;
}

export const idx = (l: { w: number }, x: number, y: number) => y * l.w + x;
export const inside = (l: { w: number; h: number }, x: number, y: number) =>
  x >= 0 && y >= 0 && x < l.w && y < l.h;
export const tileAt = (l: Layout, x: number, y: number) =>
  inside(l, x, y) ? l.tiles[idx(l, x, y)] : T.Bedrock;
export const walkable = (l: Layout, x: number, y: number) =>
  tileAt(l, x, y) === T.Floor;
export const diggable = (t: number) => t === T.Rock || t === T.Vein;
export const objectAt = (l: Layout, x: number, y: number) =>
  l.objects.find((o) => o.x === x && o.y === y);

export function cloneLayout(l: Layout): Layout {
  return {
    ...l,
    tiles: l.tiles.slice(),
    entrance: { ...l.entrance },
    hoard: { ...l.hoard },
    objects: l.objects.map((o) => ({ ...o })),
  };
}

/**
 * Dijkstra over walkable tiles. `extra(x,y)` adds cost (10 = one tile).
 * `rockCost` lets diggers consider tunnelling (Infinity = never).
 * Returns distance field from the target (so any unit can follow it).
 */
export function distanceField(
  l: Layout,
  tx: number,
  ty: number,
  extra?: (x: number, y: number) => number,
  rockCost = Infinity,
): Float64Array {
  const n = l.w * l.h;
  const d = new Float64Array(n).fill(Infinity);
  const start = idx(l, tx, ty);
  d[start] = 0;
  // Small binary heap keyed by distance; ties broken by index for determinism.
  const heap: number[] = [start];
  const less = (a: number, b: number) =>
    d[a] < d[b] || (d[a] === d[b] && a < b);
  const push = (v: number) => {
    heap.push(v);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(heap[i], heap[p])) break;
      [heap[i], heap[p]] = [heap[p], heap[i]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const a = 2 * i + 1;
        const b = a + 1;
        let m = i;
        if (a < heap.length && less(heap[a], heap[m])) m = a;
        if (b < heap.length && less(heap[b], heap[m])) m = b;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m], heap[i]];
        i = m;
      }
    }
    return top;
  };
  const done = new Uint8Array(n);
  while (heap.length) {
    const c = pop();
    if (done[c]) continue;
    done[c] = 1;
    const cx = c % l.w;
    const cy = (c - cx) / l.w;
    for (let k = 0; k < 4; k++) {
      const nx = cx + DX[k];
      const ny = cy + DY[k];
      if (!inside(l, nx, ny)) continue;
      const t = l.tiles[idx(l, nx, ny)];
      let step: number;
      if (t === T.Floor) step = 10;
      else if (diggable(t) && rockCost < Infinity) step = 10 + rockCost;
      else continue;
      // The field is reversed: a unit on (nx,ny) steps INTO (cx,cy), so the
      // danger of (cx,cy) is charged; rock cost is charged for tiles on the path.
      const add = extra ? extra(cx, cy) : 0;
      const nd = d[c] + step + add;
      const ni = idx(l, nx, ny);
      if (nd < d[ni]) {
        d[ni] = nd;
        push(ni);
      }
    }
  }
  return d;
}

/** Follow a distance field downhill from (x,y). Returns next tile or null. */
export function stepDown(
  l: Layout,
  field: Float64Array,
  x: number,
  y: number,
): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestD = field[idx(l, x, y)];
  for (let k = 0; k < 4; k++) {
    const nx = x + DX[k];
    const ny = y + DY[k];
    if (!inside(l, nx, ny)) continue;
    const v = field[idx(l, nx, ny)];
    if (v < bestD) {
      bestD = v;
      best = { x: nx, y: ny };
    }
  }
  return best;
}

export function pathTo(
  l: Layout,
  field: Float64Array,
  x: number,
  y: number,
  limit = 400,
): { x: number; y: number }[] {
  const out = [{ x, y }];
  let cur = { x, y };
  for (let i = 0; i < limit; i++) {
    const n = stepDown(l, field, cur.x, cur.y);
    if (!n) break;
    out.push(n);
    cur = n;
  }
  return out;
}

/** Integer line-of-sight through walkable tiles (Bresenham, deterministic). */
export function lineOfSight(
  l: Layout,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean {
  let x = Math.floor(x0);
  let y = Math.floor(y0);
  const tx = Math.floor(x1);
  const ty = Math.floor(y1);
  const dx = Math.abs(tx - x);
  const dy = -Math.abs(ty - y);
  const sx = x < tx ? 1 : -1;
  const sy = y < ty ? 1 : -1;
  let err = dx + dy;
  for (let i = 0; i < 64; i++) {
    if (!walkable(l, x, y)) return false;
    if (x === tx && y === ty) return true;
    const e2 = 2 * err;
    const stepX = e2 >= dy;
    const stepY = e2 <= dx;
    // A diagonal step may not squeeze between two blocked corners.
    if (stepX && stepY && (!walkable(l, x + sx, y) || !walkable(l, x, y + sy)))
      return false;
    if (stepX) {
      err += dy;
      x += sx;
    }
    if (stepY) {
      err += dx;
      y += sy;
    }
  }
  return false;
}

export function hasRoute(l: Layout): boolean {
  const f = distanceField(l, l.hoard.x, l.hoard.y);
  return f[idx(l, l.entrance.x, l.entrance.y)] < Infinity;
}

export function routeLength(l: Layout): number {
  const f = distanceField(l, l.hoard.x, l.hoard.y);
  const v = f[idx(l, l.entrance.x, l.entrance.y)];
  return v < Infinity ? Math.round(v / 10) : -1;
}

/** Procedural starting dungeon: bedrock frame, a floorplan, pillars and veins. */
export function generateLayout(
  seed: number,
  biome: Biome["id"],
  opts: { veins?: number; variant?: number; plan?: FloorplanId } = {},
): Layout {
  const rng = new Rng(seed);
  const b = BIOMES[biome];
  const w = MAP_W;
  const h = MAP_H;
  const tiles = new Array(w * h).fill(T.Rock);
  for (let x = 0; x < w; x++) {
    tiles[x] = T.Bedrock;
    tiles[(h - 1) * w + x] = T.Bedrock;
  }
  for (let y = 0; y < h; y++) {
    tiles[y * w] = T.Bedrock;
    tiles[y * w + w - 1] = T.Bedrock;
  }
  const carve: Carve = {
    w,
    h,
    tiles,
    rng,
    set: (x, y, t) => {
      if (x > 0 && y > 0 && x < w - 1 && y < h - 1) tiles[y * w + x] = t;
    },
    get: (x, y) => tiles[y * w + x],
  };
  const plan = opts.plan ?? "cellar";
  // Deeper dungeons move the stairs and the hoard around.
  const variant =
    opts.variant !== undefined
      ? new Rng((opts.variant ^ 0x3c6ef372) >>> 0)
      : null;
  const shape = CARVERS[plan](carve, variant);
  const { entrance, hoard } = shape;
  const l: Layout = { w, h, tiles, entrance, hoard, objects: [], nextId: 1 };

  // Bedrock pillars and gold veins in untouched rock only.
  const rockCells = () => {
    const out: number[] = [];
    for (let y = 2; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++)
        if (tiles[idx(l, x, y)] === T.Rock) out.push(idx(l, x, y));
    return out;
  };
  const cells = rng.shuffle(rockCells());
  let pillars = Math.round(b.pillars * (shape.pillars ?? 1));
  let veins = Math.round(b.veins * (opts.veins ?? 1) * (shape.veins ?? 1));
  for (const c of cells) {
    if (pillars > 0) {
      const x = c % w;
      const y = (c - x) / w;
      // Keep the area around the entrance and hoard clean.
      if (Math.abs(x - hoard.x) + Math.abs(y - hoard.y) < 4 || y < 2) continue;
      tiles[c] = T.Bedrock;
      pillars--;
    } else if (veins > 0) {
      tiles[c] = T.Vein;
      veins--;
    } else break;
  }
  return l;
}
