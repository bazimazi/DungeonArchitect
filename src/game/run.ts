/**
 * A run: ten nights defending one growing dungeon. Randomness only affects
 * what is offered (parties, drafts, maps) and is derived from the run seed.
 */
import { Rng } from "../engine/math";
import {
  ARCHITECTS,
  BASE_POOL,
  DIG_COST,
  HEROES,
  NIGHTS,
  PIECES,
  RELICS,
  T,
  VEIN_GOLD,
  type ArchitectDef,
  type Biome,
  type HeroClass,
  type PieceId,
  type PowerId,
  type RelicId,
} from "./defs";
import {
  generateLayout,
  hasRoute,
  idx,
  inside,
  objectAt,
  type Layout,
} from "./grid";
import type { PartyMember, RaidMods, RaidResult } from "./sim";

export type Card =
  | { type: "piece"; id: PieceId }
  | { type: "tier"; id: PieceId }
  | { type: "relic"; id: RelicId };

export interface NightRecord {
  night: number;
  stars: number;
  killed: number;
  escaped: number;
  stolen: number;
  gold: number;
  combo: number;
}

export interface RunState {
  v: 1;
  seed: number;
  biome: Biome["id"];
  architect: ArchitectDef["id"];
  infamy: number;
  daily: string | null;
  night: number;
  phase: "build" | "draft" | "over";
  gold: number;
  hoard: number;
  hoardMax: number;
  layout: Layout;
  owned: PieceId[];
  tiers: Partial<Record<PieceId, number>>;
  relics: RelicId[];
  powers: PowerId[];
  draft: Card[] | null;
  history: NightRecord[];
  victory: boolean | null;
  /** Pieces placed this build phase (refunded in full when sold). */
  fresh: number[];
}

export const HERO_ARRIVAL: Record<HeroClass, number> = {
  knight: 1,
  rogue: 2,
  cleric: 3,
  ranger: 3,
  mage: 4,
  dwarf: 5,
  berserker: 6,
  paladin: 10,
};

export function newRun(opts: {
  seed: number;
  biome: Biome["id"];
  architect: ArchitectDef["id"];
  infamy: number;
  daily?: string | null;
  powers: PowerId[];
}): RunState {
  const arch = ARCHITECTS.find((a) => a.id === opts.architect) ?? ARCHITECTS[0];
  const layout = generateLayout(opts.seed, opts.biome);
  let gold = 110;
  if (arch.id === "mason") gold += 40;
  if (opts.infamy >= 3) gold -= 30;
  const hoard = opts.infamy >= 5 ? 9 : 12;
  const run: RunState = {
    v: 1,
    seed: opts.seed,
    biome: opts.biome,
    architect: arch.id,
    infamy: opts.infamy,
    daily: opts.daily ?? null,
    night: 1,
    phase: "build",
    gold,
    hoard,
    hoardMax: hoard,
    layout,
    owned: [...arch.start],
    tiers: {},
    relics: arch.id === "lich" ? ["restless"] : [],
    powers: opts.powers,
    draft: null,
    history: [],
    victory: null,
    fresh: [],
  };
  // A first spike plate on the starter tunnel so night one teaches itself.
  const spot = firstTunnelTile(layout, 4);
  if (spot) {
    layout.objects.push({
      id: layout.nextId++,
      kind: arch.start.includes("spikes") ? "spikes" : arch.start[0],
      x: spot.x,
      y: spot.y,
      dir: 2,
    });
  }
  return run;
}

function firstTunnelTile(l: Layout, depth: number) {
  // Walk the route from the entrance and return the tile `depth` steps in.
  let cur = { ...l.entrance };
  const seen = new Set<number>([idx(l, cur.x, cur.y)]);
  for (let i = 0; i < depth; i++) {
    let moved = false;
    for (const [dx, dy] of [
      [0, 1],
      [1, 0],
      [-1, 0],
      [0, -1],
    ]) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (
        !inside(l, nx, ny) ||
        l.tiles[idx(l, nx, ny)] !== T.Floor ||
        seen.has(idx(l, nx, ny))
      )
        continue;
      seen.add(idx(l, nx, ny));
      cur = { x: nx, y: ny };
      moved = true;
      break;
    }
    if (!moved) return null;
  }
  return cur;
}

