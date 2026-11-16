import { BIOME_IDS, FLOORPLANS, T, type FloorplanId } from "../src/game/defs";
import {
  distanceField,
  generateLayout,
  hasRoute,
  idx,
  pathTo,
  routeLength,
  type Layout,
} from "../src/game/grid";
import { depthInfo, newRun, planFor } from "../src/game/run";
import { isLordDepth } from "../src/game/defs";

const PLANS = Object.keys(FLOORPLANS) as FloorplanId[];

function ascii(l: Layout) {
  const rows: string[] = [];
  for (let y = 0; y < l.h; y++) {
    let s = "";
    for (let x = 0; x < l.w; x++) {
      if (x === l.entrance.x && y === l.entrance.y) s += "E";
      else if (x === l.hoard.x && y === l.hoard.y) s += "H";
      else s += "#.@$"[l.tiles[idx(l, x, y)]];
    }
    rows.push(s);
  }
  return rows.join("\n");
}

describe("floorplans", () => {
  it("always connect the stairs to the hoard inside a bedrock frame", () => {
    for (const plan of PLANS)
      for (const biome of BIOME_IDS)
        for (let seed = 1; seed <= 60; seed++) {
          const l = generateLayout(seed * 7919, biome, {
            plan,
            variant: seed,
            veins: seed % 3 ? 1 : 2,
          });
          expect(hasRoute(l), `${plan}/${biome}/${seed}\n${ascii(l)}`).toBe(
            true,
          );
          expect(l.entrance.y).toBe(0);
          expect(l.tiles[idx(l, l.entrance.x, 1)]).toBe(T.Floor);
          expect(l.tiles[idx(l, l.hoard.x, l.hoard.y)]).toBe(T.Floor);
          for (let x = 0; x < l.w; x++) {
            if (x !== l.entrance.x) expect(l.tiles[x]).toBe(T.Bedrock);
            expect(l.tiles[idx(l, x, l.h - 1)]).toBe(T.Bedrock);
          }
          for (let y = 0; y < l.h; y++) {
            expect(l.tiles[idx(l, 0, y)]).toBe(T.Bedrock);
            expect(l.tiles[idx(l, l.w - 1, y)]).toBe(T.Bedrock);
          }
          const len = routeLength(l);
          expect(len, `${plan}/${seed}\n${ascii(l)}`).toBeGreaterThanOrEqual(9);
          expect(len).toBeLessThanOrEqual(45);
        }
  });

  it("keep the original cellars unchanged", () => {
    // Shared links, trials and tests built on generateLayout(seed, biome).
    const a = generateLayout(42, "grotto");
    const b = generateLayout(42, "grotto", { plan: "cellar" });
    expect(b).toEqual(a);
  });

  it("are fixed per depth, varied, and never repeat back to back", () => {
    expect(planFor(1)).toBe("cellar");
    const seen = new Set<FloorplanId>();
    for (let d = 1; d <= 400; d++) {
      const p = planFor(d);
      expect(planFor(d)).toBe(p);
      expect(depthInfo(d).plan).toBe(p);
      expect(FLOORPLANS[p].from).toBeLessThanOrEqual(d);
      if (!isLordDepth(d)) expect(FLOORPLANS[p].lord).toBeFalsy();
      if (d > 1 && !isLordDepth(d) && !isLordDepth(d - 1))
        expect(p, `depth ${d}`).not.toBe(planFor(d - 1));
      seen.add(p);
    }
    expect(seen.size).toBe(PLANS.length);
  });

  it("give every run a gift trap on the route", () => {
    for (let d = 1; d <= 40; d++)
      for (let seed = 1; seed <= 6; seed++) {
        const r = newRun({
          seed: seed * 1013,
          biome: "crypt",
          architect: "mason",
          depth: d,
          powers: [],
        });
        expect(r.layout.objects.length, `depth ${d}`).toBe(1);
        const o = r.layout.objects[0];
        const f = distanceField(r.layout, r.layout.hoard.x, r.layout.hoard.y);
        const route = pathTo(
          r.layout,
          f,
          r.layout.entrance.x,
          r.layout.entrance.y,
        );
        expect(route.some((t) => t.x === o.x && t.y === o.y)).toBe(true);
      }
  });

  it.skipIf(!process.env.SHOW)("print", () => {
    for (const plan of PLANS) {
      const l = generateLayout(12345, "crypt", { plan, variant: 3 });
      process.stderr.write(
        `\n${plan} (route ${routeLength(l)})\n${ascii(l)}\n`,
      );
    }
  });
});
