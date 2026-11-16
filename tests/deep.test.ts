// Rules v4: floorplans aside, the deep expansion's heroes, pieces, relics,
// twists, omens, dawn visitors and depth crowns.
import { generateLayout, type Layout } from "../src/game/grid";
import {
  ARCHITECTS,
  BIOMES,
  FEATS,
  HEROES,
  OMENS,
  PIECES,
  RELICS,
  T,
  UNLOCKS,
  heatOf,
  powerCost,
  type HeroClass,
  type PieceId,
} from "../src/game/defs";
import {
  capacityFor,
  newRun,
  partyFor,
  raidMods,
  rerollCost,
  type RunState,
} from "../src/game/run";
import {
  ENCOUNTERS,
  encounterOptions,
  resolveEncounter,
  rollEncounter,
  settleWager,
  type Encounter,
  type EncounterId,
} from "../src/game/encounters";
import {
  defaultProfile,
  migrateProfile,
  realmSwept,
  recordDepthWin,
  totalCrowns,
} from "../src/game/profile";
import { Raid, type Hero, type RaidMods } from "../src/game/sim";

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
  l.hoard = { x: 5, y: 12 };
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
const events = (r: Raid, max = 4000) => {
  const out: Raid["events"] = [];
  for (let i = 0; i < max && !r.finished; i++) {
    r.step();
    out.push(...r.events);
    r.events.length = 0;
  }
  return out;
};
const run = (depth = 1, extra: Partial<Parameters<typeof newRun>[0]> = {}) =>
  newRun({
    seed: 77,
    biome: "crypt",
    architect: "mason",
    depth,
    powers: ["rockfall"],
    ...extra,
  });
/** Put a hero on the map right now (tests that need exact positions). */
function place(_r: Raid, h: Hero, x: number, y: number) {
  h.spawned = true;
  h.alive = true;
  h.x = h.px = x;
  h.y = h.py = y;
}

describe("new heroes", () => {
  it("monks turn aside every other dart", () => {
    const r = raidOn(["monk"], [["darts", 5, 1, 2]]);
    const ev = events(r, 1200);
    const deflects = ev.filter((e) => e.k === "deflect").length;
    const hits = ev.filter(
      (e) => e.k === "hit" && e.hero && e.dtype === "phys",
    ).length;
    expect(deflects).toBeGreaterThan(0);
    expect(Math.abs(deflects - hits)).toBeLessThanOrEqual(1);
  });
  it("monks shrug off tar", () => {
    const tar: [PieceId, number, number][] = [3, 4, 5, 6, 7, 8].map((y) => [
      "tar",
      5,
      y,
    ]);
    const reach = (cls: HeroClass, objs: typeof tar) => {
      const r = raidOn([cls], objs);
      runUntil(r, () => r.heroes[0].y >= 9.5);
      return r.tick;
    };
    expect(reach("monk", tar)).toBe(reach("monk", []));
    expect(reach("rogue", tar)).toBeGreaterThan(reach("rogue", []));
  });
  it("templars shield the allies around them, not themselves", () => {
    const r = raidOn(["knight", "templar"]);
    const [k, t] = r.heroes;
    place(r, k, 5.5, 5.5);
    place(r, t, 5.5, 20);
    const alone = r.damage(k, 60, "magic", "test");
    t.y = 6.5;
    const shielded = r.damage(k, 60, "magic", "test");
    expect(shielded).toBeLessThan(alone);
    expect(shielded).toBe(Math.round(alone * 0.75));
    const self = r.damage(t, 60, "magic", "test");
    expect(self).toBe(60);
  });
  it("the Witch Queen jams nearby traps", () => {
    const r = raidOn(["witch"], [["spikes", 5, 3]]);
    expect(runUntil(r, () => r.traps[0].jam > 0, 1200)).toBe(true);
    // A jammed plate does not bite.
    const hp = r.heroes[0].hp;
    r.heroes[0].x = 5.5;
    r.heroes[0].y = 3.5;
    (r as unknown as { onEnter(h: Hero, x: number, y: number): void }).onEnter(
      r.heroes[0],
      5,
      3,
    );
    expect(r.heroes[0].hp).toBe(hp);
  });
  it("a jinx pauses a rolling boulder instead of stopping it for good", () => {
    const l = corridor();
    const r = raidOn(["knight"], [["boulder", 5, 1, 2]], {}, l);
    expect(runUntil(r, () => r.traps[0].active, 1500)).toBe(true);
    const t = r.traps[0];
    t.jam = 10;
    for (let i = 0; i < 10; i++) r.step();
    const pos = t.pos;
    expect(t.active).toBe(true);
    for (let i = 0; i < 5; i++) r.step();
    expect(t.pos).toBeGreaterThan(pos);
  });
  it("join parties at their depths and nights", () => {
    let monk = 0;
    let templar = 0;
    for (let seed = 1; seed < 60; seed++) {
      const deep = { ...run(9), seed };
      const shallow = { ...run(3), seed };
      for (let n = 1; n <= 9; n++) {
        const p = partyFor(deep, n).map((m) => m.cls);
        if (p.includes("monk")) {
          monk++;
          expect(n).toBeGreaterThanOrEqual(5);
        }
        if (p.includes("templar")) {
          templar++;
          expect(n).toBeGreaterThanOrEqual(6);
        }
        const q = partyFor(shallow, n).map((m) => m.cls);
        expect(q).not.toContain("monk");
        expect(q).not.toContain("templar");
      }
    }
    expect(monk).toBeGreaterThan(0);
    expect(templar).toBeGreaterThan(0);
  });
  it("the fourth realm lord guards depth 20", () => {
    expect(partyFor(run(20), 10)[0].cls).toBe("witch");
  });
});

