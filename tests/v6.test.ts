// Rules v6: the Sanctum (souls, the Dungeon Heart, the Forge, the Dark Arts,
// heirlooms and the Soul Well).
import { Rng } from "../src/engine/math";
import { generateLayout, type Layout } from "../src/game/grid";
import {
  FEATS,
  NIGHTS,
  PIECES,
  T,
  type HeroClass,
  type PieceId,
} from "../src/game/defs";
import {
  BASES,
  FORGE_CAP,
  FORGE_ROWS,
  HEART,
  LEGENDS,
  RARITIES,
  ROW_POINTS,
  STATS,
  TALENTS,
  VAULT_SIZE,
  WELL_HOURS,
  buyHeart,
  canLower,
  canRaise,
  collectWell,
  defaultMeta,
  equip,
  forgeCost,
  forgePiece,
  heartCost,
  heirloomDrop,
  heirloomSlots,
  heirloomStats,
  infamyLevel,
  infamyStep,
  keepHeirloom,
  lowerTalent,
  metaBonus,
  nightSouls,
  pieceMeta,
  raiseTalent,
  rollHeirloom,
  salvage,
  salvageAll,
  setPieceTalent,
  talentPoints,
  talentsValid,
  temper,
  unspentPoints,
  wellAmount,
  winSouls,
  type Heirloom,
  type MetaProfile,
  type RunMeta,
} from "../src/game/meta";
import {
  defaultProfile,
  migrateProfile,
  recordNight,
} from "../src/game/profile";
import {
  capacityFor,
  dawnIncome,
  draftFor,
  newRun,
  pieceCost,
  raidMods,
  reinforceCost,
  rerollCost,
  sellValue,
  applyCard,
} from "../src/game/run";
import {
  Raid,
  simulate,
  type RaidMods,
  type RaidResult,
} from "../src/game/sim";

const meta = (s: RunMeta["s"] = {}, extra: Partial<RunMeta> = {}): RunMeta => ({
  s,
  p: {},
  keys: [],
  ...extra,
});
const xpForLevel = (l: number) => {
  let xp = 0;
  for (let i = 1; i < l; i++) xp += infamyStep(i);
  return xp;
};
const prof = (extra: Partial<MetaProfile> = {}) => ({
  ...defaultMeta(),
  mastery: {} as Record<string, number>,
  ...extra,
});
const run = (extra: Partial<Parameters<typeof newRun>[0]> = {}) =>
  newRun({
    seed: 77,
    biome: "crypt",
    architect: "mason",
    depth: 3,
    powers: ["rockfall"],
    ...extra,
  });
const mods = (extra: Partial<RaidMods> = {}): RaidMods => ({
  heroHp: 1,
  heroDmg: 1,
  heroSpeed: 1,
  monsterHp: 1,
  relics: [],
  tiers: {},
  schools: false,
  ...extra,
});
function corridor(objects: [PieceId, number, number][]): Layout {
  const l = generateLayout(1, "crypt");
  l.tiles = l.tiles.map((t) => (t === T.Floor ? T.Rock : t));
  for (let y = 0; y <= 12; y++) l.tiles[y * l.w + 5] = T.Floor;
  l.entrance = { x: 5, y: 0 };
  l.hoard = { x: 5, y: 12 };
  l.objects = objects.map(([kind, x, y], i) => ({
    id: i + 1,
    kind,
    x,
    y,
    dir: 2,
  }));
  return l;
}
const raid = (
  objects: [PieceId, number, number][],
  party: { cls: HeroClass; elite?: boolean }[],
  m: Partial<RaidMods> = {},
) =>
  simulate({
    layout: corridor(objects),
    party,
    seed: 9,
    night: 1,
    hoard: 12,
    mods: mods(m),
  });

