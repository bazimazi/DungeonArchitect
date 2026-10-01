import { randomUUID } from "node:crypto";
import { architectLevel } from "../src/shared/community";
import type { PlayerProfile } from "../src/shared/community";
import { Database } from "./database";
import type { UserRow } from "./auth";
import { requireValue } from "./errors";

export interface Reward {
  xp: number;
  gold: number;
  materials: number;
  essence: number;
}
export const NO_REWARD: Reward = { xp: 0, gold: 0, materials: 0, essence: 0 };
export class ProgressionService {
  constructor(
    private db: Database,
    private now: () => Date,
  ) {}
  grant(
    userId: string,
    reason: string,
    reference: string,
    reward: Reward,
  ): Reward {
    const changed = this.db.run(
      "INSERT OR IGNORE INTO ledger VALUES(?,?,?,?,?,?,?,?,?)",
      randomUUID(),
      userId,
      reason,
      reference,
      reward.xp,
      reward.gold,
      reward.materials,
      reward.essence,
      this.now().toISOString(),
    );
    return changed ? reward : { ...NO_REWARD };
  }
  master(userId: string, category: string, xp: number): void {
    if (xp > 0)
      this.db.run(
        "INSERT INTO mastery VALUES(?,?,?) ON CONFLICT(user_id,category) DO UPDATE SET xp=xp+excluded.xp",
        userId,
        category,
        xp,
      );
  }
  achievement(userId: string, key: string): void {
    this.db.run(
      "INSERT OR IGNORE INTO achievements VALUES(?,?,?)",
      userId,
      key,
      this.now().toISOString(),
    );
  }
  profile(userId: string): PlayerProfile {
    const user = requireValue(
      this.db.get<UserRow>("SELECT * FROM users WHERE id=?", userId),
    );
    const totals = this.db.get<Reward>(
      "SELECT COALESCE(SUM(xp),0) xp, COALESCE(SUM(gold),0) gold, COALESCE(SUM(materials),0) materials, COALESCE(SUM(essence),0) essence FROM ledger WHERE user_id=?",
      userId,
    )!;
    const count = (query: string): number =>
      this.db.get<{ count: number }>(query, userId)!.count;
    return {
      id: user.id,
      handle: user.handle,
      displayName: user.display_name,
      role: user.role,
      ...totals,
      level: architectLevel(totals.xp),
      interests: JSON.parse(user.interests),
      mastery: Object.fromEntries(
        this.db
          .all<{ category: string; xp: number }>(
            "SELECT * FROM mastery WHERE user_id=?",
            userId,
          )
          .map((row) => [row.category, row.xp]),
      ),
      achievements: this.db
        .all<{ key: string }>(
          "SELECT key FROM achievements WHERE user_id=? ORDER BY created_at",
          userId,
        )
        .map((row) => row.key),
      followers: count("SELECT COUNT(*) count FROM follows WHERE target_id=?"),
      following: count(
        "SELECT COUNT(*) count FROM follows WHERE follower_id=?",
      ),
      dungeons: count(
        "SELECT COUNT(*) count FROM dungeons WHERE owner_id=? AND lifecycle='published' AND visibility='public'",
      ),
      completions: count(
        "SELECT COUNT(DISTINCT version_id) count FROM attempts WHERE player_id=? AND outcome='completed'",
      ),
      createdAt: user.created_at,
      publishingDisabled: !!user.publishing_disabled,
    };
  }
}
