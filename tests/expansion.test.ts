import { generateLayout, hasRoute, type Layout } from "../src/game/grid";
import {
  NIGHTS,
  T,
  type HeroClass,
  type PieceId,
  type RelicId,
} from "../src/game/defs";
import {
  applyCard,
  canPlace,
  capacityFor,
  championFor,
  depthInfo,
  draftFor,
  isChampionNight,
  migrateRun,
  newRun,
  partyFor,
  place,
  raidMods,
  reinforce,
  reinforceCost,
  renownFor,
  type RunState,
} from "../src/game/run";
import { award, awardStats, migrateProfile } from "../src/game/profile";
import { Raid, simulate, type RaidMods } from "../src/game/sim";
import { playRun } from "./bot";

const mods = (extra: Partial<RaidMods> = {}): RaidMods => ({
  heroHp: 1,
  heroDmg: 1,
  heroSpeed: 1,
  monsterHp: 1,
  relics: [],
  tiers: {},
  ...extra,
});
function corridor(): Layout {
  const l = generateLayout(1, "crypt");
  l.tiles = l.tiles.map((t) => (t === T.Floor ? T.Rock : t));
  for (let y = 0; y <= 12; y++) l.tiles[y * l.w + 5] = T.Floor;
  l.objects = [];
  return l;
}
function raidOn(
  party: HeroClass[],
  objects: [PieceId, number, number, number?][] = [],
  m: Partial<RaidMods> = {},
  l = corridor(),
) {
  l.objects = objects.map(([kind, x, y, dir], i) => ({
    id: i + 1,
    kind,
    x,
    y,
    dir: dir ?? 2,
  }));
  return new Raid({
    layout: l,
    party: party.map((cls) => ({ cls })),
    seed: 5,
    night: 1,
    hoard: 12,
    mods: mods(m),
  });
}
function runUntil(r: Raid, pred: () => boolean, max = 4000) {
  for (let i = 0; i < max && !pred() && !r.finished; i++) r.step();
  return pred();
}
const run = (depth = 1, seed = 77): RunState =>
  newRun({
    seed,
    biome: "crypt",
    architect: "mason",
    depth,
    powers: ["rockfall"],
  });

describe("depths", () => {
  it("are deterministic, named, and get more twisted", () => {
    expect(depthInfo(7)).toEqual(depthInfo(7));
    expect(depthInfo(1).mutators).toEqual([]);
    expect(depthInfo(1).boss).toBe("paladin");
    expect(depthInfo(2).boss).toBe("archmage");
    expect(depthInfo(3).boss).toBe("warlord");
    expect(depthInfo(3).mutators.length).toBe(1);
    expect(depthInfo(6).mutators.length).toBe(2);
    for (let d = 2; d < 80; d++) {
      const n = depthInfo(d).mutators.length;
      expect(n).toBeGreaterThan(0);
      expect(n).toBeLessThanOrEqual(
        d <= 4 ? 1 : d <= 8 ? 2 : d <= 15 ? 3 : d <= 30 ? 4 : 5,
      );
    }
    for (let d = 1; d < 60; d++) {
      const i = depthInfo(d);
      expect(new Set(i.mutators).size).toBe(i.mutators.length);
      expect(i.name.length).toBeGreaterThan(4);
    }
  });
  it("move the stairs and hoard but always leave a route", () => {
    for (let seed = 1; seed < 150; seed++)
      for (const depth of [2, 5, 9]) {
        const r = run(depth, seed);
        expect(hasRoute(r.layout)).toBe(true);
      }
  });
  it("scale hero strength without limit", () => {
    const a = raidMods({ ...run(1), night: 5 });
    const b = raidMods({ ...run(9), night: 5 });
    const c = raidMods({ ...run(20), night: 5 });
    expect(b.heroHp).toBeGreaterThan(a.heroHp);
    expect(c.heroHp).toBeGreaterThan(b.heroHp);
    expect(c.heroDmg).toBeGreaterThan(b.heroDmg);
  });
});