export function pieceCost(run: Pick<RunState, "architect">, id: PieceId) {
  const def = PIECES[id];
  let c = def.cost;
  if (run.architect === "trickster" && def.kind === "trap")
    c = Math.round(c * 0.8);
  return c;
}
export function digCost(run: Pick<RunState, "relics">) {
  return run.relics.includes("deepRoots") ? 0 : DIG_COST;
}

export function raidMods(run: RunState): RaidMods {
  const n = run.night;
  let heroHp = 1 + 0.15 * (n - 1);
  if (run.infamy >= 1) heroHp *= 1.15;
  return {
    heroHp,
    heroDmg: 1 + 0.07 * (n - 1),
    heroSpeed: run.infamy >= 6 ? 1.1 : 1,
    monsterHp: run.architect === "lich" ? 1.25 : 1,
    relics: run.relics,
    tiers: run.tiers,
  };
}

export function isEliteNight(run: Pick<RunState, "infamy">, n: number) {
  if (n === 4 || n === 7) return true;
  return run.infamy >= 4 && (n === 3 || n === 6 || n === 9);
}

/** The party that will attack on night n. Deterministic per run seed. */
export function partyFor(
  run: Pick<RunState, "seed" | "infamy">,
  n: number,
): PartyMember[] {
  if (n === 1) return [{ cls: "knight" }];
  if (n === 2) return [{ cls: "knight" }, { cls: "rogue" }];
  const rng = new Rng((run.seed ^ Math.imul(n, 0x9e3779b1)) >>> 0);
  const avail = (Object.keys(HERO_ARRIVAL) as HeroClass[]).filter(
    (c) => c !== "paladin" && HERO_ARRIVAL[c] <= n,
  );
  let budget = 4 + n * 2.4 + (run.infamy >= 2 ? 3 : 0);
  const party: PartyMember[] = [];
  if (n === NIGHTS) {
    party.push({ cls: "paladin" });
    budget = 10 + (run.infamy >= 7 ? 6 : 0);
  } else {
    // Showcase a class on the night it first arrives.
    const debut = avail.find((c) => HERO_ARRIVAL[c] === n);
    if (debut) {
      party.push({ cls: debut });
      budget -= HEROES[debut].points;
    }
  }
  let guard = 0;
  while (budget >= 3 && guard++ < 50) {
    const healers = party.filter((p) => p.cls === "cleric").length;
    const options = avail.filter(
      (c) =>
        HEROES[c].points <= budget &&
        !(c === "cleric" && healers >= (n >= 7 ? 2 : 1)),
    );
    if (!options.length) break;
    const c = rng.pick(options);
    party.push({ cls: c });
    budget -= HEROES[c].points;
  }
  if (isEliteNight(run, n) && party.length) {
    const pick = party.findIndex(
      (p) => p.cls !== "paladin" && p.cls !== "cleric",
    );
    party[pick >= 0 ? pick : 0].elite = true;
  }
  // Marching order: front-liners first, healers and casters at the back.
  const order: Record<HeroClass, number> = {
    paladin: 0,
    knight: 1,
    berserker: 2,
    dwarf: 3,
    rogue: 4,
    ranger: 5,
    mage: 6,
    cleric: 7,
  };
  party.sort((a, b) => order[a.cls] - order[b.cls]);
  return party;
}

export function starsFor(r: RaidResult, stolenThisNight: number) {
  if (stolenThisNight > 0) return 0;
  if (r.escaped > 0) return 1;
  if (r.touchedHoard) return 2;
  return 3;
}

export function dawnIncome(run: RunState, stars: number) {
  return (
    38 + 5 * run.night + stars * 8 + (run.relics.includes("goldRush") ? 10 : 0)
  );
}

export function draftFor(run: RunState, unlockedPool: PieceId[]): Card[] {
  const rng = new Rng(
    (run.seed ^ Math.imul(run.night + 101, 0x85ebca6b)) >>> 0,
  );
  const pool = [...new Set([...BASE_POOL, ...unlockedPool])].filter(
    (p) => !run.owned.includes(p),
  );
  const tierable = run.owned.filter((p) => (run.tiers[p] ?? 1) < 3);
  const relics = (Object.keys(RELICS) as RelicId[]).filter(
    (r) => !run.relics.includes(r),
  );
  const cards: Card[] = [];
  const has = (c: Card) =>
    cards.some((x) => x.type === c.type && x.id === c.id);
  const add = (c: Card | null) => {
    if (c && !has(c)) cards.push(c);
  };
  if (pool.length) add({ type: "piece", id: rng.pick(pool) });
  for (let i = 0; i < 8 && cards.length < 2; i++) {
    const roll = rng.next();
    if (roll < 0.5 && pool.length) add({ type: "piece", id: rng.pick(pool) });
    else if (tierable.length) add({ type: "tier", id: rng.pick(tierable) });
  }
  for (let i = 0; i < 8 && cards.length < 3; i++) {
    const roll = rng.next();
    if (roll < 0.6 && relics.length)
      add({ type: "relic", id: rng.pick(relics) });
    else if (tierable.length) add({ type: "tier", id: rng.pick(tierable) });
    else if (pool.length) add({ type: "piece", id: rng.pick(pool) });
  }
  return cards;
}

