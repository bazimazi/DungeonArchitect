import { VerificationPool } from "./verification";
import { randomBytes, randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { fingerprint, parseDungeon } from "../src/core/dungeon";
import { parseReplay } from "../src/core/simulation";
import { validateDungeon } from "../src/core/validation";
import { CONTENT } from "../src/core/content";
import type { Dungeon, Replay } from "../src/core/types";
import type {
  CommunityDungeon,
  CommunityVersion,
  DungeonCard,
  FeedCategory,
  Visibility,
} from "../src/shared/community";
import { Database } from "./database";
import type { UserRow } from "./auth";
import { ApiError, objectBody, requireValue, textField } from "./errors";
import {
  challengeRating,
  checkChallenge,
  contentHash,
  parseTags,
  screenText,
} from "./policies";
import { ProgressionService } from "./progression";

export interface DungeonRow {
  id: string;
  owner_id: string;
  source_id: string;
  title: string;
  description: string;
  tags: string;
  visibility: Visibility;
  lifecycle: string;
  latest_version_id: string;
  share_code: string;
  created_at: string;
  updated_at: string;
}
export interface VersionRow {
  id: string;
  dungeon_id: string;
  number: number;
  package: string;
  certificate: Uint8Array;
  content_hash: string;
  challenge_rating: number;
  created_at: string;
}
export class DungeonService {
  constructor(
    private db: Database,
    private progression: ProgressionService,
    private now: () => Date,
    private verification: VerificationPool,
  ) {}
  readable(id: string, viewer: UserRow | null): DungeonRow {
    const row = requireValue(
      this.db.get<DungeonRow>(
        "SELECT * FROM dungeons WHERE id=? OR share_code=?",
        id,
        id,
      ),
    );
    const privileged =
      viewer && (viewer.id === row.owner_id || viewer.role !== "player");
    if (
      !privileged &&
      (row.lifecycle !== "published" || row.visibility === "private")
    )
      throw new ApiError(404, "not_found", "This dungeon is unavailable.");
    return row;
  }
  version(id: string, viewer: UserRow | null): VersionRow {
    const version = requireValue(
      this.db.get<VersionRow>("SELECT * FROM versions WHERE id=?", id),
    );
    this.readable(version.dungeon_id, viewer);
    return version;
  }
  detail(id: string, viewer: UserRow | null): CommunityDungeon {
    const dungeon = this.readable(id, viewer);
    return {
      card: this.card(dungeon, viewer?.id),
      versions: this.db
        .all<VersionRow>(
          "SELECT * FROM versions WHERE dungeon_id=? ORDER BY number DESC",
          dungeon.id,
        )
        .map((v) => this.versionData(v)),
    };
  }
  private versionData(version: VersionRow): CommunityVersion {
    const stats = this.db.get<{ attempts: number; completions: number }>(
      "SELECT COUNT(*) attempts,COALESCE(SUM(outcome='completed'),0) completions FROM attempts WHERE version_id=?",
      version.id,
    )!;
    return {
      id: version.id,
      number: version.number,
      dungeon: JSON.parse(version.package),
      createdAt: version.created_at,
      ...stats,
    };
  }
  async publish(user: UserRow, input: unknown): Promise<CommunityDungeon> {
    if (user.publishing_disabled)
      throw new ApiError(
        403,
        "publishing_disabled",
        "Publishing is disabled for this account.",
      );
    const body = objectBody(input);
    let dungeon: Dungeon;
    let proof: Replay;
    try {
      dungeon = parseDungeon(body.dungeon);
      proof = parseReplay(body.proof);
    } catch {
      throw new ApiError(
        400,
        "invalid_package",
        "The dungeon or completion recording is invalid.",
      );
    }
    const level = this.progression.profile(user.id).level;
    const eraLevels: Record<string, number> = {
      "forgotten-cave": 1,
      "ancient-ruins": 3,
      castle: 5,
      fortress: 8,
      temple: 12,
      "underground-city": 16,
      hell: 21,
      "alien-facility": 27,
    };
    const requiredLevel = Math.max(
      eraLevels[dungeon.theme],
      dungeon.height > 13 ? 8 : 1,
      ...dungeon.objects.map((o) => CONTENT[o.type].unlockLevel ?? 1),
    );
    if (level < requiredLevel)
      throw new ApiError(
        403,
        "mechanic_locked",
        `This creation uses mechanics unlocked at architect level ${requiredLevel}. You can test every mechanic locally; earn experience to publish it online.`,
      );
    const validation = validateDungeon(dungeon);
    if (!validation.valid)
      throw new ApiError(
        400,
        "invalid_layout",
        validation.issues.map((i) => i.code).join(", "),
      );
    if (
      fingerprint(proof.dungeon) !== fingerprint(dungeon) ||
      (await this.verification.verify(proof)).status !== "completed"
    )
      throw new ApiError(
        400,
        "completion_required",
        "Complete this exact dungeon before publishing.",
      );
    const description = textField(
      // Verification yields to worker threads. Recheck account state before committing.
      body.description ?? "",
      "Description",
      0,
      500,
    );
    const currentUser = requireValue(
      this.db.get<UserRow>("SELECT * FROM users WHERE id=?", user.id),
    );
    if (currentUser.status !== "active" || currentUser.publishing_disabled)
      throw new ApiError(
        403,
        "publishing_disabled",
        "This account cannot publish.",
      );
    screenText(dungeon.title);
    screenText(description);
    const tags = parseTags(body.tags ?? []);
    const visibility = body.visibility ?? "public";
    if (!["public", "unlisted", "private"].includes(String(visibility)))
      throw new ApiError(
        400,
        "invalid_visibility",
        "Choose public, unlisted, or private.",
      );
    const existing = body.dungeonId
      ? this.db.get<DungeonRow>(
          "SELECT * FROM dungeons WHERE id=?",
          String(body.dungeonId),
        )
      : this.db.get<DungeonRow>(
          "SELECT * FROM dungeons WHERE owner_id=? AND source_id=?",
          user.id,
          dungeon.id,
        );
    if (body.dungeonId && !existing)
      throw new ApiError(404, "not_found", "That dungeon does not exist.");
    if (existing && existing.owner_id !== user.id)
      throw new ApiError(
        403,
        "not_owner",
        "Only this dungeon’s architect can publish a version.",
      );
    if (existing?.lifecycle === "moderated")
      throw new ApiError(
        403,
        "moderated",
        "A moderator has hidden this dungeon.",
      );
    const hash = contentHash(dungeon);
    if (
      existing &&
      this.db.get(
        "SELECT id FROM versions WHERE dungeon_id=? AND content_hash=?",
        existing.id,
        hash,
      )
    )
      throw new ApiError(
        409,
        "unchanged",
        "This exact version has already been published.",
      );
    const current = existing
      ? this.db.get<VersionRow>(
          "SELECT * FROM versions WHERE id=?",
          existing.latest_version_id,
        )
      : undefined;
    if (
      body.expectedVersion !== undefined &&
      body.expectedVersion !== (current?.number ?? 0)
    )
      throw new ApiError(
        409,
        "version_conflict",
        "A newer version exists. Reload before publishing.",
      );
    if (body.challengeId !== undefined)
      checkChallenge(
        dungeon,
        textField(body.challengeId, "Challenge", 1, 80),
        this.now(),
      );
    const recent = this.db.get<{ count: number }>(
      "SELECT COUNT(*) count FROM versions v JOIN dungeons d ON d.id=v.dungeon_id WHERE d.owner_id=? AND v.created_at>?",
      user.id,
      new Date(this.now().getTime() - 3600000).toISOString(),
    )!.count;
    if (recent >= 20)
      throw new ApiError(
        429,
        "publish_limit",
        "You can publish up to 20 versions per hour.",
      );
    const id = existing?.id ?? randomUUID();
    const versionId = randomUUID();
    const at = this.now().toISOString();
    this.db.transaction(() => {
      if (!existing)
        this.db.run(
          "INSERT INTO dungeons(id,owner_id,source_id,title,description,tags,visibility,share_code,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
          id,
          user.id,
          dungeon.id,
          dungeon.title,
          description,
          JSON.stringify(tags),
          String(visibility),
          `DA-${randomBytes(5).toString("hex").toUpperCase()}`,
          at,
          at,
        );
      this.db.run(
        "INSERT INTO versions VALUES(?,?,?,?,?,?,?,?)",
        versionId,
        id,
        (current?.number ?? 0) + 1,
        JSON.stringify(dungeon),
        gzipSync(JSON.stringify(proof)),
        hash,
        challengeRating(dungeon),
        at,
      );
      this.db.run(
        "UPDATE dungeons SET title=?,description=?,tags=?,visibility=?,lifecycle='published',latest_version_id=?,updated_at=? WHERE id=?",
        dungeon.title,
        description,
        JSON.stringify(tags),
        String(visibility),
        versionId,
        at,
        id,
      );
      if (!existing) {
        const dailyRewards = this.db.get<{ count: number }>(
          "SELECT COUNT(*) count FROM ledger WHERE user_id=? AND reason='publish' AND created_at>=?",
          user.id,
          at.slice(0, 10),
        )!.count;
        if (dailyRewards < 5) {
          this.progression.grant(user.id, "publish", id, {
            xp: 40,
            gold: 0,
            materials: 20,
            essence: 0,
          });
          this.progression.master(user.id, "architecture", 20);
          for (const category of [
            "traps",
            "monsters",
            "objects",
            "puzzle",
            "structural",
            "utility",
            "environment",
          ])
            this.progression.master(
              user.id,
              category,
              dungeon.objects.filter(
                (o) => CONTENT[o.type].category === category,
              ).length * 3,
            );
          this.progression.master(
            user.id,
            "logic",
            (dungeon.rules?.length ?? 0) * 5,
          );
          this.progression.master(
            user.id,
            "boss",
            dungeon.objects.filter((o) => o.type === "boss").length * 10,
          );
          const earned = this.progression.profile(user.id).mastery;
          for (const [category, xp] of Object.entries(earned))
            if (xp >= 100)
              this.progression.achievement(user.id, `${category}-architect`);
        }
        this.progression.achievement(user.id, "first-publication");
      } else this.progression.achievement(user.id, "iteration");
      if (body.challengeId) {
        this.db.run(
          "INSERT INTO challenge_submissions VALUES(?,?,?,?) ON CONFLICT(challenge_id,user_id) DO UPDATE SET version_id=excluded.version_id,created_at=excluded.created_at",
          String(body.challengeId),
          versionId,
          user.id,
          at,
        );
        this.progression.grant(
          user.id,
          "challenge-submission",
          String(body.challengeId),
          { xp: 50, gold: 0, materials: 15, essence: 1 },
        );
      }
      this.event(
        user.id,
        existing ? "DungeonUpdated" : "DungeonPublished",
        id,
        versionId,
      );
    });
    return this.detail(id, user);
  }
  card(row: DungeonRow, viewerId?: string): DungeonCard {
    const author = requireValue(
      this.db.get<UserRow>("SELECT * FROM users WHERE id=?", row.owner_id),
    );
    const version = requireValue(
      this.db.get<VersionRow>(
        "SELECT * FROM versions WHERE id=?",
        row.latest_version_id,
      ),
    );
    const stats = this.db.get<{
      attempts: number;
      completions: number;
      average: number;
      damage: number;
      players: number;
      earlyDeaths: number;
    }>(
      "SELECT COUNT(*) attempts,COALESCE(SUM(outcome='completed'),0) completions,COALESCE(AVG(ticks)*0.25,0) average,COALESCE(AVG(damage),0) damage,COUNT(DISTINCT player_id) players,COALESCE(SUM(outcome='dead' AND ticks<=12),0) earlyDeaths FROM attempts WHERE version_id=?",
      version.id,
    )!;
    const rate = stats.attempts
      ? (stats.completions / stats.attempts) * 100
      : 0;
    const reactions = this.db.all<{
      kind: string;
      total: number;
      mine: number;
    }>(
      "SELECT kind,COUNT(*) total,MAX(user_id=?) mine FROM reactions WHERE dungeon_id=? GROUP BY kind",
      viewerId ?? "",
      row.id,
    );
    const liked = reactions.find((r) => r.kind === "like");
    const favorite = reactions.find((r) => r.kind === "favorite");
    const median = this.db.get<{ value: number }>(
      "SELECT COALESCE(AVG(ticks)/4,0) value FROM (SELECT ticks FROM attempts WHERE version_id=? AND outcome='completed' ORDER BY ticks LIMIT ? OFFSET ?)",
      version.id,
      stats.completions % 2 ? 1 : 2,
      Math.max(0, Math.ceil(stats.completions / 2) - 1),
    )!.value;
    const routeCount = this.db.get<{ count: number }>(
      "SELECT COUNT(*) count FROM (SELECT 1 FROM version_routes WHERE version_id=? LIMIT 2)",
      version.id,
    )!.count;
    return {
      calibration: {
        medianCompletionSeconds: median,
        averageDamage: stats.damage,
        retryRate: stats.attempts
          ? (1 - stats.players / stats.attempts) * 100
          : 0,
      },
      id: row.id,
      sourceId: row.source_id,
      title: row.title,
      description: row.description,
      tags: JSON.parse(row.tags),
      ownerId: row.owner_id,
      author: author.handle,
      authorName: author.display_name,
      shareCode: row.share_code,
      versionId: version.id,
      version: version.number,
      visibility: row.visibility,
      lifecycle: row.lifecycle,
      attempts: stats.attempts,
      completions: stats.completions,
      completionRate: rate,
      averageSeconds: stats.average,
      likes: liked?.total ?? 0,
      favorites: favorite?.total ?? 0,
      liked: !!liked?.mine,
      favorited: !!favorite?.mine,
      following: !!this.db.get(
        "SELECT 1 FROM follows WHERE follower_id=? AND target_id=?",
        viewerId ?? "",
        row.owner_id,
      ),
      difficulty:
        stats.attempts < 5
          ? "Uncalibrated"
          : rate >= 85
            ? "Very easy"
            : rate >= 65
              ? "Easy"
              : rate >= 35
                ? "Moderate"
                : rate >= 10
                  ? "Hard"
                  : "Extreme",
      fairness: [
        "completable",
        "architect-tested",
        ...(stats.attempts >= 5 && rate < 10 ? ["high-failure-rate"] : []),
        ...(stats.average > 180 ? ["long-attempts"] : []),
        ...(stats.earlyDeaths >= 3 && stats.earlyDeaths / stats.attempts >= 0.25
          ? ["high-early-death-rate"]
          : []),
        ...(routeCount >= 2 ? ["distinct-clear-routes-observed"] : []),
      ],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
  feed(
    viewer: UserRow | null,
    query: Record<string, unknown>,
  ): { items: DungeonCard[]; next: number | null } {
    const category = String(query.category ?? "recommended") as FeedCategory;
    const offset = Math.max(
      0,
      Math.min(10000000, Math.floor(Number(query.cursor) || 0)),
    );
    const limit = Math.max(1, Math.min(30, Number(query.limit) || 12));
    const where =
      category === "mine"
        ? "d.owner_id=?"
        : "d.lifecycle='published' AND d.visibility='public'";
    if (category === "mine" && !viewer)
      throw new ApiError(
        401,
        "authentication_required",
        "Sign in to view your library.",
      );
    const search = String(query.search ?? "")
      .toLowerCase()
      .slice(0, 80);
    const tag = String(query.tag ?? "");
    const clauses = [where, "u.status='active'"];
    const bindings: string[] = category === "mine" ? [viewer!.id] : [];
    if (query.author) {
      clauses.push("u.handle=?");
      bindings.push(String(query.author).slice(0, 24));
    }
    if (search) {
      clauses.push("instr(lower(d.title || ' ' || d.description),?)>0");
      bindings.push(search);
    }
    for (const selected of [...new Set(tag.split(",").filter(Boolean))].slice(
      0,
      5,
    )) {
      clauses.push("EXISTS(SELECT 1 FROM json_each(d.tags) WHERE value=?)");
      bindings.push(selected);
    }
    if (category === "favorites") {
      clauses[0] =
        "d.lifecycle='published' AND (d.visibility IN ('public','unlisted') OR d.owner_id=?)";
      bindings.unshift(viewer?.id ?? "");
      clauses.push(
        "EXISTS(SELECT 1 FROM reactions r WHERE r.dungeon_id=d.id AND r.user_id=? AND r.kind='favorite')",
      );
      bindings.push(viewer?.id ?? "");
    }
    if (category === "following") {
      clauses.push(
        "EXISTS(SELECT 1 FROM follows f WHERE f.target_id=d.owner_id AND f.follower_id=?)",
      );
      bindings.push(viewer?.id ?? "");
    }
    // Chronological collections paginate in SQL, including older entries beyond the ranking candidate pool.
    if (
      ["new", "mine", "favorites", "following"].includes(category) &&
      !query.difficulty
    ) {
      const page = this.db.all<DungeonRow>(
        `SELECT d.* FROM dungeons d JOIN users u ON u.id=d.owner_id WHERE ${clauses.join(" AND ")} ORDER BY d.updated_at DESC,d.id LIMIT ? OFFSET ?`,
        ...bindings,
        limit + 1,
        offset,
      );
      return {
        items: page.slice(0, limit).map((row) => this.card(row, viewer?.id)),
        next: page.length > limit ? offset + limit : null,
      };
    }
    // Ranked collections use a bounded candidate pool; exact search is applied before the bound.
    const rows = this.db.all<DungeonRow>(
      `SELECT d.* FROM dungeons d JOIN users u ON u.id=d.owner_id WHERE ${clauses.join(" AND ")} ORDER BY d.updated_at DESC LIMIT 1000`,
      ...bindings,
    );
    let cards = rows.map((row) => this.card(row, viewer?.id));
    const interests: string[] = viewer ? JSON.parse(viewer.interests) : [];
    const history = viewer
      ? this.db.all<{
          version_id: string;
          outcome: string;
          ticks: number;
          challenge_rating: number;
        }>(
          `SELECT a.version_id,a.outcome,a.ticks,v.challenge_rating FROM attempts a JOIN versions v ON v.id=a.version_id WHERE a.player_id=? ORDER BY a.created_at DESC LIMIT 200`,
          viewer.id,
        )
      : [];
    const completed = new Set(
      history.filter((h) => h.outcome === "completed").map((h) => h.version_id),
    );
    const abandoned = new Set(
      history.filter((h) => h.outcome === "abandoned").map((h) => h.version_id),
    );
    const preferredSeconds = history.length
      ? history.reduce((sum, h) => sum + h.ticks / 4, 0) / history.length
      : 0;
    if (category === "favorites") cards = cards.filter((c) => c.favorited);
    if (category === "following") cards = cards.filter((c) => c.following);
    if (category === "combat" || category === "puzzle" || category === "trap")
      cards = cards.filter((c) =>
        c.tags.some((t) => t.toLowerCase() === category),
      );
    if (category === "short")
      cards = cards.filter(
        (c) => c.averageSeconds > 0 && c.averageSeconds <= 60,
      );
    if (category === "long")
      cards = cards.filter((c) => c.averageSeconds >= 120);
    if (category === "challenging")
      cards = cards.filter(
        (c) => c.attempts >= 5 && c.completionRate > 0 && c.completionRate < 35,
      );
    if (query.difficulty)
      cards = cards.filter((c) => c.difficulty === query.difficulty);
    const score = (card: DungeonCard): number => {
      const ageHours = Math.max(
        1,
        (this.now().getTime() - Date.parse(card.updatedAt)) / 3600000,
      );
      if (category === "new" || category === "mine")
        return Date.parse(card.updatedAt);
      if (category === "trending")
        return (
          (card.attempts + 3 * card.likes + 5 * card.favorites) /
          Math.pow(ageHours, 0.8)
        );
      if (category === "clever")
        return (
          card.favorites * 3 +
          card.likes +
          Math.min(card.attempts, 30) +
          (card.tags.includes("Puzzle") ? 15 : 0)
        );
      return (
        Math.log2(1 + card.attempts) * 2 +
        card.likes +
        card.favorites * 2 +
        card.tags.filter((t) => interests.includes(t)).length * 15 +
        (card.following ? 10 : 0) +
        (completed.has(card.versionId) ? -15 : 0) +
        (abandoned.has(card.versionId) ? -20 : 0) +
        (preferredSeconds && card.averageSeconds
          ? Math.max(
              0,
              10 - Math.abs(card.averageSeconds - preferredSeconds) / 10,
            )
          : 0) +
        (card.attempts < 10 ? 20 : 0) +
        12 / Math.sqrt(ageHours)
      );
    };
    cards.sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
    // Diversify the first page: no creator gets more than two slots before others.
    if (category === "recommended") {
      const counts = new Map<string, number>();
      const overflow: DungeonCard[] = [];
      cards = cards
        .filter((card) => {
          const count = counts.get(card.ownerId) ?? 0;
          counts.set(card.ownerId, count + 1);
          if (count >= 2) {
            overflow.push(card);
            return false;
          }
          return true;
        })
        .concat(overflow);
    }
    return {
      items: cards.slice(offset, offset + limit),
      next: offset + limit < cards.length ? offset + limit : null,
    };
  }
  lifecycle(user: UserRow, id: string, input: unknown): CommunityDungeon {
    const dungeon = this.readable(id, user);
    if (dungeon.owner_id !== user.id)
      throw new ApiError(
        403,
        "not_owner",
        "Only the architect can change this dungeon.",
      );
    if (dungeon.lifecycle === "moderated")
      throw new ApiError(
        403,
        "moderated",
        "A moderator must restore this dungeon.",
      );
    const body = objectBody(input);
    const lifecycle = String(body.lifecycle);
    const visibility = String(body.visibility ?? dungeon.visibility);
    if (
      !["published", "archived"].includes(lifecycle) ||
      !["public", "unlisted", "private"].includes(visibility)
    )
      throw new ApiError(
        400,
        "invalid_lifecycle",
        "Choose a supported lifecycle and visibility.",
      );
    this.db.run(
      "UPDATE dungeons SET lifecycle=?,visibility=?,updated_at=? WHERE id=?",
      lifecycle,
      visibility,
      this.now().toISOString(),
      dungeon.id,
    );
    return this.detail(id, user);
  }
  event(
    actorId: string | null,
    type: string,
    dungeonId?: string,
    versionId?: string,
  ): void {
    this.db.run(
      "INSERT INTO events(actor_id,type,dungeon_id,version_id,created_at) VALUES(?,?,?,?,?)",
      actorId,
      type,
      dungeonId ?? null,
      versionId ?? null,
      this.now().toISOString(),
    );
  }
}
