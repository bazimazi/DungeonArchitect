// Every trial must be beatable with three stars, and must not be free.
import { PIECES, T, type PieceId } from "../src/game/defs";
import { cloneLayout, idx } from "../src/game/grid";
import { simulate } from "../src/game/sim";
import {
  TRIALS,
  trialLayout,
  trialSetup,
  trialStars,
} from "../src/game/trials";

type Place = [PieceId, number, number, number];
/** Reference solutions found by search; each meets its trial's par. */
const SOLUTIONS: Record<string, Place[]> = {
  "1-1": [
    ["skeleton", 6, 10, 1],
    ["skeleton", 4, 12, 0],
    ["darts", 5, 5, 2],
    ["skeleton", 5, 12, 0],
  ],
  "1-2": [
    ["flame", 8, 9, 3],
    ["tar", 6, 9, 3],
    ["flame", 9, 3, 3],
  ],
  "1-3": [
    ["skeleton", 3, 9, 1],
    ["skeleton", 4, 12, 2],
    ["skeleton", 3, 11, 0],
    ["skeleton", 7, 9, 2],
    ["skeleton", 4, 11, 2],
    ["skeleton", 7, 10, 2],
    ["skeleton", 6, 12, 0],
  ],
  "1-4": [
    ["spikes", 5, 6, 1],
    ["spikes", 5, 7, 2],
    ["spikes", 5, 8, 2],
    ["spikes", 5, 3, 1],
    ["spring", 5, 1, 2],
    ["spikes", 5, 2, 0],
  ],
  "2-1": [
    ["darts", 8, 6, 3],
    ["flame", 4, 13, 0],
    ["spikes", 2, 5, 1],
    ["tar", 4, 10, 3],
    ["spikes", 4, 3, 1],
  ],
  "2-2": [
    ["tar", 5, 10, 0],
    ["gas", 6, 5, 1],
    ["spikes", 5, 5, 0],
    ["tar", 5, 9, 3],
    ["flame", 5, 8, 2],
    ["lure", 8, 7, 1],
  ],
  "2-3": [
    ["skeleton", 4, 12, 2],
    ["flame", 5, 8, 2],
    ["flame", 5, 9, 2],
    ["spikes", 5, 2, 1],
    ["darts", 5, 13, 0],
  ],
  "2-4": [
    ["darts", 5, 3, 1],
    ["darts", 4, 1, 1],
    ["trapdoor", 1, 9, 3],
    ["trapdoor", 2, 9, 3],
    ["darts", 3, 5, 1],
  ],
  "3-1": [
    ["tar", 5, 11, 0],
    ["tar", 5, 3, 2],
    ["tar", 5, 7, 1],
    ["flame", 5, 9, 0],
    ["flame", 5, 1, 2],
    ["flame", 5, 10, 2],
    ["flame", 5, 8, 0],
  ],
  "3-2": [
    ["spikes", 4, 9, 2],
    ["darts", 7, 9, 2],
    ["darts", 3, 9, 1],
    ["spikes", 4, 6, 1],
    ["spikes", 3, 3, 0],
    ["spikes", 7, 10, 0],
    ["spikes", 4, 3, 1],
    ["spikes", 2, 2, 0],
    ["skeleton", 6, 11, 1],
    ["spikes", 2, 3, 3],
    ["spikes", 2, 1, 3],
    ["archer", 6, 12, 0],
    ["spikes", 3, 8, 0],
  ],
  "3-3": [
    ["tar", 7, 4, 3],
    ["tar", 8, 4, 3],
    ["tar", 6, 10, 3],
    ["tar", 7, 1, 3],
    ["flame", 6, 9, 2],
    ["flame", 7, 2, 2],
    ["flame", 6, 7, 2],
    ["frost", 8, 6, 1],
  ],
  "3-4": [
    ["saw", 9, 7, 0],
    ["darts", 9, 6, 2],
    ["darts", 9, 5, 3],
    ["darts", 1, 5, 1],
    ["darts", 3, 5, 1],
    ["darts", 1, 4, 0],
    ["saw", 9, 12, 0],
    ["darts", 9, 13, 0],
  ],
  "4-1": [
    ["slime", 7, 4, 0],
    ["skeleton", 4, 4, 0],
    ["flame", 5, 1, 2],
    ["tar", 5, 3, 3],
    ["tar", 5, 2, 3],
    ["skeleton", 3, 5, 0],
  ],
  "4-2": [
    ["darts", 8, 8, 3],
    ["darts", 3, 8, 0],
    ["darts", 9, 8, 3],
  ],
  "4-3": [
    ["spikes", 5, 8, 2],
    ["spikes", 5, 3, 0],
    ["spikes", 5, 9, 0],
    ["spikes", 5, 1, 1],
    ["ghost", 6, 3, 0],
    ["spikes", 7, 5, 2],
    ["spikes", 3, 3, 2],
    ["darts", 7, 6, 2],
    ["darts", 6, 11, 3],
    ["spikes", 5, 2, 1],
    ["darts", 7, 8, 0],
    ["ghost", 3, 6, 0],
  ],
  "4-4": [
    ["spikes", 5, 1, 3],
    ["gas", 5, 10, 1],
    ["spikes", 5, 2, 0],
    ["tar", 5, 9, 3],
    ["gas", 5, 3, 2],
    ["spikes", 5, 4, 2],
    ["spikes", 5, 6, 0],
  ],
  "5-1": [
    ["ogre", 6, 7, 1],
    ["darts", 9, 4, 2],
    ["spikes", 3, 9, 2],
    ["slime", 6, 3, 2],
    ["slime", 6, 5, 2],
    ["spikes", 9, 5, 1],
    ["ogre", 3, 12, 2],
    ["spikes", 7, 9, 3],
    ["spikes", 9, 7, 1],
    ["skeleton", 2, 9, 0],
  ],
  "5-2": [
    ["tar", 6, 4, 3],
    ["skeleton", 5, 9, 1],
    ["crusher", 6, 12, 3],
    ["spikes", 7, 6, 1],
    ["flame", 9, 9, 0],
    ["flame", 4, 12, 1],
    ["skeleton", 7, 13, 2],
  ],
  "5-3": [
    ["spikes", 7, 6, 2],
    ["skeleton", 5, 10, 2],
    ["spikes", 6, 10, 2],
    ["crusher", 6, 9, 2],
    ["spikes", 6, 6, 2],
    ["spikes", 8, 3, 2],
    ["totem", 7, 11, 2],
    ["spikes", 4, 5, 0],
    ["crusher", 5, 11, 1],
    ["skeleton", 4, 12, 3],
    ["spikes", 6, 3, 3],
    ["skeleton", 8, 13, 3],
    ["spikes", 6, 1, 1],
  ],
  "5-4": [
    ["crusher", 6, 11, 3],
    ["spikes", 5, 9, 1],
    ["gas", 6, 12, 2],
    ["golem", 5, 13, 1],
    ["ogre", 7, 12, 3],
    ["gas", 5, 5, 0],
    ["ogre", 8, 11, 3],
    ["ogre", 3, 13, 1],
  ],
  "6-1": [
    ["spikes", 5, 9, 2],
    ["skeleton", 3, 4, 2],
    ["flame", 5, 5, 0],
    ["gas", 5, 1, 0],
    ["skeleton", 5, 4, 0],
    ["skeleton", 4, 4, 2],
    ["skeleton", 6, 4, 1],
    ["flame", 3, 3, 1],
    ["flame", 7, 3, 3],
    ["skeleton", 4, 3, 0],
    ["skeleton", 4, 9, 2],
    ["skeleton", 3, 9, 0],
  ],
  "6-2": [
    ["skeleton", 1, 11, 1],
    ["skeleton", 1, 10, 2],
    ["skeleton", 1, 8, 1],
    ["skeleton", 2, 5, 0],
    ["saw", 8, 5, 1],
    ["skeleton", 5, 5, 0],
    ["skeleton", 1, 7, 3],
    ["saw", 1, 5, 3],
    ["skeleton", 1, 12, 3],
    ["skeleton", 3, 12, 3],
    ["skeleton", 2, 13, 2],
  ],
  "6-3": [
    ["flame", 4, 8, 2],
    ["ogre", 4, 13, 2],
    ["darts", 4, 7, 2],
    ["ogre", 5, 11, 2],
    ["ogre", 5, 12, 2],
    ["tar", 4, 11, 0],
    ["ogre", 3, 12, 3],
    ["darts", 5, 7, 3],
    ["gas", 4, 10, 0],
    ["darts", 4, 9, 2],
    ["gas", 2, 6, 3],
    ["flame", 4, 4, 3],
  ],
  "6-4": [
    ["darts", 2, 6, 1],
    ["crusher", 3, 6, 1],
    ["skeleton", 6, 6, 1],
    ["darts", 8, 3, 2],
    ["spikes", 8, 5, 0],
    ["darts", 8, 6, 3],
    ["tar", 3, 9, 2],
    ["skeleton", 6, 9, 1],
    ["tar", 5, 9, 1],
    ["darts", 7, 6, 3],
    ["darts", 2, 9, 1],
    ["skeleton", 4, 13, 0],
    ["skeleton", 3, 12, 2],
    ["spikes", 5, 2, 0],
    ["skeleton", 2, 7, 3],
    ["flame", 6, 12, 3],
    ["darts", 4, 12, 1],
    ["spikes", 5, 1, 0],
  ],
  "6-5": [
    ["trapdoor", 3, 10, 0],
    ["trapdoor", 5, 9, 3],
    ["darts", 3, 6, 0],
    ["darts", 4, 6, 1],
    ["darts", 3, 3, 1],
    ["gas", 7, 3, 1],
  ],
};

