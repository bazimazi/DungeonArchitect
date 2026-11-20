// Rules v7: veterancy, nemeses, sieges and trophies, heirloom awakening and
// reforging, the Ember Throne and expeditions.
import { generateLayout, type Layout } from "../src/game/grid";
import {
  CHAMPIONS,
  FEATS,
  NIGHTS,
  T,
  type HeroClass,
  type PieceId,
} from "../src/game/defs";
import {
  AWAKE_ROWS,
  FLAMES,
  HEART,
  RARITIES,
  REKINDLE_DEPTH,
  REKINDLE_LEVELS,
  TROPHIES,
  affixValue,
  awakeLevel,
  awakeStep,
  awakenEquipped,
  buyFlame,
  buyHeart,
  defaultMeta,
  emberYield,
  flameCost,
  forgeCost,
  forgePiece,
  heartCost,
  heartInvested,
  heirloomStats,
  infamyStep,
  metaBonus,
  reforge,
  reforgeCost,
  rekindle,
  rekindleBlock,
  rollHeirloom,
  setItemTalent,
  temper,
  temperCap,
  type Heirloom,
} from "../src/game/meta";
import {
  NEMESIS_MAX,
  NEM_HP,
  isNemesisAbyssNight,
  nemesesPerRun,
  nemesisFor,
  scheduleNemeses,
  settleNemeses,
  type Nemesis,
} from "../src/game/nemesis";
import {
  SIEGE_BOSSES,
  TUNE_SIEGE,
  siegeDef,
  siegeDepth,
  siegeFrontier,
  siegeLayout,
  siegeMods,
  siegeNight,
  siegeOpen,
  siegeReward,
  siegeStars,
} from "../src/game/sieges";
import {
  DURATIONS,
  claimExpedition,
  expeditionOffers,
  expeditionSlots,
  leaders,
  recallExpedition,
  spoils,
  startExpedition,
} from "../src/game/expeditions";
import {
  VET_AT,
  VET_PER,
  creditVeterancy,
  newRun,
  partyFor,
  raidMods,
  vetRank,
  vetRanks,
} from "../src/game/run";
import {
  defaultProfile,
  migrateProfile,
  recordNight,
  syncMetaStats,
} from "../src/game/profile";
import { Rng } from "../src/engine/math";
import {
  Raid,
  simulate,
  type RaidMods,
  type RaidResult,
} from "../src/game/sim";

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
const xpForLevel = (l: number) => {
  let xp = 0;
  for (let i = 1; i < l; i++) xp += infamyStep(i);
  return xp;
};
const emptyResult = (extra: Partial<RaidResult> = {}): RaidResult => ({
  killed: 0,
  escaped: 0,
  stolen: 0,
  touchedHoard: false,
  gold: 0,
  bestCombo: 0,
  kills: {},
  damage: {},
  seconds: 30,
  fireKills: 0,
  powerKills: 0,
  falls: 0,
  champions: [],
  classKills: {},
  eliteKills: 0,
  affixKills: 0,
  schoolKills: 0,
  schools: {
    pyre: 0,
    steel: 0,
    stone: 0,
    grave: 0,
    wild: 0,
    arcana: 0,
    guile: 0,
  },
  ...extra,
});

describe("veterancy", () => {
  it("ranks climb with kills this descent", () => {
    expect(vetRank(0)).toBe(0);
    expect(vetRank(VET_AT[0])).toBe(1);
    expect(vetRank(VET_AT[3])).toBe(4);
    expect(vetRank(10_000)).toBe(4);
  });
  it("credits kills to the blueprint (minions to their maker)", () => {
    const r: { vet?: Partial<Record<PieceId, number>> } = {};
    const up = creditVeterancy(r, { spikes: 5, risen: 3, necro: 2 });
    expect(r.vet).toEqual({ spikes: 5, necro: 5 });
    expect(up).toEqual([
      ["spikes", 1],
      ["necro", 1],
    ]);
    expect(creditVeterancy(r, { spikes: 1 })).toEqual([]);
    expect(vetRanks(r)).toEqual({ spikes: 1, necro: 1 });
  });
  it("reaches the raid and raises power", () => {
    const run = newRun({
      seed: 5,
      biome: "crypt",
      architect: "mason",
      depth: 1,
      powers: [],
    });
    expect(raidMods(run).vet).toBeUndefined();
    run.vet = { skeleton: VET_AT[1] };
    expect(raidMods(run).vet).toEqual({ skeleton: 2 });
    const setup = (vet?: Partial<Record<PieceId, number>>) =>
      new Raid({
        layout: corridor([["skeleton", 5, 8]]),
        party: [{ cls: "knight" }],
        seed: 9,
        night: 1,
        hoard: 12,
        mods: mods(vet ? { vet } : {}),
      });
    const a = setup();
    const b = setup({ skeleton: 2 });
    expect(b.monsters[0].maxHp).toBe(
      Math.round(a.monsters[0].maxHp * (1 + 2 * VET_PER)),
    );
    const spikes = (vet?: Partial<Record<PieceId, number>>) =>
      simulate({
        layout: corridor([["spikes", 5, 4]]),
        party: [{ cls: "knight" }],
        seed: 9,
        night: 1,
        hoard: 12,
        mods: mods(vet ? { vet } : {}),
      }).result().damage.spikes ?? 0;
    expect(spikes({ spikes: 4 })).toBeGreaterThan(spikes());
  });
});