describe("infamy", () => {
  it("levels are endless and each is a talent point", () => {
    expect(infamyLevel(0).level).toBe(1);
    expect(infamyLevel(infamyStep(1) - 1).level).toBe(1);
    expect(infamyLevel(infamyStep(1)).level).toBe(2);
    expect(infamyLevel(xpForLevel(50)).level).toBe(50);
    expect(infamyLevel(xpForLevel(300)).level).toBe(300);
    expect(talentPoints(xpForLevel(12))).toBe(11);
    // Steps grow, so later levels take longer.
    expect(infamyStep(20)).toBeGreaterThan(infamyStep(2));
  });
  it("heirloom slots open at infamy 10 and 25", () => {
    expect(heirloomSlots(0)).toBe(3);
    expect(heirloomSlots(xpForLevel(10))).toBe(4);
    expect(heirloomSlots(xpForLevel(25))).toBe(5);
  });
});

describe("souls", () => {
  it("pay more at depth, under heat and in the abyss", () => {
    const night = { killed: 6, stars: 3 };
    const shallow = nightSouls({ depth: 1, night: 3 }, night);
    expect(shallow).toBe(2 + 6 + 9);
    expect(nightSouls({ depth: 10, night: 3 }, night)).toBeGreaterThan(shallow);
    expect(
      nightSouls({ depth: 1, night: 3, omens: ["ironWill"] }, night),
    ).toBeGreaterThan(shallow);
    expect(nightSouls({ depth: 1, night: 12 }, night)).toBeGreaterThan(shallow);
    expect(nightSouls({ depth: 1, night: 3 }, night, 0.5)).toBe(
      Math.round(shallow * 1.5),
    );
    // Realm lords pay half again.
    expect(winSouls({ depth: 5 })).toBeGreaterThan(
      winSouls({ depth: 6 }) * 1.2,
    );
  });
  it("are credited every night, with conquests and bounties", () => {
    const p = defaultProfile();
    const r = {
      killed: 5,
      kills: { spikes: 5 },
      classKills: { knight: 5 },
      fireKills: 0,
      falls: 0,
      powerKills: 0,
      gold: 50,
      bestCombo: 1,
      schools: {},
    } as unknown as RaidResult;
    const a = recordNight(
      p,
      { architect: "mason", depth: 2, night: 3, seed: 1, omens: [] },
      r,
      3,
      true,
      "2026-01-01",
    );
    expect(a.souls).toBeGreaterThan(0);
    expect(a.infamy).toBeGreaterThan(0);
    expect(p.souls).toBe(a.souls);
    expect(p.stats.souls).toBe(a.souls);
    const win = recordNight(
      p,
      { architect: "mason", depth: 2, night: NIGHTS, seed: 1, omens: [] },
      r,
      3,
      true,
      "2026-01-01",
    );
    expect(win.souls).toBeGreaterThan(a.souls + winSouls({ depth: 2 }) - 1);
    // A conquest always finds an heirloom, at least Magic.
    expect(win.heirloom).not.toBeNull();
    expect(win.heirloom!.rarity).toBeGreaterThanOrEqual(1);
    expect(p.heirlooms).toHaveLength(1);
    // Dailies earn souls but find no heirlooms.
    const d = recordNight(
      p,
      {
        architect: "mason",
        depth: 2,
        night: NIGHTS,
        seed: 1,
        daily: "2026-01-01",
      },
      r,
      3,
      true,
      "2026-01-01",
    );
    expect(d.souls).toBeGreaterThan(0);
    expect(d.heirloom).toBeNull();
  });
});

