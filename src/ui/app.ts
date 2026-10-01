import { html, msg } from "./localization";
import { cameraFrame } from "./camera";
import { ROOM_TOOLS } from "../core/rooms";
import type { RoomTool } from "../core/rooms";
import { TEMPLATES, createTemplate } from "../core/templates";
import { WorkshopTools } from "./workshop-tools";
import { isAdvancedObject } from "../core/configuration";
import { CommunityApi } from "../services/community";
import { Telemetry } from "../services/telemetry";
import { CommunityHub } from "./community";
import type { AttemptTicket } from "../shared/community";
import { CONTENT } from "../core/content";
import {
  budgetUsed,
  createDungeon,
  createStarter,
  fingerprint,
  objectAt,
  parseDungeon,
} from "../core/dungeon";
import { Editor } from "../core/editor";
import { simulateAdventurer } from "../core/adventurers";
import { reconstructReplay, Simulation } from "../core/simulation";
import { DIRECTIONS, TICK_MS } from "../core/types";
import type {
  Action,
  Category,
  Direction,
  Dungeon,
  Point,
  Replay,
  Tool,
} from "../core/types";
import { validateDungeon } from "../core/validation";
import {
  analyze,
  readAnalytics,
  improvementIdeas,
} from "../services/analytics";
import type { DungeonAnalytics } from "../services/analytics";
import { Library } from "../services/library";
import { GameAudio } from "./audio";
import { icon } from "./icons";
import { duration, errorText, t } from "./i18n";
import { DungeonRenderer } from "./renderer";

type Mode = "build" | "test" | "analytics" | "replay";
const escape = (value: unknown): string =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
const button = (
  action: string,
  label: string,
  glyph?: string,
  classes = "",
  disabled = false,
): string =>
  html`<button
    type="button"
    data-action="${action}"
    class="button ${classes}"
    ${disabled ? "disabled" : ""}
  >
    ${glyph ? icon(glyph) : ""}<span>${escape(msg(label))}</span>
  </button>`;
const iconButton = (
  action: string,
  label: string,
  glyph: string,
  active = false,
  disabled = false,
): string =>
  html`<button
    type="button"
    data-action="${action}"
    class="icon-button ${active ? "active" : ""}"
    title="${escape(label)}"
    aria-label="${escape(label)}"
    ${disabled ? "disabled" : ""}
  >
    ${icon(glyph)}
  </button>`;

