// Realms, omens and the v3 heroes, champions, pieces and relics.
import { generateLayout, type Layout } from "../src/game/grid";
import {
  FEATS,
  OMENS,
  OMEN_IDS,
  T,
  heatOf,
  isLordDepth,
  powerCost,
  realmOf,
  type HeroClass,
  type PieceId,
} from "../src/game/defs";
import {
  capacityFor,
  depthInfo,
  draftFor,
  newRun,
  partyFor,
  raidMods,
  renownFor,
  runHeat,
  sellValue,
  type RunState,
} from "../src/game/run";
import { Raid, simulate, type RaidMods } from "../src/game/sim";
import { TRIALS } from "../src/game/trials";

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
  hoard = 12,
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
    hoard,
    mods: mods(m),
  });
}
function runUntil(r: Raid, pred: () => boolean, max = 4000) {
  for (let i = 0; i < max && !pred() && !r.finished; i++) r.step();
  return pred();
}
const run = (depth = 1, extra: Partial<Parameters<typeof newRun>[0]> = {}) =>
  newRun({
    seed: 77,
    biome: "crypt",
    architect: "mason",
    depth,
    powers: ["rockfall"],
    ...extra,
  });

describe("realms", () => {
  it("group five depths and put a realm lord at the end of each", () => {
    expect(realmOf(1)).toBe(1);
    expect(realmOf(5)).toBe(1);
    expect(realmOf(6)).toBe(2);
    expect(isLordDepth(5)).toBe(true);
    expect(isLordDepth(6)).toBe(false);
    expect(depthInfo(5).boss).toBe("thane");
    expect(depthInfo(10).boss).toBe("shade");
    expect(depthInfo(15).boss).toBe("revenant");
    expect(depthInfo(20).boss).toBe("witch");
    expect(depthInfo(25).boss).toBe("thane");
    expect(depthInfo(5).lord).toBe(true);
    expect(depthInfo(5).realmName).toBe("The Upper Dark");
    expect(depthInfo(41).realmName).toMatch(/ II$/);
  });
  it("pay extra renown for conquering a lord's depth", () => {
    const a = run(4);
    const b = run(5);
    for (const r of [a, b]) {
      r.history = Array.from({ length: 10 }, (_, i) => ({
        night: i + 1,
        stars: 3,
        killed: 1,
        escaped: 0,
        stolen: 0,
        gold: 0,
        combo: 0,
      }));
      r.victory = true;
    }
    expect(renownFor(b) - renownFor(a)).toBe(4 + 10);
  });
  it("bring new heroes into deeper parties", () => {
    let sapper = false;
    let druid = false;
    for (let seed = 1; seed < 30; seed++) {
      const r = newRun({
        seed,
        biome: "crypt",
        architect: "mason",
        depth: 7,
        powers: [],
      });
      for (let n = 3; n <= 9; n++)
        for (const p of partyFor(r, n)) {
          sapper ||= p.cls === "sapper";
          druid ||= p.cls === "druid";
        }
    }
    expect(sapper && druid).toBe(true);
    const shallow = run(2);
    for (let n = 1; n <= 9; n++)
      expect(
        partyFor(shallow, n).some(
          (p) => p.cls === "sapper" || p.cls === "druid",
        ),
      ).toBe(false);
  });
});

describe("omens", () => {
  it("add heat and multiply renown", () => {
    const plain = run(1);
    const hot = run(1, { omens: ["ironWill", "cramped", "betrayal"] });
    expect(runHeat(hot)).toBe(8);
    expect(heatOf(OMEN_IDS)).toBe(
      OMEN_IDS.reduce((a, o) => a + OMENS[o].heat, 0),
    );
    for (const r of [plain, hot]) {
      r.history = [
        {
          night: 1,
          stars: 3,
          killed: 1,
          escaped: 0,
          stolen: 0,
          gold: 0,
          combo: 0,
        },
      ];
    }
    expect(renownFor(hot)).toBe(Math.round(renownFor(plain) * 1.8));
  });
  it("change the run as described", () => {
    const plain = run(1);
    const r = run(1, {
      omens: ["poverty", "brittle", "silence", "cramped", "ironWill", "meager"],
    });
    expect(r.gold).toBe(plain.gold - 40);
    expect(r.hoardMax).toBe(plain.hoardMax - 4);
    expect(r.powers).toEqual([]);
    expect(capacityFor(r)).toBe(capacityFor(plain) - 3);
    expect(raidMods(r).heroHp).toBeCloseTo(raidMods(plain).heroHp * 1.2);
    r.night = plain.night = 3;
    expect(draftFor(r, []).length).toBe(2);
    expect(draftFor(plain, []).length).toBe(3);
  });
  it("Betrayal reveals every trap", () => {
    const r = raidOn(["knight"], [["spikes", 5, 4]], { omens: ["betrayal"] });
    expect(r.traps[0].known).toBe(true);
  });
});

