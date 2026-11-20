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
  CLASSIC_CHAMPIONS,
  DIG_COST,
  FLOORPLANS,
  HEROES,
  HERO_DEPTH,
  MUTATORS,
  NIGHTS,
  PIECES,
  REALM_LORDS,
  RELICS,
  T,
  TUNE,
  VEIN_GOLD,
  depthName,
  heatOf,
  heatRenown,
  isChampion,
  isLordDepth,
  realmName,
  realmOf,
  type ArchitectId,
  type BiomeId,
  type ChampionId,
  type FloorplanId,
  type HeroClass,
  type MutatorId,
  type OmenId,
  type PieceId,
  type PowerId,
  type RelicId,
} from "./defs";
import {
  distanceField,
  generateLayout,
  hasRoute,
  idx,
  inside,
  objectAt,
  pathTo,
  type Layout,
} from "./grid";
import type { PartyMember, RaidMods, RaidResult } from "./sim";
import { AFFIXES, AFFIX_IDS, type AffixId } from "./schools";
import { ALT_KITS } from "./progression";
import type { Encounter } from "./encounters";
import { ms, pm, type RunMeta } from "./meta";
import { nemesisFor, type RunNemesis } from "./nemesis";
import { sourcePiece } from "./schools";

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
  /** Omens chosen for this descent (heat raises renown). */
  omens?: OmenId[];
  /** Night whose raid started but never finished (resolved on return). */
  raiding?: number;
  /** Pieces given for free (sell for nothing). */
  gifts?: number[];
  /** Trial being played (see trials.ts). */
  trial?: string;
  /** Trial piece limit (placed pieces, fixed ones excluded). */
  cap?: number;
  /** Digging is not allowed (trials). */
  noDig?: boolean;
  /** Fixed pieces that can't be moved or sold (trials). */
  locked?: number[];
  /** Cursed Shrine bargains: each gives heroes +8% health for the run. */
  blight?: number;
  /** Extra piece capacity bought from dawn visitors. */
  extraCap?: number;
  /** A dawn visitor waiting to be answered before building. */
  encounter?: Encounter | null;
  /** Night of the last dawn visitor (never two nights running). */
  lastEncounter?: number;
  /** A bet on earning three stars on a night. */
  wager?: { night: number; stake: number } | null;
  /** Night whose party lost its strongest hero to a turncoat's bribe. */
  bribe?: number;
  /** Crowns shown on the last legend screen (stable across reloads). */
  lastCrowns?: string[];
  /** Mastered aspects in play this descent (rules v5). */
  aspects?: PieceId[];
  /** Starting kit: 0 standard, 1 the architect's alternate kit. */
  kit?: number;
  /** The architect's signature relic can be drafted. */
  signature?: boolean;
  /** Sanctum bonuses snapshotted when the descent began (rules v6). */
  meta?: RunMeta;
  /** Started with the Sanctum sealed. */
  pure?: boolean;
  /** Souls earned so far this run. */
  souls?: number;
  /** Rules v7: kills by each blueprint this descent (veterancy). */
  vet?: Partial<Record<PieceId, number>>;
  /** Nemeses this descent will meet (snapshotted when it began). */
  nemeses?: RunNemesis[];
}

// ---------- veterancy (rules v7) ----------
/** Kills a blueprint needs this descent for each veterancy rank. */
export const VET_AT = [5, 15, 35, 70] as const;
export const VET_NAMES = [
  "Green",
  "Blooded",
  "Veteran",
  "Elite",
  "Legendary",
] as const;
/** Power each rank adds to every copy of the blueprint. */
export const VET_PER = 0.06;
export const vetRank = (kills = 0) => VET_AT.filter((k) => kills >= k).length;
/** Veterancy ranks in play (only blueprints with a rank). */
export function vetRanks(run: Partial<Pick<RunState, "vet">>) {
  const out: Partial<Record<PieceId, number>> = {};
  for (const [k, v] of Object.entries(run.vet ?? {})) {
    const r = vetRank(v);
    if (r) out[k as PieceId] = r;
  }
  return out;
}
/** Credit a night's kills to blueprints; returns promotions [piece, rank]. */
export function creditVeterancy(
  run: Pick<RunState, "vet">,
  kills: Record<string, number>,
): [PieceId, number][] {
  const vet = (run.vet ??= {});
  const up: [PieceId, number][] = [];
  for (const [src, k] of Object.entries(kills)) {
    const piece = sourcePiece(src);
    if (!piece || !k) continue;
    const before = vetRank(vet[piece]);
    vet[piece] = (vet[piece] ?? 0) + k;
    const after = vetRank(vet[piece]);
    if (after > before) up.push([piece, after]);
  }
  return up;
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
  sapper: 5,
  druid: 6,
  paladin: 10,
  archmage: 10,
  warlord: 10,
  thane: 10,
  shade: 10,
  revenant: 10,
  monk: 5,
  templar: 6,
  witch: 10,
};