describe("nemeses", () => {
  const nem = (
    id: number,
    level: number,
    cls: HeroClass = "rogue",
  ): Nemesis => ({
    id,
    cls,
    name: `N${id}`,
    level,
    affixes: ["swift"],
    escapes: level,
    stolen: 2,
    born: 3,
  });
  it("a descent meets more of them deeper down", () => {
    expect(nemesesPerRun(1)).toBe(0);
    expect(nemesesPerRun(2)).toBe(1);
    expect(nemesesPerRun(8)).toBe(2);
    expect(nemesesPerRun(25)).toBe(3);
    const roster = [nem(1, 1), nem(2, 5), nem(3, 3), nem(4, 2)];
    expect(scheduleNemeses(roster, 7, 1)).toEqual([]);
    const s = scheduleNemeses(roster, 7, 25);
    expect(s.map((x) => x.id).sort()).toEqual([2, 3, 4]);
    expect(new Set(s.map((x) => x.night)).size).toBe(3);
    // The strongest comes last.
    expect(s[s.length - 1].id).toBe(2);
    expect(scheduleNemeses(roster, 7, 25)).toEqual(s);
  });
  it("join their night's party as elites, and return in the abyss", () => {
    const base = { seed: 3, depth: 6, mutators: [], boss: "paladin" as const };
    const sched = scheduleNemeses([nem(9, 4, "berserker")], 3, 6);
    const night = sched[0].night;
    const party = partyFor({ ...base, nemeses: sched }, night);
    const n = party.find((p) => p.nemesis);
    expect(n).toMatchObject({ cls: "berserker", elite: true });
    expect(n!.nemesis).toEqual({ id: 9, level: 4, name: "N9" });
    expect(partyFor({ ...base, nemeses: sched }, night).length).toBe(
      partyFor(base, night).length + 1,
    );
    // A bribe never sends a nemesis home.
    const bribed = partyFor({ ...base, nemeses: sched, bribe: night }, night);
    expect(bribed.some((p) => p.nemesis)).toBe(true);
    expect(isNemesisAbyssNight(12)).toBe(true);
    expect(isNemesisAbyssNight(13)).toBe(false);
    expect(nemesisFor(sched, 12)?.id).toBe(9);
    expect(nemesisFor([{ ...sched[0], slain: true }], 12)).toBeNull();
  });
  it("are tougher by level in the raid and reported back", () => {
    const layout = corridor([]);
    const plain = new Raid({
      layout,
      party: [{ cls: "knight", elite: true }],
      seed: 1,
      night: 3,
      hoard: 12,
      mods: mods(),
    });
    const r = new Raid({
      layout,
      party: [
        {
          cls: "knight",
          elite: true,
          nemesis: { id: 4, level: 3, name: "X" },
        },
      ],
      seed: 1,
      night: 3,
      hoard: 12,
      mods: mods(),
    });
    expect(r.heroes[0].maxHp).toBe(
      Math.round(plain.heroes[0].maxHp * (1 + NEM_HP * 3)),
    );
    while (!r.finished) r.step();
    const res = r.result();
    expect(res.survived?.[0].id).toBe(4);
    expect(res.thieves).toEqual([]);
  });
  it("thieves are born, survivors grow, the slain leave the gallery", () => {
    const p = { nemeses: [nem(1, 2)], nextNemesis: 2, vanquished: [] };
    const run = { seed: 11, night: 4, depth: 4 };
    const o = settleNemeses(p, run, {
      slain: [],
      survived: [{ id: 1, loot: 2 }],
      thieves: [
        { cls: "knight", affixes: [], loot: 1 },
        { cls: "rogue", affixes: ["gilded"], loot: 4 },
      ],
    });
    expect(o.grew[0].level).toBe(3);
    // Level 3 adds an affix.
    expect(o.grew[0].affixes.length).toBe(2);
    expect(o.born).toMatchObject({ id: 2, cls: "rogue", level: 1 });
    expect(o.born!.affixes).toEqual(["gilded"]);
    expect(p.nemeses.length).toBe(2);
    const k = settleNemeses(
      p,
      { ...run, night: 5 },
      {
        slain: [1],
        survived: [],
        thieves: [],
      },
    );
    expect(k.slain[0].id).toBe(1);
    expect(p.nemeses.map((x) => x.id)).toEqual([2]);
    expect(p.vanquished[0]).toMatchObject({ name: "N1", level: 3 });
    // Depth 1 makes no nemeses; a full gallery takes no more.
    const q = { nemeses: [] as Nemesis[], nextNemesis: 1, vanquished: [] };
    const t = {
      slain: [],
      survived: [],
      thieves: [{ cls: "rogue" as HeroClass, affixes: [], loot: 1 }],
    };
    expect(settleNemeses(q, { ...run, depth: 1 }, t).born).toBeNull();
    const full = {
      nemeses: Array.from({ length: NEMESIS_MAX }, (_, i) => nem(i + 1, 1)),
      nextNemesis: 99,
      vanquished: [],
    };
    expect(settleNemeses(full, run, t).born).toBeNull();
  });
  it("slaying one pays souls, infamy and an heirloom", () => {
    const p = defaultProfile();
    p.nemeses = [nem(3, 5)];
    p.nextNemesis = 4;
    const night = 3;
    const r = emptyResult({ killed: 1, slain: [3] });
    const base = recordNight(
      defaultProfile(),
      { architect: "mason", depth: 6, seed: 1, night },
      emptyResult({ killed: 1 }),
      0,
      true,
    );
    const out = recordNight(
      p,
      { architect: "mason", depth: 6, seed: 1, night },
      r,
      0,
      true,
    );
    expect(out.souls).toBeGreaterThan(base.souls + 50);
    expect(out.infamy).toBeGreaterThan(base.infamy);
    expect(out.trophies?.length).toBe(1);
    expect(out.trophies![0].rarity).toBeGreaterThanOrEqual(2);
    expect(p.nemeses).toEqual([]);
    expect(p.stats.nemeses).toBe(1);
    // Dailies leave the gallery alone.
    const d = defaultProfile();
    recordNight(
      d,
      { architect: "mason", depth: 6, seed: 1, night, daily: "x" },
      emptyResult({ thieves: [{ cls: "rogue", affixes: [], loot: 2 }] }),
      0,
      true,
    );
    expect(d.nemeses).toEqual([]);
  });
});