describe("the Dungeon Heart", () => {
  it("costs grow, capped upgrades stop and infamy reveals the rest", () => {
    for (const d of HEART) {
      expect(heartCost(d, 1)!).toBeGreaterThanOrEqual(heartCost(d, 0)!);
      if (d.max !== undefined) expect(heartCost(d, d.max)).toBeNull();
      else expect(heartCost(d, 200)).not.toBeNull();
      expect(STATS[d.stat]).toBeDefined();
    }
    expect(new Set(HEART.map((d) => d.id)).size).toBe(HEART.length);
    const p = prof({ souls: 1000 });
    expect(buyHeart(p, "whetstone")).toBe(true);
    expect(p.souls).toBe(1000 - heartCost(HEART[0], 0)!);
    expect(p.heart.whetstone).toBe(1);
    // Expanse needs infamy 12.
    expect(buyHeart(p, "expanse")).toBe(false);
    p.infamyXp = xpForLevel(12);
    p.souls = 10_000;
    expect(buyHeart(p, "expanse")).toBe(true);
    const poor = prof({ souls: 0 });
    expect(buyHeart(poor, "whetstone")).toBe(false);
  });
  it("adds up into the run snapshot, with caps", () => {
    const p = prof({ heart: { whetstone: 10, coffers: 5, expanse: 2 } });
    const m = metaBonus(p);
    expect(m.s.trapDmg).toBeCloseTo(0.15);
    expect(m.s.startGold).toBe(20);
    expect(m.s.capacity).toBe(2);
    const big = metaBonus(prof({ heart: { cogs: 999 } }));
    expect(big.s.rearm).toBe(STATS.rearm.cap);
  });
});

describe("the Forge", () => {
  it("mastery caps the forge until rank IV", () => {
    const p = prof({ souls: 1e9 });
    let n = 0;
    while (forgePiece(p, "spikes")) n++;
    expect(n).toBe(FORGE_CAP[0]);
    p.mastery.spikes = 40; // rank II
    while (forgePiece(p, "spikes")) n++;
    expect(n).toBe(FORGE_CAP[2]);
    p.mastery.spikes = 300; // rank IV: endless
    for (let i = 0; i < 40; i++) expect(forgePiece(p, "spikes")).toBe(true);
    expect(forgeCost(10)).toBeGreaterThan(forgeCost(1));
  });
  it("talent rows open at their forge level and can be switched", () => {
    const p = prof();
    expect(setPieceTalent(p, "spikes", 0, 0)).toBe(false);
    p.forge.spikes = FORGE_ROWS[0];
    expect(setPieceTalent(p, "spikes", 0, 0)).toBe(true);
    expect(setPieceTalent(p, "spikes", 1, 0)).toBe(false);
    expect(pieceMeta(5, p.ptalents.spikes).pow).toBeCloseTo(0.075 + 0.1);
    expect(setPieceTalent(p, "spikes", 0, 1)).toBe(true);
    expect(pieceMeta(5, p.ptalents.spikes)).toEqual({ pow: 0.075, cost: 0.2 });
    const all = pieceMeta(30, [0, 1, 1]);
    expect(all).toEqual({ pow: 0.55, dread: 1, reinforce: 0.4 });
    expect(pieceMeta(30, [1, 0, 0])).toEqual({
      pow: 0.45,
      cost: 0.2,
      gold: 0.5,
      tier: 1,
    });
  });
});

describe("the Dark Arts", () => {
  it("every talent is sound", () => {
    expect(new Set(TALENTS.map((t) => t.id)).size).toBe(TALENTS.length);
    for (const t of TALENTS) {
      expect(STATS[t.stat]).toBeDefined();
      expect(t.row).toBeGreaterThanOrEqual(0);
      expect(t.row).toBeLessThan(4);
    }
    // Each branch has an endless node, so points are never wasted.
    for (const b of ["engineer", "warlord", "overseer"])
      expect(TALENTS.some((t) => t.branch === b && t.max === undefined)).toBe(
        true,
      );
  });
  it("rows need points above them, and points must be earned", () => {
    const p = prof({ infamyXp: xpForLevel(30) });
    expect(canRaise(p, "kindling")).toBe("row");
    for (let i = 0; i < ROW_POINTS; i++)
      expect(raiseTalent(p, "edges")).toBe(true);
    expect(canRaise(p, "edges")).toBe("max");
    expect(raiseTalent(p, "kindling")).toBe(true);
    // Lowering the first row would strand row two.
    expect(canLower(p, "edges")).toBe(false);
    expect(canLower(p, "kindling")).toBe(true);
    expect(lowerTalent(p, "kindling")).toBe(true);
    expect(canLower(p, "edges")).toBe(true);
    expect(talentsValid(p.talents)).toBe(true);
    const broke = prof({ infamyXp: 0 });
    expect(canRaise(broke, "edges")).toBe("points");
    expect(unspentPoints(p)).toBe(29 - ROW_POINTS);
  });
  it("keystones grant their rule", () => {
    const p = prof({
      talents: { hide: 5, claws: 5, terror: 2, hunt: 1, grim: 2, legion: 1 },
    });
    expect(talentsValid(p.talents)).toBe(true);
    const m = metaBonus(p);
    expect(m.keys).toContain("legion");
    expect(m.s.monsterHp).toBeCloseTo(0.15);
    expect(m.s.dread).toBe(2);
  });
});

