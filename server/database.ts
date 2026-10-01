import { DatabaseSync } from "node:sqlite";
import type { SQLInputValue, StatementSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export class Database {
  readonly connection: DatabaseSync;
  private statements = new Map<string, StatementSync>();
  private prepare(sql: string): StatementSync {
    let statement = this.statements.get(sql);
    if (!statement) {
      statement = this.connection.prepare(sql);
      if (this.statements.size >= 256)
        this.statements.delete(this.statements.keys().next().value!);
      this.statements.set(sql, statement);
    }
    return statement;
  }
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.connection = new DatabaseSync(path);
    this.connection.exec(
      "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;",
    );
    this.migrate();
  }
  get<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.prepare(sql).get(...params) as T | undefined;
  }
  all<T>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.prepare(sql).all(...params) as T[];
  }
  run(sql: string, ...params: SQLInputValue[]): number {
    return Number(this.prepare(sql).run(...params).changes);
  }
  transaction<T>(work: () => T): T {
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.connection.exec("COMMIT");
      return result;
    } catch (error) {
      this.connection.exec("ROLLBACK");
      throw error;
    }
  }
  close(): void {
    this.connection.close();
  }
  private migrate(): void {
    this.connection.exec(`
      CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS users(
        id TEXT PRIMARY KEY, handle TEXT NOT NULL UNIQUE COLLATE NOCASE, display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'player', status TEXT NOT NULL DEFAULT 'active',
        publishing_disabled INTEGER NOT NULL DEFAULT 0, interests TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
      CREATE TABLE IF NOT EXISTS dungeons(
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), source_id TEXT NOT NULL,
        title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]',
        visibility TEXT NOT NULL DEFAULT 'public', lifecycle TEXT NOT NULL DEFAULT 'published',
        latest_version_id TEXT, share_code TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(owner_id, source_id)
      );
      CREATE INDEX IF NOT EXISTS dungeons_discovery ON dungeons(lifecycle, visibility, updated_at DESC);
      CREATE INDEX IF NOT EXISTS dungeons_owner ON dungeons(owner_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS versions(
        id TEXT PRIMARY KEY, dungeon_id TEXT NOT NULL REFERENCES dungeons(id), number INTEGER NOT NULL,
        package TEXT NOT NULL, certificate BLOB NOT NULL, content_hash TEXT NOT NULL, challenge_rating INTEGER NOT NULL,
        created_at TEXT NOT NULL, UNIQUE(dungeon_id, number), UNIQUE(dungeon_id, content_hash)
      );
      CREATE TABLE IF NOT EXISTS drafts(user_id TEXT NOT NULL REFERENCES users(id), source_id TEXT NOT NULL, package TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(user_id, source_id));
      CREATE TABLE IF NOT EXISTS tickets(
        id TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES users(id), version_id TEXT NOT NULL REFERENCES versions(id),
        seed INTEGER NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL, request_hash TEXT
      );
      CREATE INDEX IF NOT EXISTS tickets_player ON tickets(player_id, created_at);
      CREATE TABLE IF NOT EXISTS attempts(
        id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL UNIQUE REFERENCES tickets(id), player_id TEXT NOT NULL REFERENCES users(id),
        version_id TEXT NOT NULL REFERENCES versions(id), replay BLOB NOT NULL, outcome TEXT NOT NULL,
        ticks INTEGER NOT NULL, health INTEGER NOT NULL, damage INTEGER NOT NULL, kills INTEGER NOT NULL, traps INTEGER NOT NULL,
        death_x INTEGER, death_y INTEGER, rewards TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS attempts_version ON attempts(version_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS attempts_version_completion ON attempts(version_id, outcome, ticks);
      CREATE INDEX IF NOT EXISTS attempts_player ON attempts(player_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS attempts_leaderboard ON attempts(outcome, ticks, health DESC, created_at);
      CREATE TABLE IF NOT EXISTS reactions(user_id TEXT NOT NULL REFERENCES users(id), dungeon_id TEXT NOT NULL REFERENCES dungeons(id), kind TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(user_id,dungeon_id,kind));
      CREATE INDEX IF NOT EXISTS reactions_dungeon ON reactions(dungeon_id,kind);
      CREATE TABLE IF NOT EXISTS follows(follower_id TEXT NOT NULL REFERENCES users(id), target_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, PRIMARY KEY(follower_id,target_id));
      CREATE TABLE IF NOT EXISTS ledger(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), reason TEXT NOT NULL, reference TEXT NOT NULL, xp INTEGER NOT NULL DEFAULT 0, gold INTEGER NOT NULL DEFAULT 0, materials INTEGER NOT NULL DEFAULT 0, essence INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, UNIQUE(user_id,reason,reference));
      CREATE TABLE IF NOT EXISTS mastery(user_id TEXT NOT NULL REFERENCES users(id), category TEXT NOT NULL, xp INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id,category));
      CREATE TABLE IF NOT EXISTS achievements(user_id TEXT NOT NULL REFERENCES users(id), key TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(user_id,key));
      CREATE TABLE IF NOT EXISTS cosmetics(user_id TEXT NOT NULL REFERENCES users(id), item_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(user_id,item_id));
      CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL, payload TEXT NOT NULL, dedupe TEXT NOT NULL, read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, UNIQUE(user_id,dedupe));
      CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id,created_at DESC);
      CREATE TABLE IF NOT EXISTS friend_challenges(id TEXT PRIMARY KEY, sender_id TEXT NOT NULL REFERENCES users(id), recipient_id TEXT NOT NULL REFERENCES users(id), version_id TEXT NOT NULL REFERENCES versions(id), status TEXT NOT NULL DEFAULT 'pending', result_id TEXT REFERENCES attempts(id), expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS challenge_submissions(challenge_id TEXT NOT NULL, version_id TEXT NOT NULL REFERENCES versions(id), user_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, PRIMARY KEY(challenge_id,user_id));
      CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY, reporter_id TEXT NOT NULL REFERENCES users(id), target_type TEXT NOT NULL, target_id TEXT NOT NULL, reason TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL, UNIQUE(reporter_id,target_type,target_id));
      CREATE TABLE IF NOT EXISTS moderation_audit(id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL, target_id TEXT NOT NULL, reason TEXT NOT NULL, previous TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, actor_id TEXT, type TEXT NOT NULL, dungeon_id TEXT, version_id TEXT, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS events_metrics ON events(type,created_at);
      INSERT OR IGNORE INTO migrations VALUES(1,datetime('now'));
      CREATE TABLE IF NOT EXISTS equipped_cosmetics(user_id TEXT PRIMARY KEY REFERENCES users(id),item_id TEXT NOT NULL);
      INSERT OR IGNORE INTO migrations VALUES(2,datetime('now'));
      CREATE TABLE IF NOT EXISTS campaigns(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES users(id),title TEXT NOT NULL,description TEXT NOT NULL,nodes TEXT NOT NULL,revision INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES users(id),title TEXT NOT NULL,package TEXT NOT NULL,revision INTEGER NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS project_members(project_id TEXT NOT NULL REFERENCES projects(id),user_id TEXT NOT NULL REFERENCES users(id),role TEXT NOT NULL,PRIMARY KEY(project_id,user_id));
      CREATE TABLE IF NOT EXISTS guilds(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES users(id),name TEXT NOT NULL,description TEXT NOT NULL,code TEXT NOT NULL UNIQUE);
      CREATE TABLE IF NOT EXISTS guild_members(guild_id TEXT NOT NULL REFERENCES guilds(id),user_id TEXT NOT NULL REFERENCES users(id),role TEXT NOT NULL,PRIMARY KEY(guild_id,user_id));
      INSERT OR IGNORE INTO migrations VALUES(3,datetime('now'));
      CREATE TABLE IF NOT EXISTS attempt_details(attempt_id TEXT PRIMARY KEY REFERENCES attempts(id),loot TEXT NOT NULL,build TEXT NOT NULL,visited INTEGER NOT NULL);
      INSERT OR IGNORE INTO migrations VALUES(4,datetime('now'));
      CREATE TABLE IF NOT EXISTS version_traffic(version_id TEXT NOT NULL REFERENCES versions(id),cell TEXT NOT NULL,visits INTEGER NOT NULL,PRIMARY KEY(version_id,cell));
      CREATE TABLE IF NOT EXISTS version_killers(version_id TEXT NOT NULL REFERENCES versions(id),object_id TEXT NOT NULL,kills INTEGER NOT NULL,PRIMARY KEY(version_id,object_id));
      CREATE TABLE IF NOT EXISTS version_routes(version_id TEXT NOT NULL REFERENCES versions(id),hash TEXT NOT NULL,path BLOB NOT NULL,uses INTEGER NOT NULL,PRIMARY KEY(version_id,hash));
      INSERT OR IGNORE INTO migrations VALUES(5,datetime('now'));
      CREATE TABLE IF NOT EXISTS usage_events(id INTEGER PRIMARY KEY,actor_id TEXT NOT NULL,type TEXT NOT NULL,duration_ms INTEGER NOT NULL,created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS usage_actor ON usage_events(actor_id,created_at);
      CREATE INDEX IF NOT EXISTS usage_type ON usage_events(type,created_at);
      INSERT OR IGNORE INTO migrations VALUES(6,datetime('now'));
      CREATE TABLE IF NOT EXISTS guild_campaigns(guild_id TEXT NOT NULL REFERENCES guilds(id),campaign_id TEXT NOT NULL REFERENCES campaigns(id),added_by TEXT NOT NULL REFERENCES users(id),PRIMARY KEY(guild_id,campaign_id));
      INSERT OR IGNORE INTO migrations VALUES(7,datetime('now'));
      CREATE TABLE IF NOT EXISTS attempt_secrets(attempt_id TEXT PRIMARY KEY REFERENCES attempts(id),count INTEGER NOT NULL);
      INSERT OR IGNORE INTO migrations VALUES(8,datetime('now'));
      INSERT OR IGNORE INTO migrations VALUES(9,datetime('now'));
    `);
  }
}