describe("parties", () => {
  it("keep new classes out of depth 1 until the abyss", () => {
    const r = run(1);
    const late = new Set<HeroClass>(["bard", "windcaller", "inquisitor"]);
    for (let n = 1; n <= NIGHTS; n++)
      for (const p of partyFor(r, n)) expect(late.has(p.cls)).toBe(false);
    const abyss = [11, 12, 13, 14, 16, 17, 18].flatMap((n) =>
      partyFor(r, n).map((p) => p.cls),
    );
    expect(abyss.some((c) => late.has(c))).toBe(true);
  });
  it("debut new classes at deeper depths", () => {
    const r = run(4);
    expect(partyFor(r, 7).some((p) => p.cls === "inquisitor")).toBe(true);
    expect(partyFor(r, 6).some((p) => p.cls === "windcaller")).toBe(true);
  });
  it("bring a champion every fifth abyss night, rotating", () => {
    const r = run(1);
    expect(partyFor(r, NIGHTS)[0].cls).toBe("paladin");
    expect(isChampionNight(15)).toBe(true);
    expect(isChampionNight(13)).toBe(false);
    expect(championFor(r, 15)).toBe("archmage");
    expect(championFor(r, 20)).toBe("warlord");
    expect(championFor(r, 25)).toBe("thane");
    expect(championFor(r, 40)).toBe("witch");
    expect(championFor(r, 45)).toBe("paladin");
    expect(partyFor(r, 15)[0].cls).toBe("archmage");
  });
  it("never exceed ten heroes", () => {
    for (const depth of [1, 8, 25])
      for (let n = 1; n < 40; n++)
        expect(partyFor(run(depth), n).length).toBeLessThanOrEqual(10);
  });
});

describe("capacity and reinforcing", () => {
  it("limits pieces per night", () => {
    const r = run(1);
    r.gold = 10_000;
    const cap = capacityFor(r);
    expect(cap).toBe(7);
    const floor: [number, number][] = [];
    for (let y = 0; y < r.layout.h; y++)
      for (let x = 0; x < r.layout.w; x++)
        if (!canPlace(r, "tar", x, y)) floor.push([x, y]);
    for (const [x, y] of floor) {
      if (r.layout.objects.length >= cap) break;
      place(r, "tar", x, y, 2);
    }
    const free = floor.find(
      ([x, y]) => !r.layout.objects.some((o) => o.x === x && o.y === y),
    )!;
    expect(canPlace(r, "tar", free[0], free[1])).toBe("full");
    r.night = 2;
    expect(canPlace(r, "tar", free[0], free[1])).toBe(null);
    expect(capacityFor({ ...r, workshop: true })).toBe(Infinity);
    expect(capacityFor({ ...r, relics: ["sprawl"] })).toBe(capacityFor(r) + 4);
  });
  it("reinforces blueprints with gold up to tier V", () => {
    const r = run(1);
    r.gold = 10_000;
    expect(reinforceCost(r, "lure")).toBe(null);
    const costs: number[] = [];
    while (reinforceCost(r, "spikes") !== null) {
      costs.push(reinforceCost(r, "spikes")!);
      expect(reinforce(r, "spikes")).toBe(true);
    }
    expect(r.tiers.spikes).toBe(5);
    expect(costs).toEqual([...costs].sort((a, b) => a - b));
    expect(reinforce(r, "spikes")).toBe(false);
  });
  it("drafts never offer tiers past III or a bait-chest upgrade", () => {
    const r = run(1);
    r.tiers = { spikes: 3 };
    for (let n = 2; n < 30; n++) {
      r.night = n;
      for (const c of draftFor(r, [])) {
        if (c.type === "tier") {
          expect(c.id).not.toBe("spikes");
          expect(c.id).not.toBe("lure");
        }
      }
    }
  });
  it("applying a relic twice has no effect", () => {
    const r = run(1);
    applyCard(r, { type: "relic", id: "hoardAges" });
    const max = r.hoardMax;
    applyCard(r, { type: "relic", id: "hoardAges" });
    expect(r.hoardMax).toBe(max);
  });
});