describe("heirlooms", () => {
  it("roll by rarity, deterministically", () => {
    const a = rollHeirloom(new Rng(5), 1, 10);
    const b = rollHeirloom(new Rng(5), 1, 10);
    expect(a).toEqual(b);
    for (let s = 0; s < 400; s++) {
      const it = rollHeirloom(new Rng(s), s, 1 + (s % 40));
      expect(it.affixes.length).toBe(1 + RARITIES[it.rarity].affixes);
      expect(it.affixes[0][0]).toBe(BASES[it.base].stat);
      expect(new Set(it.affixes.map((x) => x[0])).size).toBe(it.affixes.length);
      expect(!!it.legend).toBe(it.rarity === 4);
      for (const [, v] of Object.entries(heirloomStats(it)))
        expect(Number.isFinite(v)).toBe(true);
    }
    // Item level makes the same roll stronger.
    const lo = rollHeirloom(new Rng(3), 1, 1);
    const hi = { ...lo, ilvl: 30 };
    const k = lo.affixes[0][0];
    expect(heirloomStats(hi)[k]!).toBeGreaterThan(heirloomStats(lo)[k]!);
  });
  it("drop from conquests always, from good nights sometimes, fixed by the seed", () => {
    const base = { seed: 4, depth: 5, stars: 3, luck: 0 };
    const win = heirloomDrop({ ...base, night: NIGHTS, won: true }, 1)!;
    expect(win.rarity).toBeGreaterThanOrEqual(2); // a realm lord's depth
    expect(heirloomDrop({ ...base, night: NIGHTS, won: true }, 1)).toEqual(win);
    let found = 0;
    for (let s = 0; s < 500; s++)
      if (heirloomDrop({ ...base, seed: s, night: 4, won: false }, 1)) found++;
    expect(found).toBeGreaterThan(50);
    expect(found).toBeLessThan(200);
    expect(
      heirloomDrop({ ...base, stars: 1, night: 4, won: false }, 1),
    ).toBeNull();
  });
  it("equip into slots, temper to a cap, salvage the rest", () => {
    const p = prof({ souls: 1e6 });
    const items = [0, 1, 2, 3].map((i) =>
      rollHeirloom(new Rng(i + 10), i + 1, 5),
    );
    for (const it of items) keepHeirloom(p, it);
    expect(equip(p, 1)).toBe(true);
    expect(equip(p, 1)).toBe(false);
    expect(equip(p, 2)).toBe(true);
    expect(equip(p, 3)).toBe(true);
    expect(equip(p, 4)).toBe(false); // three slots
    let n = 0;
    while (temper(p, 1)) n++;
    expect(n).toBe(RARITIES[items[0].rarity].temper);
    expect(salvage(p, 1)).toBe(0); // equipped
    p.heirlooms[3].locked = true;
    expect(salvage(p, 4)).toBe(0); // locked
    expect(salvageAll(p, 4)).toBe(0);
    p.heirlooms[3].locked = false;
    expect(salvage(p, 4)).toBeGreaterThan(0);
    expect(p.heirlooms).toHaveLength(3);
  });
  it("a full vault salvages new finds", () => {
    const p = prof();
    for (let i = 0; i < VAULT_SIZE; i++)
      expect(keepHeirloom(p, rollHeirloom(new Rng(i), i + 1, 3))).toBe(0);
    expect(keepHeirloom(p, rollHeirloom(new Rng(99), 99, 3))).toBeGreaterThan(
      0,
    );
    expect(p.heirlooms).toHaveLength(VAULT_SIZE);
  });
  it("two copies of one legendary power don't stack", () => {
    const mk = (id: number): Heirloom => ({
      id,
      base: "chalice",
      rarity: 4,
      ilvl: 1,
      affixes: [["souls", 0]],
      temper: 0,
      legend: "crownDeep",
    });
    const p = prof({ heirlooms: [mk(1), mk(2)], equipped: [1, 2] });
    expect(metaBonus(p).s.capacity).toBe(LEGENDS.crownDeep.stats.capacity);
  });
});