// ---------------- depths ----------------
export interface DepthInfo {
  depth: number;
  name: string;
  boss: ChampionId;
  mutators: MutatorId[];
  realm: number;
  realmName: string;
  /** The realm's final depth, guarded by a realm lord. */
  lord: boolean;
  /** The shape of the dungeon. */
  plan: FloorplanId;
}

/** The first depths introduce the floorplans one at a time. */
const EARLY_PLANS: FloorplanId[] = [
  "cellar",
  "corner",
  "fork",
  "mine",
  "throne",
  "labyrinth",
  "gallery",
  "chasm",
  "pillars",
  "vault",
  "corner",
  "caves",
];
const ORDINARY_PLANS = (Object.keys(FLOORPLANS) as FloorplanId[]).filter(
  (p) => !FLOORPLANS[p].lord,
);
function planBag(bag: number) {
  const rng = new Rng((Math.imul(bag + 1, 0x2f6b4a1d) ^ 0x7e1f) >>> 0);
  return rng.shuffle([...ORDINARY_PLANS]);
}
/** Each depth's floorplan: fixed by its number, never the same twice running. */
export function planFor(depth: number): FloorplanId {
  const d = Math.max(1, Math.floor(depth));
  if (d <= EARLY_PLANS.length) return EARLY_PLANS[d - 1];
  if (isLordDepth(d)) {
    const lordPlans: FloorplanId[] = ["throne", "vault", "labyrinth", "chasm"];
    return lordPlans[(realmOf(d) - 1) % lordPlans.length];
  }
  // Later depths deal every ordinary plan from a shuffled bag.
  const i = d - EARLY_PLANS.length - 1;
  const n = ORDINARY_PLANS.length;
  const bag = Math.floor(i / n);
  const perm = planBag(bag);
  const before =
    bag > 0 ? planBag(bag - 1)[n - 1] : EARLY_PLANS[EARLY_PLANS.length - 1];
  if (perm[0] === before) [perm[0], perm[1]] = [perm[1], perm[0]];
  return perm[i % n];
}

/** Deterministic identity of a depth: its name, champion and mutators. */
export function depthInfo(depth: number): DepthInfo {
  const d = Math.max(1, Math.floor(depth));
  const rng = new Rng((Math.imul(d, 0x2c1b3c6d) ^ 0x51ed270b) >>> 0);
  const lord = isLordDepth(d);
  const count =
    d <= 1 ? 0 : d <= 4 ? 1 : d <= 8 ? 2 : d <= 15 ? 3 : d <= 30 ? 4 : 5;
  // Twists are drawn to a severity budget so neighbouring depths feel alike
  // in difficulty. A lord's depth is the realm's peak and gets a lighter hand.
  let budget =
    (d <= 1 ? 0 : d <= 4 ? 2 : d <= 8 ? 4 : d <= 15 ? 5 : d <= 30 ? 7 : 9) -
    (lord ? 2 : 0);
  const eligible = (Object.keys(MUTATORS) as MutatorId[]).filter(
    (m) => MUTATORS[m].from <= d,
  );
  const bad = rng.shuffle(eligible.filter((m) => !MUTATORS[m].good));
  const good = rng.shuffle(eligible.filter((m) => MUTATORS[m].good));
  const mutators: MutatorId[] = [];
  // Roughly one depth in three softens the blow with a blessing, which pays
  // for a harsher twist.
  const withGood = count > 0 && good.length > 0 && rng.chance(0.35);
  if (withGood) budget += -SEVERITY[good[0]];
  for (const m of bad) {
    if (mutators.length >= count - (withGood ? 1 : 0)) break;
    if (SEVERITY[m] > budget) continue;
    mutators.push(m);
    budget -= SEVERITY[m];
  }
  if (withGood) mutators.push(good[0]);
  // Realm lords guard every fifth depth; ordinary depths cycle the classic
  // champions early and every champion later.
  const boss = lord
    ? REALM_LORDS[(d / 5 - 1) % REALM_LORDS.length]
    : d < 10
      ? CLASSIC_CHAMPIONS[(d - 1) % CLASSIC_CHAMPIONS.length]
      : CHAMPIONS[(d * 5) % CHAMPIONS.length];
  return {
    depth: d,
    name: depthName(d),
    boss,
    mutators,
    realm: realmOf(d),
    realmName: realmName(realmOf(d)),
    lord,
    plan: planFor(d),
  };
}

