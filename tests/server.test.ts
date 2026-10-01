import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../server/app";
import { createStarter } from "../src/core/dungeon";
import { simulateAdventurer } from "../src/core/adventurers";
import { reconstructReplay } from "../src/core/simulation";
import type {
  CommunityDungeon,
  PlayerProfile,
  AttemptTicket,
  AttemptResult,
} from "../src/shared/community";

type Server = Awaited<ReturnType<typeof buildServer>>;
const open: Server[] = [];
afterEach(async () => {
  for (const server of open.splice(0)) await server.app.close();
});
async function setup() {
  const server = await buildServer({
    databasePath: ":memory:",
    rateLimits: false,
  });
  open.push(server);
  return server;
}
async function register(server: Server, handle: string) {
  const response = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: {
      handle,
      displayName: handle,
      password: "A test-only passphrase 2026",
    },
  });
  expect(response.statusCode).toBe(200);
  const cookie = String(response.headers["set-cookie"]).split(";")[0];
  return { cookie, profile: response.json<PlayerProfile>() };
}
async function publish(
  server: Server,
  cookie: string,
  title = "Mossveil Crypt",
) {
  const dungeon = createStarter();
  dungeon.title = title;
  const proof = simulateAdventurer(dungeon, "draft", 4, 3);
  const response = await server.app.inject({
    method: "POST",
    url: "/api/dungeons/publish",
    headers: { cookie },
    payload: {
      dungeon,
      proof,
      description: "A fair loop with a risky shortcut.",
      tags: ["Combat", "Trap"],
      visibility: "public",
    },
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<CommunityDungeon>();
}

describe("persistent authoritative server", () => {
  it("measures post-attempt returns only for mature distinct-player cohorts", async () => {
    const server = await buildServer({
      databasePath: ":memory:",
      rateLimits: false,
      now: () => new Date("2026-01-11T00:00:00.000Z"),
    });
    open.push(server);
    const owner = await register(server, "retention_owner");
    const dungeon = await publish(server, owner.cookie);
    let sequence = 0;
    const attempt = (player: string, day: number) => {
      const id = `retention-${sequence++}`;
      const at = new Date(
        Date.parse("2026-01-01T00:00:00.000Z") + day * 86400000,
      ).toISOString();
      server.db.run(
        "INSERT INTO tickets VALUES(?,?,?,?,?,?,?)",
        id,
        player,
        dungeon.card.versionId,
        1,
        at,
        at,
        "fixture",
      );
      server.db.run(
        "INSERT INTO attempts VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        id,
        id,
        player,
        dungeon.card.versionId,
        new Uint8Array(),
        "completed",
        30,
        100,
        0,
        0,
        0,
        null,
        null,
        "{}",
        at,
      );
    };
    for (const [handle, days] of [
      ["returned", [0, 1, 2]],
      ["same_session", [0, 0.1]],
      ["too_late", [0, 8]],
      ["recent", [9]],
    ] as const) {
      const player = await register(server, handle);
      for (const day of days) attempt(player.profile.id, day);
    }
    attempt(owner.profile.id, 0);
    attempt(owner.profile.id, 1);
    const response = await server.app.inject({
      url: "/api/dungeons?category=recommended",
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().items[0].calibration).toMatchObject({
      returnEligiblePlayers: 3,
      returningPlayers: 1,
    });
  });
  it("deduplicates served recommendations and limits a new dungeon's initial audience without hiding it from New", async () => {
    const s = await setup(),
      owner = await register(s, "exposure_owner"),
      first = await register(s, "first_viewer"),
      next = await register(s, "next_viewer"),
      dungeon = await publish(s, owner.cookie);
    const feed = (cookie: string, category: string) =>
      s.app.inject({
        url: `/api/dungeons?category=${category}`,
        headers: { cookie },
      });
    await feed(first.cookie, "recommended");
    await feed(first.cookie, "recommended");
    expect(
      s.db.get<{ count: number }>(
        "SELECT COUNT(*) count FROM discovery_exposures",
      )?.count,
    ).toBe(1);
    for (let i = 0; i < 19; i++) {
      s.db.run(
        "INSERT INTO users VALUES(?,?,?,?,?,?,?,?,?)",
        `sample${i}`,
        `sample${i}`,
        "Sample",
        "no-login",
        "player",
        "active",
        0,
        "[]",
        new Date().toISOString(),
      );
      s.db.run(
        "INSERT INTO discovery_exposures VALUES(?,?,?)",
        dungeon.card.versionId,
        `sample${i}`,
        new Date().toISOString(),
      );
    }
    expect((await feed(next.cookie, "recommended")).json().items).toEqual([]);
    expect((await feed(next.cookie, "new")).json().items[0].id).toBe(
      dungeon.card.id,
    );
    expect((await feed(first.cookie, "recommended")).json().items[0].id).toBe(
      dungeon.card.id,
    );
    for (let i = 0; i < 3; i++) {
      const player = await register(s, `audience_player${i}`);
      const ticket = (
        await s.app.inject({
          method: "POST",
          url: `/api/versions/${dungeon.card.versionId}/attempts`,
          headers: { cookie: player.cookie },
        })
      ).json<AttemptTicket>();
      const proof = simulateAdventurer(
        ticket.dungeon,
        ticket.versionId,
        ticket.seed,
        3,
      );
      const result = await s.app.inject({
        method: "POST",
        url: `/api/attempts/${ticket.id}`,
        headers: { cookie: player.cookie },
        payload: { actions: proof.actions, abandon: false },
      });
      expect(result.statusCode, result.body).toBe(200);
    }
    expect((await feed(next.cookie, "recommended")).json().items[0].id).toBe(
      dungeon.card.id,
    );
  });
  it("aggregates every verified recording, exposes public reputation without balances, and scopes record categories", async () => {
    const server = await setup(),
      owner = await register(server, "atlas"),
      player = await register(server, "runner");
    const published = await publish(server, owner.cookie);
    for (let i = 0; i < 3; i++) {
      const ticket = (
        await server.app.inject({
          method: "POST",
          url: `/api/versions/${published.card.versionId}/attempts`,
          headers: { cookie: player.cookie },
        })
      ).json<AttemptTicket>();
      const replay = simulateAdventurer(
        ticket.dungeon,
        ticket.versionId,
        ticket.seed,
        3,
      );
      const result = await server.app.inject({
        method: "POST",
        url: `/api/attempts/${ticket.id}`,
        headers: { cookie: player.cookie },
        payload: { actions: replay.actions },
      });
      expect(result.statusCode, result.body).toBe(200);
    }
    const recordings = (
      await server.app.inject({
        url: `/api/versions/${published.card.versionId}/recordings`,
      })
    ).json();
    expect(recordings.analytics.attempts).toBe(3);
    expect(recordings.analytics.completions).toBe(3);
    expect(recordings.analytics.commonRoute.count).toBe(3);
    expect(recordings.analytics.traffic.length).toBeGreaterThan(0);
    const profile = (
      await server.app.inject({ url: "/api/players/atlas" })
    ).json();
    expect(profile.reputation.attempts).toBe(3);
    expect(profile.reputation.uniqueAdventurers).toBe(1);
    expect(profile.gold).toBeUndefined();
    expect(profile.publishingDisabled).toBeUndefined();
    for (const metric of [
      "speed",
      "damage",
      "health",
      "treasure",
      "difficulty",
      "survival",
      "deaths",
      "secrets",
      "streak",
    ]) {
      const board = await server.app.inject({
        url: `/api/leaderboards?metric=${metric}&period=daily`,
      });
      expect(board.statusCode, board.body).toBe(200);
      expect(board.json()).toHaveLength(1);
      expect(board.json()[0].metric).toBe(metric);
    }
  });
  it("accepts only bounded product event batches and strips unrelated content", async () => {
    const server = await setup(),
      clientId = crypto.randomUUID();
    const response = await server.app.inject({
      method: "POST",
      url: "/api/usage",
      payload: {
        clientId,
        events: [
          {
            type: "ObjectPlaced",
            durationMs: 0,
            password: "must not be retained",
          },
        ],
      },
    });
    expect(response.statusCode).toBe(200);
    const rows = server.db.all("SELECT * FROM usage_events");
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain("password");
    expect(
      (
        await server.app.inject({
          method: "POST",
          url: "/api/usage",
          payload: {
            clientId,
            events: [{ type: "UnrestrictedUserText", durationMs: 0 }],
          },
        })
      ).statusCode,
    ).toBe(400);
  });
  it("authenticates with HttpOnly sessions, rejects hostile origins, and never returns password material", async () => {
    const server = await setup();
    const user = await register(server, "architect_one");
    expect(JSON.stringify(user.profile)).not.toContain("password");
    expect(
      server.db.get<{ password_hash: string }>(
        "SELECT password_hash FROM users",
      )!.password_hash,
    ).toMatch(/^scrypt:/);
    const me = await server.app.inject({
      url: "/api/me",
      headers: { cookie: user.cookie },
    });
    expect(me.json().player.handle).toBe("architect_one");
    const rejected = await server.app.inject({
      method: "PATCH",
      url: "/api/me",
      headers: { cookie: user.cookie, origin: "https://untrusted.example" },
      payload: { displayName: "Changed" },
    });
    expect(rejected.statusCode).toBe(403);
    const login = await server.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        handle: "architect_one",
        password: "A test-only passphrase 2026",
      },
    });
    expect(login.statusCode).toBe(200);
    expect(login.headers["set-cookie"]).toContain("HttpOnly");
    expect(login.headers["set-cookie"]).toContain("SameSite=Strict");
    await server.app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { cookie: user.cookie },
    });
    expect(
      (
        await server.app.inject({
          url: "/api/me",
          headers: { cookie: user.cookie },
        })
      ).json().player,
    ).toBeNull();
  });
  it("requires a real completion, enforces ownership, and preserves immutable versions", async () => {
    const server = await setup();
    const owner = await register(server, "builder");
    const other = await register(server, "intruder");
    const dungeon = createStarter();
    const proof = simulateAdventurer(dungeon, "draft", 4, 3);
    const forged = await server.app.inject({
      method: "POST",
      url: "/api/dungeons/publish",
      headers: { cookie: owner.cookie },
      payload: {
        dungeon,
        proof: { ...proof, actions: [], completed: true },
        tags: [],
      },
    });
    expect(forged.statusCode).toBe(400);
    const first = await publish(server, owner.cookie);
    const stolen = await server.app.inject({
      method: "POST",
      url: "/api/dungeons/publish",
      headers: { cookie: other.cookie },
      payload: { dungeon, proof, dungeonId: first.card.id, tags: [] },
    });
    expect(stolen.statusCode).toBe(403);
    const second = await publish(server, owner.cookie, "The revised crypt");
    expect(second.versions).toHaveLength(2);
    expect(second.versions[1].dungeon.title).toBe("Mossveil Crypt");
    expect(second.card.version).toBe(2);
    expect(server.progression.profile(owner.profile.id).xp).toBe(40);
    const guest = await server.app.inject({
      url: `/api/dungeons/${first.card.shareCode}`,
    });
    expect(guest.json().card.id).toBe(first.card.id);
  });
  it("binds attempts to server seeds and players, re-simulates results, and issues idempotent rewards", async () => {
    const server = await setup();
    const architect = await register(server, "builder");
    const player = await register(server, "adventurer");
    const dungeon = await publish(server, architect.cookie);
    const ticket = (
      await server.app.inject({
        method: "POST",
        url: `/api/versions/${dungeon.card.versionId}/attempts`,
        headers: { cookie: player.cookie },
      })
    ).json<AttemptTicket>();
    const replay = simulateAdventurer(
      ticket.dungeon,
      ticket.versionId,
      ticket.seed,
      3,
    );
    const stolen = await server.app.inject({
      method: "POST",
      url: `/api/attempts/${ticket.id}`,
      headers: { cookie: architect.cookie },
      payload: { actions: replay.actions },
    });
    expect(stolen.statusCode).toBe(403);
    const payload = {
      actions: replay.actions,
      health: 9999,
      gold: 9999,
      seed: 123,
      outcome: "completed",
    };
    const first = await server.app.inject({
      method: "POST",
      url: `/api/attempts/${ticket.id}`,
      headers: { cookie: player.cookie },
      payload,
    });
    expect(first.statusCode, first.body).toBe(200);
    const result = first.json<AttemptResult>();
    expect(result.health).toBe(reconstructReplay(replay).state.player.hp);
    expect(result.rewards.gold).toBe(15);
    expect(result.profile.gold).toBe(15);
    const repeat = await server.app.inject({
      method: "POST",
      url: `/api/attempts/${ticket.id}`,
      headers: { cookie: player.cookie },
      payload,
    });
    expect(repeat.json()).toEqual(result);
    const changed = await server.app.inject({
      method: "POST",
      url: `/api/attempts/${ticket.id}`,
      headers: { cookie: player.cookie },
      payload: { actions: [{ type: "wait" }], abandon: true },
    });
    expect(changed.statusCode).toBe(409);
    const stored = (
      await server.app.inject({ url: `/api/attempts/${result.id}/replay` })
    ).json();
    expect(reconstructReplay(stored).state).toEqual(
      reconstructReplay(replay).state,
    );
    const stats = (
      await server.app.inject({ url: `/api/dungeons/${dungeon.card.id}` })
    ).json<CommunityDungeon>();
    expect(stats.card.attempts).toBe(1);
    expect(stats.card.completions).toBe(1);
    const leaders = (
      await server.app.inject({
        url: `/api/leaderboards?versionId=${ticket.versionId}`,
      })
    ).json();
    expect(leaders[0].player).toBe("adventurer");
  });
  it("isolates drafts and detects concurrent edits", async () => {
    const server = await setup();
    const a = await register(server, "builder");
    const b = await register(server, "second");
    const dungeon = createStarter();
    const save = () =>
      server.app.inject({
        method: "PUT",
        url: `/api/drafts/${dungeon.id}`,
        headers: { cookie: a.cookie },
        payload: { dungeon, expectedRevision: 0 },
      });
    expect((await save()).json().revision).toBe(1);
    expect((await save()).statusCode).toBe(409);
    expect(
      (
        await server.app.inject({
          url: "/api/drafts",
          headers: { cookie: b.cookie },
        })
      ).json(),
    ).toEqual([]);
  });
  it("supports reactions, follows, challenge delivery/results, and private dungeon access", async () => {
    const server = await setup();
    const a = await register(server, "builder");
    const b = await register(server, "friend");
    const dungeon = await publish(server, a.cookie);
    await server.app.inject({
      method: "POST",
      url: `/api/dungeons/${dungeon.card.id}/reactions`,
      headers: { cookie: b.cookie },
      payload: { kind: "favorite", enabled: true },
    });
    await server.app.inject({
      method: "POST",
      url: "/api/players/builder/follow",
      headers: { cookie: b.cookie },
      payload: { enabled: true },
    });
    const favorites = (
      await server.app.inject({
        url: "/api/dungeons?category=favorites",
        headers: { cookie: b.cookie },
      })
    ).json();
    expect(favorites.items).toHaveLength(1);
    expect(favorites.items[0].following).toBe(true);
    const challenge = await server.app.inject({
      method: "POST",
      url: "/api/friend-challenges",
      headers: { cookie: a.cookie },
      payload: { handle: "friend", versionId: dungeon.card.versionId },
    });
    expect(challenge.statusCode).toBe(200);
    const ticket = (
      await server.app.inject({
        method: "POST",
        url: `/api/versions/${dungeon.card.versionId}/attempts`,
        headers: { cookie: b.cookie },
      })
    ).json<AttemptTicket>();
    const replay = simulateAdventurer(
      ticket.dungeon,
      ticket.versionId,
      ticket.seed,
      0,
    );
    await server.app.inject({
      method: "POST",
      url: `/api/attempts/${ticket.id}`,
      headers: { cookie: b.cookie },
      payload: { actions: replay.actions },
    });
    expect(
      (
        await server.app.inject({
          url: "/api/friend-challenges",
          headers: { cookie: a.cookie },
        })
      ).json()[0].status,
    ).toBe("completed");
    expect(
      (
        await server.app.inject({
          url: "/api/notifications",
          headers: { cookie: a.cookie },
        })
      )
        .json()
        .some((n: { kind: string }) => n.kind === "friend-result"),
    ).toBe(true);
    await server.app.inject({
      method: "PATCH",
      url: `/api/dungeons/${dungeon.card.id}`,
      headers: { cookie: a.cookie },
      payload: { lifecycle: "published", visibility: "private" },
    });
    expect(
      (
        await server.app.inject({
          url: `/api/dungeons/${dungeon.card.id}`,
          headers: { cookie: b.cookie },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await server.app.inject({
          url: `/api/dungeons/${dungeon.card.id}`,
          headers: { cookie: a.cookie },
        })
      ).statusCode,
    ).toBe(200);
  });
  it("enforces moderation roles, records audits, restores content, and revokes suspended sessions", async () => {
    const server = await setup();
    const a = await register(server, "builder");
    const moderator = await register(server, "moderator");
    const dungeon = await publish(server, a.cookie);
    const action = {
      action: "hide-dungeon",
      targetId: dungeon.card.id,
      reason: "Reviewed a reproducible content report.",
    };
    expect(
      (
        await server.app.inject({
          method: "POST",
          url: "/api/moderation/actions",
          headers: { cookie: a.cookie },
          payload: action,
        })
      ).statusCode,
    ).toBe(403);
    server.db.run(
      "UPDATE users SET role='moderator' WHERE id=?",
      moderator.profile.id,
    );
    expect(
      (
        await server.app.inject({
          method: "POST",
          url: "/api/moderation/actions",
          headers: { cookie: moderator.cookie },
          payload: action,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await server.app.inject({ url: `/api/dungeons/${dungeon.card.id}` }))
        .statusCode,
    ).toBe(404);
    await server.app.inject({
      method: "POST",
      url: "/api/moderation/actions",
      headers: { cookie: moderator.cookie },
      payload: { ...action, action: "restore-dungeon" },
    });
    expect(
      (await server.app.inject({ url: `/api/dungeons/${dungeon.card.id}` }))
        .statusCode,
    ).toBe(200);
    await server.app.inject({
      method: "POST",
      url: "/api/moderation/actions",
      headers: { cookie: moderator.cookie },
      payload: { ...action, action: "suspend-player", targetId: a.profile.id },
    });
    expect(
      (
        await server.app.inject({
          url: "/api/me",
          headers: { cookie: a.cookie },
        })
      ).json().player,
    ).toBeNull();
    expect(server.db.all("SELECT * FROM moderation_audit")).toHaveLength(3);
  });
  it("uses shared global challenge windows and validates their actual construction constraints", async () => {
    const server = await setup();
    const a = await register(server, "builder");
    const challenges = (
      await server.app.inject({ url: "/api/challenges" })
    ).json().challenges;
    expect(challenges).toHaveLength(3);
    expect(challenges[0].id).toMatch(/^daily:/);
    const dungeon = createStarter();
    const proof = simulateAdventurer(dungeon, "draft", 4, 3);
    const weekly = await server.app.inject({
      method: "POST",
      url: "/api/dungeons/publish",
      headers: { cookie: a.cookie },
      payload: {
        dungeon,
        proof,
        tags: ["Combat"],
        challengeId: challenges[1].id,
      },
    });
    expect(weekly.statusCode).toBe(400);
    expect(weekly.json().code).toBe("challenge_rules");
  });
});
