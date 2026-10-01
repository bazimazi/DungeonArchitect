import { html, msg } from "./localization";
import type { CommunityApi } from "../services/community";
import { COSMETICS } from "../shared/economy";
import type { CosmeticInventory, currentSeason } from "../shared/economy";
import type {
  Campaign,
  CampaignNode,
  Guild,
  SharedWorkshop,
} from "../shared/worlds";
import type { Dungeon } from "../core/types";
import type { CommunityDungeon, DungeonCard } from "../shared/community";
const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const button = (action: string, label: string, value = "") =>
  html`<button
    type="button"
    class="button outline"
    data-community="extras:${action}"
    data-value="${esc(value)}"
  >
    ${esc(label)}
  </button>`;
const field = (label: string, name: string, value = "", max = 60, required = true) =>
  html`<label
    >${label}<input
      name="${name}"
      value="${esc(value)}"
      ${required ? "required" : ""}
      maxlength="${max}"
  /></label>`;
export class CommunityExtras {
  private campaign: Campaign | null = null;
  private projects = new Map<string, SharedWorkshop>();
  private loadedRevisions = new Map<string, number>();
  constructor(
    private api: CommunityApi,
    private draft: () => Dungeon,
    private load: (d: Dungeon) => void,
    private shell: (html: string) => void,
    private message: (text: string) => void,
  ) {}
  async render(tab: string): Promise<string> {
    if (tab === "shop") {
      const shop = await this.api.request<{
        inventory: CosmeticInventory | null;
        season: ReturnType<typeof currentSeason>;
      }>("/shop");
      const equipped = COSMETICS.find((c) => c.id === shop.inventory?.equipped);
      document.documentElement.style.setProperty(
        "--architect-banner",
        equipped?.color ?? "#d3b779",
      );
      return html`<article class="season-banner panel">
          <p class="eyebrow">SEASONAL INSPIRATION</p>
          <h2>${shop.season.title}</h2>
          <p>${shop.season.description}</p>
          <p>Seasonal mechanics remain available in your workshop.</p>
        </article>
        <h2>Architect collection</h2>
        <p>
          Spend earned currency on a profile banner. Every item is cosmetic and
          leaves challenge rules unchanged.
        </p>
        <div class="era-track">
          ${COSMETICS.map(
            (c) =>
              html`<article class="panel">
                <div class="cosmetic-preview" style="--banner:${c.color}">
                  ◇
                </div>
                <h3>${c.name}</h3>
                <p>
                  ${[c.gold ? `${c.gold} gold` : "", c.materials ? `${c.materials} materials` : "", c.essence ? `${c.essence} essence` : ""].filter(Boolean).join(" · ")}
                </p>
                ${shop.inventory?.equipped === c.id ? html`<p>Equipped</p>` : button(shop.inventory?.owned.includes(c.id) ? "equip" : "buy", shop.inventory?.owned.includes(c.id) ? msg("Equip banner") : msg("Unlock banner"), c.id)}
              </article>`,
          ).join("")}
        </div>`;
    }
    if (tab === "worlds") {
      this.campaign = null;
      const worlds = await this.api.request<Campaign[]>("/campaigns");
      return html`<p>
          Connect published dungeon versions into a branching adventure. Chapter
          prerequisites use verified clears, flawless runs, or optional
          treasure.
        </p>
        <div class="era-track">
          ${
            worlds
              .map(
                (c) =>
                  html`<article class="panel">
                    <p class="eyebrow">
                      BY @${esc(c.author)} · ${c.nodes.length} CHAPTERS
                    </p>
                    <h2>${esc(c.title)}</h2>
                    <p>${esc(c.description)}</p>
                    ${button("campaign", msg("Open campaign"), c.id)}
                  </article>`,
              )
              .join("") ||
            html`<p>No campaigns yet. Write the first adventure.</p>`
          }
        </div>
        ${
          this.api.player
            ? html`<form
                data-form="extras:create-campaign"
                class="community-form"
              >
                <h2>New campaign</h2>
                ${field(msg("Campaign title"), "title")}${field("Premise", "description", "", 1000)}<button
                  class="button primary"
                >
                  Create campaign
                </button>
              </form>`
            : html`<p>Sign in from Profile to create a campaign.</p>`
        }`;
    }
    const [projects, guilds, campaigns] = await Promise.all([
      this.api.request<SharedWorkshop[]>("/projects"),
      this.api.request<Guild[]>("/guilds"),
      this.api.request<Campaign[]>("/campaigns"),
    ]);
    this.projects = new Map(projects.map((p) => [p.id, p]));
    return html`<h2>Co-architect workshops</h2>
      <p>
        Invite a co-architect, open a shared draft, then save your revision
        here. If another architect saves first, their changes are protected and
        you’ll be asked to reload.
      </p>
      ${button("create-project", msg("Share current workshop"))}
      <div class="era-track">
        ${
          projects
            .map(
              (p) =>
                html`<article class="panel">
                  <p class="eyebrow">
                    REVISION ${p.revision} · @${esc(p.owner)}
                  </p>
                  <h3>${esc(p.title)}</h3>
                  <p>
                    ${p.members.map((m) => `@${esc(m.handle)} (${m.role})`).join(", ")}
                  </p>
                  <div class="community-actions">
                    ${p.members.find((m) => m.handle === this.api.player!.handle)?.role === "invited" ? button("accept-project", msg("Accept invitation"), p.id) : button("open-project", msg("Open shared draft"), p.id)}${this.draft().id === p.id ? button("save-project", msg("Save current revision"), p.id) : ""}
                  </div>
                  ${p.ownerId === this.api.player!.id ? html`<form data-form="extras:invite" class="community-form"><input type="hidden" name="id" value="${p.id}" />${field(msg("Co-architect handle"), "handle", "", 24)}<button class="button outline">Invite co-architect</button></form>` : ""}
                </article>`,
            )
            .join("") || html`<p>You have no shared workshops.</p>`
        }
      </div>
      <h2>Dungeon guilds</h2>
      <div class="era-track">
        ${guilds
          .map(
            (g) =>
              html`<article class="panel">
                <h3>${esc(g.name)}</h3>
                <p>${esc(g.description)}</p>
                <p>Invite code: <strong>${g.code}</strong></p>
                <p>${g.members.map((m) => `@${esc(m.handle)}`).join(" · ")}</p>
                <h4>Guild worlds</h4>
                ${g.worlds.map((w) => html`<p>${button("campaign", w.title, w.id)} ${w.addedBy === this.api.player!.id || g.ownerId === this.api.player!.id ? button("remove-world", msg("Remove from guild"), g.id + "|" + w.id) : ""}</p>`).join("") || html`<p>No worlds linked yet.</p>`}
                <form data-form="extras:attach-world">
                  <input type="hidden" name="id" value="${g.id}" /><label
                    >Contribute a campaign<select name="campaignId">
                      ${campaigns
                        .filter((c) => c.ownerId === this.api.player!.id)
                        .map(
                          (c) =>
                            html`<option value="${c.id}">
                              ${esc(c.title)}
                            </option>`,
                        )
                        .join("")}
                    </select></label
                  ><button
                    class="button outline"
                    ${campaigns.some((c) => c.ownerId === this.api.player!.id) ? "" : "disabled"}
                  >
                    Link to guild
                  </button>
                </form>
                ${g.ownerId !== this.api.player!.id ? button("leave-guild", msg("Leave guild"), g.id) : ""}
              </article>`,
          )
          .join("")}
      </div>
      <div class="community-columns">
        <form data-form="extras:create-guild" class="community-form">
          <h3>Create a guild</h3>
          ${field(msg("Guild name"), "name")}${field("Description", "description", "", 500)}<button
            class="button primary"
          >
            Create guild
          </button>
        </form>
        <form data-form="extras:join-guild" class="community-form">
          <h3>Join a guild</h3>
          ${field(msg("Invitation code"), "code", "", 12)}<button
            class="button outline"
          >
            Join guild
          </button>
        </form>
      </div>`;
  }
  private async showCampaign(id: string): Promise<void> {
    const c = (this.campaign = await this.api.request<Campaign>(
      `/campaigns/${id}`,
    ));
    const owner = c.ownerId === this.api.player?.id;
    const own = owner
      ? await this.api.request<{ items: DungeonCard[] }>(
          "/dungeons?category=mine&limit=30",
        )
      : { items: [] };
    this.shell(
      html`<p class="eyebrow">
          CAMPAIGN BY @${esc(c.author)} · REVISION ${c.revision}
        </p>
        <h2>${esc(c.title)}</h2>
        <p>${esc(c.description)}</p>
        <div class="campaign-map">
          ${
            c.nodes
              .map((n) => {
                const progress = c.progress!.find((p) => p.nodeId === n.id)!;
                return html`<article class="panel">
                  <p class="eyebrow">
                    ${n.requires ? `AFTER ${esc(c.nodes.find((p) => p.id === n.requires)?.title)} · ${n.condition}` : msg("START HERE")}${progress.completed ? " · CLEARED" : ""}
                  </p>
                  <h3>${esc(n.title)}</h3>
                  <p>${esc(n.story)}</p>
                  <button
                    class="button primary"
                    data-community="play"
                    data-value="${n.versionId}"
                    ${progress.available ? "" : "disabled"}
                  >
                    ${progress.available ? msg("Enter chapter") : msg("Complete its prerequisite")}</button
                  >${owner ? button("remove-chapter", msg("Remove chapter"), n.id) : ""}
                </article>`;
              })
              .join("") || html`<p>Add a chapter to begin this story.</p>`
          }
        </div>
        ${
          owner
            ? html`<form data-form="extras:add-chapter" class="community-form">
                <h3>Add a chapter</h3>
                ${field(msg("Chapter title"), "title")}${field(msg("Story before this chapter"), "story", "", 1000)}<label
                  >Published dungeon<select name="versionId">
                    ${own.items
                      .filter(
                        (d) =>
                          d.visibility === "public" &&
                          d.lifecycle === "published",
                      )
                      .map(
                        (d) =>
                          html`<option value="${d.versionId}">
                            ${esc(d.title)} · v${d.version}
                          </option>`,
                      )
                      .join("")}
                    <option value="">Use a share code below</option>
                  </select></label
                >${field(msg("Or use another creator's dungeon share code"), "shareCode", "", 13, false)}<label
                  >Requires chapter<select name="requires">
                    <option value="">Start chapter (no prerequisite)</option>
                    ${c.nodes.map((n) => html`<option value="${n.id}">${esc(n.title)}</option>`).join("")}
                  </select></label
                ><label
                  >Unlock condition<select name="condition">
                    <option value="clear">Clear the prerequisite</option>
                    <option value="flawless">
                      Clear without taking damage
                    </option>
                    <option value="treasure">Clear with optional gold</option>
                  </select></label
                ><button class="button primary">Add chapter</button>
              </form>`
            : ""
        }`,
    );
  }
  async click(action: string, value: string): Promise<void> {
    if (action === "buy" || action === "equip") {
      await this.api.request(`/shop/${action}`, "POST", { itemId: value });
      await this.api.refresh();
      this.shell(await this.render("shop"));
      this.message(
        action === "buy" ? msg("Cosmetic unlocked.") : msg("Banner equipped."),
      );
    } else if (action === "campaign") await this.showCampaign(value);
    else if (action === "remove-chapter" && this.campaign) {
      if (this.campaign.nodes.some((n) => n.requires === value))
        throw new Error(msg("Remove dependent chapters first."));
      await this.api.request(`/campaigns/${this.campaign.id}`, "PUT", {
        ...this.campaign,
        expectedRevision: this.campaign.revision,
        nodes: this.campaign.nodes.filter((n) => n.id !== value),
      });
      await this.showCampaign(this.campaign.id);
    } else if (action === "create-project") {
      await this.api.request("/projects", "POST", {
        dungeon: this.draft(),
        title: this.draft().title,
      });
      this.shell(await this.render("team"));
    } else if (action === "open-project") {
      const p = await this.api.request<SharedWorkshop>(`/projects/${value}`);
      this.projects.set(p.id, p);
      this.loadedRevisions.set(`${this.api.player!.id}/${p.id}`, p.revision);
      this.load(p.dungeon);
      this.message(
        msg(
          "Shared revision loaded. Edit in the workshop, then return to Team to save.",
        ),
      );
    } else if (action === "save-project") {
      const key = `${this.api.player!.id}/${value}`;
      const revision = this.loadedRevisions.get(key);
      if (revision === undefined)
        throw new Error(
          msg(
            "Open the shared draft before saving so its revision can be checked.",
          ),
        );
      const result = await this.api.request<SharedWorkshop>(
        `/projects/${value}`,
        "PUT",
        { dungeon: this.draft(), expectedRevision: revision },
      );
      this.loadedRevisions.set(key, result.revision);
      this.shell(await this.render("team"));
      this.message(msg("Shared revision saved."));
    } else if (action === "accept-project") {
      await this.api.request(`/projects/${value}/members`, "POST", {
        action: "accept",
      });
      this.shell(await this.render("team"));
    } else if (action === "leave-guild") {
      await this.api.request("/guilds", "POST", { action: "leave", id: value });
      this.shell(await this.render("team"));
    } else if (action === "remove-world") {
      const [id, campaignId] = value.split("|");
      await this.api.request("/guilds", "POST", {
        action: "remove-world",
        id,
        campaignId,
      });
      this.shell(await this.render("team"));
    }
  }
  async submit(action: string, form: FormData): Promise<void> {
    const body = Object.fromEntries(form);
    if (action === "attach-world") {
      await this.api.request("/guilds", "POST", {
        ...body,
        action: "attach-world",
      });
      this.shell(await this.render("team"));
      return;
    }
    if (action === "create-campaign") {
      const c = await this.api.request<Campaign>("/campaigns", "POST", {
        ...body,
        nodes: [],
        expectedRevision: 0,
      });
      await this.showCampaign(c.id);
    } else if (action === "add-chapter" && this.campaign) {
      if (body.shareCode) {
        const code = String(body.shareCode).trim().toUpperCase();
        if (!/^DA-[A-F0-9]{10}$/.test(code))
          throw new Error(msg("Enter a valid dungeon share code."));
        const dungeon = await this.api.request<CommunityDungeon>(
          `/dungeons/${code}`,
        );
        body.versionId = dungeon.card.versionId;
      }
      const node = {
        ...body,
        id: crypto.randomUUID(),
      } as unknown as CampaignNode;
      if (!node.requires) delete node.requires;
      await this.api.request(`/campaigns/${this.campaign.id}`, "PUT", {
        ...this.campaign,
        nodes: [...this.campaign.nodes, node],
        expectedRevision: this.campaign.revision,
      });
      await this.showCampaign(this.campaign.id);
    } else if (action === "invite") {
      await this.api.request(`/projects/${body.id}/members`, "POST", {
        handle: body.handle,
        action: "invite",
      });
      this.shell(await this.render("team"));
      this.message(msg("Invitation added to their Team tab."));
    } else if (action === "create-guild" || action === "join-guild") {
      await this.api.request("/guilds", "POST", {
        ...body,
        action: action === "create-guild" ? "create" : "join",
      });
      this.shell(await this.render("team"));
    }
  }
}
