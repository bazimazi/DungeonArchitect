import { VerificationPool } from "./verification";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import serveStatic from "@fastify/static";
import { resolve } from "node:path";
import { Database } from "./database";
import { AuthService } from "./auth";
import { ProgressionService } from "./progression";
import { DungeonService } from "./dungeons";
import { AttemptService } from "./attempts";
import { SocialService } from "./social";
import { ModerationService } from "./moderation";
import { ApiError, objectBody, requireValue, textField } from "./errors";
import { activeChallenges, parseTags, screenText } from "./policies";
import { parseDungeon } from "../src/core/dungeon";
import { ERAS, TAGS } from "../src/shared/community";
import type { UserRow } from "./auth";
import { EconomyService } from "./economy";
import { WorldService } from "./worlds";
import { CLIENT_EVENTS } from "../src/shared/telemetry";
import { currentSeason } from "../src/shared/economy";

export interface ServerOptions {
  databasePath?: string;
  now?: () => Date;
  origins?: string[];
  secureCookies?: boolean;
  serveFiles?: boolean;
  rateLimits?: boolean;
  logger?: boolean;
}
export async function buildServer(options: ServerOptions = {}) {
  const now = options.now ?? (() => new Date());
  const db = new Database(
    options.databasePath ?? resolve("data/dungeon-architect.sqlite"),
  );
  const auth = new AuthService(db, now);
  const progression = new ProgressionService(db, now);
  const verification = new VerificationPool();
  const dungeons = new DungeonService(db, progression, now, verification);
  const attempts = new AttemptService(
    db,
    dungeons,
    progression,
    now,
    verification,
  );
  const social = new SocialService(db, dungeons, attempts, now);
  const moderation = new ModerationService(db, now);
  const economy = new EconomyService(db, progression, now);
  const worlds = new WorldService(db, dungeons, now);
  const origins = new Set(
    options.origins ?? [
      "http://127.0.0.1:5187",
      "http://localhost:5187",
      "http://127.0.0.1:5188",
      "http://localhost:5188",
      "http://127.0.0.1:5173",
      "http://localhost:5173",
    ],
  );
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 1_000_000,
    requestTimeout: 15000,
  });
  await app.register(cookie);
  if (options.rateLimits !== false)
    await app.register(rateLimit, { max: 240, timeWindow: "1 minute" });
  app.addHook("onRequest", async (request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "same-origin");
    reply.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    );
    if (request.url.startsWith("/api/"))
      reply.header("Cache-Control", "no-store");
    const origin = request.headers.origin;
    if (
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      origin &&
      !origins.has(origin)
    )
      throw new ApiError(
        403,
        "origin_rejected",
        "This request origin is not allowed.",
      );
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) {
      void reply
        .code(error.statusCode)
        .send({ code: error.code, message: error.message });
      return;
    }
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) app.log.error(error);
    void reply.code(status).send({
      code:
        status === 429
          ? "rate_limited"
          : status < 500
            ? "invalid_request"
            : "internal_error",
      message:
        status === 429
          ? "Too many requests. Please try again shortly."
          : status < 500
            ? "The request is invalid."
            : "The request could not be completed.",
    });
  });
  const params = (request: { params: unknown }) =>
    request.params as Record<string, string>;
  const query = (request: { query: unknown }) =>
    request.query as Record<string, unknown>;
  const loginRate = {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
  };
  app.get("/api/health", async () => ({ status: "ok", schema: 1 }));
  app.post("/api/usage", async (request) => {
    const body = objectBody(request.body);
    if (
      typeof body.clientId !== "string" ||
      !/^[-a-f0-9]{36}$/.test(body.clientId) ||
      !Array.isArray(body.events) ||
      body.events.length > 20
    )
      throw new ApiError(400, "invalid_usage", "Invalid usage batch.");
    const actor = auth.user(request, false)?.id ?? `anonymous:${body.clientId}`;
    const count = db.get<{ count: number }>(
      "SELECT COUNT(*) count FROM usage_events WHERE actor_id=? AND created_at>?",
      actor,
      new Date(now().getTime() - 60000).toISOString(),
    )!.count;
    if (count + body.events.length > 120)
      throw new ApiError(429, "usage_limit", "Usage batch limit reached.");
    const events = body.events.map((event) => {
      const e = objectBody(event);
      if (
        !CLIENT_EVENTS.includes(e.type as (typeof CLIENT_EVENTS)[number]) ||
        !Number.isInteger(e.durationMs) ||
        Number(e.durationMs) < 0 ||
        Number(e.durationMs) > 3600000
      )
        throw new ApiError(400, "invalid_usage", "Invalid usage event.");
      return { type: String(e.type), duration: Number(e.durationMs) };
    });
    db.transaction(() => {
      for (const e of events)
        db.run(
          "INSERT INTO usage_events(actor_id,type,duration_ms,created_at) VALUES(?,?,?,?)",
          actor,
          e.type,
          e.duration,
          now().toISOString(),
        );
    });
    return { accepted: events.length };
  });
  app.get("/api/catalog", async () => ({ tags: TAGS, eras: ERAS }));
  app.get("/api/shop", async (request) =>
    economy.catalog(auth.user(request, false)),
  );
  app.get("/api/campaigns", async (request) =>
    worlds.campaigns(auth.user(request, false)),
  );
  app.get("/api/campaigns/:id", async (request) =>
    worlds.campaign(params(request).id, auth.user(request, false)),
  );
  app.post("/api/campaigns", async (request) =>
    worlds.saveCampaign(auth.user(request)!, request.body),
  );
  app.put("/api/campaigns/:id", async (request) =>
    worlds.saveCampaign(auth.user(request)!, request.body, params(request).id),
  );
  app.get("/api/projects", async (request) =>
    worlds.projects(auth.user(request)!),
  );
  app.post("/api/projects", async (request) =>
    worlds.createProject(auth.user(request)!, request.body),
  );
  app.get("/api/projects/:id", async (request) =>
    worlds.project(params(request).id, auth.user(request)!),
  );
  app.put("/api/projects/:id", async (request) =>
    worlds.updateProject(auth.user(request)!, params(request).id, request.body),
  );
  app.post("/api/projects/:id/members", async (request) =>
    worlds.member(auth.user(request)!, params(request).id, request.body),
  );
  app.get("/api/guilds", async (request) => worlds.guilds(auth.user(request)!));
  app.post("/api/guilds", async (request) =>
    worlds.guild(auth.user(request)!, request.body),
  );
  app.post("/api/shop/buy", async (request) =>
    economy.buy(auth.user(request)!, request.body),
  );
  app.post("/api/shop/equip", async (request) =>
    economy.equip(auth.user(request)!, request.body),
  );
  for (const operation of ["register", "login"] as const)
    app.post(`/api/auth/${operation}`, loginRate, async (request, reply) => {
      const user = await auth[operation](request.body);
      const session = auth.session(user.id);
      if (request.headers["x-dungeon-native"] === "1")
        reply.header("X-Dungeon-Session", session.token);
      reply.setCookie("da_session", session.token, {
        path: "/",
        httpOnly: true,
        sameSite: "strict",
        secure: options.secureCookies ?? false,
        expires: session.expiresAt,
      });
      return progression.profile(user.id);
    });
  app.post("/api/auth/logout", async (request, reply) => {
    auth.logout(request);
    reply.clearCookie("da_session", { path: "/" });
    return { ok: true };
  });
  app.get("/api/me", async (request) => {
    const user = auth.user(request, false);
    if (user) {
      const season = currentSeason(now());
      attempts.notify(
        user.id,
        "season-open",
        { title: season.title, endsAt: season.endsAt },
        `season:${season.id}`,
      );
    }
    return { player: user ? progression.profile(user.id) : null };
  });
  app.patch("/api/me", async (request) => {
    const user = auth.user(request)!;
    const body = objectBody(request.body);
    const displayName = textField(
      body.displayName ?? user.display_name,
      "Display name",
      2,
      40,
    );
    screenText(displayName);
    const interests = parseTags(body.interests ?? JSON.parse(user.interests));
    db.run(
      "UPDATE users SET display_name=?,interests=? WHERE id=?",
      displayName,
      JSON.stringify(interests),
      user.id,
    );
    return progression.profile(user.id);
  });
  app.get("/api/players/:handle", async (request) => {
    const viewer = auth.user(request, false);
    const user = requireValue(
      db.get<UserRow>(
        "SELECT * FROM users WHERE handle=? AND status='active'",
        params(request).handle,
      ),
    );
    const p = progression.profile(user.id);
    const reputation = db.get<{
      attempts: number;
      uniqueAdventurers: number;
      clears: number;
    }>(
      `SELECT COUNT(*) attempts,COUNT(DISTINCT a.player_id) uniqueAdventurers,COALESCE(SUM(a.outcome='completed'),0) clears FROM attempts a JOIN versions v ON v.id=a.version_id JOIN dungeons d ON d.id=v.dungeon_id WHERE d.owner_id=? AND d.visibility='public' AND d.lifecycle='published'`,
      user.id,
    )!;
    const favorites = db.get<{ count: number }>(
      `SELECT COUNT(*) count FROM reactions r JOIN dungeons d ON d.id=r.dungeon_id WHERE d.owner_id=? AND d.visibility='public' AND d.lifecycle='published' AND r.kind='favorite'`,
      user.id,
    )!.count;
    return {
      id: p.id,
      handle: p.handle,
      displayName: p.displayName,
      level: p.level,
      followers: p.followers,
      following: !!db.get(
        "SELECT 1 FROM follows WHERE follower_id=? AND target_id=?",
        viewer?.id ?? "",
        user.id,
      ),
      achievements: p.achievements,
      reputation: { ...reputation, favorites },
      dungeons: dungeons.feed(viewer, {
        author: user.handle,
        category: "new",
        limit: 30,
      }).items,
    };
  });
  app.get("/api/dungeons", async (request) =>
    dungeons.feed(auth.user(request, false), query(request)),
  );
  app.post("/api/dungeons/publish", async (request) =>
    dungeons.publish(auth.user(request)!, request.body),
  );
  app.get("/api/dungeons/:id", async (request) =>
    dungeons.detail(params(request).id, auth.user(request, false)),
  );
  app.patch("/api/dungeons/:id", async (request) =>
    dungeons.lifecycle(auth.user(request)!, params(request).id, request.body),
  );
  app.post("/api/dungeons/:id/reactions", async (request) => {
    social.reaction(auth.user(request)!, params(request).id, request.body);
    return { ok: true };
  });
  app.get("/api/drafts", async (request) => {
    const user = auth.user(request)!;
    return db
      .all<{
        source_id: string;
        package: string;
        revision: number;
        updated_at: string;
      }>(
        "SELECT * FROM drafts WHERE user_id=? ORDER BY updated_at DESC",
        user.id,
      )
      .map((row) => ({
        dungeon: JSON.parse(row.package),
        revision: row.revision,
        updatedAt: row.updated_at,
      }));
  });
  app.put("/api/drafts/:id", async (request) => {
    const user = auth.user(request)!;
    const body = objectBody(request.body);
    let dungeon;
    try {
      dungeon = parseDungeon(body.dungeon);
    } catch {
      throw new ApiError(400, "invalid_draft", "This draft is malformed.");
    }
    if (dungeon.id !== params(request).id)
      throw new ApiError(
        400,
        "id_mismatch",
        "The draft identifier does not match.",
      );
    const current = db.get<{ revision: number }>(
      "SELECT revision FROM drafts WHERE user_id=? AND source_id=?",
      user.id,
      dungeon.id,
    );
    if (body.expectedRevision !== (current?.revision ?? 0))
      throw new ApiError(
        409,
        "draft_conflict",
        "This draft was edited elsewhere. Reload or save it as a copy.",
      );
    const revision = (current?.revision ?? 0) + 1;
    db.run(
      "INSERT INTO drafts VALUES(?,?,?,?,?) ON CONFLICT(user_id,source_id) DO UPDATE SET package=excluded.package,revision=excluded.revision,updated_at=excluded.updated_at",
      user.id,
      dungeon.id,
      JSON.stringify(dungeon),
      revision,
      now().toISOString(),
    );
    return { revision };
  });
  app.post("/api/versions/:id/attempts", async (request) =>
    attempts.start(auth.user(request)!, params(request).id),
  );
  app.post("/api/attempts/:id", async (request) =>
    attempts.submit(auth.user(request)!, params(request).id, request.body),
  );
  app.get("/api/versions/:id/attempts", async (request) =>
    attempts.list(params(request).id, auth.user(request, false)),
  );
  app.get("/api/versions/:id/card", async (request) => {
    const viewer = auth.user(request, false),
      version = dungeons.version(params(request).id, viewer),
      dungeon = dungeons.readable(version.dungeon_id, viewer);
    return dungeons.card(
      { ...dungeon, latest_version_id: version.id },
      viewer?.id,
    );
  });
  app.get("/api/versions/:id/recordings", async (request) => {
    const viewer = auth.user(request, false),
      id = params(request).id;
    const version = dungeons.version(id, viewer);
    const recordings = attempts
      .list(id, viewer)
      .slice(0, 30)
      .map((row) => {
        const { dungeon: _snapshot, ...replay } = attempts.replay(
          row.id,
          viewer,
          false,
        );
        return replay;
      });
    return {
      dungeon: JSON.parse(version.package),
      recordings,
      analytics: attempts.analytics(id, viewer),
    };
  });
  app.get("/api/attempts/:id/replay", async (request) =>
    attempts.replay(params(request).id, auth.user(request, false)),
  );
  app.get("/api/leaderboards", async (request) =>
    attempts.leaderboard(auth.user(request, false), query(request)),
  );
  app.post("/api/players/:handle/follow", async (request) => {
    social.follow(
      auth.user(request)!,
      params(request).handle,
      objectBody(request.body).enabled,
    );
    return { ok: true };
  });
  app.post("/api/friend-challenges", async (request) =>
    social.challenge(auth.user(request)!, request.body),
  );
  app.get("/api/friend-challenges", async (request) =>
    social.challenges(auth.user(request)!),
  );
  app.get("/api/notifications", async (request) =>
    social.notifications(auth.user(request)!),
  );
  app.post("/api/notifications/:id/read", async (request) => {
    social.read(auth.user(request)!, params(request).id);
    return { ok: true };
  });
  app.post("/api/reports", async (request) => {
    social.report(auth.user(request)!, request.body);
    return { ok: true };
  });
  app.get("/api/challenges", async () => ({
    challenges: activeChallenges(now()),
    categories: ["most-played", "most-attempted", "most-favorited"],
  }));
  app.get("/api/challenges/:id/submissions", async (request) => {
    const viewer = auth.user(request, false);
    const ids = db.all<{ dungeon_id: string; version_id: string }>(
      "SELECT v.dungeon_id,s.version_id FROM challenge_submissions s JOIN versions v ON v.id=s.version_id WHERE s.challenge_id=? ORDER BY s.created_at DESC LIMIT 100",
      params(request).id,
    );
    return ids.flatMap((row) => {
      try {
        const dungeon = dungeons.readable(row.dungeon_id, viewer);
        return [
          dungeons.card(
            { ...dungeon, latest_version_id: row.version_id },
            viewer?.id,
          ),
        ];
      } catch {
        return [];
      }
    });
  });
  app.get("/api/moderation/reports", async (request) =>
    moderation.queue(auth.user(request)!),
  );
  app.post("/api/moderation/actions", async (request) => {
    moderation.act(auth.user(request)!, request.body);
    return { ok: true };
  });
  app.get("/api/moderation/metrics", async (request) =>
    moderation.metrics(auth.user(request)!),
  );
  if (options.serveFiles) {
    await app.register(serveStatic, {
      root: resolve("dist"),
      prefix: "/",
      index: "index.html",
      setHeaders: (response, path) => {
        response.header(
          "Cache-Control",
          /[\\/]assets[\\/]/.test(path)
            ? "public, max-age=31536000, immutable"
            : "no-cache",
        );
      },
    });
    app.setNotFoundHandler((request, reply) =>
      request.url.startsWith("/api/")
        ? reply
            .code(404)
            .send({ code: "not_found", message: "Endpoint not found." })
        : reply.sendFile("index.html"),
    );
  }
  app.addHook("onClose", async () => {
    await verification.close();
    db.close();
  });
  return { app, db, auth, progression, dungeons, attempts, social, moderation };
}