describe("sieges", () => {
  it("levels are fixed and climb with the depths", () => {
    expect(siegeDepth(1)).toBe(3);
    expect(siegeDepth(10)).toBe(21);
    expect(siegeNight(1)).toBe(5);
    expect(siegeNight(6)).toBe(NIGHTS);
    expect(siegeNight(40)).toBe(NIGHTS);
    for (const b of SIEGE_BOSSES) {
      const d = siegeDef(b, 4);
      expect(d).toEqual(siegeDef(b, 4));
      expect(d.party.filter((p) => p.cls === b).length).toBe(1);
      expect(d.party.find((p) => p.cls === b)!.affixes!.length).toBe(1);
      expect(d.gold).toBe(TUNE_SIEGE.gold + 4 * TUNE_SIEGE.goldPer);
      const l = siegeLayout(d);
      expect(l.tiles.length).toBe(l.w * l.h);
    }
    const a = siegeDef("paladin", 1);
    const b = siegeDef("paladin", 12);
    expect(b.party.length).toBeGreaterThan(a.party.length);
    expect(b.cap).toBeGreaterThan(a.cap);
  });
  it("raids play like a late night at the siege depth, plus the Sanctum", () => {
    const d = siegeDef("warlord", 7);
    const m = siegeMods(d, { architect: "mason", tiers: {} });
    expect(m.relics).toEqual(d.relics);
    expect(d.relics.length).toBe(2);
    const night10 = raidMods({
      night: NIGHTS,
      depth: d.depth,
      mutators: [],
      architect: "mason",
      relics: [],
      tiers: {},
    });
    expect(m.heroHp).toBe(night10.heroHp);
    expect(m.meta).toBeUndefined();
    const meta = { s: { trapDmg: 0.2 }, p: {}, keys: [] };
    expect(siegeMods(d, { architect: "mason", tiers: {}, meta }).meta).toBe(
      meta,
    );
  });
  it("stars, the frontier and rewards", () => {
    const st = (o: Partial<Parameters<typeof siegeStars>[0]>) =>
      siegeStars({
        bossSlain: true,
        hoardLeft: 5,
        stolen: 0,
        escaped: 0,
        ...o,
      });
    expect(st({})).toBe(3);
    expect(st({ escaped: 1 })).toBe(2);
    expect(st({ stolen: 1, escaped: 1 })).toBe(1);
    expect(st({ bossSlain: false })).toBe(0);
    expect(st({ hoardLeft: 0 })).toBe(0);
    const p = { ...defaultProfile() };
    expect(siegeOpen(p, "thane")).toBe(false);
    p.bestiary.thane = 1;
    expect(siegeOpen(p, "thane")).toBe(true);
    expect(siegeFrontier(p, "thane")).toBe(1);
    p.trophies.thane = 3;
    expect(siegeFrontier(p, "thane")).toBe(4);
    const first = siegeReward(5, 1, true);
    const replay = siegeReward(5, 1, false);
    expect(replay.souls).toBeLessThan(first.souls / 5);
    expect(replay.infamy).toBe(0);
    expect(siegeReward(5, 3, true).souls).toBeGreaterThan(first.souls);
    expect(siegeReward(10, 1, true).souls).toBeGreaterThan(first.souls);
  });
  it("trophies grant their stat per level", () => {
    const m = defaultMeta();
    m.trophies = { paladin: 4, revenant: 2 };
    const s = metaBonus(m).s;
    expect(s.monsterHp).toBeCloseTo(TROPHIES.paladin.per * 4);
    expect(s.souls).toBeCloseTo(TROPHIES.revenant.per * 2);
    expect(Object.keys(TROPHIES).sort()).toEqual([...CHAMPIONS].sort());
  });
});

