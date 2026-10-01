import { html, msg } from "./localization";
import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import QRCode from "qrcode";
import type { AnalyticsSnapshot } from "../services/analytics";
import type { ClientEvent } from "../shared/telemetry";
import { CommunityExtras } from "./community-extras";
import { CommunityApi } from "../services/community";
import { ERAS, TAGS, nextLevelXp } from "../shared/community";
import type {
  AttemptTicket,
  BuildChallenge,
  CommunityAttempt,
  CommunityDungeon,
  DungeonCard,
  FriendChallenge,
  LeaderboardEntry,
  Notification,
  PlayerProfile,
  CreatorProfile,
} from "../shared/community";
import type { Dungeon, Replay } from "../core/types";
import { parseReplay } from "../core/simulation";

const esc = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const btn = (action: string, label: string, value = "", primary = false) =>
  html`<button
    type="button"
    class="button ${primary ? "primary" : "outline"}"
    data-community="${action}"
    data-value="${esc(value)}"
  >
    ${esc(label)}
  </button>`;
const field = (
  label: string,
  name: string,
  value = "",
  type = "text",
  extra = "",
) =>
  html`<label
    >${esc(label)}<input
      name="${name}"
      type="${type}"
      value="${esc(value)}"
      ${extra}
  /></label>`;
const tags = (chosen: string[] = []) =>
  html`<fieldset class="tag-picker">
    <legend>Styles (choose up to five)</legend>
    ${TAGS.map((tag) => html`<label><input type="checkbox" name="tags" value="${tag}" ${chosen.includes(tag) ? "checked" : ""} />${tag}</label>`).join("")}
  </fieldset>`;
interface Hooks {
  track: (event: ClientEvent) => void;
  draft: () => Dungeon;
  proof: () => Replay | null;
  play: (ticket: AttemptTicket) => void;
  replay: (replay: Replay) => void;
  analyze: (
    dungeon: Dungeon,
    recordings: Replay[],
    analytics: AnalyticsSnapshot,
  ) => void;
  load: (dungeon: Dungeon) => void;
  closed: () => void;
}
type Tab =
  | "discover"
  | "publish"
  | "profile"
  | "challenges"
  | "inbox"
  | "leaderboards"
  | "drafts"
  | "moderation"
  | "shop"
  | "worlds"
  | "team";

