import { buildServer } from "../server/app";
import { createStarter } from "../src/core/dungeon";
import { gzipSync } from "node:zlib";
import { writeFile, mkdir } from "node:fs/promises";
const count = Number(process.env.DUNGEONS ?? 10000),
  perDungeon = 10;
const { app, db } = await buildServer({
  databasePath: ":memory:",
  rateLimits: false,
});
const snapshot = JSON.stringify(createStarter()),
  binary = gzipSync("[]"),
  now = new Date().toISOString();
const start = performance.now();
db.transaction(() => {
  for (let i = 0; i < 100; i++)
    db.run(
      "INSERT INTO users VALUES(?,?,?,?,?,?,?,?,?)",
      `u${i}`,
      `architect_${i}`,
      `Architect ${i}`,
      "not-a-login",
      "player",
      "active",
      0,
      "[]",
      now,
    );
  for (let i = 0; i < count; i++) {
    db.run(
      "INSERT INTO dungeons VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      `d${i}`,
      `u${i % 100}`,
      `s${i}`,
      `Dungeon ${i}`,
      "Benchmark dungeon",
      '["Combat"]',
      "public",
      "published",
      `v${i}`,
      `DA-${i.toString(16).padStart(10, "0")}`,
      now,
      now,
    );
    db.run(
      "INSERT INTO versions VALUES(?,?,?,?,?,?,?,?)",
      `v${i}`,
      `d${i}`,
      1,
      snapshot,
      binary,
      `hash${i}`,
      50,
      now,
    );
    for (let a = 0; a < perDungeon; a++) {
      const id = `a${i}-${a}`;
      db.run(
        "INSERT INTO tickets VALUES(?,?,?,?,?,?,?)",
        id,
        `u${a}`,
        `v${i}`,
        a,
        now,
        now,
        "hash",
      );
      db.run(
        "INSERT INTO attempts VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        id,
        id,
        `u${a}`,
        `v${i}`,
        binary,
        a % 3 ? "completed" : "dead",
        30 + a,
        40,
        60,
        2,
        1,
        a % 3 ? null : 4,
        a % 3 ? null : 7,
        "{}",
        now,
      );
    }
  }
});
const results: Record<string, unknown> = {
  dungeons: count,
  attempts: count * perDungeon,
  seedMs: performance.now() - start,
  measurements: {},
};
for (const url of [
  "/api/dungeons?category=new",
  "/api/dungeons?category=recommended",
  "/api/dungeons?category=new&search=Dungeon+123",
  "/api/leaderboards",
  "/api/versions/v0/recordings",
]) {
  const samples: number[] = [];
  let bytes = 0;
  for (let n = 0; n < 10; n++) {
    const t = performance.now();
    const r = await app.inject({ url });
    if (r.statusCode !== 200) throw new Error(`${url}: ${r.body}`);
    samples.push(performance.now() - t);
    bytes = r.body.length;
  }
  samples.sort((a, b) => a - b);
  (results.measurements as Record<string, unknown>)[url] = {
    p50Ms: samples[5],
    p95Ms: samples[9],
    bytes,
  };
}
await app.close();
await mkdir("test-results", { recursive: true });
await writeFile(
  "test-results/server-benchmark.json",
  JSON.stringify(results, null, 2),
);
console.log(JSON.stringify(results, null, 2));