describe("heirloom awakening and reforging", () => {
  const item = (extra: Partial<Heirloom> = {}): Heirloom => ({
    id: 1,
    base: "whetstone",
    rarity: 3,
    ilvl: 10,
    affixes: [
      ["trapDmg", 0.5],
      ["souls", 0.5],
      ["bounty", 0.5],
      ["luck", 0.5],
    ],
    temper: 0,
    ...extra,
  });
  it("awakening levels are endless and raise every value", () => {
    expect(awakeLevel(0).level).toBe(0);
    expect(awakeLevel(awakeStep(0)).level).toBe(1);
    expect(awakeLevel(1e6).level).toBeGreaterThan(100);
    const a = affixValue(item(), "trapDmg", 0.5, true);
    const b = affixValue(item({ awake: 1e5 }), "trapDmg", 0.5, true);
    expect(b).toBeGreaterThan(a * 2);
  });
  it("equipped heirlooms gain experience", () => {
    const m = defaultMeta();
    m.heirlooms = [item(), item({ id: 2 })];
    m.equipped = [2];
    const up = awakenEquipped(m, awakeStep(0));
    expect(up.map((x) => x.id)).toEqual([2]);
    expect(m.heirlooms[0].awake).toBeUndefined();
  });
  it("talent rows open with awakening and change the item", () => {
    const m = defaultMeta();
    const it = item();
    m.heirlooms = [it];
    expect(setItemTalent(m, 1, 0, 0)).toBe(false);
    let xp = 0;
    for (let l = 0; l < AWAKE_ROWS[2]; l++) xp += awakeStep(l);
    it.awake = xp;
    const before = heirloomStats(it).trapDmg!;
    expect(setItemTalent(m, 1, 0, 0)).toBe(true);
    expect(heirloomStats(it).trapDmg!).toBeGreaterThan(before);
    expect(setItemTalent(m, 1, 1, 0)).toBe(true);
    expect(heirloomStats(it).souls!).toBeCloseTo(
      affixValue(it, "souls", 0.5) + 0.08,
    );
    // Perfected rolls everything at its best.
    expect(setItemTalent(m, 1, 2, 0)).toBe(true);
    expect(affixValue(it, "luck", 0.1)).toBe(affixValue(it, "luck", 1));
    // Ascendant tempers five more times, and can't be dropped while used.
    expect(setItemTalent(m, 1, 2, 1)).toBe(true);
    expect(temperCap(it)).toBe(RARITIES[3].temper + 5);
    m.souls = 1e9;
    while (temper(m, 1));
    expect(it.temper).toBe(RARITIES[3].temper + 5);
    expect(setItemTalent(m, 1, 2, 0)).toBe(false);
  });
  it("reforging rerolls one rolled affix, deterministically, for rising prices", () => {
    const make = () => {
      const m = defaultMeta();
      m.heirlooms = [item()];
      m.souls = 1e6;
      return m;
    };
    const a = make();
    const b = make();
    const c0 = reforgeCost(a.heirlooms[0])!;
    expect(reforge(a, 1, 0)).toBe(false);
    expect(reforge(a, 1, 2)).toBe(true);
    expect(reforge(b, 1, 2)).toBe(true);
    expect(a.heirlooms[0].affixes).toEqual(b.heirlooms[0].affixes);
    expect(a.souls).toBe(1e6 - c0);
    expect(reforgeCost(a.heirlooms[0])!).toBe(c0 * 2);
    const stats = a.heirlooms[0].affixes.map(([s]) => s);
    expect(new Set(stats).size).toBe(stats.length);
    expect(a.heirlooms[0].affixes[0]).toEqual(["trapDmg", 0.5]);
    expect(
      reforgeCost(item({ rarity: 0, affixes: [["trapDmg", 1]] })),
    ).toBeNull();
  });
});