describe("runs carry the Sanctum", () => {
  it("leaves runs without one untouched", () => {
    const plain = run();
    expect(plain.meta).toBeUndefined();
    expect("meta" in raidMods(plain)).toBe(false);
  });
  it("applies economy bonuses", () => {
    const plain = run();
    const m = meta({
      startGold: 30,
      hoard: 2,
      capacity: 2,
      draft: 1,
      reroll: 6,
      tribute: 0.5,
      refund: 0.25,
      reinforce: 0.5,
    });
    const r = run({ meta: m });
    expect(r.gold).toBe(plain.gold + 30);
    expect(r.hoardMax).toBe(plain.hoardMax + 2);
    expect(capacityFor(r)).toBe(capacityFor(plain) + 2);
    expect(draftFor(r, Object.keys(PIECES) as PieceId[]).length).toBe(
      draftFor(plain, Object.keys(PIECES) as PieceId[]).length + 1,
    );
    expect(rerollCost(r)).toBe(4);
    expect(dawnIncome(r, 3)).toBe(Math.round(dawnIncome(plain, 3) * 1.5));
    expect(reinforceCost(r, "spikes")).toBe(
      Math.round(reinforceCost(plain, "spikes")! * 0.5),
    );
    // Old pieces sell back at full price with a 25% refund bonus.
    const gift = r.layout.objects[0];
    r.gifts = [];
    r.fresh = [];
    expect(sellValue(r, gift.id)).toBe(pieceCost(r, gift.kind));
  });
  it("applies forge talents to cost and tier, and Legion adds a monster", () => {
    const m = meta(
      {},
      { p: { skeleton: { cost: 0.2, tier: 1 } }, keys: ["legion"] },
    );
    const plain = run();
    const r = run({ meta: m });
    expect(pieceCost(r, "skeleton")).toBe(
      Math.round(PIECES.skeleton.cost * 0.8),
    );
    expect(r.owned.length).toBe(plain.owned.length + 1);
    const extra = r.owned.find((x) => !plain.owned.includes(x))!;
    expect(PIECES[extra].kind).toBe("monster");
    expect(r.tiers.skeleton).toBe(2);
    const r2 = run({ meta: meta({}, { p: { ogre: { tier: 1 } } }) });
    applyCard(r2, { type: "piece", id: "ogre" });
    expect(r2.tiers.ogre).toBe(2);
  });
});