/** How hard each twist hits (blessings are negative). */
const SEVERITY: Record<MutatorId, number> = {
  ironclad: 3,
  horde: 3,
  bloodMoon: 3,
  scouts: 3,
  haste: 2,
  famine: 2,
  blessed: 3,
  thieves: 2,
  sappers: 2,
  fireproof: 2,
  undying: 2,
  zealots: 1,
  hardRock: 1,
  fog: 1,
  gilded: -2,
  ancient: -2,
  fortified: -2,
  armory: -1,
  rich: -1,
  pilgrims: 2,
  eclipse: 1,
  leyLines: -1,
  stockpile: -1,
};

/**
 * Past depth 8 the extra heat builds over the nights of a descent, so deep
 * runs end in a climax instead of on night three. 0 on night 1, 1 by night 9.
 */
export const deepRamp = (n: number) => Math.min(1, Math.max(0, (n - 1) / 8));

/** Difficulty that stacks with depth (the first eight steps are fixed). */
export function heatFor(depth: number, night = NIGHTS) {
  const over = Math.max(0, depth - 8);
  const ramp = deepRamp(night);
  const k = 0.3 + 0.7 * ramp;
  return {
    hpMul: (depth >= 2 ? 1.2 : 1) * (1 + 0.06 * over * k),
    dmgMul: 1 + 0.04 * over * k,
    partyBonus: (depth >= 3 ? 3 : 0) + 0.65 * over * (0.1 + 0.9 * ramp),
    goldPenalty: depth >= 4 ? 30 : 0,
    /** Deep dungeons hold richer pickings to build the first nights with. */
    startBonus: Math.min(80, 5 * over),
    moreElites: depth >= 5,
    hoardPenalty: depth >= 6 ? 3 : 0,
    speed: depth >= 7 ? 1.1 : 1,
    honorGuard: depth >= 8 ? 6 + over : 0,
  };
}

/** Deep dungeons are roomier: +1 piece per three depths past 8, up to +6. */
export const deepCapacity = (depth: number) =>
  Math.min(6, Math.floor(Math.max(0, depth - 8) / 3));

/** x^n by repeated multiplication, so every device agrees bit for bit. */
function powi(x: number, n: number) {
  let r = 1;
  for (let i = 0; i < n; i++) r *= x;
  return r;
}

const has = (run: Pick<RunState, "mutators">, m: MutatorId) =>
  run.mutators.includes(m);
const omen = (run: Partial<Pick<RunState, "omens">>, o: OmenId) =>
  !!run.omens?.includes(o);
/** Heat chosen for a run through omens. */
export const runHeat = (run: Partial<Pick<RunState, "omens">>) =>
  heatOf(run.omens ?? []);

