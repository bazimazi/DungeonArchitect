/**
 * A heuristic "reasonable human" player used to measure the difficulty curve.
 * It never peeks at simulation results while building: it shapes a longer
 * route, digs veins, spreads traps along the route, guards the hoard with
 * monsters, picks boons by simple priorities and casts powers at clumps.
 */
import { Rng } from "../src/engine/math";
import {
  NIGHTS,
  PIECES,
  POWERS,
  T,
  type PieceId,
  type PowerId,
} from "../src/game/defs";
import {
  distanceField,
  hasRoute,
  idx,
  inside,
  objectAt,
  pathTo,
  routeLength,
  walkable,
  type Layout,
} from "../src/game/grid";
import {
  applyCard,
  canDig,
  canFill,
  canPlace,
  dawnIncome,
  dig,
  digCost,
  draftFor,
  fill,
  interestFor,
  newRun,
  partyFor,
  pieceCost,
  place,
  raidMods,
  reinforce,
  reinforceCost,
  starsFor,
  type Card,
  type RunState,
} from "../src/game/run";
import { Raid } from "../src/game/sim";
import type { ArchitectId, BiomeId } from "../src/game/defs";

export interface BotOpts {
  seed: number;
  depth: number;
  architect?: ArchitectId;
  biome?: BiomeId;
  /** Pieces unlocked by meta progression (defaults to everything). */
  pool?: PieceId[];
  powers?: PowerId[];
  /** Keep playing abyss nights after a victory, up to this night. */
  abyssUntil?: number;
  /** 0..1: how well the bot plays (route shaping, power use). */
  skill?: number;
}
export interface BotResult {
  won: boolean;
  nights: number;
  stars: number;
  hoard: number;
  hoardMax: number;
  abyssNights: number;
  perNight: {
    night: number;
    stolen: number;
    killed: number;
    party: number;
    secs: number;
    gold: number;
    pieces: number;
    route: number;
  }[];
}

const ALL_PIECES = Object.keys(PIECES) as PieceId[];

function path(l: Layout) {
  const f = distanceField(l, l.hoard.x, l.hoard.y);
  if (f[idx(l, l.entrance.x, l.entrance.y)] === Infinity) return [];
  return pathTo(l, f, l.entrance.x, l.entrance.y);
}

