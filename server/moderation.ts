import { randomUUID } from "node:crypto";
import { Database } from "./database";
import type { UserRow } from "./auth";
import { ApiError, objectBody, requireValue, textField } from "./errors";

export class ModerationService {
  constructor(
    private db: Database,
    private now: () => Date,
  ) {}
  private authorize(user: UserRow): void {
    if (user.role === "player")
      throw new ApiError(
        403,
        "moderator_required",
        "Moderator access is required.",
      );
  }
  queue(user: UserRow): unknown[] {
    this.authorize(user);
    return this.db.all(
      "SELECT r.id,r.target_type targetType,r.target_id targetId,r.reason,r.state,r.created_at createdAt,u.handle reporter FROM reports r JOIN users u ON u.id=r.reporter_id ORDER BY r.created_at DESC LIMIT 200",
    );
  }
  act(user: UserRow, input: unknown): void {
    this.authorize(user);
    const body = objectBody(input);
    const action = String(body.action);
    const targetId = textField(body.targetId, "Target", 1, 100);
    const reason = textField(body.reason, "Moderation reason", 10, 1000);
    const at = this.now().toISOString();
    const allowed = [
      "hide-dungeon",
      "restore-dungeon",
      "disable-publishing",
      "enable-publishing",
      "suspend-player",
      "restore-player",
      "resolve-report",
    ];
    if (!allowed.includes(action))
      throw new ApiError(
        400,
        "invalid_action",
        "Choose a supported moderation action.",
      );
    let previous: unknown;
    this.db.transaction(() => {
      if (action.endsWith("dungeon")) {
        previous = requireValue(
          this.db.get<{ lifecycle: string; visibility: string }>(
            "SELECT lifecycle,visibility FROM dungeons WHERE id=?",
            targetId,
          ),
        );
        if (
          ((previous as { lifecycle: string }).lifecycle === "moderated") ===
          (action === "hide-dungeon")
        )
          throw new ApiError(
            409,
            "unchanged",
            "This dungeon already has that moderation state.",
          );
        if (action === "hide-dungeon")
          this.db.run(
            "UPDATE dungeons SET lifecycle='moderated' WHERE id=?",
            targetId,
          );
        else {
          const audit = this.db.get<{ previous: string }>(
            "SELECT previous FROM moderation_audit WHERE target_id=? AND action='hide-dungeon' ORDER BY created_at DESC LIMIT 1",
            targetId,
          );
          const prior = audit
            ? (JSON.parse(audit.previous) as { lifecycle: string })
            : null;
          this.db.run(
            "UPDATE dungeons SET lifecycle=? WHERE id=?",
            prior && ["published", "archived"].includes(prior.lifecycle)
              ? prior.lifecycle
              : "published",
            targetId,
          );
        }
      } else if (action === "resolve-report") {
        previous = requireValue(
          this.db.get("SELECT state FROM reports WHERE id=?", targetId),
        );
        this.db.run("UPDATE reports SET state='resolved' WHERE id=?", targetId);
      } else {
        const target = requireValue(
          this.db.get<UserRow>("SELECT * FROM users WHERE id=?", targetId),
        );
        if (
          target.id === user.id ||
          target.role === "admin" ||
          (target.role === "moderator" && user.role !== "admin")
        )
          throw new ApiError(
            403,
            "protected_account",
            "This moderator cannot act on that account.",
          );
        previous = {
          status: target.status,
          publishingDisabled: target.publishing_disabled,
        };
        if (action.includes("publishing"))
          this.db.run(
            "UPDATE users SET publishing_disabled=? WHERE id=?",
            action === "disable-publishing" ? 1 : 0,
            targetId,
          );
        else {
          this.db.run(
            "UPDATE users SET status=? WHERE id=?",
            action === "suspend-player" ? "suspended" : "active",
            targetId,
          );
          if (action === "suspend-player")
            this.db.run("DELETE FROM sessions WHERE user_id=?", targetId);
        }
      }
      this.db.run(
        "INSERT INTO moderation_audit VALUES(?,?,?,?,?,?,?)",
        randomUUID(),
        user.id,
        action,
        targetId,
        reason,
        JSON.stringify(previous),
        at,
      );
    });
  }
  metrics(user: UserRow): unknown {
    this.authorize(user);
    const at = this.now();
    const since = new Date(at.getTime() - 30 * 86400000).toISOString();
    return {
      usage: this.db.all(
        "SELECT type,COUNT(*) events,COUNT(DISTINCT actor_id) players,AVG(duration_ms) averageDurationMs FROM usage_events WHERE created_at>=? GROUP BY type",
        since,
      ),
      creation: this.db.get(
        `SELECT COUNT(*) players,COALESCE(SUM(EXISTS(SELECT 1 FROM dungeons d WHERE d.owner_id=u.id)),0) creators,AVG((SELECT (julianday(MIN(d.created_at))-julianday(u.created_at))*86400 FROM dungeons d WHERE d.owner_id=u.id)) averageSecondsToFirstPublish FROM users u`,
      ),
      gameplay: this.db.get(
        `SELECT COUNT(*) attempts,COUNT(DISTINCT player_id) players,COALESCE(AVG(outcome='completed'),0)*100 completionPercent,AVG(ticks)/4 averageSeconds,COUNT(*)-COUNT(DISTINCT player_id||':'||version_id) repeatedAttempts FROM attempts WHERE created_at>=?`,
        since,
      ),
      players: this.db.get("SELECT COUNT(*) total FROM users"),
      creators: this.db.get(
        "SELECT COUNT(DISTINCT owner_id) total FROM dungeons",
      ),
      dungeons: this.db.get(
        "SELECT COUNT(*) total FROM dungeons WHERE lifecycle='published'",
      ),
      activity: this.db.all(
        "SELECT type,COUNT(*) count,COUNT(DISTINCT actor_id) players FROM events WHERE created_at>=? GROUP BY type",
        since,
      ),
      daily: this.db.all(
        "SELECT substr(created_at,1,10) day,COUNT(*) events,COUNT(DISTINCT actor_id) players FROM events WHERE created_at>=? GROUP BY day ORDER BY day",
        since,
      ),
      retention: [1, 7, 30].map((day) => {
        const eligible = new Date(at.getTime() - day * 86400000).toISOString();
        return {
          day,
          ...this.db.get<{ cohort: number; returned: number }>(
            `SELECT COUNT(*) cohort,COALESCE(SUM(EXISTS(SELECT 1 FROM events e WHERE e.actor_id=u.id AND julianday(e.created_at)-julianday(u.created_at)>=? AND julianday(e.created_at)-julianday(u.created_at)<?)),0) returned FROM users u WHERE u.created_at<=?`,
            day,
            day + 1,
            eligible,
          ),
        };
      }),
    };
  }
}
