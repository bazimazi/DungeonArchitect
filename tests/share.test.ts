import { generateLayout } from "../src/game/grid";
import { decodeDungeon, encodeDungeon } from "../src/game/share";

describe("dungeon links", () => {
  it("round-trips a dungeon through a URL-safe code", () => {
    const layout = generateLayout(42, "grotto");
    const floor = layout.tiles
      .map((t, i) => (t === 1 && i > layout.w * 2 ? i : -1))
      .filter((i) => i >= 0);
    layout.objects = (["darts", "necro", "saw"] as const).map((kind, i) => ({
      id: i + 1,
      kind,
      x: floor[i * 3] % layout.w,
      y: Math.floor(floor[i * 3] / layout.w),
      dir: i,
    }));
    const code = encodeDungeon({
      name: "Grimwald's Hole ☠",
      biome: "grotto",
      layout,
      tiers: { darts: 3 },
      budget: 14,
      rules: 1,
    });
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(code.length).toBeLessThan(200);
    const d = decodeDungeon(code)!;
    expect(d.name).toBe("Grimwald's Hole ☠");
    expect(d.biome).toBe("grotto");
    expect(d.budget).toBe(14);
    expect(d.tiers.darts).toBe(3);
    expect(d.layout.tiles).toEqual(layout.tiles);
    expect(
      d.layout.objects.map(({ kind, x, y, dir }) => ({ kind, x, y, dir })),
    ).toEqual(
      layout.objects.map(({ kind, x, y, dir }) => ({ kind, x, y, dir })),
    );
  });

  it("rejects damaged links", () => {
    expect(decodeDungeon("not-a-dungeon")).toBeNull();
    expect(decodeDungeon("")).toBeNull();
  });

  it("rejects crafted links with sealed hoards or pieces in rock", () => {
    const sealed = generateLayout(3, "crypt");
    sealed.tiles = sealed.tiles.map((t, i) =>
      i === sealed.hoard.y * sealed.w + sealed.hoard.x
        ? 1
        : t === 1 && Math.floor(i / sealed.w) > 1
          ? 0
          : t,
    );
    expect(
      decodeDungeon(
        encodeDungeon({
          name: "x",
          biome: "crypt",
          layout: sealed,
          tiers: {},
          budget: 10,
          rules: 1,
        }),
      ),
    ).toBeNull();
    const rocky = generateLayout(3, "crypt");
    const rock = rocky.tiles.findIndex((t) => t === 0);
    rocky.objects = [
      {
        id: 1,
        kind: "spikes",
        x: rock % rocky.w,
        y: Math.floor(rock / rocky.w),
        dir: 0,
      },
    ];
    expect(
      decodeDungeon(
        encodeDungeon({
          name: "x",
          biome: "crypt",
          layout: rocky,
          tiers: {},
          budget: 10,
          rules: 1,
        }),
      ),
    ).toBeNull();
  });
});