describe("new pieces", () => {
  it("bear traps bite and hold a hero", () => {
    const r = raidOn(["knight"], [["beartrap", 5, 3]]);
    expect(runUntil(r, () => r.heroes[0].st.stun > 0, 600)).toBe(true);
    expect(r.heroes[0].hp).toBeLessThan(r.heroes[0].maxHp);
  });
  it("windcallers float over bear traps", () => {
    const r = raidOn(["windcaller"], [["beartrap", 5, 3]]);
    runUntil(r, () => r.heroes[0].y > 6, 800);
    expect(r.heroes[0].hp).toBe(r.heroes[0].maxHp);
  });
  it("soul lanterns pay more for the dead around them", () => {
    const gold = (withLantern: boolean) => {
      const objs: [PieceId, number, number][] = [
        ["spikes", 5, 3],
        ["spikes", 5, 4],
        ["spikes", 5, 5],
        ["spikes", 5, 6],
      ];
      // The lantern hangs in the rock-free tile beside the killing floor.
      const l = corridor();
      l.tiles[4 * l.w + 6] = T.Floor;
      if (withLantern) objs.push(["lantern", 6, 4]);
      const r = raidOn(["rogue"], objs, { heroHp: 0.3 }, l);
      runUntil(r, () => r.finished);
      return { gold: r.gold, killed: r.result().killed };
    };
    const a = gold(false);
    const b = gold(true);
    expect(a.killed).toBe(1);
    expect(b.killed).toBe(1);
    expect(b.gold).toBeGreaterThan(a.gold);
  });
  it("basilisks turn heroes to stone", () => {
    const r = raidOn(["knight"], [["basilisk", 5, 6]]);
    const ev = events(r, 800);
    expect(ev.some((e) => e.k === "gaze")).toBe(true);
  });
  it("kobolds repair what rogues disarm", () => {
    const r = raidOn(
      ["rogue"],
      [
        ["spikes", 5, 3],
        ["kobold", 5, 5],
      ],
    );
    const ev = events(r, 2000);
    expect(ev.some((e) => e.k === "disarm")).toBe(true);
    expect(ev.some((e) => e.k === "repair")).toBe(true);
  });
  it("are appended so old links still decode", () => {
    const ids = Object.keys(PIECES);
    expect(ids.slice(-4)).toEqual([
      "beartrap",
      "lantern",
      "basilisk",
      "kobold",
    ]);
  });
});

describe("new relics", () => {
  it("Crown of Thorns punishes looters", () => {
    const r = raidOn(["knight"], [], { relics: ["thornCrown"] });
    const ev = events(r, 3000);
    expect(ev.some((e) => e.k === "hit" && e.hero && e.amount >= 30)).toBe(
      true,
    );
  });
  it("Ancestral Keys make rerolls free", () => {
    const a = run();
    a.rerolls = 3;
    expect(rerollCost(a)).toBe(40);
    a.relics.push("keys");
    expect(rerollCost(a)).toBe(0);
  });
  it("Haunted Halls make frightened heroes take more", () => {
    const r = raidOn(["rogue"], [], { relics: ["haunted"] });
    const h = r.heroes[0];
    place(r, h, 5.5, 5.5);
    const calm = r.damage(h, 20, "magic", "test");
    h.st.fear = 40;
    expect(r.damage(h, 20, "magic", "test")).toBe(Math.round(calm * 1.25));
  });
  it("all have names, text and rarities", () => {
    for (const r of Object.values(RELICS)) {
      expect(r.name.length).toBeGreaterThan(2);
      expect(r.text.length).toBeGreaterThan(8);
    }
  });
});

