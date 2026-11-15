/**
 * A run: ten nights defending one growing dungeon at a chosen depth, with an
 * optional endless descent into the abyss afterwards. Randomness only affects
 * what is offered (parties, drafts, maps) and is derived from the run seed.
 */
import { Rng } from "../engine/math";
import {
  ARCHITECTS,
  BASE_POOL,
  CHAMPIONS,
  DIG_COST,
  HEROES,
  HERO_DEPTH,
  MUTATORS,
  NIGHTS,
  PIECES,
  RELICS,
  T,
  TUNE,
  VEIN_GOLD,
  depthName,
  isChampion,
  type ArchitectId,
  type BiomeId,
  type ChampionId,
  type HeroClass,
  type MutatorId,
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
  v: 2;
  seed: number;
  biome: BiomeId;
  architect: ArchitectId;
  /** Dungeon depth, 1-based. Deeper is harder, without limit. */
  depth: number;
  mutators: MutatorId[];
  /** Champion who leads night ten. */
  boss: ChampionId;
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
  /** Past night ten: the run continues into the abyss until the hoard falls. */
  endless: boolean;
  /** Renown already granted (a victory banked before entering the abyss). */
  renownPaid: number;
  /** Tiles the player dug this run. */
  dug: number;
  /** Draft rerolls bought this run. */
  rerolls: number;
  /** Renown for this run has been paid out (legend screen pending). */
  settled?: boolean;
  /** Renown shown on the last legend screen (stable across reloads). */
  lastPaid?: number;
  /** Workshop sandbox: unlimited gold and space. */
  workshop?: boolean;
}

export const HERO_ARRIVAL: Record<HeroClass, number> = {
  knight: 1,
  rogue: 2,
  cleric: 3,
  ranger: 3,
  mage: 4,
  dwarf: 5,
  bard: 5,
  berserker: 6,
  windcaller: 6,
  inquisitor: 7,
  paladin: 10,
  archmage: 10,
  warlord: 10,
};

// ---------------- depths ----------------
export interface DepthInfo {
  depth: number;
  name: string;
  boss: ChampionId;
  mutators: MutatorId[];
}

/** Deterministic identity of a depth: its name, champion and mutators. */
export function depthInfo(depth: number): DepthInfo {
  const d = Math.max(1, Math.floor(depth));
  const rng = new Rng((Math.imul(d, 0x2c1b3c6d) ^ 0x51ed270b) >>> 0);
  const count = d <= 1 ? 0 : d <= 4 ? 1 : d <= 8 ? 2 : d <= 15 ? 3 : 4;
  const eligible = (Object.keys(MUTATORS) as MutatorId[]).filter(
    (m) => MUTATORS[m].from <= d,
  );
  const bad = rng.shuffle(eligible.filter((m) => !MUTATORS[m].good));
  const good = rng.shuffle(eligible.filter((m) => MUTATORS[m].good));
  const mutators: MutatorId[] = [];
  // Roughly one depth in three softens the blow with a blessing.
  const withGood = count > 0 && good.length > 0 && rng.chance(0.35);
  for (const m of bad) {
    if (mutators.length >= count - (withGood ? 1 : 0)) break;
    mutators.push(m);
  }
  if (withGood) mutators.push(good[0]);
  return {
    depth: d,
    name: depthName(d),
    boss: CHAMPIONS[(d - 1) % CHAMPIONS.length],
    mutators,
  };
}

/** Difficulty that stacks with depth (the first eight steps are fixed). */
export function heatFor(depth: number) {
  const over = Math.max(0, depth - 8);
  return {
    hpMul: (depth >= 2 ? 1.15 : 1) * (1 + 0.07 * over),
    dmgMul: 1 + 0.04 * over,
    partyBonus: (depth >= 3 ? 3 : 0) + 0.8 * over,
    goldPenalty: depth >= 4 ? 30 : 0,
    moreElites: depth >= 5,
    hoardPenalty: depth >= 6 ? 3 : 0,
    speed: depth >= 7 ? 1.1 : 1,
    honorGuard: depth >= 8 ? 6 + over : 0,
  };
}