describe("the Ember Throne", () => {
  it("rekindling needs a big Heart and a deep conquest", () => {
    const m = defaultMeta();
    m.infamyXp = xpForLevel(30);
    m.souls = 1e9;
    expect(rekindleBlock(m, REKINDLE_DEPTH - 1)).toBe("depth");
    expect(rekindleBlock(m, REKINDLE_DEPTH)).toBe("levels");
    let n = 0;
    while (n < REKINDLE_LEVELS)
      for (const d of HEART) if (buyHeart(m, d.id)) n++;
    expect(rekindleBlock(m, REKINDLE_DEPTH)).toBeNull();
    const invested = heartInvested(m);
    const souls = m.souls;
    const gain = rekindle(m, REKINDLE_DEPTH);
    expect(gain).toBe(emberYield(invested));
    expect(gain).toBeGreaterThan(0);
    expect(m.heart).toEqual({});
    expect(m.embers).toBe(gain);
    expect(m.rekindles).toBe(1);
    expect(m.souls).toBe(souls);
  });
  it("embers grow with the square root of the Heart", () => {
    expect(emberYield(400)).toBe(1);
    expect(emberYield(1600)).toBe(2);
    expect(emberYield(40_000)).toBe(10);
  });
  it("flames cost 1, 2, 3… and never reset", () => {
    const m = defaultMeta();
    m.embers = 6;
    expect(buyFlame(m, "soulfire")).toBe(true);
    expect(buyFlame(m, "soulfire")).toBe(true);
    expect(buyFlame(m, "soulfire")).toBe(true);
    expect(m.embers).toBe(0);
    expect(buyFlame(m, "soulfire")).toBe(false);
    expect(metaBonus(m).s.souls).toBeCloseTo(0.18);
    for (const d of FLAMES)
      if (d.max !== undefined) expect(flameCost(d, d.max)).toBeNull();
  });
  it("Ember Heart and Kindled Forge discount prices", () => {
    const m = { ...defaultMeta(), mastery: { spikes: 1000 } };
    m.flames = { emberheart: 10, kindled: 10 };
    m.infamyXp = xpForLevel(5);
    m.souls = 1000;
    const d = HEART[0];
    expect(heartCost(d, 0, 0.95 ** 10)).toBeLessThan(heartCost(d, 0)!);
    buyHeart(m, d.id);
    expect(m.souls).toBe(1000 - heartCost(d, 0, 0.95 ** 10)!);
    const s = m.souls;
    forgePiece(m, "spikes");
    expect(m.souls).toBe(s - forgeCost(0, 0.95 ** 10));
  });
});

