import {
  generateLayout,
  hasRoute,
  routeLength,
  type Layout,
} from "../src/game/grid";
import {
  applyCard,
  canFill,
  draftFor,
  newRun,
  partyFor,
  raidMods,
  sell,
  place,
  canPlace,
} from "../src/game/run";
import { Raid, simulate, type RaidMods } from "../src/game/sim";
import { NIGHTS, T, type HeroClass, type PieceId } from "../src/game/defs";

const base = () =>
  newRun({
    seed: 1234,
    biome: "crypt",
    architect: "mason",
    depth: 1,
    powers: ["rockfall"],
  });
const mods = (): RaidMods => ({
  heroHp: 1,
  heroDmg: 1,
  heroSpeed: 1,
  monsterHp: 1,
  relics: [],
  tiers: {},
});

/** A straight vertical corridor from the entrance (5,0) to the hoard (5,12). */
function corridor(): Layout {
  const l = generateLayout(1, "crypt");
  l.tiles = l.tiles.map((t) => (t === T.Floor ? T.Rock : t));
  for (let y = 0; y <= 12; y++) l.tiles[y * l.w + 5] = T.Floor;
  l.objects = [];
  return l;
}
function raidOn(
  l: Layout,
  party: HeroClass[],
  objects: [PieceId, number, number, number?][] = [],
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
    mods: mods(),
  });
}
function runUntil(r: Raid, pred: () => boolean, max = 4000) {
  for (let i = 0; i < max && !pred() && !r.finished; i++) {
    r.step();
  }
  return pred();
}

describe("map generation", () => {
  it("always produces a connected starter dungeon", () => {
    for (let seed = 1; seed < 200; seed++) {
      for (const biome of ["crypt", "grotto", "forge"] as const) {
        const l = generateLayout(seed, biome);
        expect(hasRoute(l)).toBe(true);
        expect(routeLength(l)).toBeGreaterThan(10);
      }
    }
  });
});