/** Free fills that lengthen the route, then paid detours. */
function shapeRoute(run: RunState, budget: number) {
  const l = run.layout;
  const protectedTile = (x: number, y: number) =>
    (x === l.entrance.x && y === l.entrance.y) ||
    (x === l.hoard.x && y === l.hoard.y);
  // Veins are free money.
  for (let y = 1; y < l.h - 1; y++)
    for (let x = 1; x < l.w - 1; x++)
      if (l.tiles[idx(l, x, y)] === T.Vein && !canDig(run, x, y))
        dig(run, x, y);
  let spent = 0;
  for (let iter = 0; iter < 40; iter++) {
    const base = routeLength(l);
    let best: {
      dig: [number, number][];
      fill: [number, number] | null;
      gain: number;
      cost: number;
    } | null = null;
    const p = path(l);
    const onPath = new Set(p.map((t) => idx(l, t.x, t.y)));
    // Free fills of floor that isn't on the route (closing shortcuts) or is.
    for (let y = 0; y < l.h; y++)
      for (let x = 0; x < l.w; x++) {
        if (l.tiles[idx(l, x, y)] !== T.Floor || protectedTile(x, y)) continue;
        if (objectAt(l, x, y)) continue;
        if (!onPath.has(idx(l, x, y))) continue;
        if (canFill(run, x, y)) continue;
        l.tiles[idx(l, x, y)] = T.Rock;
        const g = routeLength(l) - base;
        l.tiles[idx(l, x, y)] = T.Floor;
        if (g > 0 && (!best || g / 1 > best.gain / Math.max(1, best.cost)))
          best = { dig: [], fill: [x, y], gain: g, cost: 0 };
      }
    if (!best || best.cost > 0) {
      // Detours: dig a U around a route tile, then fill it.
      const dc = digCost(run);
      for (let i = 1; i < p.length - 1; i++) {
        const a = p[i - 1];
        const b = p[i];
        const c = p[i + 1];
        if (protectedTile(b.x, b.y) || objectAt(l, b.x, b.y)) continue;
        const straight = a.x === c.x || a.y === c.y;
        if (!straight) continue;
        const nx = a.x === c.x ? 1 : 0;
        const ny = a.y === c.y ? 1 : 0;
        for (const side of [-1, 1]) {
          for (const off of [1, 2]) {
            const digs: [number, number][] = [];
            const cells = [a, b, c].map(
              (t) =>
                [t.x + nx * side * off, t.y + ny * side * off] as [
                  number,
                  number,
                ],
            );
            if (off === 2)
              cells.push(
                [a.x + nx * side, a.y + ny * side],
                [c.x + nx * side, c.y + ny * side],
              );
            let ok = true;
            for (const [x, y] of cells) {
              if (
                !inside(l, x, y) ||
                x <= 0 ||
                y <= 0 ||
                x >= l.w - 1 ||
                y >= l.h - 1
              ) {
                ok = false;
                break;
              }
              const t = l.tiles[idx(l, x, y)];
              if (t === T.Bedrock) {
                ok = false;
                break;
              }
              if (t !== T.Floor) digs.push([x, y]);
            }
            if (!ok || !digs.length) continue;
            const cost = digs.length * dc;
            if (spent + cost > budget || run.gold - cost < 0) continue;
            const saved = digs.map(([x, y]) => l.tiles[idx(l, x, y)]);
            for (const [x, y] of digs) l.tiles[idx(l, x, y)] = T.Floor;
            l.tiles[idx(l, b.x, b.y)] = T.Rock;
            const g = hasRoute(l) ? routeLength(l) - base : -1;
            l.tiles[idx(l, b.x, b.y)] = T.Floor;
            digs.forEach(([x, y], k) => (l.tiles[idx(l, x, y)] = saved[k]));
            if (
              g > 0 &&
              (!best ||
                g / Math.max(1, cost) > best.gain / Math.max(1, best.cost))
            )
              best = { dig: digs, fill: [b.x, b.y], gain: g, cost };
          }
        }
      }
    }
    if (!best) break;
    if (best.cost > 0 && best.gain / best.cost < 0.3) break;
    for (const [x, y] of best.dig) dig(run, x, y);
    spent += best.cost;
    if (best.fill && !canFill(run, best.fill[0], best.fill[1]))
      fill(run, best.fill[0], best.fill[1]);
  }
}

function bestDir(
  l: Layout,
  x: number,
  y: number,
  route: { x: number; y: number }[],
) {
  const DX = [0, 1, 0, -1];
  const DY = [-1, 0, 1, 0];
  let best = 2;
  let bestScore = -1;
  for (let d = 0; d < 4; d++) {
    let len = 0;
    let on = 0;
    let cx = x;
    let cy = y;
    for (let i = 0; i < 8; i++) {
      cx += DX[d];
      cy += DY[d];
      if (!walkable(l, cx, cy)) break;
      len++;
      if (route.some((p) => p.x === cx && p.y === cy)) on++;
    }
    const s = on * 3 + len;
    if (s > bestScore) {
      bestScore = s;
      best = d;
    }
  }
  return best;
}

const VALUE: Partial<Record<PieceId, number>> = {
  spikes: 1.0,
  darts: 1.1,
  flame: 1.2,
  frost: 0.9,
  tar: 0.8,
  spring: 0.6,
  keg: 0.9,
  saw: 1.2,
  gas: 1.1,
  boulder: 1.0,
  trapdoor: 1.0,
  pylon: 1.3,
  skeleton: 1.1,
  archer: 1.1,
  slime: 0.9,
  ogre: 1.2,
  bat: 0.8,
  necro: 1.0,
  mimic: 0.8,
  imp: 1.1,
  ghost: 0.9,
  spider: 1.0,
  golem: 1.2,
  lure: 0.5,
};