describe("expeditions", () => {
  const owner = () => {
    const p = defaultProfile();
    p.bestDepth = 10;
    p.forge = { skeleton: 10, spikes: 2 };
    return p;
  };
  it("offers a fixed board that turns over", () => {
    const p = owner();
    const a = expeditionOffers(p);
    expect(a).toEqual(expeditionOffers(p));
    expect(a.length).toBe(3);
    for (const o of a) expect(DURATIONS).toContain(o.hours);
    expect(a.some((o) => o.kind === "embers")).toBe(false);
  });
  it("run on the clock, led by a forged piece, and pay their spoils", () => {
    const p = owner();
    expect(leaders(p)).toEqual(["skeleton", "spikes"]);
    expect(expeditionSlots(p)).toBe(1);
    const offers = expeditionOffers(p);
    const i = offers.findIndex(
      (o) => o.kind === "souls" || o.kind === "infamy",
    );
    const idx = i < 0 ? 0 : i;
    const e = startExpedition(p, idx, "skeleton", 1000)!;
    expect(e).not.toBeNull();
    expect(e.amount).toBe(spoils(offers[idx], 10, 10));
    expect(spoils(offers[idx], 10, 10)).toBeGreaterThanOrEqual(
      spoils(offers[idx], 10, 0),
    );
    // One slot: nothing else can leave, and a leader can't go twice.
    expect(startExpedition(p, 0, "spikes", 1000)).toBeNull();
    expect(leaders(p)).toEqual(["spikes"]);
    expect(claimExpedition(p, e.id, e.end - 1)).toBeNull();
    const souls = p.souls;
    const haul = claimExpedition(p, e.id, e.end)!;
    expect(haul).not.toBeNull();
    if (e.kind === "souls") expect(p.souls).toBe(souls + e.amount);
    if (e.kind === "heirloom") expect(haul.heirloom!.ilvl).toBe(e.amount);
    expect(p.expeditions).toEqual([]);
    const again = startExpedition(p, 0, "skeleton", 5000)!;
    expect(recallExpedition(p, again.id)).toBe(true);
    expect(p.expeditions).toEqual([]);
  });
  it("need a conquest and grow slots with infamy", () => {
    const p = owner();
    p.bestDepth = 0;
    expect(startExpedition(p, 0, "skeleton", 0)).toBeNull();
    p.infamyXp = xpForLevel(40);
    expect(expeditionSlots(p)).toBe(3);
  });
});

describe("rules v7 profiles", () => {
  it("old saves get empty v7 fields", () => {
    const old = defaultProfile() as unknown as Record<string, unknown>;
    for (const k of [
      "nemeses",
      "vanquished",
      "expeditions",
      "sieges",
      "embers",
      "flames",
      "trophies",
    ])
      delete old[k];
    const p = migrateProfile(old);
    expect(p.nemeses).toEqual([]);
    expect(p.expeditions).toEqual([]);
    expect(p.flames).toEqual({});
    expect(p.trophies).toEqual({});
    expect(p.embers).toBe(0);
    expect(p.nextNemesis).toBe(1);
  });
  it("counters follow trophies, rekindles and awakening", () => {
    const p = defaultProfile();
    p.trophies = { paladin: 3, thane: 2 };
    p.rekindles = 2;
    p.heirlooms = [{ ...rollHeirloom(new Rng(1), 1, 5), awake: 1e5 }];
    syncMetaStats(p);
    expect(p.stats.trophies).toBe(5);
    expect(p.stats.rekindles).toBe(2);
    expect(p.stats.awaken).toBeGreaterThan(30);
  });
  it("feats are well formed", () => {
    const ids = new Set(FEATS.map((f) => f.id));
    expect(ids.size).toBe(FEATS.length);
    for (const id of [
      "nemesis1",
      "siege1",
      "trophies100",
      "expeditions10",
      "awaken10",
      "rekindle1",
      "veteran1",
      "flame10",
    ])
      expect(ids.has(id)).toBe(true);
    const p = defaultProfile();
    for (const f of FEATS)
      if (f.stat) expect(p.stats[f.stat]).toBeTypeOf("number");
  });
});