export function newRun(opts: {
  seed: number;
  biome: BiomeId;
  architect: ArchitectId;
  depth: number;
  daily?: string | null;
  powers: PowerId[];
  omens?: OmenId[];
  aspects?: PieceId[];
  kit?: number;
  signature?: boolean;
  /** Sanctum bonuses (campaign descents only). */
  meta?: RunMeta | null;
  /** Pieces the Legion keystone may add (defaults to the base pool). */
  pool?: PieceId[];
  pure?: boolean;
  /** Nemeses scheduled for this descent (campaign only). */
  nemeses?: RunNemesis[];
}): RunState {
  const meta = opts.meta ?? undefined;
  const omens = [...new Set(opts.omens ?? [])];
  const base = ARCHITECTS.find((a) => a.id === opts.architect) ?? ARCHITECTS[0];
  const kit = opts.kit === 1 ? 1 : 0;
  const arch = kit ? { ...base, start: ALT_KITS[base.id].start } : base;
  const info = depthInfo(opts.depth);
  const heat = heatFor(info.depth);
  const mutators = info.mutators;
  const layout = generateLayout(opts.seed, opts.biome, {
    veins: mutators.includes("gilded") ? 2 : 1,
    variant: info.depth >= 2 ? opts.seed : undefined,
    plan: info.plan,
  });
  let gold = TUNE.startGold;
  if (arch.id === "mason") gold += TUNE.masonGold;
  gold -= heat.goldPenalty;
  gold += heat.startBonus;
  if (omens.includes("poverty")) gold -= 40;
  if (mutators.includes("stockpile")) gold += 60;
  gold += Math.round(ms(meta, "startGold"));
  const hoard =
    Math.round(ms(meta, "hoard")) +
    12 -
    heat.hoardPenalty +
    (mutators.includes("ancient") ? 4 : 0) +
    (arch.id === "warden" ? 4 : 0) -
    (omens.includes("brittle") ? 4 : 0);
  const owned = [...arch.start];
  if (mutators.includes("armory")) {
    const rng = new Rng(opts.seed ^ 0x5bd1e995);
    const extra = BASE_POOL.filter((p) => !owned.includes(p));
    owned.push(rng.pick(extra));
  }
  // Legion: an extra monster blueprint, fixed by the seed.
  if (meta?.keys.includes("legion")) {
    const rng = new Rng(opts.seed ^ 0x1e910a);
    const extra = [...new Set([...BASE_POOL, ...(opts.pool ?? [])])].filter(
      (p) => PIECES[p].kind === "monster" && !owned.includes(p),
    );
    if (extra.length) owned.push(rng.pick(extra));
  }
  const tiers: Partial<Record<PieceId, number>> = {};
  for (const p of owned) {
    const t = pm(meta, p)?.tier ?? 0;
    if (t > 0 && p !== "lure") tiers[p] = Math.min(TIER_MAX, 1 + t);
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
    tiers,
    relics: arch.id === "lich" ? ["restless"] : [],
    powers: omens.includes("silence") ? [] : opts.powers,
    draft: null,
    history: [],
    victory: null,
    fresh: [],
    endless: false,
    renownPaid: 0,
    dug: 0,
    rerolls: 0,
    omens,
  };
  if (opts.aspects?.length) run.aspects = [...new Set(opts.aspects)];
  if (kit) run.kit = kit;
  if (opts.signature) run.signature = true;
  if (meta) run.meta = meta;
  if (opts.pure) run.pure = true;
  if (opts.nemeses?.length) run.nemeses = opts.nemeses.map((x) => ({ ...x }));
  // A first trap on the starter tunnel so night one teaches itself.
  const spot = firstTunnelTile(layout, 4);
  if (spot) {
    run.gifts = [layout.nextId];
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

/** The tile `steps` along the heroes' route from the stairs. */
function firstTunnelTile(l: Layout, steps: number) {
  const f = distanceField(l, l.hoard.x, l.hoard.y);
  const route = pathTo(l, f, l.entrance.x, l.entrance.y);
  const t = route[Math.min(steps, route.length - 3)];
  if (!t || (t.x === l.hoard.x && t.y === l.hoard.y)) return null;
  if (t.x === l.entrance.x && t.y === l.entrance.y) return null;
  return t;
}

export function pieceCost(
  run: Pick<RunState, "architect"> & Partial<Pick<RunState, "meta">>,
  id: PieceId,
) {
  const def = PIECES[id];
  let c = def.cost;
  const off = pm(run.meta, id)?.cost ?? 0;
  if (off) c = Math.max(1, Math.round(c * (1 - off)));
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
  > &
    Partial<Pick<RunState, "omens" | "blight" | "aspects" | "meta" | "vet">>,
): RaidMods {
  const n = run.night;
  const heat = heatFor(run.depth, n);
  const a = abyssDepth(n);
  let heroHp =
    (1 + TUNE.hpPerNight * (Math.min(n, NIGHTS) - 1)) *
    heat.hpMul *
    powi(TUNE.abyssHp, a);
  if (has(run, "horde")) heroHp *= 0.85;
  if (omen(run, "ironWill")) heroHp *= 1.2;
  heroHp *= 1 + 0.08 * (run.blight ?? 0);
  return {
    heroHp,
    heroDmg:
      (1 + TUNE.dmgPerNight * (Math.min(n, NIGHTS) - 1)) *
      heat.dmgMul *
      powi(TUNE.abyssDmg, a),
    heroSpeed:
      heat.speed *
      (has(run, "haste") ? 1.12 : 1) *
      (omen(run, "swift") ? 1.1 : 1),
    monsterHp: run.architect === "lich" ? 1.25 : 1,
    monsterDmg: run.architect === "beastmaster" ? 1.15 : 1,
    arch: run.architect,
    mutators: run.mutators,
    relics: run.relics,
    tiers: run.tiers,
    omens: run.omens ?? [],
    schools: !omen(run, "discord"),
    aspects: run.aspects ?? [],
    ...(run.meta ? { meta: run.meta } : {}),
    ...(run.vet ? { vet: vetRanks(run) } : {}),
  };
}

export function isEliteNight(
  run: Pick<RunState, "depth" | "mutators"> & Partial<Pick<RunState, "omens">>,
  n: number,
) {
  if (n > NIGHTS) return true;
  if (n === 4 || n === 7) return true;
  if (has(run, "bloodMoon") && n >= 4 && n < NIGHTS) return true;
  if (omen(run, "veterans") && n >= 3 && n < NIGHTS) return true;
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
  sapper: 9,
  druid: 10,
  bard: 11,
  cleric: 12,
  thane: 0,
  shade: 0,
  revenant: 0,
  witch: 0,
  templar: 1,
  monk: 3,
};
const MAX_PARTY = 10;

/** The party that will attack on night n. Deterministic per run seed. */
export function partyFor(
  run: Pick<RunState, "seed" | "depth" | "mutators" | "boss"> &
    Partial<Pick<RunState, "omens" | "bribe" | "nemeses">>,
  n: number,
): PartyMember[] {
  const party = rawParty(run, n);
  // Rules v7: a nemesis returns for revenge (and can't be bribed away).
  const nem = nemesisFor(run.nemeses, n);
  if (nem) {
    party.push({
      cls: nem.cls,
      elite: true,
      affixes: [...nem.affixes],
      nemesis: { id: nem.id, level: nem.level, name: nem.name },
    });
    party.sort((a, b) => ORDER[a.cls] - ORDER[b.cls]);
  }
  // A turncoat paid at dawn: the strongest ordinary hero stays home.
  if (run.bribe === n) {
    let pick = -1;
    let best = -1;
    for (let i = 0; i < party.length; i++) {
      const p = party[i];
      if (isChampion(p.cls) || p.nemesis) continue;
      const v = HEROES[p.cls].points + (p.elite ? 3 : 0);
      if (v > best) {
        best = v;
        pick = i;
      }
    }
    if (pick >= 0 && party.length > 1) party.splice(pick, 1);
  }
  return party;
}

function rawParty(
  run: Pick<RunState, "seed" | "depth" | "mutators" | "boss"> &
    Partial<Pick<RunState, "omens">>,
  n: number,
): PartyMember[] {
  if (n === 1) return [{ cls: "knight" }];
  if (n === 2) return [{ cls: "knight" }, { cls: "rogue" }];
  const heat = heatFor(run.depth, n);
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
  if (omen(run, "teeming")) budget *= 1.2;
  const party: PartyMember[] = [];
  if (isChampionNight(n)) {
    party.push({ cls: championFor(run, n) });
    budget =
      10 +
      heat.honorGuard +
      (abyss ? 4 + abyssDepth(n) * 0.8 : 0) +
      (has(run, "horde") ? 3 : 0) +
      (omen(run, "teeming") ? 3 : 0) +
      (omen(run, "wrath") ? 4 : 0);
  } else {
    // Showcase each class on the night it first arrives.
    for (const debut of avail.filter((c) => HERO_ARRIVAL[c] === n)) {
      if (HEROES[debut].points > budget) continue;
      party.push({ cls: debut });
      budget -= HEROES[debut].points;
    }
  }
  // Mutators that guarantee a class.
  const force = (c: HeroClass) => {
    if (party.length >= MAX_PARTY || HEROES[c].points > budget + 2) return;
    party.push({ cls: c });
    budget -= HEROES[c].points;
  };
  if (has(run, "thieves") && n >= 2 && !party.some((p) => p.cls === "rogue"))
    force("rogue");
  if (has(run, "sappers") && n >= 3 && !party.some((p) => p.cls === "sapper"))
    force("sapper");
  // Pilgrims: an extra healer on top of the usual ones (free, and beyond
  // the usual cap on clerics).
  const pilgrim = has(run, "pilgrims") && n >= 3 ? 1 : 0;
  if (pilgrim && party.length < MAX_PARTY) party.push({ cls: "cleric" });
  let guard = 0;
  while (budget >= 3 && party.length < MAX_PARTY && guard++ < 60) {
    const count = (c: HeroClass) => party.filter((p) => p.cls === c).length;
    const options = avail.filter(
      (c) =>
        HEROES[c].points <= budget &&
        !(c === "cleric" && count("cleric") >= (n >= 7 ? 2 : 1) + pilgrim) &&
        !(c === "bard" && count("bard") >= (n >= 12 ? 2 : 1)) &&
        !(c === "druid" && count("druid") >= (n >= 12 ? 2 : 1)) &&
        !(c === "sapper" && count("sapper") >= 2),
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
      if (
        isChampion(p.cls) ||
        p.cls === "cleric" ||
        p.cls === "bard" ||
        p.cls === "druid"
      )
        continue;
      p.elite = true;
      made++;
    }
    if (!made) party[0].elite = !isChampion(party[0].cls);
  }
  rollAffixes(run, n, party);
  // Marching order: front-liners first, healers and casters at the back.
  party.sort((a, b) => ORDER[a.cls] - ORDER[b.cls]);
  return party;
}

/**
 * Elites carry affixes from depth 2 (and always in the abyss): one each, two
 * from abyss night 20 or under the Empowered omen, which also gives the
 * champion one. A separate stream keeps party composition unchanged.
 */
function rollAffixes(
  run: Pick<RunState, "seed" | "depth"> & Partial<Pick<RunState, "omens">>,
  n: number,
  party: PartyMember[],
) {
  const abyss = n > NIGHTS;
  if (!abyss && run.depth < 2) return;
  const pool = AFFIX_IDS.filter((a) => abyss || AFFIXES[a].from <= run.depth);
  if (!pool.length) return;
  const rng = new Rng((run.seed ^ Math.imul(n, 0x51a3c9e7) ^ 0xaff1) >>> 0);
  const empowered = omen(run, "empowered");
  const per = empowered || n >= 20 ? 2 : 1;
  const pickN = (k: number) =>
    rng.shuffle([...pool]).slice(0, Math.min(k, pool.length)) as AffixId[];
  for (const p of party) {
    if (p.elite) p.affixes = pickN(per);
    else if (empowered && isChampion(p.cls)) p.affixes = pickN(1);
  }
}

export function starsFor(r: RaidResult, stolenThisNight: number) {
  if (stolenThisNight > 0) return 0;
  if (r.escaped > 0) return 1;
  if (r.touchedHoard) return 2;
  return 3;
}

export function dawnIncome(
  run: Pick<RunState, "night" | "relics" | "mutators"> &
    Partial<Pick<RunState, "omens" | "meta">>,
  stars: number,
) {
  let base =
    TUNE.tributeBase +
    TUNE.tributePerNight * run.night +
    stars * TUNE.tributePerStar;
  if (has(run, "famine")) base = Math.round(base * 0.75);
  if (omen(run, "poverty")) base = Math.round(base * 0.8);
  const tithe = ms(run.meta, "tribute");
  if (tithe) base = Math.round(base * (1 + tithe));
  return base + (run.relics.includes("goldRush") ? 10 : 0);
}
/** Royal Treasury: interest on the gold saved going into the night. */
export function interestFor(run: Pick<RunState, "relics">, saved: number) {
  if (!run.relics.includes("treasury")) return 0;
  return Math.min(20, Math.floor(Math.max(0, saved) / 8));
}

const RARITY_WEIGHT = { common: 4, rare: 2, legendary: 1 } as const;
export function rerollCost(
  run: Pick<RunState, "rerolls"> & Partial<Pick<RunState, "relics" | "meta">>,
) {
  if (run.relics?.includes("keys")) return 0;
  return Math.max(
    0,
    10 + run.rerolls * 10 - Math.round(ms(run.meta, "reroll")),
  );
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
    (r) =>
      !run.relics.includes(r) &&
      (!RELICS[r].arch || (run.signature && RELICS[r].arch === run.architect)),
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
  const size =
    (omen(run, "meager") ? 2 : 3) +
    (run.relics.includes("loadedDice") ? 1 : 0) +
    Math.round(ms(run.meta, "draft"));
  for (let i = 0; i < 8 && cards.length < size; i++) {
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
    // Forge talent "Heirloom": the piece joins a tier higher.
    const t = pm(run.meta, c.id)?.tier ?? 0;
    if (t > 0 && c.id !== "lure")
      run.tiers[c.id] = Math.min(
        TIER_MAX,
        Math.max(run.tiers[c.id] ?? 1, 1 + t),
      );
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
  if (!inside(l, x, y) || run.noDig) return "protected";
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
  run: Pick<RunState, "night" | "relics" | "workshop"> &
    Partial<
      Pick<
        RunState,
        | "mutators"
        | "omens"
        | "cap"
        | "locked"
        | "trial"
        | "extraCap"
        | "depth"
        | "meta"
      >
    >,
) {
  if (run.workshop) return Infinity;
  if (run.cap !== undefined) return run.cap + (run.locked?.length ?? 0);
  if (run.trial) return Infinity;
  const n = run.night;
  return (
    TUNE.capBase +
    TUNE.capPerNight * Math.min(n, NIGHTS) +
    Math.min(10, Math.max(0, n - NIGHTS)) +
    (run.relics.includes("sprawl") ? 4 : 0) +
    (run.mutators?.includes("fortified") ? 3 : 0) +
    (run.extraCap ?? 0) +
    deepCapacity(run.depth ?? 1) +
    Math.round(ms(run.meta, "capacity")) -
    (omen(run, "cramped") ? 3 : 0)
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
  if (run.gifts?.includes(objId)) return 0;
  const c = pieceCost(run, o.kind);
  return run.fresh.includes(objId) || run.relics.includes("miser")
    ? c
    : Math.min(c, Math.floor(c * (0.75 + ms(run.meta, "refund"))));
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
  let total =
    descent.length +
    stars +
    (won ? 12 + (run.depth - 1) * 4 + (isLordDepth(run.depth) ? 10 : 0) : 0);
  for (const h of abyss) total += 2 + h.stars;
  // Omens multiply everything the run earns.
  return Math.round(total * heatRenown(runHeat(run)));
}

/** Display name for the run's dungeon. */
export const runTitle = (run: Pick<RunState, "depth">) =>
  `${depthName(run.depth)} · Depth ${run.depth}`;

// ---------- reinforcing (the late-game gold sink) ----------
/** Highest tier from drafts; reinforcing with gold can go further. */
export const DRAFT_TIER_MAX = 3;
export const TIER_MAX = 5;
export function reinforceCost(
  run: Pick<RunState, "architect" | "tiers"> &
    Partial<Pick<RunState, "relics" | "meta">>,
  id: PieceId,
) {
  // Bait chests have no power to raise.
  if (id === "lure") return null;
  const tier = run.tiers[id] ?? 1;
  if (tier >= TIER_MAX) return null;
  const square = run.relics?.includes("masterTools") ? 0.7 : 1;
  // Sanctum discounts (global and per piece) stack, but never below 30%.
  const off = Math.max(
    0.3,
    (1 - ms(run.meta, "reinforce")) * (1 - (pm(run.meta, id)?.reinforce ?? 0)),
  );
  return Math.round(pieceCost(run, id) * TUNE.reinforce * tier * square * off);
}
export function reinforce(run: RunState, id: PieceId) {
  const c = reinforceCost(run, id);
  if (c === null || run.gold < c) return false;
  run.gold -= c;
  run.tiers[id] = (run.tiers[id] ?? 1) + 1;
  return true;
}
