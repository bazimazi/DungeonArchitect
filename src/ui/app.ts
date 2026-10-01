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
import { analyze } from "../services/analytics";
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
  `<button type="button" data-action="${action}" class="button ${classes}" ${disabled ? "disabled" : ""}>${glyph ? icon(glyph) : ""}<span>${escape(label)}</span></button>`;
const iconButton = (
  action: string,
  label: string,
  glyph: string,
  active = false,
  disabled = false,
): string =>
  `<button type="button" data-action="${action}" class="icon-button ${active ? "active" : ""}" title="${escape(label)}" aria-label="${escape(label)}" ${disabled ? "disabled" : ""}>${icon(glyph)}</button>`;

export class App {
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
  private replaySpeed = 1;
  private replayElapsed = 0;
  private lastFrame = 0;
  private selectedVersion = this.library.latest()?.id ?? "";
  private heatmap = true;
  private analytics: DungeonAnalytics = analyze([]);
  private toastTimer = 0;
  private reducedMotionMedia = matchMedia("(prefers-reduced-motion: reduce)");
  private toastElement = document.createElement("div");
  private dialog = document.createElement("dialog");
  private pendingImport: Dungeon | null = null;

  constructor(private root: HTMLDivElement) {
    this.audio.enabled = this.library.data.preferences.sound;
    this.toastElement.className = "toast";
    this.toastElement.setAttribute("role", "status");
    this.toastElement.setAttribute("aria-live", "polite");
    document.body.append(this.toastElement);
    this.dialog.className = "dialog";
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
    document.addEventListener("pointerup", () => {
      this.drawing = false;
      this.panStart = null;
    });
    document.addEventListener("pointercancel", () => {
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
  }
  private get activeDungeon(): Dungeon {
    return this.mode === "test" && this.simulation
      ? this.simulation.dungeon
      : this.mode === "replay" && this.replay
        ? this.replay.dungeon
        : this.mode === "analytics"
          ? (this.library.data.versions.find(
              (v) => v.id === this.selectedVersion,
            )?.dungeon ?? this.editor.dungeon)
          : this.editor.dungeon;
  }
  private get attempts(): Replay[] {
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
    this.analytics = analyze(this.attempts);
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
    this.root.innerHTML = `
      <header class="site-header"><a class="brand" href="#" data-action="build">${icon("castle")}<span>${t("brand.first")}<span class="brand-second">${t("brand.second")}</span></span></a>
        <nav aria-label="${t("nav.label")}"><button data-action="build" class="nav-link ${this.mode === "build" || this.mode === "test" ? "active" : ""}">${t("nav.workshop")}</button><button data-action="analytics" class="nav-link ${this.mode === "analytics" || this.mode === "replay" ? "active" : ""}">${t("nav.attempts")}<span class="nav-count">${this.library.data.attempts.length}</span></button><button data-action="guide" class="nav-link">${t("nav.guide")}</button></nav>
        <div class="header-right"><span class="local-label"><i></i>${t("status.local")}</span>${iconButton("sound", t("action.sound"), this.audio.enabled ? "sound" : "mute", this.audio.enabled)}</div>
      </header>
      <main><section class="page-heading"><div><p class="eyebrow">${this.mode === "analytics" || this.mode === "replay" ? t("analytics.title").toUpperCase() : t("hero.eyebrow")} <span>/ ${t("theme.cave").toUpperCase()}</span></p><h1>${this.mode === "analytics" ? t("analytics.subtitle") : this.mode === "replay" ? t("replay.title") : t("hero.title")}</h1><p class="subtitle">${this.mode === "analytics" || this.mode === "replay" ? t("analytics.local") : t("hero.subtitle")}</p></div><div class="heading-actions">${button("import", t("action.import"), "upload", "quiet")}${button("new", t("action.new"), "plus", "outline")}</div></section>
      <section class="workspace ${this.mode}"><aside class="palette panel">${this.mode === "build" ? this.palette(used) : this.mode === "test" ? this.testSidebar() : this.attemptSidebar()}</aside>
        <section class="dungeon-panel panel"><div class="dungeon-title"><div class="dungeon-name">${icon("leaf")}<div>${this.mode === "build" ? `<input id="dungeon-title" maxlength="60" aria-label="${t("dungeon.name")}" value="${escape(dungeon.title)}" />` : `<h2>${escape(dungeon.title)}</h2>`}<span>${t("status.floor")}</span></div></div><span class="status-pill ${isPublished ? "published" : ""}">${this.mode === "build" ? escape(versionLabel) : this.mode === "test" ? t("run.testBadge") : this.mode === "replay" ? t("run.replayBadge") : `v${this.library.data.versions.find((v) => v.id === this.selectedVersion)?.number ?? "—"}`}</span></div>
        <div class="canvas-toolbar"><div class="toolbar-left">${this.mode === "build" ? `${iconButton("select", t("tool.select"), "select", this.tool === "select")}${iconButton("undo", t("action.undo"), "undo", false, !this.editor.canUndo)}${iconButton("redo", t("action.redo"), "redo", false, !this.editor.canRedo)}<span class="divider"></span>${iconButton("grid", t("action.grid"), "grid", this.library.data.preferences.showGrid)}` : button("build", t("action.back"), "back", "quiet small")}${this.mode === "analytics" ? iconButton("heatmap", t("action.heatmap"), "fire", this.heatmap) : ""}</div><div class="toolbar-right">${iconButton("zoom-out", t("action.zoomOut"), "zoomOut")}${iconButton("fit", t("action.fit"), "fit")}${iconButton("zoom-in", t("action.zoomIn"), "zoomIn")}</div></div>
        <div class="canvas-wrap"><canvas id="dungeon-canvas" tabindex="0" role="application" aria-label="${t("canvas.label")}"></canvas>${this.mode === "test" && this.simulation?.state.status !== "playing" ? this.runOverlay() : ""}<span class="map-compass">N<span>↑</span></span></div>
        <div class="canvas-caption"><span>${icon(this.mode === "build" ? "select" : this.mode === "test" ? "play" : "eye")} ${this.mode === "build" ? t("canvas.hint") : this.mode === "test" ? t("canvas.testHint") : t("canvas.replayHint")}</span><span class="map-size">15 × 13</span></div>
        ${this.mode === "test" ? this.touchControls() : this.mode === "replay" ? this.replayControls() : this.mode === "analytics" ? `<div class="heatmap-legend"><span><i class="legend-visited"></i>${t("analytics.traffic")}</span><span><i class="legend-death"></i>${t("analytics.deathLegend")}</span></div>` : `<div class="build-actions"><span class="save-status ${this.library.warning ? "warning" : ""}">${icon(this.library.warning ? "flag" : "check")}${t(this.library.warning ? "status.unsaved" : "status.saved")}</span>${button("test", t("action.test"), "play", "primary")}</div>`}
        </section><aside class="inspector">${this.mode === "build" ? this.buildInspector(validation.valid) : this.mode === "test" ? this.runInspector() : this.mode === "replay" ? this.replayInspector() : this.analyticsInspector()}</aside>
      </section><footer class="site-footer"><span>${icon("castle")}${t("app.tagline")}</span><div>${button("guide", t("nav.guide"), "book", "quiet small")}${button("import", t("action.import"), "upload", "quiet small mobile-only")}${button("export", t("action.export"), "download", "quiet small")}${button("motion", t("action.motion"), undefined, `quiet small ${this.library.data.preferences.reducedMotion ? "active" : ""}`)}</div></footer></main>`;
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
    const categories: Category[] = ["rooms", "traps", "monsters", "objects"];
    const tools: Tool[] =
      this.category === "rooms"
        ? ["room", "floor", "wall", "erase"]
        : Object.values(CONTENT)
            .filter((d) => d.category === this.category)
            .map((d) => d.id);
    const toolName = Object.hasOwn(CONTENT, this.tool)
      ? t(`object.${this.tool}`)
      : t(`tool.${this.tool}`);
    return `<div class="panel-heading"><p class="eyebrow">${t("kit.title")}</p><span class="tiny-diamond">◇</span></div><div class="category-tabs" role="group" aria-label="${t("kit.categories")}">${categories.map((category) => `<button data-category="${category}" class="category ${this.category === category ? "active" : ""}" aria-pressed="${this.category === category}">${icon(category)}<span>${t(`category.${category}`)}</span></button>`).join("")}</div><p class="palette-hint">${t("kit.hint")}</p><div class="tool-grid">${tools
      .map((tool) => {
        const cost = Object.hasOwn(CONTENT, tool)
          ? CONTENT[tool as keyof typeof CONTENT].cost
          : tool === "room"
            ? 9
            : tool === "floor"
              ? 1
              : 0;
        return `<button data-tool="${tool}" class="tool-card ${this.tool === tool ? "active" : ""}" aria-pressed="${this.tool === tool}" title="${escape(t(`desc.${tool}`))}"><span class="tool-cost">${cost > 0 ? `${cost} ◇` : "—"}</span>${icon(tool)}<span>${escape(Object.hasOwn(CONTENT, tool) ? t(`object.${tool}`) : t(`tool.${tool}`))}</span></button>`;
      })
      .join(
        "",
      )}</div><div class="selected-description"><span class="eyebrow">${t("kit.selected")}</span><h3>${escape(toolName)}</h3><p>${escape(t(`desc.${this.tool}`))}</p></div><div class="budget-box"><div><span>${t("kit.budget")}</span><strong>${used}<span> / ${this.editor.dungeon.budget}</span></strong></div><div class="budget-track"><i style="width:${(used / this.editor.dungeon.budget) * 100}%" class="${used > 145 ? "near-limit" : ""}"></i></div><p>${t("kit.available", { count: this.editor.dungeon.budget - used })}</p></div>`;
  }
  private buildInspector(valid: boolean): string {
    const issues = validateDungeon(this.editor.dungeon).issues;
    const selected = this.editor.dungeon.objects.filter((o) =>
      this.selected.includes(o.id),
    );
    return `<section class="note-card"><div class="note-illustration">${icon("castle")}<span>✧</span></div><p class="eyebrow">${t("insight.title")}</p><h2>${t("insight.heading")}</h2><p>${t("insight.body")}</p><div class="note-rule"><span>◇</span></div></section>
      ${selected.length ? `<section class="selection-card panel"><p class="eyebrow">${selected.length === 1 ? t(`object.${selected[0].type}`) : t("kit.selectionCount", { count: selected.length })}</p><p>${this.placement ? t(`editor.${this.placement}Hint`) : selected.length === 1 ? t(`desc.${selected[0].type}`) : t("desc.select")}</p><div class="selection-actions">${iconButton("move", t("action.move"), "move", this.placement === "move")}${iconButton("duplicate", t("action.duplicate"), "duplicate", this.placement === "duplicate")}${iconButton("rotate", t("action.rotate"), "rotate")}${iconButton("delete", t("action.delete"), "delete")}</div></section>` : ""}
      <section class="publish-card panel"><h3>${t("check.title")}</h3><ul class="checklist"><li class="${!issues.some((i) => ["entrance", "treasure", "unreachable", "floor"].includes(i.code)) ? "done" : ""}">${icon("check")}${t("check.layout")}</li><li class="${!issues.some((i) => ["key", "spawn", "budget"].includes(i.code)) ? "done" : ""}">${icon("check")}${t("check.keys")}</li><li class="${this.library.tested ? "done" : ""}">${icon("check")}${t("check.test")}</li></ul>${button("validate", t("action.validate"), undefined, "text-button")}<p>${this.library.tested && valid ? t("check.ready") : t("check.testHint")}</p>${button("publish", t(this.library.latest() ? "action.republish" : "action.publish"), "flag", "gold full", !this.library.tested || !valid)}</section>
      ${this.library.data.practice.some((r) => r.dungeon.id === this.editor.dungeon.id) ? button("watch-test", t("action.watchTest"), "eye", "outline full") : ""}<section class="mini-stats"><span>${icon("eye")} ${t("analytics.adventureCount", { count: this.library.data.attempts.filter((a) => a.dungeon.id === this.editor.dungeon.id).length })}</span>${button("analytics", t("analytics.title"), "arrow", "quiet small")}</section>`;
  }
  private testSidebar(): string {
    return `<div class="panel-heading"><p class="eyebrow">${t("run.adventurer")}</p>${icon("play")}</div><div class="adventurer-portrait">${icon("guardian")}</div><h3 class="center">${t("run.playing")}</h3><p class="palette-hint">${t("check.testHint")}</p><div class="play-instructions"><div><kbd>W A S D</kbd><span>${t("run.arrowHint")}</span></div><div><kbd>SPACE</kbd><span>${t("action.attack")}</span></div><div><kbd>E</kbd><span>${t("action.wait")}</span></div></div><p class="test-tip">${t("run.tip")}</p>${button("restart", t("action.restart"), "rotate", "outline full")}`;
  }
  private runInspector(): string {
    const state = this.simulation!.state;
    const events = state.events
      .filter((e) => !["move", "spawn", "attack"].includes(e.kind))
      .slice(-6)
      .reverse();
    return `<section class="run-stats panel"><p class="eyebrow">${t("run.health")}</p><div class="health-value">${icon("heart")}<strong>${state.player.hp}<span> / 100</span></strong></div><div class="health-track"><i style="width:${state.player.hp}%"></i></div><div class="run-stat"><span>${icon("clock")}${t("run.time")}</span><strong>${duration((state.tick * TICK_MS) / 1000)}</strong></div><div class="run-stat key-stat ${state.player.hasKey ? "collected" : ""}">${icon("key")}${t(state.player.hasKey ? "run.key" : "run.noKey")}</div></section><section class="event-card panel"><p class="eyebrow">${t("run.log")}</p><ol class="event-list">${events.map((e) => `<li><span>${icon(e.kind === "damage" || e.kind === "death" ? "heart" : e.kind === "key" ? "key" : e.kind === "trap" ? "fire" : "check")}</span><div>${t(`event.${e.kind}`)}${e.amount ? ` <b>${e.amount}</b>` : ""}<small>${e.reason && Object.hasOwn(CONTENT, e.reason) ? t(`object.${e.reason}`) : duration((e.tick * TICK_MS) / 1000)}</small></div></li>`).join("") || `<li class="muted">${t("event.spawn")}</li>`}</ol></section>`;
  }
  private runOverlay(): string {
    const status = this.simulation!.state.status;
    return `<div class="run-overlay"><div class="result-card ${status}" role="status">${icon(status === "completed" ? "treasure" : "monsters")}<p class="eyebrow">${t(status === "completed" ? "run.completeBadge" : "run.endBadge")}</p><h2>${t(`run.${status}`)}</h2><p>${t(`run.${status}Body`)}</p><div>${button("build", t("action.back"), "back", "primary")}${status !== "completed" ? button("restart", t("action.restart"), "rotate", "outline") : ""}${button("watch-test", t("action.watchTest"), "eye", "quiet small")}</div></div></div>`;
  }
  private touchControls(): string {
    return `<div class="touch-controls"><div class="dpad">${(["up", "left", "down", "right"] as const).map((direction) => `<button class="direction ${direction}" data-direction="${direction}" aria-label="${t("run.move", { direction: t(`direction.${direction}`) })}">${icon(direction)}</button>`).join("")}</div><div class="combat-controls">${button("attack", t("action.attack"), "skeleton", "primary")}${button("wait", t("action.wait"), "clock", "outline")}</div></div>`;
  }
  private attemptSidebar(): string {
    const versions = this.library.data.versions;
    return `<div class="panel-heading"><p class="eyebrow">${t("analytics.recent")}</p>${icon("eye")}</div><label class="field-label" for="version-select">${t("analytics.version")}</label><select id="version-select" ${versions.length ? "" : "disabled"}>${
      versions.length
        ? [...versions]
            .reverse()
            .map(
              (v) =>
                `<option value="${escape(v.id)}" ${v.id === this.selectedVersion ? "selected" : ""}>${escape(v.dungeon.title)} · v${v.number}</option>`,
            )
            .join("")
        : `<option>${t("analytics.noVersions")}</option>`
    }</select><div class="attempt-list">${
      this.attempts
        .slice()
        .reverse()
        .map((attempt) => {
          const state = reconstructReplay(attempt).state;
          return `<button class="attempt-card ${attempt.id === this.replay?.id && this.mode === "replay" ? "active" : ""}" data-replay="${escape(attempt.id)}"><span class="attempt-avatar ${state.status}">${icon(state.status === "completed" ? "treasure" : "monsters")}</span><span><strong>${escape(attempt.adventurer.split(" · ")[0])}</strong><small>${escape(attempt.adventurer.split(" · ")[1] ?? "Architect")}</small><em class="${state.status}">${t(state.status === "completed" ? "run.cleared" : state.status === "dead" ? "run.failed" : "run.incomplete")}</em></span><span class="attempt-time">${duration((state.tick * TICK_MS) / 1000)}${icon("play")}</span></button>`;
        })
        .join("") ||
      `<div class="empty-attempts">${icon("eye")}<p>${t("replay.empty")}</p></div>`
    }</div>${button("simulate", t("action.simulate"), "plus", "outline full", !this.selectedVersion)}`;
  }
  private analyticsInspector(): string {
    const stats = this.analytics;
    const version = this.library.data.versions.find(
      (v) => v.id === this.selectedVersion,
    );
    const deadly =
      stats.deadliest &&
      version?.dungeon.objects.find((o) => o.id === stats.deadliest!.objectId);
    const versions = this.library.data.versions.filter(
      (v) => v.dungeon.id === version?.dungeon.id,
    );
    return `<section class="analytics-card panel"><p class="eyebrow">${t("analytics.title")}</p><div class="stat-grid"><div><strong>${stats.attempts}</strong><span>${t("analytics.attempts")}</span></div><div><strong>${Math.round(stats.completionRate)}<small>%</small></strong><span>${t("analytics.clears")}</span></div><div><strong>${stats.deaths}</strong><span>${t("analytics.deaths")}</span></div><div><strong>${duration(stats.averageSeconds)}</strong><span>${t("analytics.time")}</span></div></div></section><section class="note-card compact">${icon("fire")}<h2>${stats.attempts ? (deadly ? t(`object.${deadly.type}`) : t("analytics.brave")) : t("analytics.empty")}</h2><p>${stats.attempts ? (deadly ? t("analytics.fell", { deaths: stats.deadliest!.count, attempts: stats.attempts }) : t("analytics.noDeaths")) : t("analytics.emptyBody")}</p></section>${
      versions.length > 1
        ? `<section class="panel version-comparison"><p class="eyebrow">${t("analytics.history")}</p>${versions
            .map((v) => {
              const summary = analyze(
                this.library.data.attempts.filter(
                  (a) => a.dungeonVersionId === v.id,
                ),
              );
              return `<div><strong>v${v.number}</strong><span>${t("analytics.attemptCount", { count: summary.attempts })}</span><b>${summary.attempts ? t("analytics.clearPercent", { percent: Math.round(summary.completionRate) }) : "—"}</b></div>`;
            })
            .join("")}</section>`
        : ""
    }`;
  }
  private replayControls(): string {
    return `<div class="replay-controls"><div class="replay-slider"><span id="replay-time">00:00</span><input type="range" id="replay-position" min="0" max="${this.replay!.actions.length}" value="${this.replayTick}" aria-label="${t("replay.timeline")}"/><span>${duration((this.replay!.actions.length * TICK_MS) / 1000)}</span></div><div class="replay-buttons">${iconButton("replay-restart", t("action.restart"), "rotate")}${iconButton("replay-toggle", t("action.play"), "play")}<select id="replay-speed" aria-label="${t("replay.speed")}">${[0.5, 1, 2, 4].map((speed) => `<option value="${speed}" ${speed === this.replaySpeed ? "selected" : ""}>${speed}×</option>`).join("")}</select>${button("jump-death", t("action.death"), "monsters", "quiet small", !reconstructReplay(this.replay!).state.events.some((e) => e.kind === "death"))}</div></div>`;
  }
  private replayInspector(): string {
    const events = reconstructReplay(this.replay!).state.events.filter(
      (e) => !["move", "blocked", "attack", "damage"].includes(e.kind),
    );
    return `<section class="replay-summary panel"><p class="eyebrow">${escape(this.replay!.adventurer)}</p><div id="replay-health" class="health-value"></div><p class="muted">${t("canvas.replayHint")}</p></section><section class="event-card panel"><p class="eyebrow">${t("replay.moments")}</p><ol class="event-list replay-events">${events.map((e) => `<li><button data-tick="${e.tick}"><span class="event-time">${duration((e.tick * TICK_MS) / 1000)}</span><span>${t(`event.${e.kind}`)}</span>${icon(e.kind === "death" ? "monsters" : e.kind === "key" ? "key" : "check")}</button></li>`).join("")}</ol></section>${button("analytics", t("action.overview"), "back", "outline full")}`;
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
      if (action === "build") {
        this.recordTest();
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
      else if (action === "new") this.showNew();
      else if (action === "import") this.importFile();
      else if (action === "export") this.exportFile();
      else if (action === "test" || action === "restart") this.startTest();
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
      } else if (action === "zoom-in")
        this.renderer.zoom = Math.min(2.2, this.renderer.zoom + 0.2);
      else if (action === "zoom-out")
        this.renderer.zoom = Math.max(0.7, this.renderer.zoom - 0.2);
      else if (action === "fit") this.renderer.fit();
      else if (action === "validate") this.showValidation();
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
    if (clearSelection) this.selected = [];
    this.library.updateDraft(this.editor.dungeon);
    this.render();
    if (this.library.warning) this.toast(t("storage.saveFailed"), true);
  }
  private pointerDown(event: PointerEvent): void {
    if ((event.target as HTMLElement).tagName !== "CANVAS") return;
    const point = this.renderer.point(event.clientX, event.clientY);
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
    const key = `${point.x},${point.y}`;
    if (this.drawing && key === this.lastPaint) return;
    this.lastPaint = key;
    try {
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
      } else if (key === "e") {
        event.preventDefault();
        this.act({ type: "wait" });
      }
    } else if (this.mode === "build") {
      try {
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
            y: Math.max(0, Math.min(12, this.cursor.y + delta.y)),
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
    this.recordTest();
    const result = validateDungeon(this.editor.dungeon);
    if (!result.valid) {
      this.showValidation();
      return;
    }
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
      this.library.certify(this.simulation.replay());
      this.audio.play("success");
    } else
      this.audio.play(
        events.some((e) => e.kind === "damage")
          ? "damage"
          : events.some((e) => e.kind === "attack")
            ? "attack"
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
      ...this.library.data.attempts,
      ...this.library.data.practice,
    ].find((a) => a.id === id);
    if (!replay) return;
    this.replay = replay;
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
      this.library.recordPractice(this.simulation.replay(t("run.architect")));
      this.testRecorded = true;
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
      health.innerHTML = `${icon("heart")}<strong>${this.simulation.state.player.hp}<span> / 100</span></strong>`;
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
    this.renderer.draw({
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
      `<div class="dialog-glyph">${icon(result.valid ? "check" : "flag")}</div><h2>${t("action.validate")}</h2>${result.valid ? `<p>${t("validation.success")}</p>` : `<ul class="validation-issues">${result.issues.map((issue) => `<li>${t(issue.messageKey)}${issue.point ? ` <small>(${issue.point.x + 1}, ${String.fromCharCode(65 + issue.point.y)})</small>` : ""}</li>`).join("")}</ul>`}${button("close", t("action.close"), undefined, "primary full")}`,
    );
  }
  private showGuide(): void {
    this.showDialog(
      `<p class="eyebrow">${t("nav.guide")}</p><h2>${t("guide.title")}</h2><p>${t("guide.intro")}</p>${["build", "test", "watch"].map((section) => `<h3>${t(`guide.${section}`)}</h3><p>${t(`guide.${section}Body`)}</p>`).join("")}<p class="guide-shortcuts">${t("guide.shortcuts")}</p><p class="muted">${t("guide.scope")}</p>${button("close", t("action.close"), undefined, "primary full")}`,
    );
  }
  private showNew(): void {
    this.pendingImport = null;
    this.showDialog(
      `<p class="eyebrow">${t("new.badge")}</p><h2>${t("new.title")}</h2><p>${t("new.body")}</p>${button("confirm-new", t("new.confirm"), "plus", "primary full")}${button("starter", t("action.starter"), "castle", "outline full")}${button("close", t("new.cancel"), undefined, "quiet full")}`,
    );
  }
  private showDialog(html: string): void {
    this.dialog.innerHTML = `<div class="dialog-content">${iconButton("close", t("action.close"), "close")} ${html}</div>`;
    this.dialog.onclick = (event) => {
      const action = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-action]",
      )?.dataset.action;
      if (!action) return;
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
        if (action === "starter")
          dungeon = { ...dungeon, id: crypto.randomUUID() };
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
    this.dialog.showModal();
  }
  private importFile(): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        if (file.size > 100_000) throw new Error("storage.invalidDungeon");
        this.pendingImport = parseDungeon(JSON.parse(await file.text()));
        this.showDialog(
          `<p class="eyebrow">${t("action.import")}</p><h2>${escape(this.pendingImport.title)}</h2><p>${t("new.body")}</p>${button("confirm-import", t("action.import"), "upload", "primary full")}${button("close", t("new.cancel"), undefined, "quiet full")}`,
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