describe("raids carry the Sanctum", () => {
  const knight = [{ cls: "knight" as HeroClass }];
  const dmg = (r: Raid, src: string) => r.result().damage[src] ?? 0;
  it("trap damage and forge power raise trap damage", () => {
    const base = raid([["spikes", 5, 4]], knight);
    expect(dmg(base, "spikes")).toBeGreaterThan(0);
    const up = raid([["spikes", 5, 4]], knight, {
      meta: meta({ trapDmg: 0.5 }),
    });
    expect(dmg(up, "spikes")).toBeGreaterThan(dmg(base, "spikes"));
    const forged = raid([["spikes", 5, 4]], knight, {
      meta: meta({}, { p: { spikes: { pow: 0.5 } } }),
    });
    expect(dmg(forged, "spikes")).toBeGreaterThan(dmg(base, "spikes"));
  });
  it("monster health and damage grow", () => {
    const setup = (m?: RunMeta) =>
      new Raid({
        layout: corridor([["skeleton", 5, 8]]),
        party: knight,
        seed: 9,
        night: 1,
        hoard: 12,
        mods: mods(m ? { meta: m } : {}),
      });
    const a = setup();
    const b = setup(meta({ monsterHp: 1, monsterDmg: 0.5 }));
    const c = setup(meta({}, { p: { skeleton: { pow: 1 } } }));
    expect(b.monsters[0].maxHp).toBe(a.monsters[0].maxHp * 2);
    expect(b.monsters[0].dmg).toBeCloseTo(a.monsters[0].dmg * 1.5);
    expect(c.monsters[0].maxHp).toBe(a.monsters[0].maxHp * 2);
  });
  it("dread and bounty gold", () => {
    const r = new Raid({
      layout: corridor([]),
      party: knight,
      seed: 9,
      night: 1,
      hoard: 12,
      mods: mods({ meta: meta({ dread: 4 }) }),
    });
    expect(r.dread).toBe(7);
    expect(r.dreadMax).toBe(19);
    const objs: [PieceId, number, number][] = [
      ["spikes", 5, 2],
      ["spikes", 5, 4],
      ["spikes", 5, 6],
      ["skeleton", 5, 9],
      ["skeleton", 5, 10],
    ];
    const plain = raid(objs, knight);
    const rich = raid(objs, knight, { meta: meta({ bounty: 1 }) });
    expect(plain.result().killed).toBe(1);
    expect(rich.result().gold).toBe(plain.result().gold * 2);
  });
});

describe("profiles", () => {
  it("old saves get an empty Sanctum, veterans a head start", () => {
    const fresh = migrateProfile(null);
    expect(fresh.souls).toBe(0);
    expect(fresh.heirlooms).toEqual([]);
    const old = { ...defaultProfile(), renown: 300 } as Record<string, unknown>;
    for (const k of Object.keys(defaultMeta())) delete old[k];
    const p = migrateProfile(old);
    expect(p.souls).toBe(900);
    expect(p.infamyXp).toBe(2400);
    expect(p.stats.heart).toBe(0);
    // A v6 save keeps its own values.
    const again = migrateProfile(JSON.parse(JSON.stringify(p)));
    expect(again.souls).toBe(900);
  });
  it("drops equipped ids that no longer exist", () => {
    const p = migrateProfile({ ...defaultProfile(), equipped: [5, 7] });
    expect(p.equipped).toEqual([]);
  });
  it("Sanctum feats are well formed", () => {
    for (const id of [
      "souls1k",
      "heart25",
      "forge50",
      "infamy10",
      "legendary",
      "purist",
      "keystone",
    ])
      expect(FEATS.some((f) => f.id === id)).toBe(true);
    expect(new Set(FEATS.map((f) => f.id)).size).toBe(FEATS.length);
  });
});

describe("the Soul Well", () => {
  it("fills after the first conquest, up to its cap", () => {
    const p = prof({ wellAt: 0 });
    expect(wellAmount(p, 0, 0, 1e12)).toBe(0);
    expect(collectWell(p, 3, 1e12)).toBe(0);
    expect(p.wellAt).toBe(1e12);
    const hour = 3_600_000;
    const one = wellAmount(p, 3, 0, 1e12 + hour);
    expect(one).toBe(Math.floor(3 + 1.5 * 3));
    expect(wellAmount(p, 3, 0, 1e12 + 100 * hour)).toBe(
      Math.floor(WELL_HOURS * (3 + 1.5 * 3)),
    );
    expect(collectWell(p, 3, 1e12 + 2 * hour)).toBe(Math.floor(2 * 7.5));
    expect(p.souls).toBe(15);
    expect(wellAmount(p, 3, 0, 1e12 + 2 * hour)).toBe(0);
  });
});
