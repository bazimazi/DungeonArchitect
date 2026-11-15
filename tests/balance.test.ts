// Balance report: BALANCE=1 npx vitest run tests/balance.test.ts
import { newRun, partyFor, raidMods, pieceCost } from "../src/game/run";
import { simulate } from "../src/game/sim";
import { distanceField, pathTo } from "../src/game/grid";
import type { PieceId } from "../src/game/defs";

function build(seed: number, gold: number, kit: PieceId[]) {
  const run = newRun({
    seed,
    biome: "crypt",
    architect: "mason",
    infamy: 0,
    powers: ["rockfall"],
  });
  const l = run.layout;
  const f = distanceField(l, l.hoard.x, l.hoard.y);
  const route = pathTo(l, f, l.entrance.x, l.entrance.y).slice(2, -2);
  let g = gold,
    i = 0;
  for (const k of kit) {
    const c = pieceCost(run, k);
    if (g < c) break;
    const spot = route[Math.floor(((i + 0.5) / kit.length) * route.length)];
    i++;
    if (l.objects.some((o) => o.x === spot.x && o.y === spot.y)) continue;
    l.objects.push({ id: l.nextId++, kind: k, x: spot.x, y: spot.y, dir: 2 });
    g -= c;
  }
  return run;
}
it.skipIf(!process.env.BALANCE)("balance report", () => {
  const kits: [string, PieceId[]][] = [
    [
      "spikes+skel",
      ["skeleton", "spikes", "spikes", "skeleton", "darts", "spikes"],
    ],
    ["skeletons", ["skeleton", "skeleton", "skeleton", "skeleton", "skeleton"]],
  ];
  for (const n of [1, 2, 3, 5, 8, 10]) {
    for (const [name, kit] of kits) {
      let stolen = 0,
        killed = 0,
        secs = 0;
      for (let seed = 1; seed <= 20; seed++) {
        const run = build(
          seed,
          150 + (n - 1) * 90,
          [...kit, ...kit, ...kit].slice(0, 4 + n * 2),
        );
        run.night = n;
        const r = simulate({
          layout: run.layout,
          party: partyFor(run, n),
          seed,
          night: n,
          hoard: 12,
          mods: raidMods(run),
        });
        const res = r.result();
        stolen += res.stolen;
        killed += res.killed;
        secs += res.seconds;
      }
      process.stderr.write(
        `\nnight ${n} ${name}: party=${partyFor({ seed: 1, infamy: 0 }, n)
          .map((p) => p.cls)
          .join(
            ",",
          )} avgStolen=${(stolen / 20).toFixed(2)} avgKilled=${(killed / 20).toFixed(2)} avgSec=${(secs / 20).toFixed(0)}`,
      );
    }
  }
});
