import { DatabaseSync, backup } from "node:sqlite";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
const source = resolve(
  process.env.DATABASE_PATH ?? "data/dungeon-architect.sqlite",
);
const destination = resolve(
  process.argv[2] ??
    `data/backups/dungeon-${new Date().toISOString().replaceAll(":", "-")}.sqlite`,
);
if (destination === source)
  throw new Error(
    "A backup must use a different destination from the active database.",
  );
await mkdir(resolve(destination, ".."), { recursive: true });
const db = new DatabaseSync(source, { readOnly: true });
try {
  await backup(db, destination);
  console.log(`Consistent database backup saved to ${destination}`);
} finally {
  db.close();
}
