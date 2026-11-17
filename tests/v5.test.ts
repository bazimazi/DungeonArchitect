// Rules v5: schools, aspects, elite affixes, mastery, bestiary, bounties and
// architect levels.
import { generateLayout, type Layout } from "../src/game/grid";
import {
  ARCHITECTS,
  FEATS,
  PIECES,
  RELICS,
  T,
  type HeroClass,
  type PieceId,
  type RelicId,
} from "../src/game/defs";
import {
  AFFIXES,
  ASPECTS,
  PIECE_SCHOOL,
  SCHOOLS,
  SCHOOL_IDS,
  schoolLevels,
} from "../src/game/schools";
import {
  ALT_KITS,
  ARCH_LEVEL_AT,
  MASTERY_AT,
  SIGNATURE,
  archLevel,
  bountiesFor,
  bountyGain,
  masteryRank,
} from "../src/game/progression";
import {
  activeAspects,
  currentBoard,
  defaultProfile,
  migrateProfile,
  recordNight,
  recordWinXp,
} from "../src/game/profile";
import {
  draftFor,
  newRun,
  partyFor,
  raidMods,
  reinforceCost,
} from "../src/game/run";
import { TRIALS, trialLayout, trialSetup } from "../src/game/trials";
import { Raid, simulate, type Hero, type RaidMods } from "../src/game/sim";

