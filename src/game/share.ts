/**
 * Compact, versioned dungeon links. A static site has no server, so a
 * dungeon travels inside the URL hash: #raid=<base64url>.
 */
import {
  BIOME_IDS,
  MAP_H,
  MAP_W,
  PIECES,
  RULES_COMPAT,
  RULES_VERSION,
  T,
  type Biome,
  type PieceId,
} from "./defs";
import { hasRoute, idx, inside, type Layout } from "./grid";

/** Reject crafted or corrupted links that would produce a broken raid. */
function validLayout(l: Layout) {
  if (
    !inside(l, l.entrance.x, l.entrance.y) ||
    !inside(l, l.hoard.x, l.hoard.y)
  )
    return false;
  if (l.tiles.some((t) => t < T.Rock || t > T.Vein)) return false;
  if (
    l.tiles[idx(l, l.entrance.x, l.entrance.y)] !== T.Floor ||
    l.tiles[idx(l, l.hoard.x, l.hoard.y)] !== T.Floor
  )
    return false;
  const seen = new Set<number>();
  for (const o of l.objects) {
    if (!inside(l, o.x, o.y) || l.tiles[idx(l, o.x, o.y)] !== T.Floor)
      return false;
    if (
      (o.x === l.entrance.x && o.y === l.entrance.y) ||
      (o.x === l.hoard.x && o.y === l.hoard.y)
    )
      return false;
    const k = idx(l, o.x, o.y);
    if (seen.has(k)) return false;
    seen.add(k);
  }
  return hasRoute(l);
}

const KINDS = Object.keys(PIECES) as PieceId[];

export interface SharedDungeon {
  name: string;
  biome: Biome["id"];
  layout: Layout;
  tiers: Partial<Record<PieceId, number>>;
  /** Party points the raider may spend. */
  budget: number;
  /** Optional score posted by a previous raider ("beat my 2 treasure"). */
  rules: number;
}

function toB64(bytes: Uint8Array) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64(text: string) {
  const s = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function encodeDungeon(d: SharedDungeon): string {
  const l = d.layout;
  const bytes: number[] = [
    RULES_VERSION,
    BIOME_IDS.indexOf(d.biome),
    l.w,
    l.h,
    l.entrance.x,
    l.entrance.y,
    l.hoard.x,
    l.hoard.y,
    d.budget,
  ];
  // Tiles: 2 bits each.
  let acc = 0;
  let bits = 0;
  for (const t of l.tiles) {
    acc |= (t & 3) << bits;
    bits += 2;
    if (bits === 8) {
      bytes.push(acc);
      acc = 0;
      bits = 0;
    }
  }
  if (bits) bytes.push(acc);
  bytes.push(l.objects.length);
  for (const o of l.objects) {
    bytes.push(KINDS.indexOf(o.kind), o.x | (o.dir << 4), o.y);
  }
  const tierEntries = Object.entries(d.tiers).filter(
    ([, v]) => (v ?? 1) > 1,
  ) as [PieceId, number][];
  bytes.push(tierEntries.length);
  for (const [k, v] of tierEntries) bytes.push(KINDS.indexOf(k), v);
  const name = new TextEncoder().encode(d.name.slice(0, 24));
  bytes.push(name.length, ...name);
  return toB64(new Uint8Array(bytes));
}

export function decodeDungeon(code: string): SharedDungeon | null {
  try {
    const b = fromB64(code);
    let p = 0;
    const r = () => {
      if (p >= b.length) throw new Error("short");
      return b[p++];
    };
    const version = r();
    if (!RULES_COMPAT.includes(version)) return null;
    const biome = BIOME_IDS[r()] ?? "crypt";
    const w = r();
    const h = r();
    if (w !== MAP_W || h !== MAP_H) return null;
    const entrance = { x: r(), y: r() };
    const hoard = { x: r(), y: r() };
    const budget = r();
    const tiles: number[] = [];
    const n = w * h;
    while (tiles.length < n) {
      const byte = r();
      for (let i = 0; i < 4 && tiles.length < n; i++)
        tiles.push((byte >> (i * 2)) & 3);
    }
    const count = r();
    const objects = [];
    for (let i = 0; i < count; i++) {
      const kind = KINDS[r()];
      const xd = r();
      const y = r();
      if (!kind) return null;
      objects.push({ id: i + 1, kind, x: xd & 15, y, dir: (xd >> 4) & 3 });
    }
    const tiers: Partial<Record<PieceId, number>> = {};
    const tc = r();
    for (let i = 0; i < tc; i++) {
      const k = KINDS[r()];
      const v = r();
      if (k) tiers[k] = Math.min(5, Math.max(1, v));
    }
    const len = r();
    const name = new TextDecoder().decode(b.slice(p, p + len));
    const layout: Layout = {
      w,
      h,
      tiles,
      entrance,
      hoard,
      objects,
      nextId: count + 1,
    };
    if (!validLayout(layout) || budget < 3 || budget > 40) return null;
    return { name, biome, layout, tiers, budget, rules: version };
  } catch {
    return null;
  }
}

export function shareUrl(code: string) {
  const base = location.href.split("#")[0];
  return `${base}#raid=${code}`;
}
