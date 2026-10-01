import { randomBytes, randomUUID } from "node:crypto";
import { Database } from "./database";
import type { UserRow } from "./auth";
import { ApiError, objectBody, requireValue, textField } from "./errors";
import { DungeonService } from "./dungeons";
import { parseDungeon } from "../src/core/dungeon";
import { screenText } from "./policies";
import type {
  Campaign,
  CampaignNode,
  Guild,
  SharedWorkshop,
} from "../src/shared/worlds";
interface CampaignRow {
  id: string;
  owner_id: string;
  title: string;
  description: string;
  nodes: string;
  revision: number;
  created_at: string;
  author: string;
}
interface ProjectRow {
  id: string;
  owner_id: string;
  title: string;
  package: string;
  revision: number;
  updated_at: string;
  owner: string;
}
interface GuildRow {
  id: string;
  owner_id: string;
  name: string;
  description: string;
  code: string;
}

export class WorldService {
  constructor(
    private db: Database,
    private dungeons: DungeonService,
    private now: () => Date,
  ) {}
  campaigns(user: UserRow | null): Campaign[] {
    return this.db
      .all<CampaignRow>(
        "SELECT c.*,u.handle author FROM campaigns c JOIN users u ON u.id=c.owner_id WHERE u.status='active' ORDER BY c.updated_at DESC LIMIT 100",
      )
      .map((r) => this.campaignData(r, user));
  }
  campaign(id: string, user: UserRow | null): Campaign {
    return this.campaignData(
      requireValue(
        this.db.get<CampaignRow>(
          "SELECT c.*,u.handle author FROM campaigns c JOIN users u ON u.id=c.owner_id WHERE c.id=? AND u.status='active'",
          id,
        ),
      ),
      user,
    );
  }
  private campaignData(row: CampaignRow, user: UserRow | null): Campaign {
    const nodes = JSON.parse(row.nodes) as CampaignNode[];
    const best = (id: string, condition = "clear") =>
      user
        ? this.db.get<{ damage: number; rewards: string }>(
            `SELECT a.damage,a.rewards FROM attempts a LEFT JOIN attempt_details details ON details.attempt_id=a.id WHERE a.player_id=? AND a.version_id=? AND a.outcome='completed' ${condition === "flawless" ? "AND a.damage=0" : condition === "treasure" ? "AND COALESCE(json_extract(details.loot,'$.gold'),0)>0" : ""} LIMIT 1`,
            user.id,
            nodes.find((n) => n.id === id)?.versionId ?? "",
          )
        : undefined;
    return {
      id: row.id,
      ownerId: row.owner_id,
      author: row.author,
      title: row.title,
      description: row.description,
      revision: row.revision,
      nodes,
      createdAt: row.created_at,
      progress: nodes.map((node) => {
        const prior = node.requires
          ? best(node.requires, node.condition)
          : undefined;
        let readable = true;
        try {
          this.dungeons.version(node.versionId, user);
        } catch {
          readable = false;
        }
        return {
          nodeId: node.id,
          completed: !!best(node.id),
          available: readable && (!node.requires || !!prior),
        };
      }),
    };
  }
  saveCampaign(user: UserRow, input: unknown, id?: string): Campaign {
    const body = objectBody(input);
    const existing = id ? this.campaign(id, user) : null;
    if (existing && existing.ownerId !== user.id)
      throw new ApiError(
        403,
        "not_owner",
        "Only the campaign creator can edit its story.",
      );
    if (body.expectedRevision !== (existing?.revision ?? 0))
      throw new ApiError(
        409,
        "campaign_conflict",
        "This campaign changed. Reload before editing.",
      );
    const title = textField(body.title, "Campaign title", 2, 60),
      description = textField(body.description ?? "", "Description", 0, 1000);
    screenText(title);
    screenText(description);
    if (!Array.isArray(body.nodes) || body.nodes.length > 30)
      throw new ApiError(
        400,
        "invalid_nodes",
        "A campaign supports up to 30 chapters.",
      );
    const ids = new Set<string>();
    const nodes: CampaignNode[] = body.nodes.map((raw) => {
      const n = objectBody(raw);
      const nodeId = textField(n.id, "Chapter id", 1, 100);
      if (ids.has(nodeId))
        throw new ApiError(
          400,
          "duplicate_chapter",
          "Chapter identifiers must be unique.",
        );
      ids.add(nodeId);
      const versionId = textField(n.versionId, "Version", 1, 100);
      const version = this.dungeons.version(versionId, user);
      const dungeon = this.dungeons.readable(version.dungeon_id, user);
      if (dungeon.visibility !== "public" || dungeon.lifecycle !== "published")
        throw new ApiError(
          400,
          "private_chapter",
          "Campaign chapters must use public published dungeons.",
        );
      const story = textField(n.story ?? "", "Chapter story", 0, 1000);
      screenText(story);
      if (!["clear", "flawless", "treasure"].includes(String(n.condition)))
        throw new ApiError(
          400,
          "invalid_condition",
          "Choose a chapter unlock condition.",
        );
      return {
        id: nodeId,
        versionId,
        title: textField(n.title, "Chapter title", 1, 60),
        story,
        condition: n.condition as CampaignNode["condition"],
        ...(n.requires
          ? { requires: textField(n.requires, "Previous chapter", 1, 100) }
          : {}),
      };
    });
    for (const node of nodes) {
      const seen = new Set<string>([node.id]);
      let parent = node.requires;
      while (parent) {
        if (seen.has(parent) || !ids.has(parent))
          throw new ApiError(
            400,
            "campaign_cycle",
            "Chapter prerequisites must form a reachable story without cycles.",
          );
        seen.add(parent);
        parent = nodes.find((n) => n.id === parent)!.requires;
      }
    }
    const campaignId = existing?.id ?? randomUUID(),
      at = this.now().toISOString();
    this.db.run(
      "INSERT INTO campaigns VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,nodes=excluded.nodes,revision=excluded.revision,updated_at=excluded.updated_at",
      campaignId,
      user.id,
      title,
      description,
      JSON.stringify(nodes),
      (existing?.revision ?? 0) + 1,
      existing?.createdAt ?? at,
      at,
    );
    return this.campaign(campaignId, user);
  }
  projects(user: UserRow): SharedWorkshop[] {
    return this.db
      .all<{ id: string }>(
        "SELECT p.id FROM projects p JOIN project_members m ON m.project_id=p.id WHERE m.user_id=? ORDER BY p.updated_at DESC",
        user.id,
      )
      .map((r) => this.project(r.id, user));
  }
  project(id: string, user: UserRow): SharedWorkshop {
    requireValue(
      this.db.get(
        "SELECT 1 FROM project_members WHERE project_id=? AND user_id=?",
        id,
        user.id,
      ),
    );
    const r = requireValue(
      this.db.get<ProjectRow>(
        "SELECT p.*,u.handle owner FROM projects p JOIN users u ON u.id=p.owner_id WHERE p.id=?",
        id,
      ),
    );
    return {
      id: r.id,
      ownerId: r.owner_id,
      owner: r.owner,
      title: r.title,
      dungeon: JSON.parse(r.package),
      revision: r.revision,
      updatedAt: r.updated_at,
      members: this.db.all(
        "SELECT u.handle,m.role FROM project_members m JOIN users u ON u.id=m.user_id WHERE m.project_id=?",
        id,
      ),
    };
  }
  createProject(user: UserRow, input: unknown): SharedWorkshop {
    const body = objectBody(input);
    let dungeon;
    try {
      dungeon = parseDungeon(body.dungeon);
    } catch {
      throw new ApiError(
        400,
        "invalid_draft",
        "Choose a valid workshop draft.",
      );
    }
    const id = randomUUID();
    dungeon.id = id;
    const title = textField(
      body.title ?? dungeon.title,
      "Workshop title",
      2,
      60,
    );
    screenText(title);
    this.db.transaction(() => {
      this.db.run(
        "INSERT INTO projects VALUES(?,?,?,?,?,?)",
        id,
        user.id,
        title,
        JSON.stringify(dungeon),
        1,
        this.now().toISOString(),
      );
      this.db.run(
        "INSERT INTO project_members VALUES(?,?,?)",
        id,
        user.id,
        "owner",
      );
    });
    return this.project(id, user);
  }
  updateProject(user: UserRow, id: string, input: unknown): SharedWorkshop {
    const project = this.project(id, user),
      body = objectBody(input);
    const member = this.db.get<{ role: string }>(
      "SELECT role FROM project_members WHERE project_id=? AND user_id=?",
      id,
      user.id,
    )!;
    if (member.role === "invited")
      throw new ApiError(
        403,
        "accept_required",
        "Accept the workshop invitation before editing.",
      );
    if (body.expectedRevision !== project.revision)
      throw new ApiError(
        409,
        "project_conflict",
        "A co-architect saved another revision. Reload their changes before saving.",
      );
    let dungeon;
    try {
      dungeon = parseDungeon(body.dungeon);
    } catch {
      throw new ApiError(
        400,
        "invalid_draft",
        "The workshop draft is invalid.",
      );
    }
    dungeon.id = id;
    this.db.run(
      "UPDATE projects SET package=?,revision=revision+1,updated_at=? WHERE id=?",
      JSON.stringify(dungeon),
      this.now().toISOString(),
      id,
    );
    return this.project(id, user);
  }
  member(user: UserRow, id: string, input: unknown): SharedWorkshop {
    const project = this.project(id, user),
      body = objectBody(input);
    if (body.action === "accept")
      this.db.run(
        "UPDATE project_members SET role='editor' WHERE project_id=? AND user_id=? AND role='invited'",
        id,
        user.id,
      );
    else {
      if (project.ownerId !== user.id)
        throw new ApiError(
          403,
          "not_owner",
          "Only the owner can manage co-architects.",
        );
      const target = requireValue(
        this.db.get<UserRow>(
          "SELECT * FROM users WHERE handle=? AND status='active'",
          textField(body.handle, "Co-architect handle", 3, 24),
        ),
      );
      if (target.id === user.id)
        throw new ApiError(
          400,
          "owner_membership",
          "The owner already belongs to this workshop.",
        );
      if (body.action === "remove")
        this.db.run(
          "DELETE FROM project_members WHERE project_id=? AND user_id=?",
          id,
          target.id,
        );
      else if (body.action === "invite")
        this.db.run(
          "INSERT OR IGNORE INTO project_members VALUES(?,?,'invited')",
          id,
          target.id,
        );
      else
        throw new ApiError(
          400,
          "invalid_action",
          "Choose invite, accept, or remove.",
        );
    }
    return this.project(id, user);
  }
  guilds(user: UserRow): Guild[] {
    return this.db
      .all<GuildRow>(
        "SELECT g.* FROM guilds g JOIN guild_members m ON m.guild_id=g.id WHERE m.user_id=?",
        user.id,
      )
      .map((r) => ({
        ...r,
        ownerId: r.owner_id,
        worlds: this.db.all(
          "SELECT c.id,c.title,u.handle author,gc.added_by addedBy FROM guild_campaigns gc JOIN campaigns c ON c.id=gc.campaign_id JOIN users u ON u.id=c.owner_id WHERE gc.guild_id=? AND u.status='active'",
          r.id,
        ),
        members: this.db.all(
          "SELECT u.id,u.handle,m.role FROM guild_members m JOIN users u ON u.id=m.user_id WHERE m.guild_id=?",
          r.id,
        ),
      }));
  }
  guild(user: UserRow, input: unknown): Guild[] {
    const body = objectBody(input);
    if (body.action === "create") {
      const id = randomUUID(),
        name = textField(body.name, "Guild name", 3, 60),
        description = textField(body.description ?? "", "Description", 0, 500);
      screenText(name);
      screenText(description);
      this.db.transaction(() => {
        this.db.run(
          "INSERT INTO guilds VALUES(?,?,?,?,?)",
          id,
          user.id,
          name,
          description,
          randomBytes(6).toString("hex").toUpperCase(),
        );
        this.db.run(
          "INSERT INTO guild_members VALUES(?,?,'owner')",
          id,
          user.id,
        );
      });
    } else if (body.action === "join") {
      const guild = requireValue(
        this.db.get<GuildRow>(
          "SELECT * FROM guilds WHERE code=?",
          textField(body.code, "Guild invitation code", 12, 12).toUpperCase(),
        ),
      );
      this.db.run(
        "INSERT OR IGNORE INTO guild_members VALUES(?,?,'member')",
        guild.id,
        user.id,
      );
    } else if (
      body.action === "attach-world" ||
      body.action === "remove-world"
    ) {
      const guild = requireValue(
        this.db.get<GuildRow>(
          "SELECT g.* FROM guilds g JOIN guild_members m ON m.guild_id=g.id WHERE g.id=? AND m.user_id=?",
          String(body.id),
          user.id,
        ),
      );
      const campaign = requireValue(
        this.db.get<CampaignRow>(
          "SELECT * FROM campaigns WHERE id=?",
          String(body.campaignId),
        ),
      );
      if (
        campaign.owner_id !== user.id &&
        (body.action === "attach-world" || guild.owner_id !== user.id)
      )
        throw new ApiError(
          403,
          "not_owner",
          "Contribute your own campaign, or ask its architect to join the guild.",
        );
      if (body.action === "attach-world")
        this.db.run(
          "INSERT OR IGNORE INTO guild_campaigns VALUES(?,?,?)",
          guild.id,
          campaign.id,
          user.id,
        );
      else
        this.db.run(
          "DELETE FROM guild_campaigns WHERE guild_id=? AND campaign_id=?",
          guild.id,
          campaign.id,
        );
    } else if (body.action === "leave") {
      const id = textField(body.id, "Guild", 1, 100);
      const guild = requireValue(
        this.db.get<GuildRow>("SELECT * FROM guilds WHERE id=?", id),
      );
      if (guild.owner_id === user.id)
        throw new ApiError(
          400,
          "owner_cannot_leave",
          "The guild owner must keep their membership.",
        );
      this.db.run(
        "DELETE FROM guild_members WHERE guild_id=? AND user_id=?",
        id,
        user.id,
      );
    } else
      throw new ApiError(
        400,
        "invalid_action",
        "Choose create, join, or leave.",
      );
    return this.guilds(user);
  }
}