const mods = (extra: Partial<RaidMods> = {}): RaidMods => ({
  heroHp: 1,
  heroDmg: 1,
  heroSpeed: 1,
  monsterHp: 1,
  relics: [],
  tiers: {},
  schools: true,
  ...extra,
});
function corridor(): Layout {
  const l = generateLayout(1, "crypt");
  l.tiles = l.tiles.map((t) => (t === T.Floor ? T.Rock : t));
  for (let y = 0; y <= 12; y++) l.tiles[y * l.w + 5] = T.Floor;
  // A side pocket off the corridor for pieces that shouldn't block it.
  for (let y = 1; y <= 11; y++) l.tiles[y * l.w + 6] = T.Floor;
  l.entrance = { x: 5, y: 0 };
  l.hoard = { x: 5, y: 12 };
  l.objects = [];
  return l;
}
function raidOn(
  party: { cls: HeroClass; elite?: boolean; affixes?: Hero["affixes"] }[],
  objects: [PieceId, number, number, number?][] = [],
  m: Partial<RaidMods> = {},
) {
  const l = corridor();
  l.objects = objects.map(([kind, x, y, dir], i) => ({
    id: i + 1,
    kind,
    x,
    y,
    dir: dir ?? 2,
  }));
  return new Raid({
    layout: l,
    party,
    seed: 5,
    night: 1,
    hoard: 12,
    mods: mods(m),
  });
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
function place(h: Hero, x: number, y: number) {
  h.spawned = true;
  h.alive = true;
  h.x = h.px = x;
  h.y = h.py = y;
}
const onEnter = (r: Raid, h: Hero, x: number, y: number) =>
  (r as unknown as { onEnter(h: Hero, x: number, y: number): void }).onEnter(
    h,
    x,
    y,
  );
const run = (extra: Partial<Parameters<typeof newRun>[0]> = {}) =>
  newRun({
    seed: 77,
    biome: "crypt",
    architect: "mason",
    depth: 3,
    powers: ["rockfall"],
    ...extra,
  });

describe("schools", () => {
  it("every piece belongs to exactly one school", () => {
    const all = SCHOOL_IDS.flatMap((s) => SCHOOLS[s].pieces);
    expect(new Set(all).size).toBe(all.length);
    expect(all.sort()).toEqual((Object.keys(PIECES) as PieceId[]).sort());
    for (const p of Object.keys(PIECES) as PieceId[])
      expect(SCHOOLS[PIECE_SCHOOL[p]].pieces).toContain(p);
    for (const s of SCHOOL_IDS)
      expect(RELICS[SCHOOLS[s].sigil as RelicId]).toBeDefined();
  });
  it("awaken at two and four different kinds, and sigils count as one", () => {
    expect(schoolLevels(["spikes"]).steel).toBe(0);
    expect(schoolLevels(["spikes", "spikes"]).steel).toBe(0);
    expect(schoolLevels(["spikes", "darts"]).steel).toBe(1);
    expect(schoolLevels(["spikes", "darts", "saw"]).steel).toBe(1);
    expect(schoolLevels(["spikes", "darts", "saw", "crusher"]).steel).toBe(2);
    expect(schoolLevels(["spikes"], ["sigilSteel"]).steel).toBe(1);
    expect(schoolLevels(["spikes", "darts", "saw"], ["sigilSteel"]).steel).toBe(
      2,
    );
  });
  it("Steel II sharpens spikes; Discord and trials keep schools asleep", () => {
    const hit = (m: Partial<RaidMods>, objs: [PieceId, number, number][]) => {
      const r = raidOn([{ cls: "rogue" }], objs, m);
      const h = r.heroes[0];
      place(h, 5.5, 3.5);
      const before = h.hp;
      onEnter(r, h, 5, 3);
      return before - h.hp;
    };
    const alone = hit({}, [["spikes", 5, 3]]);
    const paired = hit({}, [
      ["spikes", 5, 3],
      ["darts", 6, 8],
    ]);
    expect(paired).toBe(Math.round(alone * 1.2));
    expect(
      hit({ schools: false }, [
        ["spikes", 5, 3],
        ["darts", 6, 8],
      ]),
    ).toBe(alone);
    const discord = raidMods({ ...run(), omens: ["discord"] });
    expect(discord.schools).toBe(false);
    expect(raidMods(run()).schools).toBe(true);
    for (const t of TRIALS.slice(0, 3))
      expect(trialSetup(t, trialLayout(t)).mods.schools).toBe(false);
  });
  it("Grave IV lets the dead rise once more", () => {
    const grave: [PieceId, number, number][] = [
      ["skeleton", 6, 2],
      ["ghost", 6, 4],
      ["wraith", 6, 6],
      ["necro", 6, 8],
    ];
    const r = raidOn([{ cls: "knight" }], grave);
    expect(r.school("grave")).toBe(2);
    const skel = r.monsters.find((m) => m.kind === "skeleton")!;
    const ghost = r.monsters.find((m) => m.kind === "ghost")!;
    expect(skel.reforms).toBe(2);
    expect(ghost.reforms).toBe(1);
    const asleep = raidOn([{ cls: "knight" }], grave, { schools: false });
    expect(asleep.monsters.find((m) => m.kind === "ghost")!.reforms).toBe(0);
  });
  it("Wild II speeds beasts up; Stone II toughens stone", () => {
    const r = raidOn(
      [{ cls: "knight" }],
      [
        ["bat", 6, 2],
        ["spider", 6, 4],
        ["golem", 6, 6],
        ["ogre", 6, 8],
      ],
    );
    expect(r.monsters.find((m) => m.kind === "bat")!.spd).toBeCloseTo(1.2);
    const golem = r.monsters.find((m) => m.kind === "golem")!;
    expect(golem.maxHp).toBe(Math.round(400 * 1.25));
  });
  it("results report awakened schools and school kills", () => {
    const r = raidOn(
      [{ cls: "knight" }],
      [
        ["spikes", 5, 3],
        ["darts", 6, 8],
      ],
    );
    const res = simulate(r.setup).result();
    expect(res.schools.steel).toBe(1);
    expect(res.schoolKills).toBeGreaterThanOrEqual(0);
  });
});

describe("aspects", () => {
  it("every piece has exactly one aspect with a name and a rule", () => {
    for (const p of Object.keys(PIECES) as PieceId[]) {
      expect(ASPECTS[p].piece).toBe(p);
      expect(ASPECTS[p].name.length).toBeGreaterThan(3);
      expect(ASPECTS[p].text.length).toBeGreaterThan(10);
    }
  });
  it("Rusted Spikes hit softer but poison", () => {
    const r = raidOn([{ cls: "rogue" }], [["spikes", 5, 3]], {
      schools: false,
      aspects: ["spikes"],
    });
    const h = r.heroes[0];
    place(h, 5.5, 3.5);
    const before = h.hp;
    onEnter(r, h, 5, 3);
    expect(before - h.hp).toBe(Math.round(30 * 0.6) - HERO_ARMOR("rogue"));
    expect(h.st.poison).toBeGreaterThan(0);
    expect(h.poisonSrc).toBe("spikes");
  });
  it("a Snare deals no damage but holds a hero for 4s", () => {
    const r = raidOn([{ cls: "rogue" }], [["beartrap", 5, 3]], {
      aspects: ["beartrap"],
    });
    const h = r.heroes[0];
    place(h, 5.5, 3.5);
    const before = h.hp;
    onEnter(r, h, 5, 3);
    expect(h.hp).toBe(before);
    expect(h.st.stun).toBe(80);
  });
  it("a Rolling Stone rolls again", () => {
    const party = Array.from({ length: 6 }, () => ({
      cls: "knight" as HeroClass,
    }));
    const rolls = (aspects: PieceId[]) =>
      events(raidOn(party, [["boulder", 5, 1, 2]], { aspects }), 3000).filter(
        (e) => e.k === "trap" && e.kind === "boulder",
      ).length;
    expect(rolls([])).toBe(1);
    expect(rolls(["boulder"])).toBeGreaterThan(1);
  });
  it("Glue Pool never burns", () => {
    const tar: [PieceId, number, number][] = [
      ["tar", 5, 4],
      ["flame", 5, 2, 2] as unknown as [PieceId, number, number],
    ];
    const ignites = (aspects: PieceId[]) =>
      events(raidOn([{ cls: "knight" }], tar, { aspects }), 1500).filter(
        (e) => e.k === "ignite",
      ).length;
    expect(ignites([])).toBeGreaterThan(0);
    expect(ignites(["tar"])).toBe(0);
  });
  it("Kobold Bombers throw firebombs instead of mending", () => {
    const ev = events(
      raidOn([{ cls: "knight" }], [["kobold", 6, 5]], { aspects: ["kobold"] }),
      2000,
    );
    expect(ev.some((e) => e.k === "firebomb")).toBe(true);
  });
  it("aspects keep raids deterministic", () => {
    const setup = raidOn(
      [{ cls: "knight" }, { cls: "rogue" }, { cls: "cleric" }],
      [
        ["spikes", 5, 3],
        ["skeleton", 6, 5],
        ["darts", 5, 1, 2],
        ["slime", 6, 9],
      ],
      { aspects: ["spikes", "skeleton", "darts", "slime"] },
    ).setup;
    const a = simulate(setup).result();
    const b = simulate(setup).result();
    expect(a).toEqual(b);
  });
});

/** Armor a class subtracts from physical hits. */
const HERO_ARMOR = (cls: HeroClass) =>
  ({ rogue: 0, knight: 4 })[cls as "rogue" | "knight"] ?? 0;

describe("elite affixes", () => {
  it("no affixes on depth 1; elites carry them deeper", () => {
    const shallow = run({ depth: 1 });
    for (let n = 1; n <= 10; n++)
      for (const p of partyFor(shallow, n)) expect(p.affixes).toBeUndefined();
    const deep = run({ depth: 9 });
    const elites = [4, 7].flatMap((n) =>
      partyFor(deep, n).filter((p) => p.elite),
    );
    expect(elites.length).toBeGreaterThan(0);
    for (const e of elites) {
      expect(e.affixes?.length).toBe(1);
      for (const a of e.affixes!)
        expect(AFFIXES[a].from).toBeLessThanOrEqual(9);
    }
  });
  it("Empowered doubles elite affixes and marks the champion", () => {
    const r = run({ depth: 9, omens: ["empowered"] });
    const elite = partyFor(r, 4).find((p) => p.elite)!;
    expect(elite.affixes?.length).toBe(2);
    expect(new Set(elite.affixes).size).toBe(2);
    const champ = partyFor(r, 10)[0];
    expect(champ.affixes?.length).toBe(1);
  });
  it("affixes never change who comes", () => {
    const a = run({ depth: 9 });
    const b = run({ depth: 9, omens: ["empowered"] });
    for (const n of [3, 4, 7])
      expect(partyFor(a, n).map((p) => p.cls)).toEqual(
        partyFor(b, n).map((p) => p.cls),
      );
  });
  it("a ward soaks damage before health", () => {
    const r = raidOn([{ cls: "knight", elite: true, affixes: ["warded"] }]);
    const h = r.heroes[0];
    expect(h.ward).toBe(Math.round(h.maxHp * 0.25));
    place(h, 5.5, 5.5);
    const hp = h.hp;
    r.damage(h, 20, "magic", "test");
    expect(h.hp).toBe(hp);
    r.damage(h, h.ward + 10, "magic", "test");
    expect(h.ward).toBe(0);
    expect(h.hp).toBe(hp - 10);
  });
  it("gilded heroes pay triple bounty", () => {
    const gold = (affixes: Hero["affixes"]) => {
      const r = raidOn([{ cls: "rogue", affixes }]);
      const h = r.heroes[0];
      place(h, 5.5, 5.5);
      r.damage(h, 9999, "magic", "test");
      return r.gold;
    };
    expect(gold(["gilded"])).toBe(gold([]) * 3);
  });
  it("salamanders shrug off fire", () => {
    const r = raidOn([
      { cls: "knight", affixes: ["salamander"] },
      { cls: "knight" },
    ]);
    const [a, b] = r.heroes;
    place(a, 5.5, 5.5);
    place(b, 5.5, 6.5);
    expect(r.damage(a, 50, "fire", "test")).toBe(20);
    expect(r.damage(b, 50, "fire", "test")).toBe(50);
  });
});

describe("mastery, bestiary and bounties", () => {
  const result = (over: Partial<ReturnType<Raid["result"]>> = {}) => ({
    ...simulate(raidOn([{ cls: "knight" }]).setup).result(),
    ...over,
  });
  it("mastery ranks unlock aspects, which start equipped", () => {
    expect(masteryRank(0)).toBe(0);
    expect(masteryRank(MASTERY_AT[0])).toBe(1);
    expect(masteryRank(MASTERY_AT[1])).toBe(2);
    expect(masteryRank(10_000)).toBe(4);
    const p = defaultProfile();
    const renown = p.renown;
    const pr = recordNight(
      p,
      { architect: "mason" },
      result({ kills: { spikes: 45, risen: 12 }, classKills: {} }),
      3,
      true,
      "2026-11-16",
    );
    expect(pr.aspects).toEqual(["spikes"]);
    expect(p.mastery.necro).toBe(12);
    expect(activeAspects(p)).toEqual(["spikes"]);
    expect(p.renown).toBeGreaterThan(renown);
    expect(p.stats.aspects).toBe(1);
  });
  it("bestiary marks pay renown", () => {
    const p = defaultProfile();
    const pr = recordNight(
      p,
      { architect: "mason" },
      result({ kills: {}, classKills: { rogue: 12, paladin: 1 } }),
      0,
      false,
      "2026-11-16",
    );
    expect(pr.bestiary).toEqual([
      ["rogue", 1],
      ["paladin", 1],
    ]);
    expect(p.stats.bestiary).toBe(2);
  });
  it("bounties are daily, distinct and deterministic", () => {
    const a = bountiesFor("2026-11-16");
    expect(a).toEqual(bountiesFor("2026-11-16"));
    expect(new Set(a.map((b) => b.kind)).size).toBe(3);
    const days = new Set(
      ["2026-11-16", "2026-11-17", "2026-11-18"].map((d) =>
        JSON.stringify(bountiesFor(d)),
      ),
    );
    expect(days.size).toBe(3);
  });
  it("bounties fill up over nights and pay once", () => {
    const p = defaultProfile();
    const board = currentBoard(p, "2026-11-16");
    // Fake a board with an easy stars bounty.
    board.bounties = [
      { kind: "stars", goal: 4, renown: 4 },
      { kind: "combo", goal: 3, renown: 4 },
      { kind: "classKills", ref: "knight", goal: 1, renown: 3 },
    ];
    const res = result({ kills: {}, classKills: {}, bestCombo: 2 });
    let pr = recordNight(p, { architect: "mason" }, res, 3, true, "2026-11-16");
    expect(pr.bounties.length).toBe(0);
    pr = recordNight(
      p,
      { architect: "mason" },
      { ...res, bestCombo: 3, classKills: { knight: 1 } },
      3,
      true,
      "2026-11-16",
    );
    expect(pr.bounties.length).toBe(3);
    expect(pr.boardDone).toBe(true);
    expect(p.stats.contracts).toBe(3);
    pr = recordNight(p, { architect: "mason" }, res, 3, true, "2026-11-16");
    expect(pr.bounties.length).toBe(0);
    // A new day brings a new board.
    expect(currentBoard(p, "2026-11-17").day).toBe("2026-11-17");
  });
  it("bounty gains read the night's result", () => {
    const res = result({
      kills: { spikes: 3, flame: 2, risen: 1 },
      classKills: { rogue: 2 },
    });
    expect(
      bountyGain(
        { kind: "pieceKills", ref: "spikes", goal: 5, renown: 3 },
        res,
        0,
      ),
    ).toBe(3);
    expect(
      bountyGain(
        { kind: "schoolKills", ref: "grave", goal: 5, renown: 3 },
        res,
        0,
      ),
    ).toBe(1);
    expect(
      bountyGain(
        { kind: "classKills", ref: "rogue", goal: 5, renown: 3 },
        res,
        0,
      ),
    ).toBe(2);
    expect(bountyGain({ kind: "flawless", goal: 2, renown: 3 }, res, 3)).toBe(
      1,
    );
  });
});

describe("architect levels", () => {
  it("nights and wins level architects up and pay renown", () => {
    expect(archLevel(0).level).toBe(1);
    expect(archLevel(ARCH_LEVEL_AT[1]).level).toBe(2);
    expect(archLevel(100_000).level).toBe(10);
    const p = defaultProfile();
    const res = {
      ...simulate(raidOn([{ cls: "knight" }]).setup).result(),
      kills: {},
      classKills: {},
    };
    for (let i = 0; i < 3; i++)
      recordNight(p, { architect: "lich" }, res, 3, true, "2026-11-16");
    expect(p.archXp.lich).toBe(12);
    const before = p.renown;
    const pr = recordWinXp(p, "lich");
    expect(p.archXp.lich).toBe(22);
    expect(pr.renown).toBe(0);
    expect(p.renown).toBe(before);
    // A lost night earns nothing.
    recordNight(p, { architect: "lich" }, res, 0, false, "2026-11-16");
    expect(p.archXp.lich).toBe(22);
  });
  it("alternate kits replace the starting blueprints", () => {
    for (const a of ARCHITECTS) {
      const r = newRun({
        seed: 3,
        biome: "crypt",
        architect: a.id,
        depth: 1,
        powers: [],
        kit: 1,
      });
      expect(r.owned).toEqual(ALT_KITS[a.id].start);
      expect(r.kit).toBe(1);
      for (const p of ALT_KITS[a.id].start) expect(PIECES[p]).toBeDefined();
    }
  });
  it("signature relics only reach their own architect", () => {
    const offered = (signature: boolean, architect = "lich" as const) => {
      const seen = new Set<string>();
      const r = newRun({
        seed: 9,
        biome: "crypt",
        architect,
        depth: 1,
        powers: [],
        signature,
      });
      for (let night = 1; night <= 30; night++)
        for (let salt = 0; salt < 6; salt++) {
          r.night = night;
          for (const c of draftFor(r, [], salt))
            if (c.type === "relic") seen.add(c.id);
        }
      return seen;
    };
    const sigs = Object.values(SIGNATURE);
    expect(sigs.some((s) => offered(false).has(s))).toBe(false);
    const withSig = offered(true);
    expect(withSig.has(SIGNATURE.lich)).toBe(true);
    for (const s of sigs)
      if (s !== SIGNATURE.lich) expect(withSig.has(s)).toBe(false);
    for (const s of sigs) expect(RELICS[s].arch).toBeDefined();
  });
  it("signature relics do what they say", () => {
    const r = run();
    r.relics.push("loadedDice");
    expect(draftFor(r, []).length).toBe(4);
    const base = reinforceCost(r, "spikes")!;
    r.relics.push("masterTools");
    expect(reinforceCost(r, "spikes")).toBe(Math.round(base * 0.7));
  });
});

describe("profile", () => {
  it("old saves gain the new progression fields", () => {
    const old = { ...defaultProfile() } as Record<string, unknown>;
    for (const k of [
      "mastery",
      "aspects",
      "bestiary",
      "bounties",
      "archXp",
      "kits",
      "schools4",
    ])
      delete old[k];
    const p = migrateProfile(old);
    expect(p.mastery).toEqual({});
    expect(p.aspects).toEqual([]);
    expect(p.archXp).toEqual({});
    expect(p.schools4).toEqual([]);
    expect(p.stats.contracts).toBe(0);
  });
  it("new feats are unique and named", () => {
    expect(new Set(FEATS.map((f) => f.id)).size).toBe(FEATS.length);
    for (const id of [
      "school4",
      "aspectsAll",
      "contracts10",
      "archLevel10",
      "heat26",
    ])
      expect(FEATS.some((f) => f.id === id)).toBe(true);
    const all = FEATS.find((f) => f.id === "aspectsAll")!;
    expect(all.goal).toBe(Object.keys(ASPECTS).length);
  });
});
