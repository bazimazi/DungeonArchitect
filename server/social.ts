import { randomUUID } from "node:crypto";
import type { FriendChallenge, Notification } from "../src/shared/community";
import { Database } from "./database";
import type { UserRow } from "./auth";
import { ApiError, objectBody, requireValue, textField } from "./errors";
import { DungeonService } from "./dungeons";
import { AttemptService } from "./attempts";

export class SocialService {
  constructor(
    private db: Database,
    private dungeons: DungeonService,
    private attempts: AttemptService,
    private now: () => Date,
  ) {}
  reaction(user: UserRow, dungeonId: string, input: unknown): void {
    const dungeon = this.dungeons.readable(dungeonId, user);
    const body = objectBody(input);
    const kind = String(body.kind);
    if (
      !["like", "favorite"].includes(kind) ||
      typeof body.enabled !== "boolean"
    )
      throw new ApiError(
        400,
        "invalid_reaction",
        "Choose like or favorite and an enabled state.",
      );
    if (body.enabled)
      this.db.run(
        "INSERT OR IGNORE INTO reactions VALUES(?,?,?,?)",
        user.id,
        dungeon.id,
        kind,
        this.now().toISOString(),
      );
    else
      this.db.run(
        "DELETE FROM reactions WHERE user_id=? AND dungeon_id=? AND kind=?",
        user.id,
        dungeon.id,
        kind,
      );
    if (body.enabled)
      this.dungeons.event(
        user.id,
        kind === "favorite" ? "DungeonFavorited" : "DungeonLiked",
        dungeon.id,
        dungeon.latest_version_id,
      );
    if (body.enabled && kind === "favorite" && user.id !== dungeon.owner_id)
      this.attempts.notify(
        dungeon.owner_id,
        "dungeon-favorited",
        { handle: user.handle, title: dungeon.title, dungeonId: dungeon.id },
        `favorite:${dungeon.id}:${user.id}`,
      );
  }
  follow(user: UserRow, handle: string, enabled: unknown): void {
    const target = requireValue(
      this.db.get<UserRow>(
        "SELECT * FROM users WHERE handle=? AND status='active'",
        handle,
      ),
    );
    if (target.id === user.id || typeof enabled !== "boolean")
      throw new ApiError(
        400,
        "invalid_follow",
        "Choose another architect to follow.",
      );
    if (enabled) {
      const changed = this.db.run(
        "INSERT OR IGNORE INTO follows VALUES(?,?,?)",
        user.id,
        target.id,
        this.now().toISOString(),
      );
      if (changed)
        this.attempts.notify(
          target.id,
          "new-follower",
          { handle: user.handle },
          `follow:${user.id}`,
        );
    } else
      this.db.run(
        "DELETE FROM follows WHERE follower_id=? AND target_id=?",
        user.id,
        target.id,
      );
  }
  challenge(user: UserRow, input: unknown): FriendChallenge {
    const body = objectBody(input);
    const versionId = textField(body.versionId, "Dungeon version", 1, 100);
    const handle = textField(body.handle, "Friend handle", 3, 24);
    const target = requireValue(
      this.db.get<UserRow>(
        "SELECT * FROM users WHERE handle=? AND status='active'",
        handle,
      ),
    );
    if (target.id === user.id)
      throw new ApiError(
        400,
        "self_challenge",
        "Choose a friend to challenge.",
      );
    const version = this.dungeons.version(versionId, user);
    const dungeon = this.dungeons.readable(version.dungeon_id, target);
    if (
      this.db.get(
        "SELECT id FROM friend_challenges WHERE sender_id=? AND recipient_id=? AND version_id=? AND status='pending' AND expires_at>?",
        user.id,
        target.id,
        versionId,
        this.now().toISOString(),
      )
    )
      throw new ApiError(
        409,
        "already_challenged",
        "That friend already has this challenge.",
      );
    const recent = this.db.get<{ count: number }>(
      "SELECT COUNT(*) count FROM friend_challenges WHERE sender_id=? AND created_at>?",
      user.id,
      new Date(this.now().getTime() - 86400000).toISOString(),
    )!.count;
    if (recent >= 20)
      throw new ApiError(
        429,
        "challenge_limit",
        "You can send 20 friend challenges per day.",
      );
    const id = randomUUID();
    const expiresAt = new Date(
      this.now().getTime() + 7 * 86400000,
    ).toISOString();
    this.db.transaction(() => {
      this.db.run(
        "INSERT INTO friend_challenges(id,sender_id,recipient_id,version_id,expires_at,created_at) VALUES(?,?,?,?,?,?)",
        id,
        user.id,
        target.id,
        versionId,
        expiresAt,
        this.now().toISOString(),
      );
      this.attempts.notify(
        target.id,
        "friend-challenge",
        {
          handle: user.handle,
          title: dungeon.title,
          versionId,
          challengeId: id,
        },
        `challenge:${id}`,
      );
    });
    return {
      id,
      sender: user.handle,
      recipient: target.handle,
      versionId,
      dungeonTitle: dungeon.title,
      status: "pending",
      resultId: null,
      expiresAt,
    };
  }
  challenges(user: UserRow): FriendChallenge[] {
    return this.db.all<FriendChallenge>(
      `SELECT c.id,s.handle sender,r.handle recipient,c.version_id versionId,d.title dungeonTitle,CASE WHEN c.status='pending' AND c.expires_at<? THEN 'expired' ELSE c.status END status,c.result_id resultId,c.expires_at expiresAt,a.ticks,a.damage,COALESCE(sec.count,0) secrets,(a.outcome='dead') deaths FROM friend_challenges c JOIN users s ON s.id=c.sender_id JOIN users r ON r.id=c.recipient_id JOIN versions v ON v.id=c.version_id JOIN dungeons d ON d.id=v.dungeon_id LEFT JOIN attempts a ON a.id=c.result_id LEFT JOIN attempt_secrets sec ON sec.attempt_id=a.id WHERE c.sender_id=? OR c.recipient_id=? ORDER BY c.created_at DESC LIMIT 100`,
      this.now().toISOString(),
      user.id,
      user.id,
    );
  }
  notifications(user: UserRow): Notification[] {
    return this.db
      .all<{
        id: string;
        kind: string;
        payload: string;
        read: number;
        created_at: string;
      }>(
        "SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 100",
        user.id,
      )
      .map((row) => ({
        id: row.id,
        kind: row.kind,
        payload: JSON.parse(row.payload),
        read: !!row.read,
        createdAt: row.created_at,
      }));
  }
  read(user: UserRow, id: string): void {
    this.db.run(
      "UPDATE notifications SET read=1 WHERE user_id=? AND id=?",
      user.id,
      id,
    );
  }
  report(user: UserRow, input: unknown): void {
    const body = objectBody(input);
    const type = String(body.targetType);
    const id = textField(body.targetId, "Target", 1, 100);
    const reason = textField(body.reason, "Report reason", 10, 1000);
    if (type === "dungeon") this.dungeons.readable(id, user);
    else if (type === "player")
      requireValue(this.db.get("SELECT id FROM users WHERE id=?", id));
    else
      throw new ApiError(400, "invalid_report", "Report a dungeon or player.");
    const count = this.db.get<{ count: number }>(
      "SELECT COUNT(*) count FROM reports WHERE reporter_id=? AND created_at>?",
      user.id,
      new Date(this.now().getTime() - 86400000).toISOString(),
    )!.count;
    if (count >= 10)
      throw new ApiError(
        429,
        "report_limit",
        "The daily report limit has been reached.",
      );
    this.db.run(
      "INSERT OR IGNORE INTO reports(id,reporter_id,target_type,target_id,reason,created_at) VALUES(?,?,?,?,?,?)",
      randomUUID(),
      user.id,
      type,
      id,
      reason,
      this.now().toISOString(),
    );
  }
}