export function applyCard(run: RunState, c: Card) {
  if (c.type === "piece") run.owned.push(c.id);
  else if (c.type === "tier")
    run.tiers[c.id] = Math.min(3, (run.tiers[c.id] ?? 1) + 1);
  else {
    run.relics.push(c.id);
    if (c.id === "hoardAges") {
      run.hoardMax += 4;
      run.hoard = Math.min(run.hoardMax, run.hoard + 4);
    }
    if (c.id === "goldRush") run.gold += 30;
  }
}

// ---------- building ----------
export type BuildError =
  "gold" | "occupied" | "rock" | "blocked" | "protected" | "floor" | "none";

export function canDig(run: RunState, x: number, y: number): BuildError | null {
  const l = run.layout;
  if (!inside(l, x, y)) return "protected";
  const t = l.tiles[idx(l, x, y)];
  if (t === T.Floor) return "floor";
  if (t === T.Bedrock) return "protected";
  if (run.gold < digCost(run)) return "gold";
  return null;
}
export function dig(run: RunState, x: number, y: number): number {
  const l = run.layout;
  const k = idx(l, x, y);
  const vein = l.tiles[k] === T.Vein;
  l.tiles[k] = T.Floor;
  run.gold -= digCost(run);
  if (vein) run.gold += VEIN_GOLD;
  return vein ? VEIN_GOLD : 0;
}
export function canFill(
  run: RunState,
  x: number,
  y: number,
): BuildError | null {
  const l = run.layout;
  if (!inside(l, x, y)) return "protected";
  if (l.tiles[idx(l, x, y)] !== T.Floor) return "rock";
  if (
    (x === l.entrance.x && y === l.entrance.y) ||
    (Math.abs(x - l.hoard.x) <= 0 && Math.abs(y - l.hoard.y) <= 0)
  )
    return "protected";
  if (objectAt(l, x, y)) return "occupied";
  l.tiles[idx(l, x, y)] = T.Rock;
  const ok = hasRoute(l);
  l.tiles[idx(l, x, y)] = T.Floor;
  return ok ? null : "blocked";
}
export function fill(run: RunState, x: number, y: number) {
  const l = run.layout;
  l.tiles[idx(l, x, y)] = T.Rock;
}
export function canPlace(
  run: RunState,
  id: PieceId,
  x: number,
  y: number,
): BuildError | null {
  const l = run.layout;
  if (!inside(l, x, y) || l.tiles[idx(l, x, y)] !== T.Floor) return "rock";
  if (x === l.entrance.x && y === l.entrance.y) return "protected";
  if (x === l.hoard.x && y === l.hoard.y) return "protected";
  if (objectAt(l, x, y)) return "occupied";
  if (run.gold < pieceCost(run, id)) return "gold";
  return null;
}
export function place(
  run: RunState,
  id: PieceId,
  x: number,
  y: number,
  dir: number,
) {
  const o = { id: run.layout.nextId++, kind: id, x, y, dir };
  run.layout.objects.push(o);
  run.gold -= pieceCost(run, id);
  run.fresh.push(o.id);
  return o;
}
export function sellValue(run: RunState, objId: number) {
  const o = run.layout.objects.find((q) => q.id === objId);
  if (!o) return 0;
  const c = pieceCost(run, o.kind);
  return run.fresh.includes(objId) ? c : Math.floor(c * 0.75);
}
export function sell(run: RunState, objId: number) {
  const v = sellValue(run, objId);
  run.layout.objects = run.layout.objects.filter((o) => o.id !== objId);
  run.gold += v;
  return v;
}

export function renownFor(run: RunState) {
  const nights = run.history.length;
  const stars = run.history.reduce((a, h) => a + h.stars, 0);
  return nights + stars + (run.victory ? 12 + run.infamy * 4 : 0);
}