/** x^n by repeated multiplication, so every device agrees bit for bit. */
function powi(x: number, n: number) {
  let r = 1;
  for (let i = 0; i < n; i++) r *= x;
  return r;
}

const has = (run: Pick<RunState, "mutators">, m: MutatorId) =>
  run.mutators.includes(m);

export function newRun(opts: {
  seed: number;
  biome: BiomeId;
  architect: ArchitectId;
  depth: number;
  daily?: string | null;
  powers: PowerId[];
}): RunState {
  const arch = ARCHITECTS.find((a) => a.id === opts.architect) ?? ARCHITECTS[0];
  const info = depthInfo(opts.depth);
  const heat = heatFor(info.depth);
  const mutators = info.mutators;
  const layout = generateLayout(opts.seed, opts.biome, {
    veins: mutators.includes("gilded") ? 2 : 1,
    variant: info.depth >= 2 ? opts.seed : undefined,
  });
  let gold = TUNE.startGold;
  if (arch.id === "mason") gold += TUNE.masonGold;
  gold -= heat.goldPenalty;
  const hoard = 12 - heat.hoardPenalty + (mutators.includes("ancient") ? 4 : 0);
  const owned = [...arch.start];
  if (mutators.includes("armory")) {
    const rng = new Rng(opts.seed ^ 0x5bd1e995);
    const extra = BASE_POOL.filter((p) => !owned.includes(p));
    owned.push(rng.pick(extra));
  }
  const run: RunState = {
    v: 2,
    seed: opts.seed,
    biome: opts.biome,
    architect: arch.id,
    depth: info.depth,
    mutators,
    boss: info.boss,
    daily: opts.daily ?? null,
    night: 1,
    phase: "build",
    gold,
    hoard,
    hoardMax: hoard,
    layout,
    owned,
    tiers: {},
    relics: arch.id === "lich" ? ["restless"] : [],
    powers: opts.powers,
    draft: null,
    history: [],
    victory: null,
    fresh: [],
    endless: false,
    renownPaid: 0,
    dug: 0,
    rerolls: 0,
  };
  // A first trap on the starter tunnel so night one teaches itself.
  const spot = firstTunnelTile(layout, 4);
  if (spot) {
    const firstTrap =
      arch.start.find((p) => p === "spikes") ??
      arch.start.find((p) => PIECES[p].kind === "trap" && p !== "lure") ??
      arch.start[0];
    layout.objects.push({
      id: layout.nextId++,
      kind: firstTrap,
      x: spot.x,
      y: spot.y,
      dir: 2,
    });
  }
  return run;
}

/** Upgrade a saved run from an older version of the game. */
export function migrateRun(raw: unknown): RunState | null {
  const r = raw as Omit<Partial<RunState>, "v"> & {
    v?: number;
    infamy?: number;
  };
  if (!r || typeof r !== "object") return null;
  if (r.v === 2) return r as RunState;
  if (r.v !== 1) return null;
  const depth = (r.infamy ?? 0) + 1;
  const out = {
    ...r,
    v: 2,
    depth,
    mutators: [],
    boss: "paladin",
    endless: false,
    renownPaid: 0,
    // Tunnels dug before the update aren't known: not eligible for "noDig".
    dug: 1,
    rerolls: 0,
  } as RunState & { infamy?: number };
  delete out.infamy;
  return out;
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
  if (run.architect === "beastmaster" && def.kind === "monster")
    c = Math.round(c * 0.85);
  return c;
}
export function digCost(run: Pick<RunState, "relics" | "mutators">) {
  if (run.relics.includes("deepRoots")) return 0;
  return run.mutators?.includes("hardRock") ? DIG_COST * 3 : DIG_COST;
}
export function veinGold(run: Pick<RunState, "mutators">) {
  return run.mutators?.includes("gilded")
    ? Math.round(VEIN_GOLD * 1.5)
    : VEIN_GOLD;
}