function placePieces(run: RunState, rng: Rng) {
  const l = run.layout;
  const route = path(l);
  if (route.length < 4) return;
  const n = route.length;
  const owned = run.owned.filter((p) => p !== "lure" || run.night >= 2);
  for (let guard = 0; guard < 60; guard++) {
    const affordable = owned.filter((p) => pieceCost(run, p) <= run.gold);
    if (!affordable.length) return;
    // Prefer upgraded and valuable pieces, with some variety.
    const weights = affordable.map(
      (p) =>
        ((VALUE[p] ?? 1) *
          (1 + 0.5 * ((run.tiers[p] ?? 1) - 1)) *
          (0.6 + rng.next() * 0.8)) /
        Math.sqrt(pieceCost(run, p)),
    );
    let bi = 0;
    for (let i = 1; i < weights.length; i++)
      if (weights[i] > weights[bi]) bi = i;
    const id = affordable[bi];
    const def = PIECES[id];
    // Candidate tiles: on the route (traps early, monsters late) or beside it.
    let bestTile: { x: number; y: number; s: number } | null = null;
    for (let i = 2; i < n - 1; i++) {
      const t = route[i];
      const prog = i / n;
      const near = [
        t,
        { x: t.x + 1, y: t.y },
        { x: t.x - 1, y: t.y },
        { x: t.x, y: t.y + 1 },
        { x: t.x, y: t.y - 1 },
      ];
      for (const c of near) {
        if (canPlace(run, id, c.x, c.y)) continue;
        const onRoute = c === t;
        let s = 0;
        if (def.kind === "monster") {
          s = 1 + prog * 2 + (onRoute ? 0 : 0.6);
          if (
            id === "archer" ||
            id === "imp" ||
            id === "spider" ||
            id === "necro"
          )
            s += onRoute ? -1 : 0.8;
        } else if (def.directional) {
          s = onRoute ? 1 : 1.5;
          s += 1 - Math.abs(prog - 0.5);
        } else if (id === "lure") {
          s = onRoute ? -2 : 2 - prog;
        } else if (id === "gas" || id === "pylon") {
          s = (onRoute ? 1.2 : 1.6) + prog;
        } else {
          s = onRoute ? 2 - prog : -5;
        }
        // Spread things out.
        const crowd = l.objects.filter(
          (o) => Math.abs(o.x - c.x) + Math.abs(o.y - c.y) <= 1,
        ).length;
        s -= crowd * 0.7;
        s += rng.next() * 0.3;
        if (!bestTile || s > bestTile.s) bestTile = { x: c.x, y: c.y, s };
      }
    }
    if (!bestTile) {
      owned.splice(owned.indexOf(id), 1);
      if (!owned.length) return;
      continue;
    }
    place(
      run,
      id,
      bestTile.x,
      bestTile.y,
      def.directional ? bestDir(l, bestTile.x, bestTile.y, route) : 2,
    );
  }
}

function pickCard(run: RunState, cards: Card[]): Card | null {
  const score = (c: Card) => {
    if (c.type === "relic") {
      const good: Record<string, number> = {
        goldRush: 3,
        bloodMoney: 2.5,
        sharpIron: 2.5,
        quickHands: 2.5,
        warBanner: 2.2,
        hoardAges: 2.4,
        huntersMark: 2.4,
        treasury: 2.3,
        deathKnell: 2.6,
        ironMaiden: 2,
      };
      return good[c.id] ?? 1.5;
    }
    if (c.type === "tier") {
      const count = run.layout.objects.filter((o) => o.kind === c.id).length;
      return 1 + count * 0.5;
    }
    return 1.8 + (VALUE[c.id] ?? 1) - (run.owned.length > 8 ? 1 : 0);
  };
  let best: Card | null = null;
  let bs = -1;
  for (const c of cards) {
    const s = score(c);
    if (s > bs) {
      bs = s;
      best = c;
    }
  }
  return best;
}