describe("new twists and omens", () => {
  it("Pilgrims bring an extra cleric", () => {
    const base = run(9);
    base.mutators = [];
    const pil = { ...base, mutators: ["pilgrims" as const] };
    for (let n = 3; n <= 9; n++) {
      const a = partyFor(base, n).filter((p) => p.cls === "cleric").length;
      const b = partyFor(pil, n).filter((p) => p.cls === "cleric").length;
      expect(b).toBeGreaterThanOrEqual(a);
    }
    for (let seed = 1; seed < 80; seed++)
      for (let n = 3; n <= 9; n++) {
        const a = { ...base, seed };
        const b = { ...pil, seed };
        const ca = partyFor(a, n).filter((p) => p.cls === "cleric").length;
        const cb = partyFor(b, n).filter((p) => p.cls === "cleric").length;
        if (partyFor(a, n).length < 10) expect(cb).toBeGreaterThan(ca);
      }
  });
  it("Eclipse raises power costs and Ley Lines start raids with dread", () => {
    expect(powerCost("rockfall", [], ["eclipse"])).toBe(7);
    const r = raidOn(["knight"], [], { mutators: ["leyLines"] });
    expect(r.dread).toBe(9);
  });
  it("Stockpile and the Warden change the start", () => {
    const a = run(5);
    a.mutators = [];
    const b = newRun({
      seed: 77,
      biome: "crypt",
      architect: "warden",
      depth: 5,
      powers: [],
    });
    expect(b.hoardMax).toBe(a.hoardMax + 4);
    expect(ARCHITECTS.find((x) => x.id === "warden")!.start).toContain(
      "beartrap",
    );
  });
  it("Teeming Halls grow parties; Tempered Steel adds armor", () => {
    let more = 0;
    for (let seed = 1; seed < 30; seed++) {
      const a = { ...run(3), seed };
      const b = { ...a, omens: ["teeming" as const] };
      const pa = partyFor(a, 8).reduce((s, p) => s + HEROES[p.cls].points, 0);
      const pb = partyFor(b, 8).reduce((s, p) => s + HEROES[p.cls].points, 0);
      if (pb > pa) more++;
      expect(pb).toBeGreaterThanOrEqual(pa);
    }
    expect(more).toBeGreaterThan(10);
    const r = raidOn(["knight"], [], { omens: ["tempered"] });
    expect(r.heroes[0].armor).toBe(HEROES.knight.armor + 1);
    expect(heatOf(["teeming", "blind", "tempered"])).toBe(5);
    expect(Object.values(OMENS).reduce((a, o) => a + o.heat, 0)).toBe(26);
  });
});

describe("dawn visitors", () => {
  const ids = Object.keys(ENCOUNTERS) as EncounterId[];
  const sample = () => {
    const out: { run: RunState; e: Encounter }[] = [];
    for (let seed = 1; seed < 400 && out.length < 400; seed++) {
      const r = { ...run(4), seed: seed * 7 };
      r.gold = 400;
      r.owned = ["spikes", "darts", "skeleton", "lure"];
      for (let n = 3; n <= 14; n++) {
        const x = structuredClone({ ...r, night: n });
        const e = rollEncounter(x);
        if (e) out.push({ run: x, e });
      }
    }
    return out;
  };
  it("are deterministic and come now and then", () => {
    const r = run(4);
    let seen = 0;
    for (let n = 1; n <= 10; n++) {
      const a = rollEncounter({ ...r, night: n });
      expect(rollEncounter({ ...r, night: n })).toEqual(a);
      if (a) {
        expect(n).toBeGreaterThanOrEqual(3);
        seen++;
      }
    }
    const all = sample();
    expect(new Set(all.map((x) => x.e.id)).size).toBe(ids.length);
    void seen;
  });
  it("are the same for every player in a daily", () => {
    for (let n = 3; n <= 10; n++) {
      const a = { ...run(3), seed: 991, night: n };
      const b = structuredClone(a);
      b.relics = ["bloodMoney", "sharpIron", "keys", "spite"];
      b.hoard = 3;
      b.owned = ["spikes", "darts", "skeleton", "lure", "beartrap"];
      const ea = rollEncounter(a);
      const eb = rollEncounter(b);
      if (ea && eb) expect(eb.id).toBe(ea.id);
    }
  });
  it("never come two nights running", () => {
    const r = run(4);
    r.lastEncounter = 5;
    expect(rollEncounter({ ...r, night: 6 })).toBeNull();
  });
  it("every offer does what it says, and leaving costs nothing", () => {
    for (const { run: r0, e } of sample()) {
      const opts = encounterOptions(r0, e);
      expect(opts.length).toBeGreaterThanOrEqual(2);
      for (let i = 0; i < opts.length; i++) {
        const r = structuredClone(r0);
        const before = {
          gold: r.gold,
          relics: r.relics.length,
          hoard: r.hoard,
          max: r.hoardMax,
          cap: capacityFor(r),
          hp: raidMods(r).heroHp,
        };
        const msg = resolveEncounter(r, e, i);
        expect(r.encounter).toBeNull();
        expect(r.lastEncounter).toBe(e.night);
        if (opts[i].leave || !opts[i].ok) {
          expect(msg).toBeNull();
          expect(r.gold).toBe(before.gold);
          continue;
        }
        expect(msg).toBeTruthy();
        expect(r.gold).toBeGreaterThanOrEqual(0);
        // Gold Rush pays 30 the moment it is taken.
        const rush =
          r.relics.includes("goldRush") && !r0.relics.includes("goldRush")
            ? 30
            : 0;
        if (opts[i].cost)
          expect(r.gold).toBe(before.gold - opts[i].cost + rush);
        switch (e.id) {
          case "merchant":
            expect(r.relics.length).toBe(before.relics + 1);
            break;
          case "shrine":
            expect(r.relics.length).toBe(before.relics + 1);
            expect(raidMods(r).heroHp).toBeGreaterThan(before.hp);
            break;
          case "cartographer":
            expect(capacityFor(r)).toBe(before.cap + 2);
            break;
          case "hunters":
            expect(r.hoard).toBe(before.hoard + 2);
            expect(r.hoardMax).toBe(before.max + 2);
            break;
          case "altar":
            expect(r.hoard).toBe(before.hoard - 2);
            expect(r.gold).toBe(before.gold + e.price!);
            break;
          case "turncoat":
            expect(partyFor(r, r.night).length).toBe(
              partyFor({ ...r, bribe: undefined }, r.night).length - 1,
            );
            break;
          case "smith": {
            const id = e.pieces![i];
            expect(r.tiers[id]).toBe((r0.tiers[id] ?? 1) + 1);
            break;
          }
        }
      }
    }
  });
  it("pay out a won wager only on three stars", () => {
    const r = run(4);
    r.wager = { night: 5, stake: 40 };
    expect(settleWager(r, 5, 2)).toBe(0);
    expect(r.wager).toBeNull();
    r.wager = { night: 5, stake: 40 };
    const g = r.gold;
    expect(settleWager(r, 5, 3)).toBe(120);
    expect(r.gold).toBe(g + 120);
  });
});

