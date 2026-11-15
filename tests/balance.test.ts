// Balance report: BALANCE=1 npx vitest run tests/balance.test.ts
// A heuristic bot plays whole runs at several depths and into the abyss.
import { playRun } from "./bot";
import { BASE_POOL, TUNE, type PieceId } from "../src/game/defs";
if (process.env.TUNE) Object.assign(TUNE, JSON.parse(process.env.TUNE));

const SEEDS = Number(process.env.SEEDS ?? 24);
const out = (s: string) => process.stderr.write(s + "\n");

it.skipIf(!process.env.BALANCE)(
  "difficulty curve across depths",
  () => {
    const depths = (process.env.DEPTHS ?? "1,2,3,5,8,12")
      .split(",")
      .map(Number);
    for (const depth of depths) {
      let wins = 0;
      let stars = 0;
      let nights = 0;
      const lostAt: number[] = [];
      const stolenBy = new Array(11).fill(0);
      const secsBy = new Array(11).fill(0);
      for (let seed = 1; seed <= SEEDS; seed++) {
        const r = playRun({ seed: seed * 101 + depth, depth });
        if (r.won) wins++;
        else lostAt.push(r.nights);
        stars += r.stars;
        nights += r.nights;
        for (const n of r.perNight) {
          stolenBy[n.night] += n.stolen;
          secsBy[n.night] += n.secs;
        }
      }
      out(
        `depth ${depth}: win ${((wins / SEEDS) * 100).toFixed(0)}% stars ${(stars / SEEDS).toFixed(1)} avgNights ${(nights / SEEDS).toFixed(1)} lostAt [${lostAt.sort((a, b) => a - b).join(",")}]`,
      );
      out(
        `   stolen/night ${stolenBy
          .slice(1)
          .map((v) => (v / SEEDS).toFixed(1))
          .join(" ")}`,
      );
      out(
        `   secs/night   ${secsBy
          .slice(1)
          .map((v) => (v / SEEDS).toFixed(0))
          .join(" ")}`,
      );
    }
  },
  600_000,
);

it.skipIf(!process.env.BALANCE)(
  "abyss endurance",
  () => {
    for (const depth of [1, 4]) {
      const reached: number[] = [];
      for (let seed = 1; seed <= SEEDS; seed++) {
        const r = playRun({ seed: seed * 31 + depth, depth, abyssUntil: 60 });
        if (r.won) reached.push(r.nights);
      }
      reached.sort((a, b) => a - b);
      out(
        `abyss from depth ${depth}: winners ${reached.length}/${SEEDS} fell at [${reached.join(",")}]`,
      );
    }
  },
  600_000,
);

it.skipIf(!process.env.BALANCE)(
  "first descent with the starter kit",
  () => {
    for (const skill of [0.3, 0.7]) {
      let wins = 0;
      let stars = 0;
      const lost: number[] = [];
      for (let seed = 1; seed <= SEEDS; seed++) {
        const r = playRun({
          seed: seed * 13,
          depth: 1,
          skill,
          pool: BASE_POOL as PieceId[],
          powers: ["rockfall"],
        });
        if (r.won) wins++;
        else lost.push(r.nights);
        stars += r.stars;
      }
      out(
        `first descent, skill ${skill}: win ${((wins / SEEDS) * 100).toFixed(0)}% stars ${(stars / SEEDS).toFixed(1)} lostAt [${lost.join(",")}]`,
      );
    }
  },
  600_000,
);