export class App {
  openInvite(value: string): void {
    try {
      const url = new URL(value);
      const code =
        url.protocol === "dungeonarchitect:" && url.hostname === "dungeon"
          ? url.pathname.slice(1)
          : new URLSearchParams(url.hash.slice(1)).get("dungeon");
      if (code && /^DA-[A-F0-9]{10}$/i.test(code))
        void this.community.openShare(code.toUpperCase());
    } catch {
      /* Unknown deep links do not alter the workshop. */
    }
  }
  private library = new Library({
    getItem: (key) => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, value),
  });
  private editor = new Editor(this.library.data.draft);
  private audio = new GameAudio();
  private renderer!: DungeonRenderer;
  private mode: Mode = "build";
  private category: Category = "rooms";
  private tool: Tool = "room";
  private selected: string[] = [];
  private placement: "move" | "duplicate" | null = null;
  private clipboard: ReturnType<Editor["copy"]> | null = null;
  private pasting = false;
  private hiddenLayers = new Set<Category>();
  private touches = new Map<number, { x: number; y: number }>();
  private gesture: {
    distance: number;
    zoom: number;
    worldX: number;
    worldY: number;
  } | null = null;
  private pendingTouch: Point | null = null;
  private touchOrigin: Point | null = null;
  private longPress = 0;
  private blockContextRelease = false;
  private rotation = 0;
  private hover: Point | null = null;
  private cursor: Point = { x: 2, y: 2 };
  private showCursor = false;
  private drawing = false;
  private lastPaint = "";
  private lastPaintError = "";
  private panStart: {
    x: number;
    y: number;
    panX: number;
    panY: number;
  } | null = null;
  private simulation: Simulation | null = null;
  private testRecorded = false;
  private replay: Replay | null = null;
  private replayTick = 0;
  private replayPlaying = false;
  private followCamera = true;
  private replaySpeed = 1;
  private replayElapsed = 0;
  private lastFrame = 0;
  private selectedVersion = this.library.latest()?.id ?? "";
  private heatmap = true;
  private analytics: DungeonAnalytics = analyze([]);
  private analyticsSignature = "";
  private communityAnalysis: {
    dungeon: Dungeon;
    recordings: Replay[];
    summary?: DungeonAnalytics;
  } | null = null;
  private toastTimer = 0;
  private reducedMotionMedia = matchMedia("(prefers-reduced-motion: reduce)");
  private toastElement = document.createElement("div");
  private dialog = document.createElement("dialog");
  private pendingImport: Dungeon | null = null;
  private communityApi = new CommunityApi();
  private telemetry = new Telemetry(this.communityApi);
  private editorOpenedAt = performance.now();
  private onlineTicket: AttemptTicket | null = null;
  private onlineMessage = "";
  private community!: CommunityHub;
  private mechanics!: WorkshopTools;
  private floor = 0;
  private submitting = false;
  private outbox: {
    id: string;
    playerId: string;
    actions: Action[];
    abandon: boolean;
    replay?: Replay;
    expiresAt?: string;
    lastError?: string;
  }[] = [];

  constructor(private root: HTMLDivElement) {
    try {
      this.outbox = JSON.parse(
        localStorage.getItem("da.online-outbox") ?? "[]",
      );
      if (!Array.isArray(this.outbox)) this.outbox = [];
      this.outbox = this.outbox.filter(
        (r) =>
          r &&
          typeof r.id === "string" &&
          typeof r.playerId === "string" &&
          Array.isArray(r.actions) &&
          r.actions.length <= 2400 &&
          typeof r.abandon === "boolean",
      );
    } catch {
      this.outbox = [];
    }
    this.mechanics = new WorkshopTools(
      () => this.editor,
      () => {
        this.telemetry.track("MechanicConfigured");
        this.changed(false);
      },
    );
    this.community = new CommunityHub(this.communityApi, {
      track: (event) => this.telemetry.track(event),
      draft: () => this.editor.dungeon,
      proof: () => (this.library.tested ? this.library.data.certificate : null),
      play: (ticket) => this.startOnline(ticket),
      replay: (replay) => this.showOnlineReplay(replay),
      analyze: (dungeon, recordings, snapshot) => {
        this.recordTest();
        this.communityAnalysis = {
          dungeon,
          recordings,
          summary: readAnalytics(snapshot),
        };
        this.selectedVersion = recordings[0]?.dungeonVersionId ?? "";
        this.mode = "analytics";
        this.render();
        this.renderer.fit();
      },
      load: (dungeon) => {
        this.recordTest();
        this.onlineTicket = null;
        this.backupDraft();
        this.editor = new Editor(dungeon);
        this.library.updateDraft(dungeon);
        this.mode = "build";
        this.selected = [];
        this.render();
        this.renderer.fit();
      },
      closed: () => this.render(),
    });
    this.audio.enabled = this.library.data.preferences.sound;
    this.telemetry.track("EditorOpened");
    this.toastElement.className = "toast";
    this.toastElement.setAttribute("role", "status");
    this.toastElement.setAttribute("aria-live", "polite");
    document.body.append(this.toastElement);
    this.dialog.className = "dialog";
    this.dialog.addEventListener("pointerdown", () => {
      this.blockContextRelease = false;
    });
    document.body.append(this.dialog);
    this.root.addEventListener("click", (event) => this.click(event));
    this.root.addEventListener("change", (event) => this.change(event));
    this.root.addEventListener("input", (event) => {
      if ((event.target as HTMLElement).id === "replay-position") {
        this.replayPlaying = false;
        this.seek(Number((event.target as HTMLInputElement).value));
      }
    });
    this.root.addEventListener("pointerdown", (event) =>
      this.pointerDown(event),
    );
    document.addEventListener("pointermove", (event) =>
      this.pointerMove(event),
    );
    document.addEventListener("pointerup", (event) => {
      clearTimeout(this.longPress);
      if (this.pendingTouch && !this.gesture)
        this.paint(this.pendingTouch, this.tool);
      this.pendingTouch = null;
      this.touches.delete(event.pointerId);
      if (!this.touches.size) this.gesture = null;
      this.drawing = false;
      this.panStart = null;
    });
    document.addEventListener("pointercancel", (event) => {
      clearTimeout(this.longPress);
      this.pendingTouch = null;
      this.touches.delete(event.pointerId);
      if (!this.touches.size) this.gesture = null;
      this.drawing = false;
      this.panStart = null;
    });
    this.root.addEventListener("contextmenu", (event) => {
      if ((event.target as HTMLElement).tagName === "CANVAS")
        event.preventDefault();
    });
    document.addEventListener("keydown", (event) => this.keyDown(event));
    this.root.addEventListener(
      "wheel",
      (event) => {
        if (
          (event.target as HTMLElement).tagName !== "CANVAS" ||
          !event.ctrlKey
        )
          return;
        event.preventDefault();
        this.renderer.zoom = Math.max(
          0.7,
          Math.min(2.2, this.renderer.zoom + (event.deltaY < 0 ? 0.1 : -0.1)),
        );
      },
      { passive: false },
    );
    this.render();
    if (this.library.warning) this.toast(t("storage.loadFailed"), true);
    requestAnimationFrame((time) => this.frame(time));
    const shared = new URLSearchParams(location.hash.slice(1)).get("dungeon");
    if (shared) void this.community.openShare(shared);
    window.addEventListener("online", () => {
      void this.flushOutbox();
    });
  }
  private get activeDungeon(): Dungeon {
    return this.mode === "test" && this.simulation
      ? this.simulation.dungeon
      : this.mode === "replay" && this.replay
        ? this.replay.dungeon
        : this.mode === "analytics"
          ? (this.communityAnalysis?.dungeon ??
            this.library.data.versions.find(
              (v) => v.id === this.selectedVersion,
            )?.dungeon ??
            this.editor.dungeon)
          : this.editor.dungeon;
  }
  private get attempts(): Replay[] {
    if (this.communityAnalysis) return this.communityAnalysis.recordings;
    return this.library.data.attempts.filter(
      (a) => a.dungeonVersionId === this.selectedVersion,
    );
  }
  private get reducedMotion(): boolean {
    return (
      this.library.data.preferences.reducedMotion ||
      this.reducedMotionMedia.matches
    );
  }

  private render(): void {
    const previousCanvas = this.renderer?.canvas;
    const canvasFocused = document.activeElement === previousCanvas;
    const oldZoom = this.renderer?.zoom ?? 1;
    const oldPan = this.renderer?.pan ?? { x: 0, y: 0 };
    this.floor = Math.min(this.floor, this.activeDungeon.height / 13 - 1);
    const attempts = this.attempts;
    const signature = attempts.map((a) => a.id).join(",");
    if (
      signature !== this.analyticsSignature ||
      this.communityAnalysis?.summary
    ) {
      this.analytics = this.communityAnalysis?.summary ?? analyze(attempts);
      this.analyticsSignature = signature;
    }
    const dungeon = this.activeDungeon;
    const used = budgetUsed(this.editor.dungeon);
    const validation = validateDungeon(this.editor.dungeon);
    const latest = this.library.latest();
    const isPublished =
      latest &&
      fingerprint(latest.dungeon) === fingerprint(this.editor.dungeon);
    const versionLabel = isPublished
      ? `${t("status.published")} · v${latest.number}`
      : latest
        ? t("status.updated")
        : t("status.draft");
    const tutorial = this.library.data.preferences.tutorialStep;
    if (tutorial !== undefined) {
      const d = this.editor.dungeon;
      let next = tutorial;
      if (tutorial === 0 && this.library.tested) next = 1;
      if (
        tutorial === 1 &&
        d.objects.some((o) => CONTENT[o.type].behavior === "trap")
      )
        next = 2;
      if (
        tutorial === 2 &&
        d.objects.some((o) => o.type === "key") &&
        d.objects.some((o) => o.type === "door")
      )
        next = 3;
      if (tutorial === 3 && this.library.latest()) next = 4;
      if (tutorial === 4 && this.attempts.length) next = 5;
      if (tutorial === 5 && this.mode === "replay") next = 6;
      if (next !== tutorial) {
        this.telemetry.track("TutorialStep", next);
        this.library.data.preferences.tutorialStep = next;
        this.library.persist();
      }
    }
    document.body.classList.toggle(
      "high-contrast",
      !!this.library.data.preferences.contrast,
    );
    document.body.classList.toggle(
      "large-text",
      this.library.data.preferences.textScale === 125,
    );
    this.root.innerHTML = html` <header class="site-header">
        <a class="brand" href="#" data-action="build"
          >${icon("castle")}<span
            >${t("brand.first")}<span class="brand-second"
              >${t("brand.second")}</span
            ></span
          ></a
        >
        <nav aria-label="${t("nav.label")}">
          <button
            data-action="build"
            class="nav-link ${this.mode === "build" || this.mode === "test" ? "active" : ""}"
          >
            ${t("nav.workshop")}</button
          ><button
            data-action="analytics"
            class="nav-link ${this.mode === "analytics" || this.mode === "replay" ? "active" : ""}"
          >
            ${t("nav.attempts")}<span class="nav-count"
              >${this.library.data.attempts.length}</span
            ></button
          ><button data-action="community" class="nav-link">Community</button
          ><button data-action="guide" class="nav-link">
            ${t("nav.guide")}
          </button>
        </nav>
        <div class="header-right">
          <span class="local-label"
            ><i></i
            >${this.communityApi.player ? escape(this.communityApi.player.displayName) : t("status.local")}</span
          >${iconButton("sound", t("action.sound"), this.audio.enabled ? "sound" : "mute", this.audio.enabled)}
        </div>
      </header>
      <main>
        <section class="page-heading">
          <div>
            <p class="eyebrow">
              ${this.mode === "analytics" || this.mode === "replay" ? t("analytics.title").toUpperCase() : t("hero.eyebrow")}
              <span>/ ${t("theme.cave").toUpperCase()}</span>
            </p>
            <h1>
              ${this.mode === "analytics" ? t("analytics.subtitle") : this.mode === "replay" ? t("replay.title") : t("hero.title")}
            </h1>
            <p class="subtitle">
              ${this.mode === "analytics" || this.mode === "replay" ? t("analytics.local") : t("hero.subtitle")}
            </p>
          </div>
          <div class="heading-actions">
            ${button("import", t("action.import"), "upload", "quiet")}${button("new", t("action.new"), "plus", "outline")}
          </div>
        </section>
        <section class="workspace ${this.mode}">
          <aside class="palette panel">
            ${this.mode === "build" ? this.palette(used) : this.mode === "test" ? this.testSidebar() : this.attemptSidebar()}
          </aside>
          <section class="dungeon-panel panel">
            <div class="dungeon-title">
              <div class="dungeon-name">
                ${icon("leaf")}
                <div>
                  ${this.mode === "build" ? html`<input id="dungeon-title" maxlength="60" aria-label="${t("dungeon.name")}" value="${escape(dungeon.title)}" />` : html`<h2>${escape(dungeon.title)}</h2>`}<span
                    >${escape(dungeon.theme.replaceAll("-", " "))} | Floor
                    ${this.mode === "test" || this.mode === "replay" ? Math.floor((this.simulation?.state.player.y ?? 0) / 13) + 1 : this.floor + 1}</span
                  >
                </div>
              </div>
              <span class="status-pill ${isPublished ? "published" : ""}"
                >${this.mode === "build" ? escape(versionLabel) : this.mode === "test" ? t("run.testBadge") : this.mode === "replay" ? t("run.replayBadge") : `v${this.library.data.versions.find((v) => v.id === this.selectedVersion)?.number ?? "—"}`}</span
              >
            </div>
            <div class="canvas-toolbar">
              <div class="toolbar-left">
                ${this.mode === "build" ? html`${iconButton("select", t("tool.select"), "select", this.tool === "select")}${iconButton("undo", t("action.undo"), "undo", false, !this.editor.canUndo)}${iconButton("redo", t("action.redo"), "redo", false, !this.editor.canRedo)}<span class="divider"></span>${iconButton("grid", t("action.grid"), "grid", this.library.data.preferences.showGrid)}` : button("build", t("action.back"), "back", "quiet small")}${this.mode === "analytics" ? iconButton("heatmap", t("action.heatmap"), "fire", this.heatmap) : ""}
              </div>
              <div class="toolbar-right">
                ${
                  dungeon.height > 13
                    ? html`<select id="floor-select" aria-label="Edit floor">
                        ${Array.from({ length: dungeon.height / 13 }, (_, i) => html`<option value="${i}" ${i === this.floor ? "selected" : ""}>Floor ${i + 1}</option>`).join("")}
                      </select>`
                    : ""
                }${this.mode === "test" || this.mode === "replay" ? `${iconButton("camera-follow", msg("Follow adventurer"), "eye", this.followCamera)}${iconButton("camera-overview", msg("Floor overview"), "grid", !this.followCamera)}` : ""}${iconButton("zoom-out", t("action.zoomOut"), "zoomOut")}${iconButton("fit", t("action.fit"), "fit")}${iconButton("zoom-in", t("action.zoomIn"), "zoomIn")}
              </div>
            </div>
            <div class="canvas-wrap">
              <canvas
                id="dungeon-canvas"
                tabindex="0"
                role="application"
                aria-label="${t("canvas.label")}"
              ></canvas
              >${this.mode === "test" && this.simulation?.state.status !== "playing" ? this.runOverlay() : ""}<span
                class="map-compass"
                >N<span>↑</span></span
              >
            </div>
            <div class="canvas-caption">
              <span
                >${icon(this.mode === "build" ? "select" : this.mode === "test" ? "play" : "eye")}
                ${this.mode === "build" ? t("canvas.hint") : this.mode === "test" ? t("canvas.testHint") : t("canvas.replayHint")}</span
              ><span class="map-size">15 × 13</span>
            </div>
            ${
              this.mode === "test"
                ? this.touchControls()
                : this.mode === "replay"
                  ? this.replayControls()
                  : this.mode === "analytics"
                    ? html`<div class="heatmap-legend">
                        <span
                          ><i class="legend-visited"></i
                          >${t("analytics.traffic")}</span
                        ><span
                          ><i class="legend-death"></i
                          >${t("analytics.deathLegend")}</span
                        >
                      </div>`
                    : html`<div class="build-actions">
                        <span
                          class="save-status ${this.library.warning ? "warning" : ""}"
                          >${icon(this.library.warning ? "flag" : "check")}${t(this.library.warning ? "status.unsaved" : "status.saved")}</span
                        >${button("test", t("action.test"), "play", "primary")}
                      </div>`
            }
          </section>
          <aside class="inspector">
            ${this.mode === "build" ? this.buildInspector(validation.valid) : this.mode === "test" ? this.runInspector() : this.mode === "replay" ? this.replayInspector() : this.analyticsInspector()}
          </aside>
        </section>
        <footer class="site-footer">
          <span>${icon("castle")}${t("app.tagline")}</span>
          <div>
            ${button("advanced", msg("Advanced workshop"), "grid", "quiet small")}${button("logic", msg("Visual logic"), "objects", "quiet small")}${this.selected.length === 1 ? button("configure", msg("Object settings"), "select", "quiet small") : ""}${button("community", msg("Community"), "castle", "quiet small")}${button("publish-online", msg("Publish online"), "flag", "quiet small")}${this.outbox.length ? button("sync-runs", msg("Sync pending runs"), "upload", "quiet small") : ""}${button("guide", t("nav.guide"), "book", "quiet small")}${button("import", t("action.import"), "upload", "quiet small mobile-only")}${button("export", t("action.export"), "download", "quiet small")}${button("layers", msg("Layers"), undefined, "quiet small")}${this.clipboard ? button("paste", msg("Paste"), undefined, "quiet small") : ""}${button("usage", msg("Usage analytics"), undefined, "quiet small")}${button("backups", msg("Recover a draft"), "book", "quiet small")}${button("tutorial", msg("First steps"), "book", "quiet small")}${button("contrast", msg("High contrast"), undefined, "quiet small")}${button("text-size", msg("Larger text"), undefined, "quiet small")}${button("motion", t("action.motion"), undefined, `quiet small ${this.library.data.preferences.reducedMotion ? "active" : ""}`)}
          </div>
        </footer>
      </main>`;
    const placeholder =
      this.root.querySelector<HTMLCanvasElement>("#dungeon-canvas")!;
    if (previousCanvas) placeholder.replaceWith(previousCanvas);
    else this.renderer = new DungeonRenderer(placeholder);
    if (canvasFocused) this.renderer.canvas.focus({ preventScroll: true });
    this.renderer.zoom = oldZoom;
    this.renderer.pan = oldPan;
    this.root.classList.toggle("reduced-motion", this.reducedMotion);
    if (this.mode === "replay") this.updateReplayUI();
  }

  private palette(used: number): string {
    const categories: Category[] = [
      "rooms",
      "traps",
      "monsters",
      "objects",
      ...(this.editor.dungeon.schemaVersion === 2
        ? ([
            "structural",
            "puzzle",
            "utility",
            "environment",
            "decor",
          ] as Category[])
        : []),
    ];
    const tools: Tool[] =
      this.category === "rooms"
        ? [
            ...(this.editor.dungeon.schemaVersion === 2
              ? (Object.keys(ROOM_TOOLS) as RoomTool[])
              : (["room"] as RoomTool[])),
            "floor",
            "wall",
            "erase",
          ]
        : Object.values(CONTENT)
            .filter(
              (d) =>
                d.category === this.category &&
                (this.editor.dungeon.schemaVersion === 2 ||
                  !isAdvancedObject(d.id)),
            )
            .map((d) => d.id);
    const toolName = Object.hasOwn(CONTENT, this.tool)
      ? t(`object.${this.tool}`)
      : t(`tool.${this.tool}`);
    return html`<div class="panel-heading">
        <p class="eyebrow">${t("kit.title")}</p>
        <span class="tiny-diamond">◇</span>
      </div>
      <div
        class="category-tabs"
        role="group"
        aria-label="${t("kit.categories")}"
      >
        ${categories.map((category) => html`<button data-category="${category}" class="category ${this.category === category ? "active" : ""}" aria-pressed="${this.category === category}">${icon(category)}<span>${t(`category.${category}`)}</span></button>`).join("")}
      </div>
      <p class="palette-hint">${t("kit.hint")}</p>
      <div class="tool-grid">
        ${tools
          .map((tool) => {
            const cost = Object.hasOwn(CONTENT, tool)
              ? CONTENT[tool as keyof typeof CONTENT].cost
              : Object.hasOwn(ROOM_TOOLS, tool)
                ? ROOM_TOOLS[tool as RoomTool].width *
                  ROOM_TOOLS[tool as RoomTool].height
                : tool === "floor"
                  ? 1
                  : 0;
            return html`<button
              data-tool="${tool}"
              class="tool-card ${this.tool === tool ? "active" : ""}"
              aria-pressed="${this.tool === tool}"
              title="${escape(t(`desc.${tool}`))}"
            >
              <span class="tool-cost">${cost > 0 ? `${cost} ◇` : "—"}</span
              >${icon(tool)}<span
                >${escape(Object.hasOwn(CONTENT, tool) ? t(`object.${tool}`) : t(`tool.${tool}`))}</span
              >
            </button>`;
          })
          .join("")}
      </div>
      <div class="selected-description">
        <span class="eyebrow">${t("kit.selected")}</span>
        <h3>${escape(toolName)}</h3>
        <p>${escape(t(`desc.${this.tool}`))}</p>
      </div>
      <div class="budget-box">
        <div>
          <span>${t("kit.budget")}</span
          ><strong>${used}<span> / ${this.editor.dungeon.budget}</span></strong>
        </div>
        <div class="budget-track">
          <i
            style="width:${(used / this.editor.dungeon.budget) * 100}%"
            class="${used > 145 ? "near-limit" : ""}"
          ></i>
        </div>
        <p>
          ${t("kit.available", { count: this.editor.dungeon.budget - used })}
        </p>
      </div>`;
  }
  private buildInspector(valid: boolean): string {
    const issues = validateDungeon(this.editor.dungeon).issues;
    const selected = this.editor.dungeon.objects.filter((o) =>
      this.selected.includes(o.id),
    );
    return html`<section class="note-card">
        <div class="note-illustration">${icon("castle")}<span>✧</span></div>
        <p class="eyebrow">${t("insight.title")}</p>
        <h2>${this.tutorialCopy().title}</h2>
        <p>${this.tutorialCopy().body}</p>
        ${this.library.data.preferences.tutorialStep === undefined ? button("tutorial", msg("Learn in 7 steps"), "book", "outline full") : ""}
        <div class="note-rule"><span>◇</span></div>
      </section>
      ${
        selected.length
          ? html`<section class="selection-card panel">
              <p class="eyebrow">
                ${selected.length === 1 ? t(`object.${selected[0].type}`) : t("kit.selectionCount", { count: selected.length })}
              </p>
              <p>
                ${this.placement ? t(`editor.${this.placement}Hint`) : selected.length === 1 ? t(`desc.${selected[0].type}`) : t("desc.select")}
              </p>
              <div class="selection-actions">
                ${iconButton("move", t("action.move"), "move", this.placement === "move")}${iconButton("duplicate", t("action.duplicate"), "duplicate", this.placement === "duplicate")}${iconButton("rotate", t("action.rotate"), "rotate")}${iconButton("delete", t("action.delete"), "delete")}${button("copy", msg("Copy"), undefined, "quiet small")}${button("mirror-h", msg("Mirror horizontally"), undefined, "quiet small")}${button("mirror-v", msg("Mirror vertically"), undefined, "quiet small")}
              </div>
              ${selected.length === 1 ? button("configure", msg("Object settings"), "select", "outline full") : ""}
            </section>`
          : ""
      }
      <section class="publish-card panel">
        <h3>${t("check.title")}</h3>
        <ul class="checklist">
          <li
            class="${!issues.some((i) => ["entrance", "treasure", "unreachable", "floor"].includes(i.code)) ? "done" : ""}"
          >
            ${icon("check")}${t("check.layout")}
          </li>
          <li
            class="${!issues.some((i) => ["key", "spawn", "budget"].includes(i.code)) ? "done" : ""}"
          >
            ${icon("check")}${t("check.keys")}
          </li>
          <li class="${this.library.tested ? "done" : ""}">
            ${icon("check")}${t("check.test")}
          </li>
        </ul>
        ${button("validate", t("action.validate"), undefined, "text-button")}
        <p>
          ${this.library.tested && valid ? t("check.ready") : t("check.testHint")}
        </p>
        ${button("publish", t(this.library.latest() ? "action.republish" : "action.publish"), "flag", "gold full", !this.library.tested || !valid)}
      </section>
      ${this.library.data.practice.some((r) => r.dungeon.id === this.editor.dungeon.id) ? button("watch-test", t("action.watchTest"), "eye", "outline full") : ""}
      <section class="mini-stats">
        <span
          >${icon("eye")}
          ${t("analytics.adventureCount", { count: this.library.data.attempts.filter((a) => a.dungeon.id === this.editor.dungeon.id).length })}</span
        >${button("analytics", t("analytics.title"), "arrow", "quiet small")}
      </section>`;
  }
  private tutorialCopy(): { title: string; body: string } {
    const lessons = [
      {
        title: "1. Make your first path.",
        body: msg(
          "Carve a room and corridor. Place an entrance, a skeleton, and treasure. Test it and reach the treasure.",
        ),
      },
      {
        title: "2. Give danger a purpose.",
        body: msg(
          "Open Traps and place spikes on a floor tile. Leave room for an adventurer to react.",
        ),
      },
      {
        title: "3. Build a reason to explore.",
        body: msg(
          "Place a key and a door. Keep the key reachable before its door, and offer another route when you can.",
        ),
      },
      {
        title: "4. Prove it, then publish.",
        body: msg(
          "Complete a fresh test of your changes. Publish dungeon preserves your first version; Publish online shares it with the community.",
        ),
      },
      {
        title: "5. Invite an adventurer.",
        body: msg(
          "Open Attempts and choose Invite 6 adventurers to see different play styles tackle your published layout.",
        ),
      },
      {
        title: "6. Watch what happened.",
        body: msg(
          "Select an attempt to open its replay. Pause, scrub the timeline, and jump to a death or important event.",
        ),
      },
      {
        title: "7. Now make it better.",
        body: msg(
          "Use what you learned to change the dungeon. Retest and publish a new version. Your earlier attempts remain attached to the original.",
        ),
      },
    ];
    const lesson = lessons[
      this.library.data.preferences.tutorialStep ?? -1
    ] ?? {
      title: t("insight.heading"),
      body: t("insight.body"),
    };
    return { title: msg(lesson.title), body: msg(lesson.body) };
  }
  private testSidebar(): string {
    return html`<div class="panel-heading">
        <p class="eyebrow">${t("run.adventurer")}</p>
        ${icon("play")}
      </div>
      <div class="adventurer-portrait">${icon("guardian")}</div>
      <h3 class="center">
        ${this.onlineTicket ? msg("Community adventure") : t("run.playing")}
      </h3>
      <p class="palette-hint">
        ${this.onlineTicket ? msg("Finish to record your verified score.") : t("check.testHint")}
      </p>
      <div class="play-instructions">
        <div><kbd>W A S D</kbd><span>${t("run.arrowHint")}</span></div>
        <div><kbd>SPACE</kbd><span>${t("action.attack")}</span></div>
        <div><kbd>E</kbd><span>${t("action.wait")}</span></div>
      </div>
      <p class="test-tip">${t("run.tip")}</p>
      ${button("restart", t("action.restart"), "rotate", "outline full")}`;
  }
  private runInspector(): string {
    const state = this.simulation!.state;
    const advanced = state.advanced;
    const events = state.events
      .filter((e) => !["move", "spawn", "attack"].includes(e.kind))
      .slice(-6)
      .reverse();
    return html`<section class="run-stats panel">
        <p class="eyebrow">${t("run.health")}</p>
        <div class="health-value">
          ${icon("heart")}<strong
            >${state.player.hp}<span> / ${state.player.maxHp}</span></strong
          >
        </div>
        <div class="health-track">
          <i style="width:${(state.player.hp / state.player.maxHp) * 100}%"></i>
        </div>
        <div class="run-stat">
          <span>${icon("clock")}${t("run.time")}</span
          ><strong>${duration((state.tick * TICK_MS) / 1000)}</strong>
        </div>
        <div
          class="run-stat key-stat ${state.player.hasKey ? "collected" : ""}"
        >
          ${icon("key")}${t(state.player.hasKey ? "run.key" : "run.noKey")}
        </div>
      </section>
      ${
        advanced
          ? html`<section class="panel run-inventory">
              ${this.activeDungeon.objects.some((o) => o.type === "exit") ? html`<p>${this.activeDungeon.objects.some((o) => o.type === "treasure" && state.collected.includes(o.id)) ? msg("Treasure secured. Reach the exit.") : msg("Secure the main treasure, then escape through the exit.")}</p>` : ""}
              <h3>${msg(advanced.build)} inventory</h3>
              <p>
                ${Object.entries(advanced.loot)
                  .map(([kind, count]) => `${msg(kind)}: ${count}`)
                  .join(" · ")}
              </p>
              <p>Keys: ${advanced.keys} · Quests: ${advanced.quests.length}</p>
              <p>
                Ability
                ${state.tick >= advanced.abilityReady ? msg("ready") : msg("ready in {turns} turns", { turns: advanced.abilityReady - state.tick })}${advanced.checkpoint ? msg(" · Checkpoint active") : ""}
              </p>
            </section>`
          : ""
      }
      <section class="event-card panel">
        <p class="eyebrow">${t("run.log")}</p>
        <ol class="event-list">
          ${
            events
              .map(
                (e) =>
                  html`<li>
                    <span
                      >${icon(e.kind === "damage" || e.kind === "death" ? "heart" : e.kind === "key" ? "key" : e.kind === "trap" ? "fire" : "check")}</span
                    >
                    <div>
                      ${escape(e.message ?? t(`event.${e.kind}`))}${e.amount ? html` <b>${e.amount}</b>` : ""}<small
                        >${e.reason && Object.hasOwn(CONTENT, e.reason) ? t(`object.${e.reason}`) : duration((e.tick * TICK_MS) / 1000)}</small
                      >
                    </div>
                  </li>`,
              )
              .join("") || html`<li class="muted">${t("event.spawn")}</li>`
          }
        </ol>
      </section>`;
  }
  private runOverlay(): string {
    const status = this.simulation!.state.status;
    return html`<div class="run-overlay">
      <div class="result-card ${status}" role="status">
        ${icon(status === "completed" ? "treasure" : "monsters")}
        <p class="eyebrow">
          ${t(status === "completed" ? "run.completeBadge" : "run.endBadge")}
        </p>
        <h2>${t(`run.${status}`)}</h2>
        <p>
          ${this.onlineTicket ? escape(this.onlineMessage || msg("Your adventure is being recorded.")) : t(`run.${status}Body`)}
        </p>
        <div>
          ${button("build", t("action.back"), "back", "primary")}${status !== "completed" ? button("restart", t("action.restart"), "rotate", "outline") : ""}${this.onlineTicket ? button("community", msg("Back to community"), "castle", "quiet small") : button("watch-test", t("action.watchTest"), "eye", "quiet small")}
        </div>
      </div>
    </div>`;
  }
  private touchControls(): string {
    return html`<div class="touch-controls">
      <div class="dpad">
        ${(["up", "left", "down", "right"] as const).map((direction) => html`<button class="direction ${direction}" data-direction="${direction}" aria-label="${t("run.move", { direction: t(`direction.${direction}`) })}">${icon(direction)}</button>`).join("")}
      </div>
      <div class="combat-controls">
        ${button("attack", t("action.attack"), "skeleton", "primary")}${button("wait", t("action.wait"), "clock", "outline")}${this.simulation?.dungeon.schemaVersion === 2 ? button("interact", msg("Interact ? F"), "objects", "outline") + button("ability", msg("Ability ? Q"), "fire", "outline") : ""}
      </div>
    </div>`;
  }
  private attemptSidebar(): string {
    if (this.communityAnalysis)
      return html`<p class="eyebrow">Community recordings</p>
        <h3>${escape(this.communityAnalysis.dungeon.title)}</h3>
        <p>
          Heatmap and totals cover all verified adventures. Browse the latest
          ${this.attempts.length} recordings below (up to 30).
        </p>
        <div class="attempt-list">
          ${this.attempts.map((r) => html`<button class="attempt-card" data-replay="${escape(r.id)}"><span>${escape(r.adventurer)}</span><span>${duration(r.actions.length / 4)}</span></button>`).join("")}
        </div>`;
    const versions = this.library.data.versions;
    return html`<div class="panel-heading">
        <p class="eyebrow">${t("analytics.recent")}</p>
        ${icon("eye")}
      </div>
      <label class="field-label" for="version-select"
        >${t("analytics.version")}</label
      ><select id="version-select" ${versions.length ? "" : "disabled"}>
        ${
          versions.length
            ? [...versions]
                .reverse()
                .map(
                  (v) =>
                    html`<option
                      value="${escape(v.id)}"
                      ${v.id === this.selectedVersion ? "selected" : ""}
                    >
                      ${escape(v.dungeon.title)} · v${v.number}
                    </option>`,
                )
                .join("")
            : html`<option>${t("analytics.noVersions")}</option>`
        }
      </select>
      <div class="attempt-list">
        ${
          this.attempts
            .slice()
            .reverse()
            .map((attempt) => {
              const state = reconstructReplay(attempt).state;
              return html`<button
                class="attempt-card ${attempt.id === this.replay?.id && this.mode === "replay" ? "active" : ""}"
                data-replay="${escape(attempt.id)}"
              >
                <span class="attempt-avatar ${state.status}"
                  >${icon(state.status === "completed" ? "treasure" : "monsters")}</span
                ><span
                  ><strong>${escape(attempt.adventurer.split(" · ")[0])}</strong
                  ><small
                    >${escape(attempt.adventurer.split(" · ")[1] ?? "Architect")}</small
                  ><em class="${state.status}"
                    >${t(state.status === "completed" ? "run.cleared" : state.status === "dead" ? "run.failed" : "run.incomplete")}</em
                  ></span
                ><span class="attempt-time"
                  >${duration((state.tick * TICK_MS) / 1000)}${icon("play")}</span
                >
              </button>`;
            })
            .join("") ||
          html`<div class="empty-attempts">
            ${icon("eye")}
            <p>${t("replay.empty")}</p>
          </div>`
        }
      </div>
      ${button("simulate", t("action.simulate"), "plus", "outline full", !this.selectedVersion)}`;
  }
  private analyticsInspector(): string {
    const stats = this.analytics;
    const version = this.library.data.versions.find(
      (v) => v.id === this.selectedVersion,
    );
    const deadly =
      stats.deadliest &&
      (this.communityAnalysis?.dungeon ?? version?.dungeon)?.objects.find(
        (o) => o.id === stats.deadliest!.objectId,
      );
    const versions = this.library.data.versions.filter(
      (v) => v.dungeon.id === version?.dungeon.id,
    );
    return html`<section class="analytics-card panel">
        <p class="eyebrow">${t("analytics.title")}</p>
        <div class="stat-grid">
          <div>
            <strong>${stats.attempts}</strong
            ><span>${t("analytics.attempts")}</span>
          </div>
          <div>
            <strong>${Math.round(stats.completionRate)}<small>%</small></strong
            ><span>${t("analytics.clears")}</span>
          </div>
          <div>
            <strong>${stats.deaths}</strong
            ><span>${t("analytics.deaths")}</span>
          </div>
          <div>
            <strong>${duration(stats.averageSeconds)}</strong
            ><span>${t("analytics.time")}</span>
          </div>
        </div>
        <p>
          Average damage: ${Math.round(stats.averageDamage)} | Deaths per
          attempt: ${stats.averageDeaths.toFixed(2)}
        </p>
        ${stats.firstDeath ? html`<p>First recorded death: ${stats.firstDeath.x + 1}, ${stats.firstDeath.y + 1}</p>` : ""}${stats.dangerousRoom ? html`<p>Deadliest chamber: ${stats.dangerousRoom.id}, floor ${stats.dangerousRoom.floor} (${stats.dangerousRoom.deaths} deaths). Chambers are inferred from connected open floor.</p>` : ""}${stats.dangerousArea ? html`<p>Most dangerous area: floor ${stats.dangerousArea.floor}, sector ${stats.dangerousArea.x}/${stats.dangerousArea.y}</p>` : ""}${stats.commonRoute ? html`<p>Most common successful route: ${stats.commonRoute.points.length} moves, used ${stats.commonRoute.count} times.</p>` : ""}
      </section>
      <section class="note-card compact">
        ${icon("fire")}
        <h2>
          ${stats.attempts ? (deadly ? t(`object.${deadly.type}`) : t("analytics.brave")) : t("analytics.empty")}
        </h2>
        <p>
          ${stats.attempts ? (deadly ? t("analytics.fell", { deaths: stats.deadliest!.count, attempts: stats.attempts }) : t("analytics.noDeaths")) : t("analytics.emptyBody")}
        </p>
      </section>
      ${
        versions.length > 1
          ? html`<section class="panel version-comparison">
              <p class="eyebrow">${t("analytics.history")}</p>
              ${versions
                .map((v) => {
                  const summary = analyze(
                    this.library.data.attempts.filter(
                      (a) => a.dungeonVersionId === v.id,
                    ),
                  );
                  return html`<div>
                    <strong>v${v.number}</strong
                    ><span
                      >${t("analytics.attemptCount", { count: summary.attempts })}</span
                    ><b
                      >${summary.attempts ? t("analytics.clearPercent", { percent: Math.round(summary.completionRate) }) : "—"}</b
                    >
                  </div>`;
                })
                .join("")}
            </section>`
          : ""
      }`;
  }
  private replayControls(): string {
    return html`<div class="replay-controls">
      <div class="replay-slider">
        <span id="replay-time">00:00</span
        ><input
          type="range"
          id="replay-position"
          min="0"
          max="${this.replay!.actions.length}"
          value="${this.replayTick}"
          aria-label="${t("replay.timeline")}"
        /><span
          >${duration((this.replay!.actions.length * TICK_MS) / 1000)}</span
        >
      </div>
      <div class="replay-buttons">
        ${iconButton("replay-restart", t("action.restart"), "rotate")}${iconButton("replay-toggle", t("action.play"), "play")}<select
          id="replay-speed"
          aria-label="${t("replay.speed")}"
        >
          ${[0.5, 1, 2, 4].map((speed) => html`<option value="${speed}" ${speed === this.replaySpeed ? "selected" : ""}>${speed}×</option>`).join("")}</select
        >${button("jump-death", t("action.death"), "monsters", "quiet small", !reconstructReplay(this.replay!).state.events.some((e) => e.kind === "death"))}
      </div>
    </div>`;
  }
  private replayInspector(): string {
    const events = reconstructReplay(this.replay!).state.events.filter(
      (e) => !["move", "blocked", "attack", "damage"].includes(e.kind),
    );
    return html`<section class="note-card compact">
        <h3>Ideas for the next version</h3>
        <ul>
          ${improvementIdeas(this.replay!)
            .map((idea) => html`<li>${escape(msg(idea))}</li>`)
            .join("")}
        </ul>
      </section>
      <section class="replay-summary panel">
        <p class="eyebrow">${escape(this.replay!.adventurer)}</p>
        <div id="replay-health" class="health-value"></div>
        <p class="muted">${t("canvas.replayHint")}</p>
      </section>
      <section class="event-card panel">
        <p class="eyebrow">${t("replay.moments")}</p>
        <ol class="event-list replay-events">
          ${events
            .map(
              (e) =>
                html`<li>
                  <button data-tick="${e.tick}">
                    <span class="event-time"
                      >${duration((e.tick * TICK_MS) / 1000)}</span
                    ><span>${t(`event.${e.kind}`)}</span
                    >${icon(e.kind === "death" ? "monsters" : e.kind === "key" ? "key" : "check")}
                  </button>
                </li>`,
            )
            .join("")}
        </ol>
      </section>
      ${button("analytics", t("action.overview"), "back", "outline full")}`;
  }
  private click(event: MouseEvent): void {
    const target = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-action], [data-tool], [data-category], [data-direction], [data-replay], [data-tick]",
    );
    if (!target || target.hasAttribute("disabled")) return;
    event.preventDefault();
    try {
      if (target.dataset.tool) {
        this.tool = target.dataset.tool as Tool;
        this.selected = [];
        this.placement = null;
        this.render();
        return;
      }
      if (target.dataset.category) {
        this.category = target.dataset.category as Category;
        this.render();
        return;
      }
      if (target.dataset.direction) {
        this.act({
          type: "move",
          direction: target.dataset.direction as Direction,
        });
        return;
      }
      if (target.dataset.replay) {
        this.openReplay(target.dataset.replay);
        return;
      }
      if (target.dataset.tick) {
        this.replayPlaying = false;
        this.seek(Number(target.dataset.tick));
        return;
      }
      const action = target.dataset.action;
      if (action === "camera-follow") {
        this.followCamera = true;
        this.render();
        return;
      }
      if (action === "camera-overview") {
        this.followCamera = false;
        this.floor = Math.floor((this.simulation?.state.player.y ?? 0) / 13);
        this.renderer.fit();
        this.render();
        return;
      }
      if (action === "copy") {
        this.clipboard = this.editor.copy(this.selected);
        this.toast(
          msg("Selection copied. Choose Paste, then a destination tile."),
        );
        this.render();
        return;
      }
      if (action === "paste") {
        if (this.clipboard) {
          this.pasting = true;
          this.tool = "select";
          this.toast(msg("Choose a floor tile for the copied selection."));
        }
        return;
      }
      if (action === "mirror-h" || action === "mirror-v") {
        if (
          this.editor.mirror(
            this.selected,
            action === "mirror-h" ? "horizontal" : "vertical",
          )
        )
          this.changed(false);
        return;
      }
      if (action === "layers") {
        this.showLayers();
        return;
      }
      if (action === "usage") {
        this.showDialog(
          html`<h2>Usage analytics</h2>
            <p>
              Optional measurements help identify editor friction and tutorial
              drop-off. They contain action names and durations, linked to a
              random device identifier or your signed-in account. No dungeon
              text, passwords, or input recordings are sent by this setting.
            </p>
            <p>
              Verified online attempts and transactions are stored separately to
              operate the game.
            </p>
            ${button("usage-toggle", this.telemetry.enabled ? msg("Turn usage analytics off") : msg("Enable usage analytics"), undefined, "primary full")}${button("close", t("action.close"), undefined, "quiet full")}`,
        );
        return;
      }
      if (action === "tutorial") {
        this.backupDraft();
        const dungeon = createDungeon();
        this.editor = new Editor(dungeon);
        this.library.updateDraft(dungeon);
        this.library.data.preferences.tutorialStep = 0;
        this.library.persist();
        this.mode = "build";
        this.floor = 0;
        this.render();
        return;
      }
      if (action === "contrast" || action === "text-size") {
        if (action === "contrast")
          this.library.data.preferences.contrast =
            !this.library.data.preferences.contrast;
        else
          this.library.data.preferences.textScale =
            this.library.data.preferences.textScale === 125 ? 100 : 125;
        this.library.persist();
        this.render();
        return;
      }
      if (
        action === "advanced" ||
        action === "configure" ||
        action === "logic"
      ) {
        this.mechanics.show(
          action === "advanced"
            ? "settings"
            : action === "configure"
              ? "object"
              : "logic",
          this.selected[0],
        );
        return;
      }
      if (action === "interact" || action === "ability") {
        this.act({ type: action });
        return;
      }
      if (action === "community" || action === "publish-online") {
        this.recordTest();
        this.onlineTicket = null;
        this.communityAnalysis = null;
        this.mode = "build";
        this.replayPlaying = false;
        void this.community.show(
          action === "publish-online" ? "publish" : "discover",
        );
      } else if (action === "sync-runs") {
        this.showPendingRuns();
      } else if (action === "build") {
        this.recordTest();
        this.communityAnalysis = null;
        this.onlineTicket = null;
        this.mode = "build";
        this.replayPlaying = false;
        this.render();
      } else if (action === "analytics") {
        this.recordTest();
        this.mode = "analytics";
        this.replayPlaying = false;
        if (!this.selectedVersion)
          this.selectedVersion = this.library.latest()?.id ?? "";
        this.render();
      } else if (action === "guide") this.showGuide();
      else if (action === "backups") this.showBackups();
      else if (action === "new") this.showNew();
      else if (action === "import") this.importFile();
      else if (action === "export") this.exportFile();
      else if (action === "restart" && this.onlineTicket) {
        const id = this.onlineTicket.versionId;
        void this.communityApi
          .request<AttemptTicket>(`/versions/${id}/attempts`, "POST")
          .then((ticket) => this.startOnline(ticket))
          .catch((error) => this.toast(error.message, true));
      } else if (action === "test" || action === "restart") this.startTest();
      else if (action === "watch-test") {
        const replay = this.library.data.practice
          .filter((r) => r.dungeon.id === this.editor.dungeon.id)
          .at(-1);
        if (replay) this.openReplay(replay.id);
      } else if (action === "attack") this.act({ type: "attack" });
      else if (action === "wait") this.act({ type: "wait" });
      else if (action === "select") {
        this.tool = "select";
        this.render();
      } else if (action === "undo" || action === "redo") {
        if (this.editor[action]()) this.changed();
      } else if (action === "grid") {
        this.library.data.preferences.showGrid =
          !this.library.data.preferences.showGrid;
        this.library.persist();
        this.render();
      } else if (action === "sound") {
        this.audio.enabled = !this.audio.enabled;
        this.library.data.preferences.sound = this.audio.enabled;
        this.library.persist();
        this.audio.play("place");
        this.render();
      } else if (action === "motion") {
        this.library.data.preferences.reducedMotion =
          !this.library.data.preferences.reducedMotion;
        this.library.persist();
        this.render();
      } else if (action === "zoom-in") {
        this.followCamera = false;
        this.renderer.zoom = Math.min(2.2, this.renderer.zoom + 0.2);
      } else if (action === "zoom-out") {
        this.followCamera = false;
        this.renderer.zoom = Math.max(0.7, this.renderer.zoom - 0.2);
      } else if (action === "fit") {
        this.followCamera = false;
        this.renderer.fit();
      } else if (action === "validate") this.showValidation();
      else if (action === "publish") {
        const version = this.library.publish();
        this.selectedVersion = version.id;
        this.mode = "analytics";
        this.render();
        this.audio.play("success");
        this.toast(
          this.library.warning ? t("storage.saveFailed") : t("publish.success"),
          !!this.library.warning,
        );
      } else if (action === "simulate") this.inviteAdventurers();
      else if (action === "heatmap") {
        this.heatmap = !this.heatmap;
        this.render();
      } else if (action === "rotate") {
        if (this.selected.length) {
          if (this.editor.rotate(this.selected)) this.changed(false);
        } else this.rotation = (this.rotation + 1) % 4;
      } else if (action === "delete") {
        if (this.editor.remove(this.selected)) this.changed();
      } else if (action === "move" || action === "duplicate") {
        this.placement = action;
        this.tool = "select";
        this.render();
        this.toast(t(`editor.${action}Hint`));
      } else if (action === "replay-toggle") {
        if (this.replayTick >= this.replay!.actions.length) this.seek(0);
        this.replayPlaying = !this.replayPlaying;
        this.replayElapsed = 0;
        this.updateReplayUI();
      } else if (action === "replay-restart") {
        this.seek(0);
        this.replayPlaying = true;
      } else if (action === "jump-death") {
        const death = reconstructReplay(this.replay!).state.events.find(
          (e) => e.kind === "death",
        );
        if (death) {
          this.replayPlaying = false;
          this.seek(death.tick);
        }
      }
    } catch (error) {
      this.toast(errorText(error), true);
    }
  }
  private change(event: Event): void {
    const target = event.target as HTMLInputElement;
    try {
      if (target.id === "floor-select") {
        if (this.mode === "test" || this.mode === "replay")
          this.followCamera = false;
        this.floor = Number(target.value);
        this.renderer.floor = this.floor;
        this.cursor = { x: 2, y: 2 + this.floor * 13 };
        this.render();
      }
      if (target.id === "dungeon-title") {
        if (this.editor.rename(target.value)) this.changed();
      }
      if (target.id === "version-select") {
        this.selectedVersion = target.value;
        this.mode = "analytics";
        this.replayPlaying = false;
        this.render();
      }
      if (target.id === "replay-speed") this.replaySpeed = Number(target.value);
    } catch (error) {
      this.toast(errorText(error), true);
      this.render();
    }
  }
  private changed(clearSelection = true): void {
    const before = this.library.data.draft.objects.length,
      after = this.editor.dungeon.objects.length;
    if (before !== after)
      this.telemetry.track(after > before ? "ObjectPlaced" : "ObjectRemoved");
    if (clearSelection) this.selected = [];
    this.library.updateDraft(this.editor.dungeon);
    this.render();
    if (this.library.warning) this.toast(t("storage.saveFailed"), true);
  }
  private pointerDown(event: PointerEvent): void {
    if ((event.target as HTMLElement).tagName !== "CANVAS") return;
    const point = this.renderer.point(event.clientX, event.clientY);
    if (event.pointerType === "touch") {
      this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      event.preventDefault();
      if (this.touches.size === 2) {
        this.followCamera = false;
        clearTimeout(this.longPress);
        this.pendingTouch = null;
        this.drawing = false;
        const [a, b] = [...this.touches.values()],
          rect = this.renderer.canvas.getBoundingClientRect();
        const cx = (((a.x + b.x) / 2 - rect.left) * 768) / rect.width,
          cy = (((a.y + b.y) / 2 - rect.top) * 672) / rect.height;
        this.gesture = {
          distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
          zoom: this.renderer.zoom,
          worldX: (cx - 384 - this.renderer.pan.x) / this.renderer.zoom,
          worldY: (cy - 336 - this.renderer.pan.y) / this.renderer.zoom,
        };
        return;
      }
      if (!point || this.mode !== "build") return;
      this.pendingTouch = point;
      this.touchOrigin = { x: event.clientX, y: event.clientY };
      this.lastPaint = "";
      this.lastPaintError = "";
      const object = objectAt(this.editor.dungeon, point);
      if (object && !this.hiddenLayers.has(CONTENT[object.type].category))
        this.longPress = window.setTimeout(() => {
          this.pendingTouch = null;
          this.drawing = false;
          this.selected = [object.id];
          this.tool = "select";
          this.render();
          this.showDialog(
            html`<h2>${t(`object.${object.type}`)}</h2>
              <div class="context-wheel">
                ${["move", "duplicate", "rotate", "configure", "copy", "delete"].map((action) => button(`context:${action}`, msg(action[0].toUpperCase() + action.slice(1)), undefined, "outline")).join("")}
              </div>`,
          );
          this.blockContextRelease = true;
        }, 450);
      return;
    }
    if (!point) return;
    this.showCursor = false;
    this.hover = point;
    if (
      event.button === 1 ||
      event.altKey ||
      (this.mode !== "build" && this.renderer.zoom > 1)
    ) {
      this.panStart = {
        x: event.clientX,
        y: event.clientY,
        panX: this.renderer.pan.x,
        panY: this.renderer.pan.y,
      };
      event.preventDefault();
      return;
    }
    if (this.mode !== "build") return;
    event.preventDefault();
    this.drawing = this.tool !== "select";
    this.lastPaint = "";
    this.lastPaintError = "";
    this.paint(point, event.button === 2 ? "erase" : this.tool, event.shiftKey);
  }
  private pointerMove(event: PointerEvent): void {
    if (this.touches.has(event.pointerId)) {
      this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.gesture) {
        if (this.touches.size >= 2) {
          const [a, b] = [...this.touches.values()],
            g = this.gesture,
            rect = this.renderer.canvas.getBoundingClientRect();
          this.renderer.zoom = Math.min(
            2.2,
            Math.max(
              0.7,
              (g.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / g.distance,
            ),
          );
          this.renderer.pan = {
            x:
              (((a.x + b.x) / 2 - rect.left) * 768) / rect.width -
              384 -
              g.worldX * this.renderer.zoom,
            y:
              (((a.y + b.y) / 2 - rect.top) * 672) / rect.height -
              336 -
              g.worldY * this.renderer.zoom,
          };
        }
        return;
      }
      if (
        this.pendingTouch &&
        this.touchOrigin &&
        Math.hypot(
          event.clientX - this.touchOrigin.x,
          event.clientY - this.touchOrigin.y,
        ) > 6
      ) {
        clearTimeout(this.longPress);
        this.paint(this.pendingTouch, this.tool);
        this.pendingTouch = null;
        this.drawing = this.tool !== "select";
      }
    }
    if (this.panStart) {
      const rect = this.renderer.canvas.getBoundingClientRect();
      this.renderer.pan = {
        x:
          this.panStart.panX +
          ((event.clientX - this.panStart.x) * 768) / rect.width,
        y:
          this.panStart.panY +
          ((event.clientY - this.panStart.y) * 672) / rect.height,
      };
      return;
    }
    const rect = this.renderer.canvas.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    ) {
      this.hover = null;
      return;
    }
    const point = this.renderer.point(event.clientX, event.clientY);
    this.hover = point;
    if (point && this.drawing && this.mode === "build")
      this.paint(
        point,
        event.buttons === 2 ? "erase" : this.tool,
        event.shiftKey,
      );
  }
  private paint(point: Point, tool: Tool, multi = false): void {
    const existing = objectAt(this.editor.dungeon, point);
    if (
      (existing && this.hiddenLayers.has(CONTENT[existing.type].category)) ||
      this.hiddenLayers.has(
        Object.hasOwn(CONTENT, tool)
          ? CONTENT[tool as keyof typeof CONTENT].category
          : "rooms",
      )
    )
      return;
    const key = `${point.x},${point.y}`;
    if (this.drawing && key === this.lastPaint) return;
    this.lastPaint = key;
    try {
      if (this.pasting && this.clipboard) {
        if (this.editor.paste(this.clipboard, point)) {
          this.pasting = false;
          this.changed();
        }
        return;
      }
      if (tool === "select") {
        if (this.placement && this.selected.length) {
          const source = this.editor.dungeon.objects.find(
            (o) => o.id === this.selected[0],
          );
          if (
            source &&
            this.editor.move(
              this.selected,
              { x: point.x - source.x, y: point.y - source.y },
              this.placement === "duplicate",
            )
          ) {
            this.placement = null;
            this.changed();
            this.audio.play("place");
          }
        } else {
          const object = objectAt(this.editor.dungeon, point);
          this.selected = object
            ? multi
              ? this.selected.includes(object.id)
                ? this.selected.filter((id) => id !== object.id)
                : [...this.selected, object.id]
              : [object.id]
            : [];
          this.render();
        }
      } else if (this.editor.place(tool, point, this.rotation)) {
        this.audio.play("place");
        this.changed();
      }
    } catch (error) {
      const message = errorText(error);
      if (message !== this.lastPaintError) this.toast(message, true);
      this.lastPaintError = message;
    }
  }
  private keyDown(event: KeyboardEvent): void {
    if (
      this.dialog.open ||
      this.community.open ||
      this.mechanics.open ||
      (event.target instanceof HTMLElement &&
        ["INPUT", "SELECT", "TEXTAREA"].includes(event.target.tagName))
    )
      return;
    const directions: Record<string, Direction> = {
      ArrowUp: "up",
      w: "up",
      ArrowRight: "right",
      d: "right",
      ArrowDown: "down",
      s: "down",
      ArrowLeft: "left",
      a: "left",
    };
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (this.mode === "test") {
      if (directions[key]) {
        event.preventDefault();
        this.act({ type: "move", direction: directions[key] });
      } else if (key === " " && !(event.target instanceof HTMLButtonElement)) {
        event.preventDefault();
        this.act({ type: "attack" });
      } else if (
        (key === "f" || key === "q") &&
        this.simulation?.dungeon.schemaVersion === 2
      ) {
        event.preventDefault();
        this.act({ type: key === "f" ? "interact" : "ability" });
      } else if (key === "e") {
        event.preventDefault();
        this.act({ type: "wait" });
      }
    } else if (this.mode === "build") {
      try {
        if ((event.ctrlKey || event.metaKey) && key === "c") {
          event.preventDefault();
          this.clipboard = this.editor.copy(this.selected);
          this.toast(msg("Selection copied."));
          return;
        }
        if ((event.ctrlKey || event.metaKey) && key === "v") {
          event.preventDefault();
          if (this.clipboard) {
            this.pasting = true;
            this.tool = "select";
            this.toast(msg("Choose a floor tile for the copied selection."));
          }
          return;
        }
        if ((event.ctrlKey || event.metaKey) && key === "z") {
          event.preventDefault();
          if (event.shiftKey ? this.editor.redo() : this.editor.undo())
            this.changed();
        } else if (key === "Delete" || key === "Backspace") {
          if (this.selected.length) {
            event.preventDefault();
            if (this.editor.remove(this.selected)) this.changed();
          }
        } else if (key === "r") {
          if (this.selected.length) {
            if (this.editor.rotate(this.selected)) this.changed(false);
          } else this.rotation = (this.rotation + 1) % 4;
        } else if (event.target === this.renderer.canvas && directions[key]) {
          event.preventDefault();
          const delta = DIRECTIONS[directions[key]];
          this.cursor = {
            x: Math.max(0, Math.min(14, this.cursor.x + delta.x)),
            y: Math.max(
              this.floor * 13,
              Math.min(this.floor * 13 + 12, this.cursor.y + delta.y),
            ),
          };
          this.showCursor = true;
        } else if (
          event.target === this.renderer.canvas &&
          (key === "Enter" || key === " ")
        ) {
          event.preventDefault();
          this.paint(this.cursor, this.tool, event.shiftKey);
          this.renderer.canvas.focus();
        }
      } catch (error) {
        this.toast(errorText(error), true);
      }
    }
  }
  private startTest(): void {
    this.telemetry.track(
      "EditorSession",
      performance.now() - this.editorOpenedAt,
    );
    this.editorOpenedAt = performance.now();
    this.recordTest();
    this.onlineTicket = null;
    const result = validateDungeon(this.editor.dungeon);
    if (!result.valid) {
      this.showValidation();
      return;
    }
    this.followCamera = true;
    this.simulation = new Simulation(this.editor.dungeon, 2026);
    this.testRecorded = false;
    this.mode = "test";
    this.replayPlaying = false;
    this.selected = [];
    this.render();
    this.renderer.fit();
    this.renderer.canvas.focus({ preventScroll: true });
  }
  private act(action: Action): void {
    if (
      this.mode !== "test" ||
      !this.simulation ||
      this.simulation.state.status !== "playing"
    )
      return;
    const before = this.simulation.state.events.length;
    const state = this.simulation.step(action);
    const events = this.simulation.state.events.slice(before);
    if (state.status === "completed") {
      if (!this.onlineTicket) this.library.certify(this.simulation.replay());
      this.audio.play("success");
    } else if (state.status === "dead") this.audio.play("death");
    else
      this.audio.play(
        events.some((e) => e.kind === "damage")
          ? "damage"
          : events.some((e) => e.kind === "attack")
            ? "attack"
            : events.some((e) => e.kind === "trap")
              ? "trap"
              : events.some((e) => e.kind === "loot")
                ? "treasure"
                : events.some((e) => e.kind === "door")
                  ? "door"
                  : events.some((e) => e.kind === "key" || e.kind === "quest")
                    ? "discovery"
                    : events.some(
                          (e) => e.kind === "interact" || e.kind === "signal",
                        )
                      ? "switch"
                      : "step",
      );
    if (state.status !== "playing") this.recordTest();
    this.render();
    if (this.library.warning) this.toast(t("storage.saveFailed"), true);
  }
  private inviteAdventurers(): void {
    const version = this.library.data.versions.find(
      (v) => v.id === this.selectedVersion,
    );
    if (!version) {
      this.toast(t("analytics.noVersion"), true);
      return;
    }
    const offset = this.library.data.attempts.length;
    for (let i = 0; i < 6; i++)
      this.library.record(
        simulateAdventurer(
          version.dungeon,
          version.id,
          104729 + offset * 31 + i,
          i,
        ),
      );
    this.mode = "analytics";
    this.replayPlaying = false;
    this.render();
    this.toast(
      this.library.warning ? t("storage.saveFailed") : t("analytics.invited"),
      !!this.library.warning,
    );
  }
  private openReplay(id: string): void {
    const replay = [
      ...(this.communityAnalysis?.recordings ?? []),
      ...this.library.data.attempts,
      ...this.library.data.practice,
    ].find((a) => a.id === id);
    if (!replay) return;
    this.replay = replay;
    this.followCamera = true;
    if (replay.dungeonVersionId !== "draft")
      this.selectedVersion = replay.dungeonVersionId;
    this.mode = "replay";
    this.replayTick = 0;
    this.replayElapsed = 0;
    this.replayPlaying = true;
    this.simulation = reconstructReplay(replay, 0);
    this.render();
    this.renderer.fit();
  }
  private recordTest(): void {
    if (
      this.mode === "test" &&
      this.simulation &&
      !this.testRecorded &&
      this.simulation.actions.length
    ) {
      if (this.onlineTicket) {
        this.outbox.push({
          id: this.onlineTicket.id,
          playerId: this.communityApi.player!.id,
          actions: [...this.simulation.actions],
          abandon: this.simulation.state.status === "playing",
          replay: this.simulation.replay(
            this.communityApi.player!.displayName,
            this.onlineTicket.versionId,
          ),
          expiresAt: this.onlineTicket.expiresAt,
        });
        this.persistOutbox();
        this.onlineMessage = msg("Verifying your adventure...");
        void this.flushOutbox();
      } else
        this.library.recordPractice(this.simulation.replay(t("run.architect")));
      this.testRecorded = true;
    }
  }
  private startOnline(ticket: AttemptTicket): void {
    this.recordTest();
    this.followCamera = true;
    this.onlineTicket = ticket;
    this.onlineMessage = "";
    this.simulation = new Simulation(ticket.dungeon, ticket.seed);
    this.testRecorded = false;
    this.mode = "test";
    this.replayPlaying = false;
    this.selected = [];
    this.render();
    this.renderer.fit();
    this.renderer.canvas.focus({ preventScroll: true });
  }
  private showOnlineReplay(replay: Replay): void {
    this.recordTest();
    this.followCamera = true;
    this.onlineTicket = null;
    this.communityAnalysis = { dungeon: replay.dungeon, recordings: [replay] };
    this.selectedVersion = replay.dungeonVersionId;
    this.replay = replay;
    this.mode = "replay";
    this.replayTick = 0;
    this.replayElapsed = 0;
    this.replayPlaying = true;
    this.simulation = reconstructReplay(replay, 0);
    this.render();
    this.renderer.fit();
  }
  private showPendingRuns(): void {
    this.showDialog(
      html`<h2>Saved adventures</h2>
        <p>
          Retry verification after connecting and signing in to the original
          account. Expired or rejected runs can be kept as local replays.
        </p>
        ${button("retry-runs", msg("Retry verification"), "upload", "primary full")}
        ${
          this.outbox
            .map(
              (r) =>
                html`<article class="panel">
                  <h3>
                    ${escape(r.replay?.dungeon.title ?? msg("Saved run"))}
                  </h3>
                  <p>
                    ${escape(r.lastError ?? msg("Waiting for verification"))}
                  </p>
                  <p>
                    ${r.actions.length}
                    ${msg("recorded turns")}${r.expiresAt && Date.parse(r.expiresAt) < Date.now() ? " · " + msg("Ticket expired") : ""}
                  </p>
                  ${r.replay ? button(`recover-run:${r.id}`, msg("Keep local replay"), "eye", "outline") : ""}${button(`discard-run:${r.id}`, msg("Remove queued run"), undefined, "quiet")}
                </article>`,
            )
            .join("") || html`<p>No pending adventures.</p>`
        }`,
    );
  }
  private persistOutbox(): void {
    try {
      localStorage.setItem("da.online-outbox", JSON.stringify(this.outbox));
    } catch {
      this.toast(
        msg(
          "This browser cannot save the pending run. Keep the page open and retry sync.",
        ),
        true,
      );
    }
  }
  private async flushOutbox(): Promise<void> {
    if (this.submitting || !this.outbox.length) return;
    this.submitting = true;
    try {
      await this.communityApi.refresh();
      let failed = 0;
      for (const run of [...this.outbox]) {
        if (run.playerId !== this.communityApi.player?.id) continue;
        try {
          const result = await this.communityApi.submit(
            run.id,
            run.actions,
            run.abandon,
          );
          this.outbox = this.outbox.filter((item) => item.id !== run.id);
          this.persistOutbox();
          this.onlineMessage = msg(
            "Verified {outcome}. +{xp} XP | +{gold} gold | +{materials} materials",
            {
              outcome: msg(result.outcome),
              xp: result.rewards.xp,
              gold: result.rewards.gold,
              materials: result.rewards.materials,
            },
          );
          this.toast(this.onlineMessage);
        } catch (error) {
          run.lastError =
            error instanceof Error
              ? error.message
              : msg("Verification failed.");
          this.persistOutbox();
          failed++;
        }
      }
      if (failed) {
        this.onlineMessage = msg(
          "{count} runs remain saved for retry. Other runs have synced.",
          { count: failed },
        );
        this.toast(this.onlineMessage, true);
      }
    } catch (error) {
      this.onlineMessage = msg(
        "Run saved for retry. Use Sync pending runs when connected.",
      );
      this.toast(
        error instanceof Error ? error.message : this.onlineMessage,
        true,
      );
    } finally {
      this.submitting = false;
      this.render();
    }
  }
  private seek(tick: number): void {
    if (!this.replay) return;
    this.replayTick = Math.max(
      0,
      Math.min(this.replay.actions.length, Math.floor(tick)),
    );
    this.simulation = reconstructReplay(this.replay, this.replayTick);
    this.replayElapsed = 0;
    this.updateReplayUI();
  }
  private updateReplayUI(): void {
    if (this.mode !== "replay" || !this.simulation) return;
    const range = this.root.querySelector<HTMLInputElement>("#replay-position");
    if (range) range.value = String(this.replayTick);
    const time = this.root.querySelector("#replay-time");
    if (time) time.textContent = duration((this.replayTick * TICK_MS) / 1000);
    const health = this.root.querySelector("#replay-health");
    if (health)
      health.innerHTML = html`${icon("heart")}<strong
          >${this.simulation.state.player.hp}<span>
            / ${this.simulation.state.player.maxHp}</span
          ></strong
        >`;
    const toggle = this.root.querySelector<HTMLButtonElement>(
      '[data-action="replay-toggle"]',
    );
    if (toggle) {
      toggle.innerHTML = icon(this.replayPlaying ? "pause" : "play");
      toggle.setAttribute(
        "aria-label",
        t(this.replayPlaying ? "action.pause" : "action.play"),
      );
    }
    for (const node of this.root.querySelectorAll<HTMLElement>("[data-tick]"))
      node.classList.toggle(
        "reached",
        Number(node.dataset.tick) <= this.replayTick,
      );
  }
  private frame(time: number): void {
    const delta = Math.min(100, time - this.lastFrame);
    this.lastFrame = time;
    if (
      this.mode === "replay" &&
      this.replayPlaying &&
      this.replay &&
      this.simulation
    ) {
      this.replayElapsed += delta * this.replaySpeed;
      while (
        this.replayElapsed >= TICK_MS &&
        this.replayTick < this.replay.actions.length
      ) {
        this.simulation.step(this.replay.actions[this.replayTick++]);
        this.replayElapsed -= TICK_MS;
      }
      if (this.replayTick >= this.replay.actions.length)
        this.replayPlaying = false;
      this.updateReplayUI();
    }
    this.renderer.floor =
      (this.mode === "test" || this.mode === "replay") && this.followCamera
        ? Math.floor((this.simulation?.state.player.y ?? 0) / 13)
        : this.floor;
    if (this.mode === "test" && this.simulation) {
      const state = this.simulation.state;
      this.audio.update(
        state.player.hp < state.player.maxHp / 3 ||
          state.events.slice(-4).some((e) => e.kind === "damage") ||
          (this.activeDungeon.objective?.kind === "escape" &&
            this.activeDungeon.objective.ticks! - state.tick < 12) ||
          this.activeDungeon.objects.some(
            (o) =>
              o.type === "treasure" &&
              Math.abs(o.x - state.player.x) + Math.abs(o.y - state.player.y) <
                3,
          )
          ? 1
          : 0,
        state.enemies.some((e) => {
          const o = this.activeDungeon.objects.find((o) => o.id === e.id),
            p = state.advanced?.positions[e.id] ?? o;
          return (
            e.hp > 0 &&
            o?.type === "boss" &&
            !!p &&
            Math.abs(p.x - state.player.x) + Math.abs(p.y - state.player.y) <= 4
          );
        }),
        this.activeDungeon.theme,
      );
    } else this.audio.update(0, false, this.activeDungeon.theme);
    if (
      (this.mode === "test" || this.mode === "replay") &&
      this.followCamera &&
      this.simulation
    ) {
      const state = this.simulation.state,
        p = state.player;
      const frame = cameraFrame(this.activeDungeon, state);
      const boss = state.enemies.some((e) => {
        const o = this.activeDungeon.objects.find((o) => o.id === e.id);
        const position = state.advanced?.positions[e.id] ?? o;
        return (
          e.hp > 0 &&
          o?.type === "boss" &&
          position &&
          Math.abs(position.x - p.x) + Math.abs(position.y - p.y) <= 4
        );
      });
      const target = this.reducedMotion
        ? 1
        : boss
          ? 1.5
          : p.hp < p.maxHp / 3
            ? 1.3
            : frame.zoom;
      const blend = this.reducedMotion ? 1 : Math.min(1, delta / 160);
      this.renderer.zoom += (target - this.renderer.zoom) * blend;
      const z = this.renderer.zoom,
        x = Math.max(
          -(z - 1) * 384,
          Math.min((z - 1) * 384, z * (384 - (48 + frame.x * 48))),
        ),
        y = Math.max(
          -(z - 1) * 336,
          Math.min((z - 1) * 336, z * (336 - (48 + (frame.y % 13) * 48))),
        );
      this.renderer.pan.x += (x - this.renderer.pan.x) * blend;
      this.renderer.pan.y += (y - this.renderer.pan.y) * blend;
    }
    this.renderer.draw({
      hiddenLayers: this.mode === "build" ? this.hiddenLayers : undefined,
      dungeon: this.activeDungeon,
      state:
        this.mode === "test" || this.mode === "replay"
          ? this.simulation?.state
          : undefined,
      grid: this.library.data.preferences.showGrid,
      reducedMotion: this.reducedMotion,
      hover: this.hover,
      tool: this.tool,
      selected: this.selected,
      heatmap:
        this.mode === "analytics" && this.heatmap ? this.analytics : undefined,
      cursor: this.cursor,
      showCursor: this.showCursor,
      time,
    });
    requestAnimationFrame((next) => this.frame(next));
  }
  private showValidation(): void {
    const result = validateDungeon(this.editor.dungeon);
    this.showDialog(
      html`<div class="dialog-glyph">
          ${icon(result.valid ? "check" : "flag")}
        </div>
        <h2>${t("action.validate")}</h2>
        ${
          result.valid
            ? html`<p>${t("validation.success")}</p>`
            : html`<ul class="validation-issues">
                ${result.issues.map((issue) => html`<li>${t(issue.messageKey)}${issue.point ? html` <small>(${issue.point.x + 1}, ${String.fromCharCode(65 + issue.point.y)})</small>` : ""}</li>`).join("")}
              </ul>`
        }${button("close", t("action.close"), undefined, "primary full")}`,
    );
  }
  private showGuide(): void {
    this.showDialog(
      html`<p class="eyebrow">${t("nav.guide")}</p>
        <h2>${t("guide.title")}</h2>
        <p>${t("guide.intro")}</p>
        ${["build", "test", "watch"]
          .map(
            (section) =>
              html`<h3>${t(`guide.${section}`)}</h3>
                <p>${t(`guide.${section}Body`)}</p>`,
          )
          .join("")}
        <p class="guide-shortcuts">${t("guide.shortcuts")}</p>
        <p class="muted">${t("guide.scope")}</p>
        ${button("close", t("action.close"), undefined, "primary full")}`,
    );
  }
  private showLayers(): void {
    this.showDialog(
      html`<h2>Workshop layers</h2>
        <p>
          Hidden object layers are locked against editing. The room layer locks
          floor painting while leaving the floor visible for orientation.
        </p>
        <div class="community-actions">
          ${(["rooms", "traps", "monsters", "objects", "structural", "puzzle", "utility", "environment", "decor"] as Category[]).map((layer) => html`<button class="button outline" data-action="layer:${layer}" aria-pressed="${!this.hiddenLayers.has(layer)}">${msg(layer)}: ${this.hiddenLayers.has(layer) ? msg("Hidden / locked") : msg("Visible / editable")}</button>`).join("")}
        </div>`,
    );
  }
  private backupDraft(): void {
    try {
      const old = JSON.parse(localStorage.getItem("da.draft-backups") ?? "[]");
      localStorage.setItem(
        "da.draft-backups",
        JSON.stringify(
          [this.editor.dungeon, ...(Array.isArray(old) ? old : [])].slice(
            0,
            10,
          ),
        ),
      );
    } catch {
      this.toast(msg("Unable to save a backup of the previous draft."), true);
    }
  }
  private showBackups(): void {
    let drafts: Dungeon[] = [];
    try {
      const saved = JSON.parse(
        localStorage.getItem("da.draft-backups") ?? "[]",
      );
      if (Array.isArray(saved))
        drafts = saved.flatMap((value) => {
          try {
            return [parseDungeon(value)];
          } catch {
            return [];
          }
        });
    } catch {
      /* Recovery never replaces the current draft with malformed data. */
    }
    this.showDialog(
      html`<h2>Previous workshop drafts</h2>
        <p>
          The ten most recent drafts replaced by templates or imports are kept
          on this device.
        </p>
        ${drafts.map((d, i) => html`<button class="button outline full" data-restore="${i}">${escape(d.title)}</button>`).join("") || html`<p>No previous drafts yet.</p>`}${button("close", t("action.close"), undefined, "quiet full")}`,
    );
    this.dialog
      .querySelectorAll<HTMLButtonElement>("[data-restore]")
      .forEach((b) =>
        b.addEventListener("click", () => {
          this.recordTest();
          this.backupDraft();
          this.editor = new Editor(drafts[Number(b.dataset.restore)]);
          this.library.updateDraft(this.editor.dungeon);
          this.mode = "build";
          this.floor = 0;
          this.selected = [];
          this.communityAnalysis = null;
          this.onlineTicket = null;
          this.dialog.close();
          this.render();
          this.renderer.fit();
          this.toast(msg("Previous draft restored."));
        }),
      );
  }
  private showNew(): void {
    this.pendingImport = null;
    this.showDialog(
      html`<p class="eyebrow">${t("new.badge")}</p>
        <h2>${t("new.title")}</h2>
        <p>${t("new.body")}</p>
        ${button("confirm-new", t("new.confirm"), "plus", "primary full")}${button("starter", t("action.starter"), "castle", "outline full")}
        <details>
          <summary>More starting points</summary>
          <div class="template-picker">
            ${TEMPLATES.filter((v) => v.id !== "classic")
              .map(
                (v) =>
                  html`<button
                    class="button outline full"
                    data-action="template:${v.id}"
                  >
                    <span
                      ><strong>${escape(msg(v.name))}</strong
                      ><small>${escape(msg(v.description))}</small></span
                    >
                  </button>`,
              )
              .join("")}
          </div>
        </details>
        ${button("close", t("new.cancel"), undefined, "quiet full")}`,
    );
  }
  private showDialog(content: string): void {
    this.dialog.innerHTML = html`<div class="dialog-content">
      ${iconButton("close", t("action.close"), "close")} ${content}
    </div>`;
    this.dialog.onclick = (event) => {
      if (this.blockContextRelease && event.detail !== 0) {
        event.preventDefault();
        return;
      }
      const action = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-action]",
      )?.dataset.action;
      if (!action) return;
      if (action === "retry-runs") {
        this.dialog.close();
        void this.flushOutbox().then(() => this.showPendingRuns());
        return;
      }
      if (action.startsWith("recover-run:")) {
        const run = this.outbox.find((r) => r.id === action.slice(12));
        if (!run?.replay) return;
        try {
          this.library.recordPractice(run.replay);
          if (this.library.warning) throw new Error("storage.saveFailed");
          this.dialog.close();
          this.openReplay(run.replay.id);
          this.toast(
            msg(
              "Saved as a local replay. Server verification is still pending.",
            ),
          );
        } catch (error) {
          this.toast(errorText(error), true);
        }
        return;
      }
      if (action.startsWith("discard-run:")) {
        const id = action.slice(12);
        this.showDialog(
          html`<h2>Remove this queued run?</h2>
            <p>
              This stops verification retries. Keep a local replay first if you
              want to watch it later.
            </p>
            ${button(`confirm-discard-run:${id}`, msg("Remove queued run"), undefined, "primary full")}${button("pending-runs", msg("Keep queued run"), undefined, "outline full")}`,
        );
        return;
      }
      if (action.startsWith("confirm-discard-run:")) {
        this.outbox = this.outbox.filter((r) => r.id !== action.slice(20));
        this.persistOutbox();
        this.showPendingRuns();
        this.render();
        return;
      }
      if (action === "pending-runs") {
        this.showPendingRuns();
        return;
      }
      if (action.startsWith("context:")) {
        this.dialog.close();
        this.root
          .querySelector<HTMLElement>(`[data-action="${action.slice(8)}"]`)
          ?.click();
        return;
      }
      if (action.startsWith("layer:")) {
        const layer = action.slice(6) as Category;
        if (this.hiddenLayers.has(layer)) this.hiddenLayers.delete(layer);
        else this.hiddenLayers.add(layer);
        this.selected = [];
        this.showLayers();
        return;
      }
      if (action === "usage-toggle") {
        this.telemetry.toggle();
        this.dialog.close();
        this.toast(
          this.telemetry.enabled
            ? msg("Usage analytics enabled.")
            : msg("Usage analytics disabled."),
        );
        return;
      }
      if (action.startsWith("template:")) {
        this.telemetry.track("DungeonCreated");
        this.recordTest();
        const dungeon = createTemplate(action.slice(9), Date.now() >>> 0);
        this.backupDraft();
        this.editor = new Editor(dungeon);
        this.library.updateDraft(dungeon);
        this.mode = "build";
        this.floor = 0;
        this.selected = [];
        this.onlineTicket = null;
        this.dialog.close();
        this.render();
        this.renderer.fit();
        return;
      }
      if (action === "close") this.dialog.close();
      else if (
        action === "confirm-new" ||
        action === "starter" ||
        action === "confirm-import"
      ) {
        this.recordTest();
        let dungeon =
          action === "starter"
            ? createStarter()
            : action === "confirm-import" && this.pendingImport
              ? this.pendingImport
              : createDungeon(crypto.randomUUID(), t("dungeon.untitled"));
        this.telemetry.track("DungeonCreated");
        if (action === "starter")
          dungeon = { ...dungeon, id: crypto.randomUUID() };
        this.backupDraft();
        this.editor = new Editor(dungeon);
        this.library.updateDraft(dungeon);
        this.mode = "build";
        this.tool = "room";
        this.selected = [];
        this.placement = null;
        this.replayPlaying = false;
        this.pendingImport = null;
        this.dialog.close();
        this.render();
        this.renderer.fit();
        this.toast(
          this.library.warning
            ? t("storage.saveFailed")
            : t(action === "confirm-import" ? "editor.imported" : "editor.new"),
          !!this.library.warning,
        );
      }
    };
    if (!this.dialog.open) this.dialog.showModal();
  }
  private importFile(): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        if (file.size > 500_000) throw new Error("storage.invalidDungeon");
        this.pendingImport = parseDungeon(JSON.parse(await file.text()));
        this.showDialog(
          html`<p class="eyebrow">${t("action.import")}</p>
            <h2>${escape(this.pendingImport.title)}</h2>
            <p>${t("new.body")}</p>
            ${button("confirm-import", t("action.import"), "upload", "primary full")}${button("close", t("new.cancel"), undefined, "quiet full")}`,
        );
      } catch (error) {
        this.toast(errorText(error), true);
      }
    };
    input.click();
  }
  private exportFile(): void {
    const blob = new Blob([JSON.stringify(this.activeDungeon, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${
      this.activeDungeon.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "dungeon"
    }.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  private toast(message: string, error = false): void {
    clearTimeout(this.toastTimer);
    this.toastElement.textContent = message;
    this.toastElement.className = `toast visible ${error ? "error" : ""}`;
    if (error) this.audio.play("error");
    this.toastTimer = window.setTimeout(
      () => this.toastElement.classList.remove("visible"),
      6500,
    );
  }
}
