import { expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { buildServer } from "../server/app";
import { createStarter } from "../src/core/dungeon";
import { simulateAdventurer } from "../src/core/adventurers";

it("retains accounts, certificates, versions and sessions across restart and a consistent live backup", async () => {
  const parent = resolve(tmpdir()),
    dir = await mkdtemp(join(parent, "dungeon-persistence-"));
  const path = join(dir, "live.sqlite"),
    backup = join(dir, "backup.sqlite");
  let server: Awaited<ReturnType<typeof buildServer>> | undefined;
  try {
    server = await buildServer({ databasePath: path, rateLimits: false });
    const registered = await server.app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        handle: "backup_architect",
        displayName: "Backup architect",
        password: "Persistence test only 2026",
      },
    });
    const cookie = String(registered.headers["set-cookie"]).split(";")[0],
      dungeon = createStarter();
    const published = await server.app.inject({
      method: "POST",
      url: "/api/dungeons/publish",
      headers: { cookie },
      payload: {
        dungeon,
        proof: simulateAdventurer(dungeon, "draft", 42, 0),
        description: "Backup test",
        tags: ["Combat"],
        visibility: "public",
        expectedVersion: 0,
      },
    });
    expect(published.statusCode, published.body).toBe(200);
    const card = published.json().card;
    execFileSync(process.execPath, ["scripts/backup.mjs", backup], {
      env: { ...process.env, DATABASE_PATH: path },
      stdio: "pipe",
    });
    await server.app.close();
    server = undefined;
    for (const databasePath of [path, backup]) {
      server = await buildServer({ databasePath, rateLimits: false });
      expect(
        (
          await server.app.inject({ url: "/api/me", headers: { cookie } })
        ).json().player.handle,
      ).toBe("backup_architect");
      expect(
        (await server.app.inject({ url: `/api/dungeons/${card.id}` })).json()
          .versions[0].id,
      ).toBe(card.versionId);
      expect(
        server.db.get<{ integrity_check: string }>("PRAGMA integrity_check")
          ?.integrity_check,
      ).toBe("ok");
      await server.app.close();
      server = undefined;
    }
  } finally {
    await server?.app.close();
    if (
      !resolve(dir).startsWith(parent + sep) ||
      !dir.includes("dungeon-persistence-")
    )
      throw new Error("Unexpected cleanup path");
    await rm(dir, { recursive: true, force: true });
  }
});