describe("depth crowns", () => {
  const won = (depth: number, stolen = 0, omens: RunState["omens"] = []) => {
    const r = run(depth, { omens });
    r.history = Array.from({ length: 10 }, (_, i) => ({
      night: i + 1,
      stars: stolen ? 1 : 3,
      killed: 3,
      escaped: 0,
      stolen: i === 4 ? stolen : 0,
      gold: 0,
      combo: 0,
    }));
    r.victory = true;
    return r;
  };
  it("award conquered, flawless and ascendant once each", () => {
    const p = defaultProfile();
    const a = recordDepthWin(p, won(3, 2));
    expect(a.crowns).toEqual(["Conquered"]);
    const b = recordDepthWin(p, won(3));
    expect(b.crowns).toEqual(["Flawless"]);
    expect(b.renown).toBe(4);
    const c = recordDepthWin(p, won(3, 0, ["ironWill", "swift", "meager"]));
    expect(c.crowns).toEqual(["Ascendant"]);
    expect(recordDepthWin(p, won(3)).crowns).toEqual([]);
    expect(p.depths[3].crowns).toBe(7);
    expect(p.depths[3].wins).toBe(4);
    expect(totalCrowns(p)).toBe(3);
    expect(p.stats.crowns).toBe(3);
    expect(p.planWins).toContain("fork");
  });
  it("sweep a realm only when all fifteen are earned", () => {
    const p = defaultProfile();
    for (let d = 1; d <= 5; d++)
      recordDepthWin(p, won(d, 0, ["ironWill", "swift", "meager"]));
    expect(realmSwept(p, 3)).toBe(true);
    expect(realmSwept(p, 7)).toBe(false);
  });
  it("credit old saves with the depths they had conquered", () => {
    const p = migrateProfile({
      ...defaultProfile(),
      bestDepth: 4,
      maxDepth: 5,
      depths: undefined,
    });
    expect(totalCrowns(p)).toBe(4);
    expect(p.depths[4].crowns).toBe(1);
  });
});

describe("progression data", () => {
  it("keeps the unlock track sorted and valid", () => {
    for (let i = 1; i < UNLOCKS.length; i++)
      expect(UNLOCKS[i].at).toBeGreaterThan(UNLOCKS[i - 1].at);
    for (const u of UNLOCKS) {
      if (u.kind === "piece") expect(PIECES[u.id as PieceId]).toBeTruthy();
      if (u.kind === "biome")
        expect(BIOMES[u.id as keyof typeof BIOMES]).toBeTruthy();
      if (u.kind === "architect")
        expect(ARCHITECTS.some((a) => a.id === u.id)).toBe(true);
    }
    expect(new Set(FEATS.map((f) => f.id)).size).toBe(FEATS.length);
  });
});