/** Nights past ten are abyss nights. */
export const abyssDepth = (n: number) => Math.max(0, n - NIGHTS);

export function raidMods(
  run: Pick<
    RunState,
    "night" | "depth" | "mutators" | "architect" | "relics" | "tiers"
  >,
): RaidMods {
  const n = run.night;
  const heat = heatFor(run.depth);
  const a = abyssDepth(n);
  let heroHp =
    (1 + TUNE.hpPerNight * (Math.min(n, NIGHTS) - 1)) *
    heat.hpMul *
    powi(TUNE.abyssHp, a);
  if (has(run, "horde")) heroHp *= 0.85;
  return {
    heroHp,
    heroDmg:
      (1 + TUNE.dmgPerNight * (Math.min(n, NIGHTS) - 1)) *
      heat.dmgMul *
      powi(TUNE.abyssDmg, a),
    heroSpeed: heat.speed * (has(run, "haste") ? 1.12 : 1),
    monsterHp: run.architect === "lich" ? 1.25 : 1,
    monsterDmg: run.architect === "beastmaster" ? 1.15 : 1,
    arch: run.architect,
    mutators: run.mutators,
    relics: run.relics,
    tiers: run.tiers,
  };
}

export function isEliteNight(
  run: Pick<RunState, "depth" | "mutators">,
  n: number,
) {
  if (n > NIGHTS) return true;
  if (n === 4 || n === 7) return true;
  if (has(run, "bloodMoon") && n >= 3 && n < NIGHTS) return true;
  return heatFor(run.depth).moreElites && (n === 3 || n === 6 || n === 9);
}
/** Champion nights: the last night of a descent and every fifth abyss night. */
export function isChampionNight(n: number) {
  return n === NIGHTS || (n > NIGHTS && n % 5 === 0);
}
export function championFor(run: Pick<RunState, "boss">, n: number) {
  if (n <= NIGHTS) return run.boss;
  const start = CHAMPIONS.indexOf(run.boss);
  return CHAMPIONS[(start + (n - NIGHTS) / 5) % CHAMPIONS.length];
}

const ORDER: Record<HeroClass, number> = {
  paladin: 0,
  archmage: 0,
  warlord: 0,
  knight: 1,
  inquisitor: 2,
  berserker: 3,
  dwarf: 4,
  rogue: 5,
  ranger: 6,
  windcaller: 7,
  mage: 8,
  bard: 9,
  cleric: 10,
};
const MAX_PARTY = 10;