function play(id: string, cfg: Place[]) {
  const t = TRIALS.find((x) => x.id === id)!;
  const l = cloneLayout(trialLayout(t));
  let spent = 0;
  for (const [kind, x, y, dir] of cfg) {
    expect(t.pieces).toContain(kind);
    expect(l.tiles[idx(l, x, y)]).toBe(T.Floor);
    expect(l.objects.some((o) => o.x === x && o.y === y)).toBe(false);
    expect(x === l.hoard.x && y === l.hoard.y).toBe(false);
    expect(x === l.entrance.x && y === l.entrance.y).toBe(false);
    l.objects.push({ id: l.nextId++, kind, x, y, dir });
    spent += PIECES[kind].cost;
  }
  expect(spent).toBeLessThanOrEqual(t.gold);
  const r = simulate(trialSetup(t, l), 6000);
  const res = r.result();
  return trialStars(t, res.stolen, res.escaped, spent);
}

describe("trials", () => {
  it("are well formed", () => {
    const ids = new Set<string>();
    for (const t of TRIALS) {
      expect(ids.has(t.id)).toBe(false);
      ids.add(t.id);
      expect(() => trialLayout(t)).not.toThrow();
      expect(t.par).toBeLessThanOrEqual(t.gold);
      expect(SOLUTIONS[t.id]).toBeDefined();
    }
  });
  for (const t of TRIALS)
    it(`${t.id} ${t.name}: reference solution earns three stars`, () => {
      expect(play(t.id, SOLUTIONS[t.id]).stars).toBe(3);
    });
  it("can't be won by building nothing", () => {
    for (const t of TRIALS) expect(play(t.id, []).stars).toBe(0);
  });
});
