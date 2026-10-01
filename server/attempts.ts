import { VerificationPool } from "./verification";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import type { Action, Replay } from "../src/core/types";
import { SIMULATION_VERSION } from "../src/core/types";
import { parseReplay } from "../src/core/simulation";
import type {
  AttemptResult,
  AttemptTicket,
  CommunityAttempt,
  LeaderboardEntry,
} from "../src/shared/community";
import { Database } from "./database";
import type { UserRow } from "./auth";
import { ApiError, objectBody, requireValue } from "./errors";
import { DungeonService } from "./dungeons";
import { NO_REWARD, ProgressionService } from "./progression";
import type { Reward } from "./progression";
import type { AnalyticsSnapshot } from "../src/services/analytics";
import { pointKey } from "../src/core/types";
import { identifyRooms } from "../src/core/rooms";

interface TicketRow {
  id: string;
  player_id: string;
  version_id: string;
  seed: number;
  expires_at: string;
  created_at: string;
  request_hash: string | null;
}
interface AttemptRow {
  id: string;
  ticket_id: string;
  player_id: string;
  version_id: string;
  replay: Uint8Array;
  outcome: string;
  ticks: number;
  health: number;
  damage: number;
  kills: number;
  traps: number;
  death_x: number | null;
  death_y: number | null;
  rewards: string;
  created_at: string;
}
export class AttemptService {
  constructor(
    private db: Database,
    private dungeons: DungeonService,
    private progression: ProgressionService,
    private now: () => Date,
    private verification: VerificationPool,
  ) {}
  start(user: UserRow, versionId: string): AttemptTicket {
    const version = this.dungeons.version(versionId, user);
    const row = this.dungeons.readable(version.dungeon_id, user);
    if (row.lifecycle !== "published")
      throw new ApiError(
        400,
        "not_playable",
        "Only published dungeons accept adventures.",
      );
    const count = this.db.get<{ count: number }>(
      "SELECT COUNT(*) count FROM tickets WHERE player_id=? AND created_at>?",
      user.id,
      new Date(this.now().getTime() - 3600000).toISOString(),
    )!.count;
    if (count >= 120)
      throw new ApiError(
        429,
        "attempt_limit",
        "Please wait before starting more adventures.",
      );
    const ticket: AttemptTicket = {
      id: randomUUID(),
      seed: randomInt(1, 0xffffffff),
      versionId,
      dungeon: JSON.parse(version.package),
      expiresAt: new Date(this.now().getTime() + 86400000).toISOString(),
    };
    this.db.run(
      "INSERT INTO tickets(id,player_id,version_id,seed,expires_at,created_at) VALUES(?,?,?,?,?,?)",
      ticket.id,
      user.id,
      versionId,
      ticket.seed,
      ticket.expiresAt,
      this.now().toISOString(),
    );
    this.dungeons.event(user.id, "DungeonAttempted", row.id, version.id);
    return ticket;
  }
  async submit(
    user: UserRow,
    ticketId: string,
    input: unknown,
  ): Promise<AttemptResult> {
    const body = objectBody(input);
    const ticket = requireValue(
      this.db.get<TicketRow>("SELECT * FROM tickets WHERE id=?", ticketId),
    );
    if (ticket.player_id !== user.id)
      throw new ApiError(
        403,
        "not_owner",
        "This adventure belongs to another player.",
      );
    if (ticket.expires_at < this.now().toISOString())
      throw new ApiError(
        410,
        "attempt_expired",
        "This adventure ticket has expired. Start a fresh run.",
      );
    const version = this.dungeons.version(ticket.version_id, user);
    const dungeon = this.dungeons.readable(version.dungeon_id, user);
    let replay: Replay;
    try {
      replay = parseReplay({
        schemaVersion: 1,
        simulationVersion:
          JSON.parse(version.package).schemaVersion === 1
            ? 1
            : SIMULATION_VERSION,
        id: randomUUID(),
        dungeonVersionId: version.id,
        adventurer: user.display_name,
        seed: ticket.seed,
        dungeon: JSON.parse(version.package),
        actions: body.actions as Action[],
        createdAt: this.now().toISOString(),
      });
    } catch {
      throw new ApiError(
        400,
        "invalid_actions",
        "The action recording is malformed or too long.",
      );
    }
    if (!replay.actions.length)
      throw new ApiError(400, "empty_attempt", "Record at least one action.");
    const requestHash = createHash("sha256")
      .update(
        JSON.stringify({
          actions: replay.actions,
          abandon: body.abandon === true,
        }),
      )
      .digest("hex");
    const existing = this.db.get<AttemptRow>(
      "SELECT * FROM attempts WHERE ticket_id=?",
      ticket.id,
    );
    if (existing) {
      if (ticket.request_hash !== requestHash)
        throw new ApiError(
          409,
          "already_submitted",
          "This adventure already has a different recorded result.",
        );
      return this.result(existing, user.id);
    }
    let state;
    try {
      state = await this.verification.verify(replay);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        400,
        "invalid_actions",
        "The recorded actions could not be verified.",
      );
    }
    if (
      this.db.get<UserRow>("SELECT * FROM users WHERE id=?", user.id)
        ?.status !== "active"
    )
      throw new ApiError(
        403,
        "account_suspended",
        "This account cannot submit attempts.",
      );
    if (state.status === "playing" && body.abandon !== true)
      throw new ApiError(
        400,
        "unfinished_attempt",
        "Finish the adventure or explicitly abandon it.",
      );
    const raced = this.db.get<AttemptRow>(
      "SELECT * FROM attempts WHERE ticket_id=?",
      ticket.id,
    );
    if (raced) {
      const hash = this.db.get<{ request_hash: string }>(
        "SELECT request_hash FROM tickets WHERE id=?",
        ticket.id,
      )!.request_hash;
      if (hash !== requestHash)
        throw new ApiError(
          409,
          "already_submitted",
          "This adventure has a different result.",
        );
      return this.result(raced, user.id);
    }
    this.dungeons.readable(version.dungeon_id, user);
    const outcome = state.status === "playing" ? "abandoned" : state.status;
    const kills = state.events.filter(
      (e) =>
        e.kind === "kill" &&
        state.enemies.some((enemy) => enemy.id === e.objectId),
    ).length;
    const traps = state.events.filter((e) => e.kind === "trap").length;
    const death = state.events.find((e) => e.kind === "death");
    const at = this.now().toISOString();
    let rewards: Reward = { ...NO_REWARD };
    this.db.transaction(() => {
      if (outcome === "completed" && dungeon.owner_id !== user.id) {
        rewards = this.progression.grant(user.id, "completion", version.id, {
          xp: 25,
          gold: 15 + Math.min(20, state.advanced?.loot.gold ?? 0),
          materials: 5 + Math.min(5, state.advanced?.loot.resources ?? 0),
          essence:
            (version.challenge_rating >= 60 ? 1 : 0) +
            Math.min(1, state.advanced?.loot.cosmetics ?? 0),
        });
        if (rewards.xp) {
          this.progression.master(user.id, "combat", kills * 5);
          this.progression.master(user.id, "traps", traps * 3);
          this.progression.master(user.id, "exploration", 10);
        }
        this.progression.achievement(user.id, "first-clear");
        if (state.damageTaken === 0)
          this.progression.achievement(user.id, "untouched");
      }
      this.db.run(
        "INSERT INTO attempts VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        replay.id,
        ticket.id,
        user.id,
        version.id,
        gzipSync(JSON.stringify(replay.actions)),
        outcome,
        state.tick,
        state.player.hp,
        state.damageTaken,
        kills,
        traps,
        death?.x ?? null,
        death?.y ?? null,
        JSON.stringify(rewards),
        at,
      );
      this.db.run(
        "INSERT INTO attempt_details VALUES(?,?,?,?)",
        replay.id,
        JSON.stringify(state.advanced?.loot ?? {}),
        state.advanced?.build ?? "classic",
        state.advanced?.visited.length ?? 0,
      );
      const traffic = new Map<string, number>();
      this.db.run(
        "INSERT INTO attempt_secrets VALUES(?,?)",
        replay.id,
        replay.dungeon.objects.filter(
          (o) => o.type === "hidden-passage" && state.opened.includes(o.id),
        ).length,
      );
      for (const e of state.events)
        if (["spawn", "move", "teleport"].includes(e.kind))
          traffic.set(pointKey(e), (traffic.get(pointKey(e)) ?? 0) + 1);
      for (const [cell, visits] of traffic)
        this.db.run(
          "INSERT INTO version_traffic VALUES(?,?,?) ON CONFLICT(version_id,cell) DO UPDATE SET visits=visits+excluded.visits",
          version.id,
          cell,
          visits,
        );
      if (death?.objectId)
        this.db.run(
          "INSERT INTO version_killers VALUES(?,?,1) ON CONFLICT(version_id,object_id) DO UPDATE SET kills=kills+1",
          version.id,
          death.objectId,
        );
      if (outcome === "completed") {
        const path = JSON.stringify(
          state.events
            .filter((e) => e.kind === "move" || e.kind === "teleport")
            .map((e) => ({ x: e.x, y: e.y })),
        );
        this.db.run(
          "INSERT INTO version_routes VALUES(?,?,?,1) ON CONFLICT(version_id,hash) DO UPDATE SET uses=uses+1",
          version.id,
          createHash("sha256").update(path).digest("hex"),
          gzipSync(path),
        );
      }
      this.db.run(
        "UPDATE tickets SET request_hash=? WHERE id=?",
        requestHash,
        ticket.id,
      );
      const challenges = this.db.all<{ id: string; sender_id: string }>(
        "SELECT id,sender_id FROM friend_challenges WHERE recipient_id=? AND version_id=? AND status='pending' AND expires_at>?",
        user.id,
        version.id,
        at,
      );
      for (const challenge of challenges) {
        this.db.run(
          "UPDATE friend_challenges SET status=?,result_id=? WHERE id=?",
          outcome,
          replay.id,
          challenge.id,
        );
        this.notify(
          challenge.sender_id,
          "friend-result",
          {
            handle: user.handle,
            title: dungeon.title,
            outcome,
            attemptId: replay.id,
          },
          `challenge:${challenge.id}`,
        );
      }
      const total = this.db.get<{ count: number }>(
        "SELECT COUNT(*) count FROM attempts WHERE version_id=?",
        version.id,
      )!.count;
      const dailyAudience = this.db.get<{ recent: number; previous: number }>(
        "SELECT COUNT(DISTINCT CASE WHEN created_at>=? THEN player_id END) recent,COUNT(DISTINCT CASE WHEN created_at<? THEN player_id END) previous FROM attempts WHERE version_id=? AND player_id<>? AND created_at>=?",
        new Date(this.now().getTime() - 86400000).toISOString(),
        new Date(this.now().getTime() - 86400000).toISOString(),
        version.id,
        dungeon.owner_id,
        new Date(this.now().getTime() - 2 * 86400000).toISOString(),
      )!;
      if (
        dailyAudience.recent >= 5 &&
        dailyAudience.recent >= 2 * Math.max(1, dailyAudience.previous)
      )
        this.notify(
          dungeon.owner_id,
          "dungeon-trending",
          { title: dungeon.title, players: dailyAudience.recent },
          `trending:${dungeon.id}:${this.now().toISOString().slice(0, 10)}`,
        );
      const received = this.db.get<{ count: number }>(
        "SELECT COUNT(*) count FROM attempts a JOIN versions v ON v.id=a.version_id JOIN dungeons d ON d.id=v.dungeon_id WHERE d.owner_id=? AND a.player_id<>?",
        dungeon.owner_id,
        dungeon.owner_id,
      )!.count;
      for (const milestone of [10, 100, 1000])
        if (received >= milestone)
          this.progression.achievement(
            dungeon.owner_id,
            `hosted-${milestone}-adventures`,
          );
      if (
        user.id !== dungeon.owner_id &&
        (total === 1 || total % 10 === 0 || outcome === "completed")
      )
        this.notify(
          dungeon.owner_id,
          outcome === "completed" ? "dungeon-completed" : "attempt-milestone",
          {
            title: dungeon.title,
            count: total,
            attemptId: replay.id,
            handle: user.handle,
          },
          outcome === "completed"
            ? `clear:${version.id}:${user.id}`
            : `attempts:${version.id}:${total}`,
        );
      this.dungeons.event(
        user.id,
        outcome === "completed" ? "DungeonCompleted" : "DungeonFailed",
        dungeon.id,
        version.id,
      );
    });
    return this.result(
      requireValue(
        this.db.get<AttemptRow>("SELECT * FROM attempts WHERE id=?", replay.id),
      ),
      user.id,
    );
  }
  private result(attempt: AttemptRow, userId: string): AttemptResult {
    return {
      id: attempt.id,
      outcome: attempt.outcome,
      ticks: attempt.ticks,
      health: attempt.health,
      damageTaken: attempt.damage,
      kills: attempt.kills,
      rewards: JSON.parse(attempt.rewards),
      profile: this.progression.profile(userId),
    };
  }
  replay(id: string, viewer: UserRow | null, track = true): Replay {
    const row = requireValue(
      this.db.get<AttemptRow>("SELECT * FROM attempts WHERE id=?", id),
    );
    const version = this.dungeons.version(row.version_id, viewer);
    const player = requireValue(
      this.db.get<UserRow>("SELECT * FROM users WHERE id=?", row.player_id),
    );
    const ticket = requireValue(
      this.db.get<TicketRow>("SELECT * FROM tickets WHERE id=?", row.ticket_id),
    );
    if (track)
      this.dungeons.event(
        viewer?.id ?? null,
        "ReplayWatched",
        version.dungeon_id,
        version.id,
      );
    return {
      id: row.id,
      schemaVersion: 1,
      simulationVersion:
        JSON.parse(version.package).schemaVersion === 1
          ? 1
          : SIMULATION_VERSION,
      dungeonVersionId: version.id,
      adventurer: player.display_name,
      seed: ticket.seed,
      dungeon: JSON.parse(version.package),
      actions: JSON.parse(gunzipSync(row.replay).toString()),
      createdAt: row.created_at,
    };
  }
  list(versionId: string, viewer: UserRow | null): CommunityAttempt[] {
    this.dungeons.version(versionId, viewer);
    return this.db
      .all<AttemptRow & { player: string }>(
        "SELECT a.*,u.display_name player FROM attempts a JOIN users u ON u.id=a.player_id WHERE a.version_id=? ORDER BY a.created_at DESC LIMIT 100",
        versionId,
      )
      .map((row) => ({
        id: row.id,
        player: row.player,
        outcome: row.outcome,
        ticks: row.ticks,
        health: row.health,
        createdAt: row.created_at,
        death:
          row.death_x !== null && row.death_y !== null
            ? { x: row.death_x, y: row.death_y }
            : null,
      }));
  }
  analytics(versionId: string, viewer: UserRow | null): AnalyticsSnapshot {
    const version = this.dungeons.version(versionId, viewer);
    const totals = this.db.get<{
      attempts: number;
      completions: number;
      deaths: number;
      averageSeconds: number;
      averageDamage: number;
    }>(
      `SELECT COUNT(*) attempts,COALESCE(SUM(outcome='completed'),0) completions,COALESCE(SUM(outcome='dead'),0) deaths,COALESCE(AVG(ticks)/4,0) averageSeconds,COALESCE(AVG(damage),0) averageDamage FROM attempts WHERE version_id=?`,
      versionId,
    )!;
    const deaths = this.db.all<{ x: number; y: number; count: number }>(
      "SELECT death_x x,death_y y,COUNT(*) count FROM attempts WHERE version_id=? AND death_x IS NOT NULL GROUP BY death_x,death_y",
      versionId,
    );
    const first =
      this.db.get<{ x: number; y: number }>(
        "SELECT death_x x,death_y y FROM attempts WHERE version_id=? AND death_x IS NOT NULL ORDER BY created_at,id LIMIT 1",
        versionId,
      ) ?? null;
    const rooms = identifyRooms(JSON.parse(version.package)),
      roomDeaths = new Map<
        number,
        { id: number; floor: number; deaths: number }
      >();
    for (const death of deaths) {
      const room = rooms.get(pointKey(death));
      if (room) {
        const count = roomDeaths.get(room.id) ?? { ...room, deaths: 0 };
        count.deaths += death.count;
        roomDeaths.set(room.id, count);
      }
    }
    const area =
      this.db.get<{ floor: number; x: number; y: number; deaths: number }>(
        "SELECT CAST(death_y/13 AS INTEGER)+1 floor,CAST(death_x/5 AS INTEGER)+1 x,CAST((death_y%13)/5 AS INTEGER)+1 y,COUNT(*) deaths FROM attempts WHERE version_id=? AND death_x IS NOT NULL GROUP BY floor,x,y ORDER BY deaths DESC,floor,x,y LIMIT 1",
        versionId,
      ) ?? null;
    const route = this.db.get<{ path: Uint8Array; uses: number }>(
      "SELECT path,uses FROM version_routes WHERE version_id=? ORDER BY uses DESC,hash LIMIT 1",
      versionId,
    );
    return {
      ...totals,
      completionRate: totals.attempts
        ? (totals.completions / totals.attempts) * 100
        : 0,
      averageDeaths: totals.attempts ? totals.deaths / totals.attempts : 0,
      firstDeath: first,
      dangerousArea: area,
      dangerousRoom:
        [...roomDeaths.values()].sort(
          (a, b) => b.deaths - a.deaths || a.id - b.id,
        )[0] ?? null,
      deathCells: deaths.map((r) => [
        `${r.x},${r.y}`,
        { point: { x: r.x, y: r.y }, count: r.count },
      ]),
      traffic: this.db
        .all<{ cell: string; visits: number }>(
          "SELECT cell,visits FROM version_traffic WHERE version_id=?",
          versionId,
        )
        .map((r) => [r.cell, r.visits]),
      deadliest:
        this.db.get<{ objectId: string; count: number }>(
          "SELECT object_id objectId,kills count FROM version_killers WHERE version_id=? ORDER BY kills DESC,object_id LIMIT 1",
          versionId,
        ) ?? null,
      commonRoute: route
        ? {
            points: JSON.parse(gunzipSync(route.path).toString()),
            count: route.uses,
          }
        : null,
    };
  }
  leaderboard(
    viewer: UserRow | null,
    query: Record<string, unknown>,
  ): LeaderboardEntry[] {
    const clauses = [
      "a.outcome='completed'",
      "d.lifecycle='published'",
      "d.visibility='public'",
      "u.status='active'",
    ];
    const values: string[] = [];
    if (query.versionId) {
      const version = this.dungeons.version(String(query.versionId), viewer);
      clauses[2] = "1=1";
      clauses.push("a.version_id=?");
      values.push(version.id);
    }
    if (
      query.period === "daily" ||
      query.period === "weekly" ||
      query.period === "season"
    ) {
      const days =
        query.period === "daily" ? 1 : query.period === "weekly" ? 7 : 90;
      clauses.push("a.created_at>=?");
      values.push(
        new Date(this.now().getTime() - days * 86400000).toISOString(),
      );
    }
    if (query.friends === "true") {
      clauses.push(
        "a.player_id IN (SELECT target_id FROM follows WHERE follower_id=?)",
      );
      values.push(viewer?.id ?? "");
    }
    const metric = String(query.metric ?? "speed");
    if (metric === "survival")
      clauses[0] = "a.outcome IN ('completed','dead','abandoned')";
    const orders: Record<string, string> = {
      speed: "ticks ASC,health DESC",
      health: "health DESC,ticks ASC",
      damage: "damage ASC,ticks ASC",
      treasure: "treasure DESC,ticks ASC",
      difficulty: "challengeRating DESC,ticks ASC",
      survival: "ticks DESC,health DESC",
      secrets: "secrets DESC,ticks ASC",
      deaths: "deaths ASC,ticks ASC",
      streak: "streak DESC,ticks ASC",
    };
    const order = orders[metric] ?? orders.speed;
    const rows = this.db.all<{
      player_id: string;
      player: string;
      title: string;
      version_id: string;
      ticks: number;
      health: number;
      damage: number;
      secrets: number;
      deaths: number;
      streak: number;
      treasure: number;
      challengeRating: number;
      created_at: string;
    }>(
      `WITH history AS (SELECT *,SUM(outcome!='completed') OVER(PARTITION BY player_id,version_id ORDER BY created_at,id) breaks,SUM(outcome='dead') OVER(PARTITION BY player_id,version_id ORDER BY created_at,id) deaths FROM attempts),
      tracked AS (SELECT *,ROW_NUMBER() OVER(PARTITION BY player_id,version_id,breaks ORDER BY created_at,id)-(breaks>0) streak FROM history),eligible AS (
        SELECT a.*,u.handle player,d.title,v.challenge_rating challengeRating,
        COALESCE(json_extract(ad.loot,'$.gold'),0) treasure,COALESCE(secret.count,0) secrets
        FROM ${metric === "streak" || metric === "deaths" ? "tracked" : "attempts"} a JOIN users u ON u.id=a.player_id JOIN versions v ON v.id=a.version_id
        JOIN dungeons d ON d.id=v.dungeon_id LEFT JOIN attempt_details ad ON ad.attempt_id=a.id
        LEFT JOIN attempt_secrets secret ON secret.attempt_id=a.id
        WHERE ${clauses.join(" AND ")}
      ), ranked AS (SELECT *,ROW_NUMBER() OVER(PARTITION BY player_id,version_id ORDER BY ${order},created_at,id) position FROM eligible)
      SELECT * FROM ranked WHERE position=1 ORDER BY ${order},created_at,id LIMIT 50`,
      ...values,
    );
    return rows.map((row, index) => ({
      rank: index + 1,
      metric,
      value: ["secrets", "deaths", "streak"].includes(metric)
        ? row[metric as "secrets" | "deaths" | "streak"]
        : metric === "treasure"
          ? row.treasure
          : metric === "difficulty"
            ? row.challengeRating
            : metric === "damage"
              ? row.damage
              : metric === "health"
                ? row.health
                : row.ticks / 4,
      playerId: row.player_id,
      player: row.player,
      dungeon: row.title,
      versionId: row.version_id,
      ticks: row.ticks,
      health: row.health,
      createdAt: row.created_at,
    }));
  }
  notify(
    userId: string,
    kind: string,
    payload: Record<string, string | number>,
    dedupe: string,
  ): void {
    this.db.run(
      "INSERT OR IGNORE INTO notifications VALUES(?,?,?,?,?,0,?)",
      randomUUID(),
      userId,
      kind,
      JSON.stringify(payload),
      dedupe,
      this.now().toISOString(),
    );
  }
}