/** The party that will attack on night n. Deterministic per run seed. */
export function partyFor(
  run: Pick<RunState, "seed" | "depth" | "mutators" | "boss">,
  n: number,
): PartyMember[] {
  if (n === 1) return [{ cls: "knight" }];
  if (n === 2) return [{ cls: "knight" }, { cls: "rogue" }];
  const heat = heatFor(run.depth);
  const rng = new Rng((run.seed ^ Math.imul(n, 0x9e3779b1)) >>> 0);
  const abyss = n > NIGHTS;
  const avail = (Object.keys(HERO_ARRIVAL) as HeroClass[]).filter(
    (c) =>
      !isChampion(c) &&
      HERO_ARRIVAL[c] <= n &&
      (abyss || (HERO_DEPTH[c] ?? 1) <= run.depth),
  );
  let budget =
    TUNE.budgetBase +
    Math.min(n, NIGHTS - 1) * TUNE.budgetPerNight +
    heat.partyBonus;
  if (abyss) budget += Math.min(10, abyssDepth(n) * 0.7);
  if (has(run, "horde")) budget *= 1.3;
  const party: PartyMember[] = [];
  if (isChampionNight(n)) {
    party.push({ cls: championFor(run, n) });
    budget =
      10 +
      heat.honorGuard +
      (abyss ? 4 + abyssDepth(n) * 0.8 : 0) +
      (has(run, "horde") ? 3 : 0);
  } else {
    // Showcase each class on the night it first arrives.
    for (const debut of avail.filter((c) => HERO_ARRIVAL[c] === n)) {
      if (HEROES[debut].points > budget) continue;
      party.push({ cls: debut });
      budget -= HEROES[debut].points;
    }
  }
  let guard = 0;
  while (budget >= 3 && party.length < MAX_PARTY && guard++ < 60) {
    const count = (c: HeroClass) => party.filter((p) => p.cls === c).length;
    const options = avail.filter(
      (c) =>
        HEROES[c].points <= budget &&
        !(c === "cleric" && count("cleric") >= (n >= 7 ? 2 : 1)) &&
        !(c === "bard" && count("bard") >= (n >= 12 ? 2 : 1)),
    );
    if (!options.length) break;
    const c = rng.pick(options);
    party.push({ cls: c });
    budget -= HEROES[c].points;
  }
  if (isEliteNight(run, n) && party.length) {
    const elites = abyss ? 1 + Math.floor(abyssDepth(n) / 4) : 1;
    let made = 0;
    for (const p of party) {
      if (made >= elites) break;
      if (isChampion(p.cls) || p.cls === "cleric" || p.cls === "bard") continue;
      p.elite = true;
      made++;
    }
    if (!made) party[0].elite = !isChampion(party[0].cls);
  }
  // Marching order: front-liners first, healers and casters at the back.
  party.sort((a, b) => ORDER[a.cls] - ORDER[b.cls]);
  return party;
}

export function starsFor(r: RaidResult, stolenThisNight: number) {
  if (stolenThisNight > 0) return 0;
  if (r.escaped > 0) return 1;
  if (r.touchedHoard) return 2;
  return 3;
}

export function dawnIncome(
  run: Pick<RunState, "night" | "relics" | "mutators">,
  stars: number,
) {
  let base =
    TUNE.tributeBase +
    TUNE.tributePerNight * run.night +
    stars * TUNE.tributePerStar;
  if (has(run, "famine")) base = Math.round(base * 0.75);
  return base + (run.relics.includes("goldRush") ? 10 : 0);
}
/** Royal Treasury: interest on the gold saved going into the night. */
export function interestFor(run: Pick<RunState, "relics">, saved: number) {
  if (!run.relics.includes("treasury")) return 0;
  return Math.min(20, Math.floor(Math.max(0, saved) / 8));
}

const RARITY_WEIGHT = { common: 4, rare: 2, legendary: 1 } as const;
export function rerollCost(run: Pick<RunState, "rerolls">) {
  return 10 + run.rerolls * 10;
}

export function draftFor(
  run: RunState,
  unlockedPool: PieceId[],
  salt = run.rerolls,
): Card[] {
  const rng = new Rng(
    (run.seed ^
      Math.imul(run.night + 101, 0x85ebca6b) ^
      Math.imul(salt, 0x27d4eb2f)) >>>
      0,
  );
  const pool = [...new Set([...BASE_POOL, ...unlockedPool])].filter(
    (p) => !run.owned.includes(p),
  );
  const tierable = run.owned.filter(
    (p) => p !== "lure" && (run.tiers[p] ?? 1) < DRAFT_TIER_MAX,
  );
  const relics = (Object.keys(RELICS) as RelicId[]).filter(
    (r) => !run.relics.includes(r),
  );
  const pickRelic = () => {
    let total = 0;
    for (const r of relics) total += RARITY_WEIGHT[RELICS[r].rarity];
    let roll = rng.next() * total;
    for (const r of relics) {
      roll -= RARITY_WEIGHT[RELICS[r].rarity];
      if (roll < 0) return r;
    }
    return relics[relics.length - 1];
  };
  const cards: Card[] = [];
  const hasCard = (c: Card) =>
    cards.some((x) => x.type === c.type && x.id === c.id);
  const add = (c: Card | null) => {
    if (c && !hasCard(c)) cards.push(c);
  };
  if (pool.length) add({ type: "piece", id: rng.pick(pool) });
  for (let i = 0; i < 8 && cards.length < 2; i++) {
    const roll = rng.next();
    if (roll < 0.5 && pool.length) add({ type: "piece", id: rng.pick(pool) });
    else if (tierable.length) add({ type: "tier", id: rng.pick(tierable) });
  }
  for (let i = 0; i < 8 && cards.length < 3; i++) {
    const roll = rng.next();
    if (roll < 0.6 && relics.length) add({ type: "relic", id: pickRelic() });
    else if (tierable.length) add({ type: "tier", id: rng.pick(tierable) });
    else if (pool.length) add({ type: "piece", id: rng.pick(pool) });
  }
  return cards;
}