/** Cast powers at the densest clump of heroes nearest the hoard. */
function castPowers(
  raid: Raid,
  powers: PowerId[],
  cds: Record<string, number>,
  skill: number,
) {
  for (const p of powers) {
    if ((cds[p] ?? 0) > 0) {
      cds[p] -= 1;
      continue;
    }
    const def = POWERS[p];
    if (raid.dread < def.cost + (p === "rockfall" ? 0 : 2)) continue;
    const heroes = raid.heroes.filter((h) => h.alive && h.state !== "falling");
    if (!heroes.length) continue;
    let best: { x: number; y: number; s: number } | null = null;
    for (const h of heroes) {
      const x = Math.floor(h.x);
      const y = Math.floor(h.y);
      const near = heroes.filter(
        (o) =>
          Math.abs(Math.floor(o.x) - x) <= 1 &&
          Math.abs(Math.floor(o.y) - y) <= 1,
      ).length;
      const danger = h.loot > 0 ? 2 : 0;
      const s = near + danger + (1 - h.hp / h.maxHp);
      if (!best || s > best.s) best = { x, y, s };
    }
    if (!best || best.s < 2 - skill) continue;
    if (raid.cast(p, best.x, best.y, def.cost))
      cds[p] = Math.round(def.cooldown / 0.05);
  }
}

export function playRun(o: BotOpts): BotResult {
  const rng = new Rng(o.seed * 7 + 1);
  const skill = o.skill ?? 0.7;
  const run = newRun({
    seed: o.seed,
    biome: o.biome ?? "crypt",
    architect: o.architect ?? "mason",
    depth: o.depth,
    powers: o.powers ?? ["rockfall", "shriek", "chill"],
  });
  const pool = o.pool ?? ALL_PIECES;
  const res: BotResult = {
    won: false,
    nights: 0,
    stars: 0,
    hoard: 0,
    hoardMax: run.hoardMax,
    abyssNights: 0,
    perNight: [],
  };
  const last = o.abyssUntil ?? NIGHTS;
  for (;;) {
    // Build.
    shapeRoute(run, Math.min(run.gold * 0.3 * skill, 60));
    placePieces(run, rng);
    // Surplus gold: reinforce the most-used blueprints.
    for (let g = 0; g < 30 && skill > 0.2; g++) {
      const counts = new Map<PieceId, number>();
      for (const ob of run.layout.objects)
        counts.set(ob.kind, (counts.get(ob.kind) ?? 0) + 1);
      const order = [...counts.entries()].sort((a, b) => b[1] - a[1]);
      let done = false;
      for (const [k] of order) {
        const c = reinforceCost(run, k);
        if (c !== null && c <= run.gold) {
          reinforce(run, k);
          done = true;
          break;
        }
      }
      if (!done) break;
    }
    const saved = run.gold;
    const party = partyFor(run, run.night);
    const raid = new Raid({
      layout: run.layout,
      party,
      seed: (run.seed ^ Math.imul(run.night, 2654435761)) >>> 0,
      night: run.night,
      hoard: run.hoard,
      hoardMax: run.hoardMax,
      mods: raidMods(run),
    });
    const cds: Record<string, number> = {};
    const before = run.hoard;
    while (!raid.finished && raid.tick < 10_000) {
      if (skill > 0 && raid.tick % 4 === 0)
        castPowers(raid, run.powers, cds, skill);
      raid.step();
      raid.events.length = 0;
    }
    const r = raid.result();
    const stolen = Math.max(0, before - raid.hoard);
    run.hoard = raid.hoard;
    const stars = starsFor(r, stolen);
    run.gold += r.gold + dawnIncome(run, stars) + interestFor(run, saved);
    run.layout.tiles = raid.layout.tiles.slice();
    run.fresh = [];
    res.perNight.push({
      night: run.night,
      stolen,
      killed: r.killed,
      party: party.length,
      secs: Math.round(r.seconds),
      gold: run.gold,
      pieces: run.layout.objects.length,
      route: routeLength(run.layout),
    });
    res.nights = run.night;
    if (run.night <= NIGHTS) res.stars += stars;
    else res.abyssNights++;
    if (run.hoard <= 0) break;
    if (run.night === NIGHTS) res.won = true;
    if (run.night >= last) break;
    run.night++;
    const cards = draftFor(run, pool);
    const pick = pickCard(run, cards);
    if (pick) applyCard(run, pick);
    else run.gold += 15;
  }
  res.hoard = run.hoard;
  return res;
}