describe("raid simulation", () => {
  it("is deterministic for identical inputs", () => {
    const run = base();
    const setup = {
      layout: run.layout,
      party: partyFor(run, 5),
      seed: 99,
      night: 5,
      hoard: 12,
      mods: raidMods({ ...run, night: 5 }),
    };
    const a = simulate(setup);
    const b = simulate(setup);
    expect(a.tick).toBe(b.tick);
    expect(a.result()).toEqual(b.result());
    expect(a.heroes.map((h) => [h.x, h.y, h.hp])).toEqual(
      b.heroes.map((h) => [h.x, h.y, h.hp]),
    );
  });

  it("always finishes, and undefended dungeons get robbed", () => {
    const run = base();
    run.layout.objects = [];
    for (let n = 1; n <= NIGHTS; n++) {
      const r = simulate({
        layout: run.layout,
        party: partyFor(run, n),
        seed: n,
        night: n,
        hoard: 12,
        mods: raidMods({ ...run, night: n }),
      });
      expect(r.finished).toBe(true);
      expect(r.result().stolen).toBeGreaterThan(0);
    }
  });

  it("kills drop stolen treasure back into the hoard", () => {
    const r = raidOn(
      corridor(),
      ["rogue"],
      [
        ["spikes", 5, 4],
        ["spikes", 5, 6],
        ["spikes", 5, 8],
      ],
    );
    runUntil(r, () => r.finished);
    // Rogue disarms one plate but the rest kill it on the way out at the latest.
    expect(r.result().killed).toBe(1);
    expect(r.hoard).toBe(12);
  });

  it("rogues disarm the first trap ahead", () => {
    const r = raidOn(corridor(), ["rogue"], [["spikes", 5, 5]]);
    expect(runUntil(r, () => r.traps[0].disabled)).toBe(true);
  });

  it("springs fling light heroes but not knights", () => {
    const r = raidOn(corridor(), ["ranger"], [["spring", 5, 3, 2]]);
    expect(runUntil(r, () => r.heroes[0].hop !== null)).toBe(true);
    const k = raidOn(corridor(), ["knight"], [["spring", 5, 3, 2]]);
    runUntil(k, () => k.heroes[0].y > 6);
    expect(k.events.some((e) => e.k === "trap" && e.kind === "spring")).toBe(
      false,
    );
  });

  it("trapdoors send heroes back to the entrance", () => {
    const r = raidOn(corridor(), ["knight"], [["trapdoor", 5, 4]]);
    expect(runUntil(r, () => r.heroes[0].state === "falling")).toBe(true);
    runUntil(r, () => r.heroes[0].state !== "falling");
    expect(Math.floor(r.heroes[0].y)).toBe(0);
  });

  it("flame ignites tar into a burning pool", () => {
    const r = raidOn(
      corridor(),
      ["knight"],
      [
        ["flame", 5, 3, 2],
        ["tar", 5, 5],
      ],
    );
    expect(runUntil(r, () => r.tarFire.size > 0, 200)).toBe(true);
  });

  it("dwarves tunnel through rock when the maze is long", () => {
    const l = corridor();
    // Detour: block the straight corridor and force a long loop.
    for (let y = 6; y <= 7; y++) l.tiles[y * l.w + 5] = T.Rock;
    for (let y = 3; y <= 10; y++) l.tiles[y * l.w + 1] = T.Floor;
    for (let x = 1; x <= 5; x++) {
      l.tiles[3 * l.w + x] = T.Floor;
      l.tiles[10 * l.w + x] = T.Floor;
    }
    const r = raidOn(l, ["dwarf"]);
    expect(
      runUntil(
        r,
        () =>
          r.events.some((e) => e.k === "dig" && e.done) ||
          r.layout.tiles[6 * l.w + 5] === T.Floor,
      ),
    ).toBe(true);
  });

  it("greedy heroes detour to bait chests", () => {
    const l = corridor();
    l.tiles[4 * l.w + 6] = T.Floor;
    l.tiles[4 * l.w + 7] = T.Floor;
    const r = raidOn(l, ["rogue"], [["lure", 7, 4]]);
    expect(runUntil(r, () => r.traps[0].used)).toBe(true);
  });

  it("boulders roll down their lane and crush heroes", () => {
    const r = raidOn(corridor(), ["knight"], [["boulder", 5, 10, 0]]);
    expect(runUntil(r, () => r.traps[0].active)).toBe(true);
    expect(runUntil(r, () => r.heroes[0].hp < r.heroes[0].maxHp)).toBe(true);
  });

  it("monsters sealed in a diagonal pocket never stall the party", () => {
    const l = corridor();
    // A floor pocket touching the hoard tile (5,12) only at a corner.
    l.tiles[13 * l.w + 4] = T.Floor;
    l.tiles[12 * l.w + 4] = T.Rock;
    l.tiles[13 * l.w + 5] = T.Rock;
    const r = raidOn(l, ["knight", "cleric"], [["skeleton", 4, 13]]);
    runUntil(r, () => r.finished);
    expect(r.result().seconds).toBeLessThan(120);
  });

  it("heroes falling through a trapdoor are untouchable", () => {
    const r = raidOn(
      corridor(),
      ["ranger"],
      [
        ["trapdoor", 5, 3],
        ["ogre", 5, 4],
      ],
    );
    expect(runUntil(r, () => r.heroes[0].state === "falling")).toBe(true);
    const hp = r.heroes[0].hp;
    for (let i = 0; i < 10; i++) r.step();
    expect(r.heroes[0].hp).toBe(hp);
    runUntil(r, () => r.heroes[0].state !== "falling");
    expect(Math.floor(r.heroes[0].y)).toBe(0);
  });

  it("powers spend dread and damage heroes", () => {
    const r = raidOn(corridor(), ["knight"]);
    runUntil(r, () => r.heroes[0].alive && r.heroes[0].y > 3);
    r.dread = 10;
    const before = r.heroes[0].hp;
    const hx = Math.floor(r.heroes[0].x);
    const hy = Math.floor(r.heroes[0].y);
    expect(r.cast("rockfall", hx, hy + 1, 5)).toBe(true);
    expect(r.dread).toBe(5);
    for (let i = 0; i < 15; i++) r.step();
    expect(r.heroes[0].hp).toBeLessThan(before);
  });
});

describe("runs", () => {
  it("generates deterministic parties that grow and end with the champion", () => {
    const run = base();
    expect(partyFor(run, 4)).toEqual(partyFor(run, 4));
    expect(partyFor(run, NIGHTS).some((p) => p.cls === "paladin")).toBe(true);
    expect(partyFor(run, 8).length).toBeGreaterThan(partyFor(run, 2).length);
  });

  it("offers three distinct boons and applies them", () => {
    const run = base();
    const cards = draftFor(run, []);
    expect(cards.length).toBe(3);
    expect(new Set(cards.map((c) => `${c.type}:${c.id}`)).size).toBe(3);
    const piece = cards.find((c) => c.type === "piece");
    if (piece) {
      applyCard(run, piece);
      expect(run.owned).toContain(piece.id);
    }
  });

  it("never lets building cut the route", () => {
    const run = base();
    const l = run.layout;
    const tunnel = l.tiles.findIndex(
      (t, i) => t === T.Floor && i > l.w * 2 && i < l.w * 6,
    );
    const x = tunnel % l.w;
    const y = Math.floor(tunnel / l.w);
    expect(canFill(run, x, y)).toBe("blocked");
  });

  it("refunds pieces placed this phase in full", () => {
    const run = base();
    const l = run.layout;
    const spot = l.tiles.findIndex(
      (t, i) =>
        t === T.Floor &&
        i > l.w * 2 &&
        !l.objects.some((o) => o.y * l.w + o.x === i),
    );
    const x = spot % l.w;
    const y = Math.floor(spot / l.w);
    expect(canPlace(run, "skeleton", x, y)).toBeNull();
    const gold = run.gold;
    const o = place(run, "skeleton", x, y, 2);
    sell(run, o.id);
    expect(run.gold).toBe(gold);
  });
});