describe("new heroes", () => {
  it("windcallers drift over floor plates", () => {
    const r = raidOn(["windcaller"], [["spikes", 5, 3]]);
    runUntil(r, () => r.heroes[0].y > 5);
    expect(r.stats.damage.spikes ?? 0).toBe(0);
    const k = raidOn(["knight"], [["spikes", 5, 3]]);
    runUntil(k, () => k.heroes[0].y > 5);
    expect(k.stats.damage.spikes).toBeGreaterThan(0);
  });
  it("windcallers take extra damage from darts", () => {
    const hit = (cls: HeroClass) => {
      const r = raidOn([cls], [["darts", 5, 1, 2]]);
      runUntil(r, () => (r.stats.damage.darts ?? 0) > 0);
      return r.stats.damage.darts;
    };
    expect(hit("windcaller")).toBeGreaterThan(hit("mage"));
  });
  it("the warlord smashes the floor traps he crosses", () => {
    const r = raidOn(
      ["warlord"],
      [
        ["spikes", 5, 3],
        ["spring", 5, 5],
      ],
    );
    runUntil(r, () => r.heroes[0].y > 6);
    expect(r.traps.every((t) => t.disabled)).toBe(true);
  });
  it("inquisitors stop skeletons from reforming", () => {
    const r = raidOn(["inquisitor"], [["skeleton", 5, 4]]);
    const sk = r.monsters[0];
    runUntil(r, () => !sk.alive && sk.reformT === 0, 3000);
    expect(sk.alive).toBe(false);
    expect(sk.reforms).toBe(0);
  });
  it("bards inspire allies, making them fearless", () => {
    const r = raidOn(["knight", "bard"]);
    runUntil(r, () => r.heroes[0].st.insp > 0, 400);
    expect(r.heroes[0].st.insp).toBeGreaterThan(0);
  });
  it("the archmage blinks ahead along her route", () => {
    const r = raidOn(["archmage"]);
    const events: string[] = [];
    runUntil(r, () => {
      for (const e of r.events) events.push(e.k);
      r.events.length = 0;
      return events.includes("blink");
    });
    expect(events).toContain("blink");
  });
});

describe("new pieces, powers and relics", () => {
  it("storm pylons chain lightning through up to three heroes", () => {
    const r = raidOn(
      ["knight", "knight", "knight", "knight"],
      [["pylon", 6, 4]],
      {},
      (() => {
        const l = corridor();
        l.tiles[4 * l.w + 6] = T.Floor;
        return l;
      })(),
    );
    let zap: { pts: unknown[] } | null = null;
    runUntil(r, () => {
      for (const e of r.events) if (e.k === "zap") zap = e;
      r.events.length = 0;
      return zap !== null;
    });
    expect(zap).not.toBeNull();
    expect(zap!.pts.length).toBeGreaterThanOrEqual(2);
    expect(zap!.pts.length).toBeLessThanOrEqual(4);
  });
  it("spiders web heroes", () => {
    const r = raidOn(["knight"], [["spider", 5, 6]]);
    expect(runUntil(r, () => r.heroes[0].st.slow > 0, 2000)).toBe(true);
  });
  it("golems taunt heroes into fighting them", () => {
    const r = raidOn(
      ["ranger"],
      [
        ["golem", 5, 7],
        ["skeleton", 5, 4],
      ],
    );
    runUntil(
      r,
      () => r.heroes[0].alive && r.heroes[0].y > 2.5 && r.heroes[0].target >= 0,
      2000,
    );
    const golem = r.monsters.find((m) => m.kind === "golem")!;
    runUntil(
      r,
      () => r.heroes[0].target === golem.uid || !r.heroes[0].alive,
      2000,
    );
    expect(r.heroes[0].target).toBe(golem.uid);
  });
  it("grave chill slows and hurts heroes in range", () => {
    const r = raidOn(["knight"]);
    runUntil(r, () => r.heroes[0].alive && r.heroes[0].y > 3);
    r.dread = 10;
    const h = r.heroes[0];
    expect(r.cast("chill", Math.floor(h.x), Math.floor(h.y), 4)).toBe(true);
    r.step();
    expect(h.st.slow).toBeGreaterThan(0);
    expect(r.stats.damage.chill).toBeGreaterThan(0);
  });
  it("soul siphon raises starting dread and its cap", () => {
    const r = raidOn(["knight"], [], { relics: ["soulSiphon" as RelicId] });
    expect(r.dread).toBe(8);
    expect(r.dreadMax).toBe(20);
  });
  it("death knell stuns heroes near a kill", () => {
    const r = raidOn(["rogue", "rogue"], [], { relics: ["deathKnell"] });
    runUntil(r, () => r.heroes.every((h) => h.alive));
    r.heroes[0].x = r.heroes[1].x;
    r.heroes[0].y = r.heroes[1].y + 1;
    r.damage(r.heroes[0], 9999, "magic", "test");
    expect(r.heroes[1].st.stun).toBeGreaterThan(0);
  });
  it("ironclad mutator adds armor", () => {
    const a = raidOn(["rogue"]);
    const b = raidOn(["rogue"], [], { mutators: ["ironclad"] });
    expect(b.heroes[0].armor).toBe(a.heroes[0].armor + 2);
  });
});

