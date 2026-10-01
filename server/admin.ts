import { resolve } from "node:path";
import { Database } from "./database";

const [handle, role = "admin"] = process.argv.slice(2);
if (!handle || !["player", "moderator", "admin"].includes(role))
  throw new Error(
    "Usage: npm run admin -- <existing-handle> [player|moderator|admin]",
  );
const db = new Database(
  process.env.DATABASE_PATH ?? resolve("data/dungeon-architect.sqlite"),
);
try {
  if (!db.run("UPDATE users SET role=? WHERE handle=?", role, handle))
    throw new Error("Account not found. Register it first.");
  console.log(`Role updated for ${handle}: ${role}`);
} finally {
  db.close();
}