describe("new heroes and champions", () => {
  it("sappers wreck the most dangerous trap in sight", () => {
    const r = raidOn(
      ["sapper"],
      [
        ["spikes", 5, 2],
        ["flame", 5, 3, 2],
      ],
    );
    expect(runUntil(r, () => r.traps.some((t) => t.disabled))).toBe(true);
    expect(r.traps.find((t) => t.kind === "flame")!.disabled).toBe(true);
    expect(r.traps.find((t) => t.kind === "spikes")!.disabled).toBe(false);
  });
  it("druids root monsters in place", () => {
    const r = raidOn(["druid"], [["skeleton", 5, 6]]);
    const m = r.monsters[0];
    expect(runUntil(r, () => m.st.stun > 0)).toBe(true);
  });
  it("the Shade vanishes from monsters", () => {
    const r = raidOn(["shade"]);
    const h = r.heroes[0];
    expect(runUntil(r, () => h.st.veil > 0)).toBe(true);
  });
  it("the Hollow King raises the fallen near him", () => {
    const r = raidOn(["revenant", "knight"]);
    r.step();
    for (let i = 0; i < 40; i++) r.step();
    const k = r.heroes[1];
    runUntil(r, () => k.alive);
    r.damage(k, 9999, "magic", "test");
    expect(k.alive).toBe(false);
    expect(runUntil(r, () => k.alive, 60)).toBe(true);
    expect(k.hp).toBe(Math.round(k.maxHp * 0.5));
    expect(r.riseCharges).toBe(2);
  });
  it("Thane Brannoc tunnels toward the hoard", () => {
    const l = corridor();
    // A long detour he can ignore: wall off the corridor and add a loop.
    const r = raidOn(["thane"], [], {}, l);
    const before = r.layout.tiles.filter((t) => t === T.Floor).length;
    // Block the corridor halfway so he must dig.
    r.layout.tiles[6 * r.layout.w + 5] = T.Rock;
    runUntil(r, () => r.heroes[0].touchedHoard, 3000);
    expect(r.heroes[0].touchedHoard).toBe(true);
    expect(r.layout.tiles.filter((t) => t === T.Floor).length).toBe(before);
  });
});

describe("new pieces", () => {
  it("crushers slam and stun the tile ahead", () => {
    const r = raidOn(["knight"], [["crusher", 5, 3, 2]]);
    const h = r.heroes[0];
    expect(runUntil(r, () => h.st.stun > 0)).toBe(true);
  });
  it("hex totems make heroes take more damage", () => {
    const a = raidOn(["knight"], [["totem", 5, 3]]);
    const h = a.heroes[0];
    runUntil(a, () => h.st.hex > 0);
    const before = h.hp;
    a.damage(h, 50, "magic", "test");
    expect(before - h.hp).toBe(60);
  });
  it("gargoyles sleep as statues, then wake with a slam", () => {
    const r = raidOn(["knight"], [["gargoyle", 5, 5]]);
    const g = r.monsters[0];
    expect(g.dormant).toBe(true);
    r.damage(g, 50, "phys", "test");
    expect(g.hp).toBe(g.maxHp);
    expect(runUntil(r, () => !g.dormant)).toBe(true);
  });
  it("wraiths drift through rock", () => {
    const r = raidOn(["knight"], [["wraith", 3, 6]]);
    const w = r.monsters[0];
    let inRock = false;
    runUntil(r, () => {
      const t = r.layout.tiles[Math.floor(w.y) * r.layout.w + Math.floor(w.x)];
      inRock ||= t === T.Rock;
      return w.target >= 0 && inRock;
    });
    expect(inRock).toBe(true);
  });
});

describe("new relics and powers", () => {
  it("Architect's Eye makes powers cheaper", () => {
    expect(powerCost("rockfall", [])).toBe(5);
    expect(powerCost("rockfall", ["archEye"])).toBe(4);
  });
  it("sinkholes drop heroes back to the stairs", () => {
    const r = raidOn(["knight"]);
    const h = r.heroes[0];
    runUntil(r, () => Math.floor(h.y) >= 3);
    r.dread = 20;
    r.cast("sinkhole", 5, 4, powerCost("sinkhole", []));
    expect(runUntil(r, () => h.state === "falling", 200)).toBe(true);
  });
  it("the Phylactery stops the first thief", () => {
    const l = corridor();
    const plain = simulate({
      layout: l,
      party: [{ cls: "rogue" }],
      seed: 1,
      night: 1,
      hoard: 12,
      mods: mods(),
    });
    expect(plain.result().stolen).toBe(2);
    const kept = simulate({
      layout: l,
      party: [{ cls: "rogue" }],
      seed: 1,
      night: 1,
      hoard: 12,
      mods: mods({ relics: ["phylactery"] }),
    });
    expect(kept.result().stolen).toBe(0);
  });
});

describe("fixes", () => {
  it("the free starter trap sells for nothing", () => {
    const r: RunState = run(1);
    const gift = r.layout.objects[0];
    expect(sellValue(r, gift.id)).toBe(0);
  });
  it("ogres can't knock knights around", () => {
    const r = raidOn(["knight"], [["ogre", 5, 6]]);
    const h = r.heroes[0];
    let hopped = false;
    runUntil(r, () => {
      hopped ||= !!h.hop;
      return !h.alive || h.touchedHoard;
    });
    expect(hopped).toBe(false);
  });
  it("stolen only counts treasure taken tonight", () => {
    const r = simulate({
      layout: corridor(),
      party: [{ cls: "knight" }],
      seed: 1,
      night: 1,
      hoard: 8,
      hoardMax: 12,
      mods: mods(),
    });
    expect(r.result().stolen).toBe(1);
  });
  it("trial feats match the number of trial stars", () => {
    expect(FEATS.find((f) => f.id === "trials90")!.goal).toBe(
      TRIALS.length * 3,
    );
  });
});