export class CommunityHub {
  readonly element = document.createElement("dialog");
  private tab: Tab = "discover";
  private category = "recommended";
  private search = "";
  private tag = "";
  private difficulty = "";
  private cursor = 0;
  private detail: CommunityDungeon | null = null;
  private selectedVersion = "";
  private busy = false;
  private revision = new Map<string, number>();
  private challengeId = "";
  private boardPeriod = "all";
  private boardMetric = "speed";
  private boardFriends = false;
  private generation = 0;
  private extras: CommunityExtras;
  constructor(
    readonly api: CommunityApi,
    private hooks: Hooks,
  ) {
    try {
      const rows = JSON.parse(
        localStorage.getItem("da.cloud-revisions") ?? "[]",
      );
      if (Array.isArray(rows))
        this.revision = new Map(
          rows.filter(
            (r) =>
              Array.isArray(r) &&
              typeof r[0] === "string" &&
              Number.isInteger(r[1]),
          ),
        );
    } catch {
      /* No cloud revision is assumed when local metadata is unavailable. */
    }
    this.extras = new CommunityExtras(
      api,
      hooks.draft,
      hooks.load,
      (html) => this.shell(html),
      (text) => this.message(text),
    );
    this.element.className = "community-dialog";
    document.body.append(this.element);
    this.element.addEventListener("close", () => {
      this.generation++;
      hooks.closed();
    });
    this.element.addEventListener("click", (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-community]",
      );
      if (target) {
        event.preventDefault();
        void this.run(() =>
          this.click(target.dataset.community!, target.dataset.value ?? ""),
        );
      }
    });
    this.element.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.target as HTMLFormElement;
      void this.run(async () => {
        try {
          await this.submit(form.dataset.form!, new FormData(form));
        } catch (error) {
          if (form.dataset.form === "publish")
            this.hooks.track("PublishFailed");
          throw error;
        }
      });
    });
    this.element.addEventListener("change", (event) => {
      const target = event.target as HTMLSelectElement;
      if (target.name === "version") {
        this.selectedVersion = target.value;
        void this.run(() => this.showDetail());
      }
    });
  }
  get open(): boolean {
    return this.element.open;
  }
  async show(tab: Tab = "discover"): Promise<void> {
    this.tab = tab;
    this.detail = null;
    if (!this.open) this.element.showModal();
    this.shell(html`<p role="status">Connecting to the community…</p>`);
    await this.run(async () => {
      await this.api.refresh();
      await this.render();
    });
  }
  private async run(work: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.element.setAttribute("aria-busy", "true");
    try {
      await work();
    } catch (error) {
      this.message(
        error instanceof Error ? error.message : msg("Something went wrong."),
        true,
      );
    } finally {
      this.busy = false;
      this.element.removeAttribute("aria-busy");
    }
  }
  private shell(content: string): void {
    const tabs: Tab[] = [
      "discover",
      "publish",
      "profile",
      "challenges",
      "inbox",
      "leaderboards",
      "drafts",
      "shop",
      "worlds",
      "team",
    ];
    if (this.api.player && this.api.player.role !== "player")
      tabs.push("moderation");
    this.element.innerHTML = html`<header class="community-header">
        <div>
          <p class="eyebrow">DUNGEON ARCHITECT / COMMUNITY</p>
          <h1>
            ${this.detail ? esc(this.detail.card.title) : { discover: msg("Beyond your workshop"), publish: msg("Share your creation"), profile: msg("Your journey"), challenges: "A new constraint. A new idea.", inbox: msg("The latest from your dungeons"), leaderboards: msg("Adventurer records"), drafts: msg("Cloud workshop"), moderation: msg("Community moderation"), shop: msg("Your architect collection"), worlds: msg("Worlds worth exploring"), team: msg("Build together") }[this.tab]}
          </h1>
        </div>
        ${btn("close", msg("Back to workshop"))}
      </header>
      <nav class="community-tabs" aria-label="Community">
        ${tabs.map((tab) => html`<button data-community="tab" data-value="${tab}" aria-current="${this.tab === tab ? "page" : "false"}">${tab[0].toUpperCase() + tab.slice(1)}</button>`).join("")}
      </nav>
      <p class="community-message" role="status" aria-live="polite"></p>
      <section class="community-body">${content}</section>`;
  }
  private message(message: string, error = false): void {
    const node = this.element.querySelector(".community-message");
    if (node) {
      node.textContent = message;
      node.classList.toggle("error", error);
    }
  }
  private auth(): string {
    return html`<div class="community-auth">
      <div>
        <p class="eyebrow">YOUR WORKSHOP TRAVELS WITH YOU</p>
        <h2>Build a reputation.</h2>
        <p>
          Save drafts, challenge other architects, and earn new possibilities
          through verified adventures.
        </p>
        <p>
          Your offline creations stay on this device until you choose to publish
          or save them.
        </p>
      </div>
      <form data-form="login">
        <h2>Sign in</h2>
        ${field("Handle", "handle", "", "text", 'required minlength="3" maxlength="24" autocomplete="username"')}${field("Password", "password", "", "password", 'required minlength="10" maxlength="128" autocomplete="current-password"')}<button
          class="button primary"
        >
          Sign in
        </button>
      </form>
      <form data-form="register">
        <h2>Create an account</h2>
        ${field("Handle", "handle", "", "text", 'required pattern="[a-zA-Z][a-zA-Z0-9_]{2,23}" maxlength="24" autocomplete="username"')}${field(msg("Display name"), "displayName", "", "text", 'required minlength="2" maxlength="40" autocomplete="nickname"')}${field("Password", "password", "", "password", 'required minlength="10" maxlength="128" autocomplete="new-password"')}<button
          class="button primary"
        >
          Create account
        </button>
      </form>
    </div>`;
  }
  private async render(): Promise<void> {
    this.detail = null;
    const generation = ++this.generation;
    if (
      !this.api.player &&
      !["discover", "leaderboards", "challenges", "worlds", "shop"].includes(
        this.tab,
      )
    ) {
      this.shell(this.auth());
      return;
    }
    let content = "";
    if (["shop", "worlds", "team"].includes(this.tab))
      content = await this.extras.render(this.tab);
    else if (this.tab === "discover") {
      const query = new URLSearchParams({
        category: this.category,
        search: this.search,
        tag: this.tag,
        difficulty: this.difficulty,
        cursor: String(this.cursor),
      });
      const feed = await this.api.request<{
        items: DungeonCard[];
        next: number | null;
      }>(`/dungeons?${query}`);
      const categories = [
        "recommended",
        "new",
        "trending",
        "challenging",
        "clever",
        "short",
        "long",
        "puzzle",
        "combat",
        "trap",
        "favorites",
        "following",
        "mine",
      ];
      content = html`<form data-form="search" class="discovery-filters">
          ${field(msg("Find a dungeon or share code"), "search", this.search, "search")}<label
            >Collection<select name="category">
              ${categories.map((c) => html`<option ${c === this.category ? "selected" : ""}>${c}</option>`).join("")}
            </select></label
          ><label
            >Style<select
              name="tag"
              multiple
              size="3"
              aria-label="Styles (combine up to five)"
            >
              <option value="">Any style</option>
              ${TAGS.map((t) => html`<option ${this.tag.split(",").includes(t) ? "selected" : ""}>${t}</option>`).join("")}
            </select></label
          ><label
            >Difficulty<select name="difficulty">
              <option value="">Any difficulty</option>
              ${["Uncalibrated", "Very easy", "Easy", "Moderate", "Hard", "Extreme"].map((t) => html`<option value="${t}" ${t === this.difficulty ? "selected" : ""}>${esc(msg(t))}</option>`).join("")}
            </select></label
          ><button class="button primary">Explore</button>
        </form>
        <div class="dungeon-feed">
          ${
            feed.items.map((c) => this.card(c)).join("") ||
            html`<div class="community-empty">
              <h2>A world waiting to be built</h2>
              <p>
                No dungeons match this collection yet. Publish a tested dungeon
                or explore another collection.
              </p>
            </div>`
          }
        </div>
        <div class="community-actions">
          ${this.cursor ? btn("page", "Previous", String(Math.max(0, this.cursor - 12))) : ""}${feed.next !== null ? btn("page", "Next", String(feed.next)) : ""}
        </div>`;
    } else if (this.tab === "publish") {
      const draft = this.hooks.draft();
      const challenges = await this.api.request<{
        challenges: BuildChallenge[];
      }>("/challenges");
      content = html`<form data-form="publish" class="community-form">
        <p class="eyebrow">
          ${this.hooks.proof() ? msg("ARCHITECT CLEAR VERIFIED LOCALLY") : msg("PLAYTEST REQUIRED")}
        </p>
        <h2>${esc(draft.title)}</h2>
        <p>
          Each publication preserves a version of your dungeon and its clear
          proof. Updates receive their own records.
        </p>
        <label
          >Description<textarea
            name="description"
            maxlength="500"
            rows="3"
            placeholder="What awaits adventurers?"
          ></textarea></label
        >${tags()}<label
          >Visibility<select name="visibility">
            <option value="public">Public — discoverable by everyone</option>
            <option value="unlisted">
              Unlisted — anyone with the share code
            </option>
            <option value="private">Private — only you</option>
          </select></label
        ><label
          >Building challenge<select name="challengeId">
            <option value="">No challenge</option>
            ${challenges.challenges.map((c) => html`<option value="${c.id}" ${c.id === this.challengeId ? "selected" : ""}>${esc(c.title)}</option>`).join("")}
          </select></label
        ><button class="button primary" ${this.hooks.proof() ? "" : "disabled"}>
          Publish online</button
        >${!this.hooks.proof() ? html`<p>Return to the workshop and complete this dungeon in Test mode first.</p>` : ""}
      </form>`;
    } else if (this.tab === "profile") {
      const p = this.api.player!;
      content = html`<div class="profile-overview">
          <p class="eyebrow">@${esc(p.handle)} / ARCHITECT LEVEL ${p.level}</p>
          <h2>${esc(p.displayName)}</h2>
          <progress
            max="${nextLevelXp(p.level)}"
            value="${p.xp}"
            aria-label="Architect experience"
          ></progress>
          <p>
            ${p.xp} / ${nextLevelXp(p.level)} XP toward level ${p.level + 1}
          </p>
          <div class="community-stats">
            <span><b>${p.gold}</b>Gold</span
            ><span><b>${p.materials}</b>Materials</span
            ><span><b>${p.essence}</b>Essence</span
            ><span><b>${p.followers}</b>Followers</span
            ><span><b>${p.completions}</b>Clears</span>
          </div>
        </div>
        <div class="community-columns">
          <form data-form="profile" class="community-form">
            ${field(msg("Display name"), "displayName", p.displayName, "text", 'required minlength="2" maxlength="40"')}${tags(p.interests)}<button
              class="button primary"
            >
              Save preferences</button
            >${btn("logout", msg("Sign out"))}
          </form>
          <section>
            <h2>Mastery</h2>
            ${
              Object.entries(p.mastery)
                .map(
                  ([k, v]) => html`<p>${esc(k)} <strong>${v} XP</strong></p>`,
                )
                .join("") ||
              html`<p>Build and complete dungeons to develop your mastery.</p>`
            }
            <h2>Achievements</h2>
            ${p.achievements.map((a) => html`<span class="community-tag">${esc(a.replaceAll("-", " "))}</span>`).join("") || html`<p>Your first achievement is ahead.</p>`}
          </section>
        </div>
        <h2>The worlds ahead</h2>
        <div class="era-track">
          ${ERAS.map(
            (e) =>
              html`<article
                class="panel ${p.level >= e.level ? "unlocked" : ""}"
              >
                <p class="eyebrow">LEVEL ${e.level}</p>
                <h3>${e.name}</h3>
                <p>${e.unlocks.join(" · ")}</p>
                <small
                  >${p.level >= e.level ? msg("Level reached") : msg("Keep creating and exploring")}</small
                >
              </article>`,
          ).join("")}
        </div>`;
    } else if (this.tab === "challenges") {
      const data = await this.api.request<{ challenges: BuildChallenge[] }>(
        "/challenges",
      );
      content = html`<div class="challenge-grid">
        ${data.challenges
          .map(
            (c) =>
              html`<article class="panel">
                <p class="eyebrow">${c.kind} architect challenge</p>
                <h2>${esc(c.title)}</h2>
                <p>${esc(c.description)}</p>
                <p>Ends ${esc(new Date(c.endsAt).toLocaleString())}</p>
                ${btn("build-challenge", msg("Enter this challenge"), c.id, true)}
                ${btn("submissions", msg("Explore submissions"), c.id)}
              </article>`,
          )
          .join("")}
      </div>`;
    } else if (this.tab === "inbox") {
      const [notifications, challenges] = await Promise.all([
        this.api.request<Notification[]>("/notifications"),
        this.api.request<FriendChallenge[]>("/friend-challenges"),
      ]);
      content = html`<h2>Friend challenges</h2>
        <div class="community-list">
          ${
            challenges
              .map(
                (c) =>
                  html`<article>
                    <div>
                      <h3>${esc(c.dungeonTitle)}</h3>
                      <p>
                        @${esc(c.sender)} → @${esc(c.recipient)} ·
                        ${esc(c.status)}
                      </p>
                    </div>
                    ${c.status === "pending" ? btn("play", msg("Take the challenge"), c.versionId) : ""}${
                      c.resultId
                        ? html`<p>
                              ${((c.ticks ?? 0) / 4).toFixed(1)}s |
                              ${c.damage ?? 0} damage | ${c.deaths ?? 0} deaths
                              | ${c.secrets ?? 0} secrets
                            </p>
                            ${btn("replay", msg("Watch result"), c.resultId)}`
                        : ""
                    }
                  </article>`,
              )
              .join("") ||
            html`<p>No friend challenges yet. Send one from a dungeon page.</p>`
          }
        </div>
        <h2>Notifications</h2>
        <div class="community-list">
          ${
            notifications
              .map(
                (n) =>
                  html`<article class="${n.read ? "read" : ""}">
                    <div>
                      <h3>${esc(n.kind.replaceAll("-", " "))}</h3>
                      <p>
                        ${esc(
                          Object.entries(n.payload)
                            .map(([k, v]) => `${k}: ${v}`)
                            .join(" · "),
                        )}
                      </p>
                      <small
                        >${esc(new Date(n.createdAt).toLocaleString())}</small
                      >
                    </div>
                    ${!n.read ? btn("read", msg("Mark read"), n.id) : ""}
                  </article>`,
              )
              .join("") ||
            html`<p>
              Activity from your creations and friends will appear here.
            </p>`
          }
        </div>`;
    } else if (this.tab === "leaderboards") {
      const rows = await this.api.request<LeaderboardEntry[]>(
        `/leaderboards?period=${this.boardPeriod}&metric=${this.boardMetric}&friends=${this.boardFriends}`,
      );
      content = html`<p>
          Verified best runs. Records are tied to the exact dungeon version.
        </p>
        <form data-form="records" class="discovery-filters">
          <label
            >Period<select name="period">
              ${["all", "daily", "weekly", "season"].map((v) => html`<option value="${v}" ${v === this.boardPeriod ? "selected" : ""}>${msg(v)}</option>`).join("")}
            </select></label
          ><label
            >Record<select name="metric">
              ${[
                ["speed", "Fastest completion"],
                ["deaths", "Fewest deaths before clear"],
                ["secrets", "Most secrets"],
                ["streak", "Longest clear streak"],
                ["health", "Most health remaining"],
                ["damage", "Least damage"],
                ["treasure", "Most treasure"],
                ["difficulty", "Highest challenge cleared"],
                ["survival", "Longest survival"],
              ]
                .map(
                  ([v, label]) =>
                    html`<option
                      value="${v}"
                      ${v === this.boardMetric ? "selected" : ""}
                    >
                      ${msg(label)}
                    </option>`,
                )
                .join("")}
            </select></label
          ><label
            ><input
              type="checkbox"
              name="friends"
              ${this.boardFriends ? "checked" : ""}
            />Creators I follow</label
          ><button class="button primary">Show records</button>
        </form>
        ${this.records(rows)}`;
    } else if (this.tab === "drafts") {
      const rows =
        await this.api.request<
          { dungeon: Dungeon; revision: number; updatedAt: string }[]
        >("/drafts");
      content = html`<p>
          Your current workshop:
          <strong>${esc(this.hooks.draft().title)}</strong>
        </p>
        ${btn("save-draft", msg("Save current draft to cloud"), "", true)}
        <div class="community-list">
          ${
            rows
              .map(
                (r) =>
                  html`<article>
                    <div>
                      <h3>${esc(r.dungeon.title)}</h3>
                      <p>
                        Revision ${r.revision} ·
                        ${esc(new Date(r.updatedAt).toLocaleString())}
                      </p>
                    </div>
                    ${btn("load-draft", msg("Open a copy in workshop"), r.dungeon.id)}
                  </article>`,
              )
              .join("") || html`<p>No cloud drafts yet.</p>`
          }
        </div>`;
    } else if (this.tab === "moderation") {
      const [reports, metrics] = await Promise.all([
        this.api.request<Record<string, unknown>[]>("/moderation/reports"),
        this.api.request<Record<string, unknown>>("/moderation/metrics"),
      ]);
      content = html`<h2>Reports</h2>
        <div class="community-list">
          ${
            reports
              .map(
                (r) =>
                  html`<article>
                    <div>
                      <h3>${esc(r.targetType)} · ${esc(r.targetId)}</h3>
                      <p>${esc(r.reason)} · ${esc(r.state)}</p>
                      <small>Report ${esc(r.id)}</small>
                    </div>
                  </article>`,
              )
              .join("") || html`<p>No reports.</p>`
          }
        </div>
        <form data-form="moderate" class="community-form">
          <label
            >Action<select name="action">
              ${["hide-dungeon", "restore-dungeon", "disable-publishing", "enable-publishing", "suspend-player", "restore-player", "resolve-report"].map((a) => html`<option>${a}</option>`).join("")}
            </select></label
          >${field(msg("Target identifier"), "targetId", "", "text", "required")}${field(msg("Reason (recorded in audit)"), "reason", "", "text", 'required minlength="10" maxlength="1000"')}<button
            class="button primary"
          >
            Apply moderation action
          </button>
        </form>
        <details>
          <summary>Operational metrics</summary>
          <pre>${esc(JSON.stringify(metrics, null, 2))}</pre>
        </details>`;
    }
    if (generation === this.generation) this.shell(content);
  }
  private card(c: DungeonCard): string {
    return html`<article class="community-card panel">
      <div class="card-art" aria-hidden="true">
        <span>${esc(c.title.slice(0, 1))}</span><i></i>
      </div>
      <div class="card-copy">
        <p class="eyebrow">${esc(c.difficulty)} · V${c.version}</p>
        <h2>${esc(c.title)}</h2>
        <p class="muted">by @${esc(c.author)}</p>
        <p>${esc(c.description || msg("An architect’s challenge awaits."))}</p>
        <div>
          ${c.tags.map((t) => html`<span class="community-tag">${t}</span>`).join("")}
        </div>
        <div class="card-metrics">
          <span>${c.attempts} attempts</span
          ><span>${Math.round(c.completionRate)}% clear</span
          ><span>${c.likes} likes</span>
        </div>
        ${btn("detail", msg("Explore dungeon"), `${c.id}|${c.versionId}`, true)}
      </div>
    </article>`;
  }
  private records(rows: LeaderboardEntry[]): string {
    return html`<div class="community-list">
      ${
        rows
          .map(
            (r) =>
              html`<article>
                <strong>#${r.rank}</strong>
                <div>
                  <h3>@${esc(r.player)}</h3>
                  <p>
                    ${esc(r.dungeon)} · ${(r.ticks / 4).toFixed(1)}s ·
                    ${r.health}
                    HP${r.metric !== "speed" ? ` | ${esc(r.metric)}: ${r.value}` : ""}
                  </p>
                </div>
                ${btn("creator", msg("Creator profile"), r.player)}
              </article>`,
          )
          .join("") ||
        html`<p>No verified clears yet. Set the first record.</p>`
      }
    </div>`;
  }
  private async showDetail(): Promise<void> {
    const d = this.detail!;
    const versionId = this.selectedVersion || d.card.versionId;
    const c =
      versionId === d.card.versionId
        ? d.card
        : await this.api.request<DungeonCard>(`/versions/${versionId}/card`);
    const [attempts, records] = await Promise.all([
      this.api.request<CommunityAttempt[]>(`/versions/${versionId}/attempts`),
      this.api.request<LeaderboardEntry[]>(
        `/leaderboards?versionId=${versionId}`,
      ),
    ]);
    const owner = this.api.player?.id === c.ownerId;
    this.shell(
      html`<div class="dungeon-detail">
        <section>
          <p class="eyebrow">BY @${esc(c.author)} · ${esc(c.difficulty)}</p>
          <p>${esc(c.description)}</p>
          <div>
            ${c.tags.map((t) => html`<span class="community-tag">${t}</span>`).join("")}
          </div>
          <div class="community-stats">
            <span><b>${c.attempts}</b>Attempts</span
            ><span><b>${Math.round(c.completionRate)}%</b>Clear rate</span
            ><span><b>${c.likes}</b>Likes</span
            ><span><b>${c.favorites}</b>Favorites</span>
          </div>
          <p>${c.fairness.map(esc).join(" · ")}</p>
          <p>
            Median clear: ${c.calibration.medianCompletionSeconds.toFixed(1)}s ·
            Average damage: ${Math.round(c.calibration.averageDamage)} · Repeat
            attempts: ${Math.round(c.calibration.retryRate)}%
          </p>
          <label
            >Dungeon version<select name="version">
              ${d.versions.map((v) => html`<option value="${v.id}" ${v.id === versionId ? "selected" : ""}>Version ${v.number} · ${v.attempts} attempts</option>`).join("")}
            </select></label
          >
          <div class="community-actions">
            ${btn("play", this.api.player ? msg("Enter dungeon") : msg("Sign in to play"), versionId, true)}${btn("like", c.liked ? "Unlike" : "Like", c.id)}${btn("favorite", c.favorited ? "Unfavorite" : "Favorite", c.id)}${!owner ? btn("follow", c.following ? msg("Unfollow creator") : msg("Follow creator"), c.author) : ""}
          </div>
          <p>Share code: <strong>${esc(c.shareCode)}</strong></p>
          ${btn("share", msg("Copy link"), c.shareCode)}${btn("share-sheet", msg("Share invite"), c.shareCode)}${btn("qr", msg("QR code"), c.shareCode)}${btn("creator", msg("Creator profile"), c.author)}
          <form data-form="challenge" class="community-form">
            <h3>Challenge a friend</h3>
            ${field(msg("Friend’s handle"), "recipient", "", "text", "required")}<button
              class="button outline"
            >
              Send challenge
            </button>
          </form>
          <details>
            <summary>Report this dungeon</summary>
            <form data-form="report">
              ${field("Reason", "reason", "", "text", 'required minlength="10" maxlength="1000"')}<button
                class="button outline"
              >
                Submit report
              </button>
            </form>
          </details>
          ${
            owner
              ? html`<form data-form="lifecycle" class="community-form">
                  <h3>Publication settings</h3>
                  <label
                    >Visibility<select name="visibility">
                      ${["public", "unlisted", "private"].map((v) => html`<option ${c.visibility === v ? "selected" : ""}>${v}</option>`).join("")}
                    </select></label
                  ><label
                    >Status<select name="lifecycle">
                      ${["published", "archived"].map((v) => html`<option ${c.lifecycle === v ? "selected" : ""}>${v}</option>`).join("")}
                    </select></label
                  ><button class="button outline">
                    Save publication settings
                  </button>
                </form>`
              : ""
          }
        </section>
        <section>
          <h2>Records</h2>
          ${this.records(records)}${btn("heatmap", msg("Inspect death heatmap"))}
          <h2>Recent attempts</h2>
          <div class="community-list">
            ${
              attempts
                .map(
                  (a) =>
                    html`<article>
                      <div>
                        <h3>@${esc(a.player)} · ${esc(a.outcome)}</h3>
                        <p>
                          ${(a.ticks / 4).toFixed(1)}s · ${a.health}
                          HP${a.death ? ` · fell at ${a.death.x + 1}, ${a.death.y + 1}` : ""}
                        </p>
                      </div>
                      ${btn("replay", msg("Watch replay"), a.id)}
                    </article>`,
                )
                .join("") || html`<p>No attempts yet.</p>`
            }
          </div>
        </section>
      </div>`,
    );
  }
  private async openDetail(id: string): Promise<void> {
    this.detail = await this.api.request<CommunityDungeon>(
      `/dungeons/${encodeURIComponent(id)}`,
    );
    this.selectedVersion = this.detail.card.versionId;
    await this.showDetail();
  }
  private async click(action: string, value: string): Promise<void> {
    if (action === "creator") {
      const p = await this.api.request<CreatorProfile>(
        `/players/${encodeURIComponent(value)}`,
      );
      this.detail = null;
      this.shell(
        html`<p class="eyebrow">CREATOR PROFILE</p>
          <h2>${esc(p.displayName)} <small>@${esc(p.handle)}</small></h2>
          <div class="community-stats">
            <span><b>${p.level}</b>Architect level</span
            ><span><b>${p.followers}</b>Followers</span
            ><span><b>${p.reputation.uniqueAdventurers}</b>Adventurers</span
            ><span><b>${p.reputation.attempts}</b>Attempts received</span
            ><span><b>${p.reputation.favorites}</b>Favorites received</span
            ><span><b>${p.reputation.clears}</b>Successful clears</span>
          </div>
          ${p.id !== this.api.player?.id ? btn("creator-follow", p.following ? "Unfollow creator" : "Follow creator", p.handle + "|" + String(!p.following)) : ""}
          <p>
            ${p.achievements.map((a) => html`<span class="community-tag">${esc(a.replaceAll("-", " "))}</span>`).join("")}
          </p>
          <details>
            <summary>Report player</summary>
            <form data-form="report-player">
              <input
                type="hidden"
                name="id"
                value="${p.id}"
              />${field("Reason", "reason", "", "text", 'required minlength="10" maxlength="1000"')}<button
                class="button outline"
              >
                Submit report
              </button>
            </form>
          </details>
          <h2>Published dungeons</h2>
          <div class="dungeon-feed">
            ${p.dungeons.map((c) => this.card(c)).join("") || html`<p>No public dungeons yet.</p>`}
          </div>`,
      );
      return;
    }
    if (action === "creator-follow") {
      if (!this.api.player) {
        this.tab = "profile";
        await this.render();
        return;
      }
      const [handle, enabled] = value.split("|");
      await this.api.request(`/players/${handle}/follow`, "POST", {
        enabled: enabled === "true",
      });
      await this.click("creator", handle);
      return;
    }
    if (action === "heatmap") {
      const data = await this.api.request<{
        dungeon: Dungeon;
        recordings: Omit<Replay, "dungeon">[];
        analytics: AnalyticsSnapshot;
      }>(`/versions/${this.selectedVersion}/recordings`);
      const recordings = data.recordings.map((r) =>
        parseReplay({ ...r, dungeon: data.dungeon }),
      );
      this.element.close();
      this.hooks.analyze(data.dungeon, recordings, data.analytics);
      return;
    }
    if (action.startsWith("extras:")) {
      if (!this.api.player && !["extras:campaign"].includes(action)) {
        this.tab = "profile";
        await this.render();
        return;
      }
      await this.extras.click(action.slice(7), value);
      return;
    }
    if (action === "close") {
      this.element.close();
      return;
    }
    if (action === "tab") {
      this.tab = value as Tab;
      await this.render();
    } else if (action === "detail") {
      const [id, version] = value.split("|");
      await this.openDetail(id);
      if (version) {
        this.selectedVersion = version;
        await this.showDetail();
      }
    } else if (action === "page") {
      this.cursor = Number(value);
      await this.render();
    } else if (action === "play") {
      if (!this.api.player) {
        this.tab = "profile";
        await this.render();
        return;
      }
      const ticket = await this.api.request<AttemptTicket>(
        `/versions/${value}/attempts`,
        "POST",
      );
      this.element.close();
      this.hooks.play(ticket);
    } else if (action === "replay") {
      const data = await this.api.request<Replay>(`/attempts/${value}/replay`);
      const replay = parseReplay(data);
      this.element.close();
      this.hooks.replay(replay);
    } else if (
      action === "like" ||
      action === "favorite" ||
      action === "follow"
    ) {
      if (!this.api.player) {
        this.tab = "profile";
        await this.render();
        return;
      }
      const c = this.detail!.card;
      if (action === "follow")
        await this.api.request(`/players/${value}/follow`, "POST", {
          enabled: !c.following,
        });
      else
        await this.api.request(`/dungeons/${value}/reactions`, "POST", {
          kind: action,
          enabled: action === "like" ? !c.liked : !c.favorited,
        });
      await this.openDetail(c.id);
    } else if (action === "logout") {
      await this.api.request("/auth/logout", "POST");
      this.api.player = null;
      await this.render();
    } else if (action === "read") {
      await this.api.request(`/notifications/${value}/read`, "POST");
      await this.render();
    } else if (action === "share") {
      this.hooks.track("DungeonShared");
      const url = new URL(
        Capacitor.isNativePlatform()
          ? String(import.meta.env.VITE_API_URL)
          : location.href,
      );
      url.hash = `dungeon=${value}`;
      await navigator.clipboard.writeText(url.toString());
      this.message(msg("Dungeon link copied."));
    } else if (action === "share-sheet") {
      const url = new URL(
        Capacitor.isNativePlatform()
          ? String(import.meta.env.VITE_API_URL)
          : location.href,
      );
      url.hash = `dungeon=${value}`;
      if ((await Share.canShare()).value)
        await Share.share({
          title: this.detail?.card.title ?? "Dungeon Architect",
          url: url.toString(),
        });
      else await this.click("share", value);
    } else if (action === "qr") {
      const url = new URL(
        Capacitor.isNativePlatform()
          ? String(import.meta.env.VITE_API_URL)
          : location.href,
      );
      url.hash = `dungeon=${value}`;
      const code = await QRCode.toDataURL(url.toString(), {
        width: 256,
        margin: 2,
        errorCorrectionLevel: "M",
      });
      this.shell(
        html`<h2>Invite an adventurer</h2>
          <img
            width="256"
            height="256"
            src="${code}"
            alt="Scan to open this dungeon"
          />
          <p>${esc(value)}</p>
          <p>${esc(url.toString())}</p>
          ${btn("detail", msg("Back to dungeon"), this.detail!.card.id)}`,
      );
    } else if (action === "build-challenge") {
      this.challengeId = value;
      this.tab = "publish";
      await this.render();
    } else if (action === "submissions") {
      const cards = await this.api.request<DungeonCard[]>(
        `/challenges/${encodeURIComponent(value)}/submissions`,
      );
      this.shell(
        html`<h2>Challenge submissions</h2>
          <div class="dungeon-feed">
            ${cards.map((c) => this.card(c)).join("") || html`<p>No submissions yet.</p>`}
          </div>`,
      );
    } else if (action === "save-draft") {
      const dungeon = this.hooks.draft();
      const result = await this.api.request<{ revision: number }>(
        `/drafts/${dungeon.id}`,
        "PUT",
        {
          dungeon,
          expectedRevision:
            this.revision.get(`${this.api.player!.id}/${dungeon.id}`) ?? 0,
        },
      );
      this.revision.set(
        `${this.api.player!.id}/${dungeon.id}`,
        result.revision,
      );
      try {
        localStorage.setItem(
          "da.cloud-revisions",
          JSON.stringify([...this.revision]),
        );
      } catch {
        /* The cloud write succeeded; future stale writes are still rejected. */
      }
      await this.render();
      this.message(msg("Draft saved to your account."));
    } else if (action === "load-draft") {
      const rows = await this.api.request<{ dungeon: Dungeon }[]>("/drafts");
      const draft = rows.find((r) => r.dungeon.id === value);
      if (draft) {
        this.element.close();
        this.hooks.load({ ...draft.dungeon, id: crypto.randomUUID() });
      }
    }
  }
  private async submit(action: string, form: FormData): Promise<void> {
    if (action.startsWith("extras:")) {
      await this.extras.submit(action.slice(7), form);
      return;
    }
    const value = (name: string) => String(form.get(name) ?? "");
    if (action === "records") {
      this.boardPeriod = value("period");
      this.boardMetric = value("metric");
      this.boardFriends = form.has("friends");
      await this.render();
      return;
    }
    if (action === "report-player") {
      await this.api.request("/reports", "POST", {
        targetType: "player",
        targetId: value("id"),
        reason: value("reason"),
      });
      this.message(msg("Report received for moderator review."));
      return;
    }
    if (action === "login" || action === "register") {
      this.api.player = await this.api.request<PlayerProfile>(
        `/auth/${action}`,
        "POST",
        Object.fromEntries(form),
      );
      await this.render();
      this.message(msg("You’re signed in."));
    } else if (action === "search") {
      this.hooks.track("DiscoverySearched");
      if (/^DA-[A-F0-9]+$/i.test(value("search").trim())) {
        await this.openDetail(value("search").trim().toUpperCase());
        return;
      }
      this.search = value("search");
      this.category = value("category");
      this.tag = form
        .getAll("tag")
        .map(String)
        .filter(Boolean)
        .slice(0, 5)
        .join(",");
      this.difficulty = value("difficulty");
      this.cursor = 0;
      await this.render();
    } else if (action === "profile") {
      this.api.player = await this.api.request<PlayerProfile>("/me", "PATCH", {
        displayName: value("displayName"),
        interests: form.getAll("tags"),
      });
      await this.render();
      this.message(msg("Preferences saved."));
    } else if (action === "publish") {
      const result = await this.api.request<CommunityDungeon>(
        "/dungeons/publish",
        "POST",
        {
          dungeon: this.hooks.draft(),
          proof: this.hooks.proof(),
          description: value("description"),
          tags: form.getAll("tags"),
          visibility: value("visibility"),
          ...(value("challengeId")
            ? { challengeId: value("challengeId") }
            : {}),
        },
      );
      await this.api.refresh();
      this.detail = result;
      this.selectedVersion = result.card.versionId;
      await this.showDetail();
      this.message(msg("Published. Your clear was verified by the server."));
    } else if (action === "challenge") {
      await this.api.request("/friend-challenges", "POST", {
        handle: value("recipient"),
        versionId: this.selectedVersion,
      });
      this.message(msg("Challenge sent. You’ll see the result in your inbox."));
    } else if (action === "report") {
      await this.api.request("/reports", "POST", {
        targetType: "dungeon",
        targetId: this.detail!.card.id,
        reason: value("reason"),
      });
      this.message(msg("Report received for moderator review."));
    } else if (action === "lifecycle") {
      const id = this.detail!.card.id;
      await this.api.request(
        `/dungeons/${id}`,
        "PATCH",
        Object.fromEntries(form),
      );
      await this.openDetail(id);
      this.message(msg("Publication settings saved."));
    } else if (action === "moderate") {
      await this.api.request(
        "/moderation/actions",
        "POST",
        Object.fromEntries(form),
      );
      await this.render();
      this.message(msg("Moderation action recorded."));
    }
  }
  async openShare(code: string): Promise<void> {
    if (!this.open) this.element.showModal();
    this.shell(html`<p>Opening dungeon…</p>`);
    await this.run(async () => {
      await this.api.refresh();
      await this.openDetail(code);
    });
  }
}