export function applyCard(run: RunState, c: Card) {
  if (c.type === "piece") {
    if (!run.owned.includes(c.id)) run.owned.push(c.id);
  } else if (c.type === "tier")
    run.tiers[c.id] = Math.min(TIER_MAX, (run.tiers[c.id] ?? 1) + 1);
  else {
    if (run.relics.includes(c.id)) return;
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
  | "gold"
  | "occupied"
  | "rock"
  | "blocked"
  | "protected"
  | "floor"
  | "full"
  | "none";

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
  run.dug = (run.dug ?? 0) + 1;
  const g = vein ? veinGold(run) : 0;
  run.gold += g;
  return g;
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
    (x === l.hoard.x && y === l.hoard.y)
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
  if (l.objects.length >= capacityFor(run)) return "full";
  if (run.gold < pieceCost(run, id)) return "gold";
  return null;
}

/** How many pieces the dungeon can hold tonight. */
export function capacityFor(
  run: Pick<RunState, "night" | "relics" | "workshop">,
) {
  if (run.workshop) return Infinity;
  const n = run.night;
  return (
    TUNE.capBase +
    TUNE.capPerNight * Math.min(n, NIGHTS) +
    Math.min(10, Math.max(0, n - NIGHTS)) +
    (run.relics.includes("sprawl") ? 4 : 0)
  );
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
  return run.fresh.includes(objId) || run.relics.includes("miser")
    ? c
    : Math.floor(c * 0.75);
}
export function sell(run: RunState, objId: number) {
  const v = sellValue(run, objId);
  run.layout.objects = run.layout.objects.filter((o) => o.id !== objId);
  run.fresh = run.fresh.filter((id) => id !== objId);
  run.gold += v;
  return v;
}

/** Total renown a run is worth so far (callers subtract what was paid). */
export function renownFor(run: RunState) {
  const descent = run.history.filter((h) => h.night <= NIGHTS);
  const abyss = run.history.filter((h) => h.night > NIGHTS);
  const stars = descent.reduce((a, h) => a + h.stars, 0);
  const won = run.victory || run.endless;
  let total = descent.length + stars + (won ? 12 + (run.depth - 1) * 4 : 0);
  for (const h of abyss) total += 2 + h.stars;
  return total;
}

/** Display name for the run's dungeon. */
export const runTitle = (run: Pick<RunState, "depth">) =>
  `${depthName(run.depth)} · Depth ${run.depth}`;

// ---------- reinforcing (the late-game gold sink) ----------
/** Highest tier from drafts; reinforcing with gold can go further. */
export const DRAFT_TIER_MAX = 3;
export const TIER_MAX = 5;
export function reinforceCost(
  run: Pick<RunState, "architect" | "tiers">,
  id: PieceId,
) {
  // Bait chests have no power to raise.
  if (id === "lure") return null;
  const tier = run.tiers[id] ?? 1;
  if (tier >= TIER_MAX) return null;
  return Math.round(pieceCost(run, id) * TUNE.reinforce * tier);
}
export function reinforce(run: RunState, id: PieceId) {
  const c = reinforceCost(run, id);
  if (c === null || run.gold < c) return false;
  run.gold -= c;
  run.tiers[id] = (run.tiers[id] ?? 1) + 1;
  return true;
}