describe("determinism with the new content", () => {
  it("replays a complex raid identically", () => {
    const party: HeroClass[] = [
      "warlord",
      "inquisitor",
      "bard",
      "windcaller",
      "cleric",
      "mage",
    ];
    const objs: [PieceId, number, number, number?][] = [
      ["pylon", 5, 3],
      ["spider", 5, 5],
      ["golem", 5, 8],
      ["skeleton", 5, 9],
      ["darts", 5, 1, 2],
      ["tar", 5, 6],
    ];
    const once = () => {
      const r = raidOn(party, objs, {
        relics: ["deathKnell", "thornHides"],
        mutators: ["blessed"],
      });
      while (!r.finished && r.tick < 6000) {
        r.step();
        r.events.length = 0;
      }
      return JSON.stringify(r.result());
    };
    expect(once()).toBe(once());
  });
});

describe("saves", () => {
  it("migrates v1 runs and profiles", () => {
    const old = { ...run(1), v: 1, infamy: 3 } as unknown as Record<
      string,
      unknown
    >;
    delete old.depth;
    const r = migrateRun(old)!;
    expect(r.v).toBe(2);
    expect(r.depth).toBe(4);
    expect(r.mutators).toEqual([]);
    expect((r as unknown as { infamy?: number }).infamy).toBeUndefined();
    const p = migrateProfile({
      v: 1,
      renown: 50,
      maxInfamy: 2,
      wins: 3,
      kills: 40,
      daily: { a: {} },
    });
    expect(p.v).toBe(2);
    expect(p.maxDepth).toBe(3);
    expect(p.stats.kills).toBe(40);
    expect(p.renown).toBeGreaterThanOrEqual(50);
    expect(migrateProfile(null).renown).toBe(0);
    expect(migrateRun({ v: 9 })).toBe(null);
  });
  it("awards feats once and counter feats by goal", () => {
    const p = migrateProfile(null);
    expect(award(p, "firstBlood")?.renown).toBe(2);
    expect(award(p, "firstBlood")).toBe(null);
    expect(p.renown).toBe(2);
    p.stats.kills = 150;
    expect(awardStats(p).map((f) => f.id)).toEqual(["kills100"]);
  });
  it("never pays renown twice across a victory and the abyss", () => {
    const r = run(3);
    for (let n = 1; n <= NIGHTS; n++)
      r.history.push({
        night: n,
        stars: 2,
        killed: 3,
        escaped: 0,
        stolen: 0,
        gold: 10,
        combo: 1,
      });
    r.victory = true;
    const first = renownFor(r) - r.renownPaid;
    r.renownPaid += first;
    expect(first).toBe(10 + 20 + 12 + 2 * 4);
    // Into the abyss.
    r.endless = true;
    r.victory = null;
    r.history.push({
      night: 11,
      stars: 3,
      killed: 6,
      escaped: 0,
      stolen: 0,
      gold: 10,
      combo: 1,
    });
    r.victory = false;
    expect(renownFor(r) - r.renownPaid).toBe(5);
  });
});

describe("balance bot smoke test", () => {
  it("plays whole runs without errors", () => {
    for (const depth of [1, 6]) {
      const res = playRun({ seed: 3, depth, abyssUntil: 13 });
      expect(res.nights).toBeGreaterThan(2);
    }
  });
  it("a reasonable player usually conquers depth 1", () => {
    let wins = 0;
    for (let s = 1; s <= 10; s++)
      if (playRun({ seed: s * 101 + 1, depth: 1 }).won) wins++;
    expect(wins).toBeGreaterThanOrEqual(6);
  });
});

it("simulate stays bounded with the biggest abyss parties", () => {
  const r = run(1);
  const party = partyFor(r, 30);
  const raid = simulate({
    layout: r.layout,
    party,
    seed: 1,
    night: 30,
    hoard: 12,
    mods: raidMods({ ...r, night: 30 }),
  });
  expect(raid.finished).toBe(true);
});
