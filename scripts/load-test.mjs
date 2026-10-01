const base = process.env.BASE_URL ?? "http://127.0.0.1:5187";
const requests = Number(process.env.REQUESTS ?? 100),
  concurrency = Number(process.env.CONCURRENCY ?? 10);
const timings = [];
let failures = 0,
  cursor = 0;
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    while (cursor++ < requests) {
      const start = performance.now();
      try {
        const response = await fetch(`${base}/api/dungeons?category=new`);
        if (!response.ok) failures++;
        await response.text();
      } catch {
        failures++;
      }
      timings.push(performance.now() - start);
    }
  }),
);
timings.sort((a, b) => a - b);
console.log(
  JSON.stringify(
    {
      requests: timings.length,
      concurrency,
      failures,
      p50Ms: timings[Math.floor(timings.length * 0.5)],
      p95Ms: timings[Math.floor(timings.length * 0.95)],
      maxMs: timings.at(-1),
    },
    null,
    2,
  ),
);
if (failures) process.exitCode = 1;
