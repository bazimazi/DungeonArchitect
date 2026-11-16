/** In-game HUD floating over the fullscreen world. */
import {
  HEROES,
  MUTATORS,
  PIECES,
  OMENS,
  POWERS,
  heatOf,
  powerCost,
  type OmenId,
  isChampion,
  roman,
  type HeroClass,
  type MutatorId,
  type PieceId,
  type PowerId,
} from "../game/defs";
import type { PartyMember, Raid } from "../game/sim";
import { countTo, h, heroArt, icon, pieceArt } from "./dom";

export interface TrayItem {
  id: PieceId;
  cost: number;
  affordable: boolean;
  tier: number;
  fresh: boolean;
}
export interface HudHandlers {
  tool(id: PieceId | "dig" | null): void;
  undo(): void;
  start(): void;
  menu(): void;
  sound(): void;
  power(id: PowerId): void;
  speed(): void;
  pause(): void;
  rotate(): void;
  sell(): void;
  hero(cls: HeroClass, el: HTMLElement): void;
  share(): void;
  testNight(delta: number): void;
}

export class Hud {
  root: HTMLElement;
  private top: HTMLElement;
  private nightEl: HTMLElement;
  private pips: HTMLElement;
  private goldEl: HTMLElement;
  private goldBox: HTMLElement;
  private hoardEl: HTMLElement;
  private hoardBox: HTMLElement;
  private dreadBox: HTMLElement;
  private dreadFill: HTMLElement;
  private dreadText: HTMLElement;
  private capBox: HTMLElement;
  private capEl: HTMLElement;
  private mutEl: HTMLElement;
  private badge!: HTMLElement;
  private party: HTMLElement;
  private partyTitle: HTMLElement;
  private partyList: HTMLElement;
  private tray: HTMLElement;
  private trayItems: HTMLElement;
  private digBtn: HTMLButtonElement;
  private undoBtn: HTMLButtonElement;
  private startBtn: HTMLButtonElement;
  private routeEl: HTMLElement;
  private raidBar: HTMLElement;
  private powersEl: HTMLElement;
  private speedBtn: HTMLButtonElement;
  private pauseBtn: HTMLButtonElement;
  private soundBtn: HTMLButtonElement;
  private info: HTMLElement;
  private toasts: HTMLElement;
  private bannerEl: HTMLElement;
  private coachEl: HTMLElement;
  private comboEl: HTMLElement;
  private shareBtn: HTMLButtonElement;
  private wsLabel: HTMLElement;
  private rosterCells = new Map<
    number,
    { bar: HTMLElement; cell: HTMLElement }
  >();
  private lastTray = "";
  private hd: HudHandlers;
  private infoTimer = 0;

  constructor(root: HTMLElement, hd: HudHandlers) {
    this.root = root;
    this.hd = hd;
    this.nightEl = h("span", { class: "night-num" }, "1");
    this.pips = h("span", { class: "pips" });
    this.goldEl = h("b", { class: "num" }, "0");
    this.goldBox = h(
      "div",
      { class: "res gold", title: "Gold" },
      icon("coin"),
      this.goldEl,
    );
    this.hoardEl = h("b", { class: "num" }, "0");
    this.hoardBox = h(
      "div",
      { class: "res hoard", title: "Treasure in your hoard" },
      icon("hoard"),
      this.hoardEl,
    );
    this.dreadFill = h("i");
    this.dreadText = h("b", { class: "num" }, "0");
    this.dreadBox = h(
      "div",
      { class: "res dread", title: "Dread: spend on powers" },
      icon("dread"),
      h("span", { class: "meter" }, this.dreadFill),
      this.dreadText,
    );
    this.capEl = h("b", { class: "num" }, "0");
    this.capBox = h(
      "div",
      {
        class: "res cap",
        title: "Pieces placed / dungeon capacity (grows each night)",
      },
      icon("blocks"),
      this.capEl,
    );
    this.mutEl = h("div", { class: "mutators" });
    this.soundBtn = h(
      "button",
      {
        class: "icon-btn",
        "aria-label": "Toggle sound",
        onclick: () => hd.sound(),
      },
      icon("sound"),
    );
    this.shareBtn = h(
      "button",
      {
        class: "icon-btn",
        "aria-label": "Share dungeon",
        onclick: () => hd.share(),
      },
      icon("share"),
    );
    this.top = h(
      "header",
      { class: "hud-top" },
      (this.badge = h(
        "div",
        { class: "night-badge" },
        h("small", {}, "Night"),
        this.nightEl,
        this.pips,
      )),
      h(
        "div",
        { class: "resources" },
        this.goldBox,
        this.hoardBox,
        this.capBox,
        this.dreadBox,
      ),
      h(
        "div",
        { class: "top-actions" },
        this.shareBtn,
        this.soundBtn,
        h(
          "button",
          { class: "icon-btn", "aria-label": "Menu", onclick: () => hd.menu() },
          icon("menu"),
        ),
      ),
    );
    this.partyTitle = h("span", { class: "party-title" }, "Tonight");
    this.partyList = h("div", { class: "party-list" });
    this.party = h(
      "div",
      { class: "party" },
      this.mutEl,
      this.partyTitle,
      this.partyList,
    );

    this.digBtn = h(
      "button",
      {
        class: "tool dig",
        "aria-label": "Dig or fill rock",
        onclick: () => hd.tool("dig"),
      },
      icon("pick"),
      h("span", { class: "lbl" }, "Dig"),
      h("kbd", {}, "D"),
    );
    this.undoBtn = h(
      "button",
      { class: "tool undo", "aria-label": "Undo", onclick: () => hd.undo() },
      icon("undo"),
      h("span", { class: "lbl" }, "Undo"),
    );
    this.trayItems = h("div", { class: "tray-items" });
    this.routeEl = h("span", { class: "route" });
    this.startBtn = h(
      "button",
      { class: "start-btn", onclick: () => hd.start() },
      h("span", { class: "moon" }),
      h(
        "span",
        { class: "start-text" },
        h("b", {}, "Begin Night"),
        this.routeEl,
      ),
    );
    this.wsLabel = h("b", {}, "3");
    const ws = h(
      "div",
      { class: "ws-night" },
      h(
        "button",
        {
          class: "icon-btn",
          "aria-label": "Easier test party",
          onclick: () => hd.testNight(-1),
        },
        "−",
      ),
      h("span", {}, h("small", {}, "Test night"), this.wsLabel),
      h(
        "button",
        {
          class: "icon-btn",
          "aria-label": "Harder test party",
          onclick: () => hd.testNight(1),
        },
        "+",
      ),
    );
    this.tray = h(
      "footer",
      { class: "tray" },
      h(
        "div",
        { class: "tray-row" },
        this.digBtn,
        this.trayItems,
        this.undoBtn,
      ),
      ws,
      this.startBtn,
    );

    this.powersEl = h("div", { class: "powers" });
    this.speedBtn = h(
      "button",
      {
        class: "round-btn speed",
        "aria-label": "Change speed",
        onclick: () => hd.speed(),
      },
      "1×",
    );
    this.pauseBtn = h(
      "button",
      { class: "round-btn", "aria-label": "Pause", onclick: () => hd.pause() },
      icon("pause"),
    );
    this.raidBar = h(
      "footer",
      { class: "raid-bar" },
      this.powersEl,
      h("div", { class: "time-ctrl" }, this.pauseBtn, this.speedBtn),
    );

    this.info = h("div", { class: "info-card", hidden: true });
    this.toasts = h("div", { class: "toasts", "aria-live": "polite" });
    this.bannerEl = h("div", { class: "banner" });
    this.coachEl = h("div", { class: "coach", hidden: true });
    this.comboEl = h("div", { class: "combo" });
    root.append(
      this.top,
      this.party,
      this.tray,
      this.raidBar,
      this.info,
      this.toasts,
      this.bannerEl,
      this.comboEl,
      this.coachEl,
    );
  }

  setMode(
    mode: "hidden" | "build" | "raid" | "after",
    kind: "run" | "workshop" | "challenge" | "trial" = "run",
  ) {
    this.root.dataset.mode = mode;
    this.root.dataset.kind = kind;
    if (mode !== "build") this.hideInfo();
  }

  setNight(n: number, total: number, stars: number[]) {
    this.nightEl.textContent = String(n);
    this.badge.classList.toggle("abyss", n > total);
    if (n > total) {
      // In the abyss the pips count down to the next champion (every 5th night).
      const start = Math.floor((n - 1) / 5) * 5 + 1;
      this.pips.replaceChildren(
        ...Array.from({ length: 5 }, (_, i) => {
          const night = start + i;
          return h("i", {
            class:
              night < n
                ? `done s${stars[night - 1] ?? 0}`
                : night === n
                  ? "now"
                  : night % 5 === 0
                    ? "boss"
                    : "",
          });
        }),
      );
      return;
    }
    this.pips.replaceChildren(
      ...Array.from({ length: total }, (_, i) =>
        h("i", {
          class:
            i < n - 1
              ? `done s${stars[i] ?? 0}`
              : i === n - 1
                ? "now"
                : i === total - 1
                  ? "boss"
                  : "",
        }),
      ),
    );
  }
  setTestNight(n: number) {
    this.wsLabel.textContent = String(n);
  }
  setNightLabel(label: string) {
    this.nightEl.textContent = label;
    this.badge.classList.remove("abyss");
    this.pips.replaceChildren();
  }
  setCapacity(used: number, cap: number) {
    this.capBox.hidden = !Number.isFinite(cap);
    if (!Number.isFinite(cap)) return;
    this.capEl.textContent = `${used}/${cap}`;
    this.capBox.classList.toggle("full", used >= cap);
  }
  pulseCapacity() {
    this.capBox.classList.remove("bad");
    void this.capBox.offsetWidth;
    this.capBox.classList.add("bad");
  }
  setMutators(ids: MutatorId[], omens: OmenId[] = []) {
    const heat = heatOf(omens);
    this.mutEl.replaceChildren(
      ...(heat
        ? [
            h(
              "button",
              {
                class: "mut heat",
                title: omens.map((o) => OMENS[o].name).join(", "),
                onclick: () =>
                  this.toast(
                    `Heat ${heat}: ${omens.map((o) => OMENS[o].name).join(", ")}`,
                    "info",
                  ),
              },
              `Heat ${heat}`,
            ),
          ]
        : []),
      ...ids.map((id) => {
        const m = MUTATORS[id];
        return h(
          "button",
          {
            class: `mut${m.good ? " good" : ""}`,
            title: m.text,
            onclick: () => this.toast(`${m.name}: ${m.text}`, "info"),
          },
          m.name,
        );
      }),
    );
  }

  setGold(v: number, infinite = false) {
    if (infinite) {
      this.goldEl.textContent = "∞";
      this.goldEl.dataset.v = "0";
    } else countTo(this.goldEl, v, 400);
  }
  pulseGold(bad = false) {
    this.goldBox.classList.remove("bad", "good");
    void this.goldBox.offsetWidth;
    this.goldBox.classList.add(bad ? "bad" : "good");
  }
  setHoard(v: number, max: number) {
    const prev = Number(this.hoardEl.dataset.v ?? v);
    this.hoardEl.dataset.v = String(v);
    this.hoardEl.textContent = `${v}/${max}`;
    if (v !== prev) {
      this.hoardBox.classList.remove("bad", "good");
      void this.hoardBox.offsetWidth;
      this.hoardBox.classList.add(v < prev ? "bad" : "good");
    }
    this.hoardBox.classList.toggle("low", v <= Math.ceil(max * 0.3));
  }
  setDread(v: number, max = 15) {
    this.dreadFill.style.width = `${(v / max) * 100}%`;
    this.dreadText.textContent = String(Math.floor(v));
  }
  goldRect() {
    return this.goldBox.querySelector(".ic")!.getBoundingClientRect();
  }
  hoardRect() {
    return this.hoardBox.querySelector(".ic")!.getBoundingClientRect();
  }
  dreadRect() {
    return this.dreadBox.querySelector(".ic")!.getBoundingClientRect();
  }

  setParty(party: PartyMember[], title: string, fog = false) {
    this.partyTitle.textContent = title;
    this.rosterCells.clear();
    this.partyList.replaceChildren(
      ...party.map((p) => {
        if (fog)
          return h(
            "button",
            {
              class: "hero-chip fogged",
              "data-name": "Unknown hero",
              "aria-label": "Unknown hero (thick fog)",
            },
            "?",
          );
        const cell = h(
          "button",
          {
            class: `hero-chip${p.elite ? " elite" : ""}${isChampion(p.cls) ? " boss" : ""}`,
            "data-name": `${p.elite ? "Elite " : ""}${HEROES[p.cls].name}`,
            "aria-label": `${HEROES[p.cls].name}${p.elite ? " (elite)" : ""}`,
          },
          heroArt(p.cls, 40, p.elite),
          h("span", { class: "hp" }, h("i")),
        );
        cell.addEventListener("click", () => this.hd.hero(p.cls, cell));
        return cell;
      }),
    );
  }
  /** Bind roster chips to live heroes (same order as the party). */
  bindRoster(raid: Raid) {
    const cells = [...this.partyList.children] as HTMLElement[];
    raid.heroes.forEach((hero, i) => {
      const cell = cells[i];
      if (cell)
        this.rosterCells.set(hero.uid, {
          cell,
          bar: cell.querySelector(".hp i") as HTMLElement,
        });
    });
  }
  updateRoster(raid: Raid) {
    for (const hero of raid.heroes) {
      const r = this.rosterCells.get(hero.uid);
      if (!r) continue;
      r.bar.style.width = `${(hero.hp / hero.maxHp) * 100}%`;
      r.cell.classList.toggle("dead", hero.state === "dead");
      r.cell.classList.toggle("gone", hero.state === "escaped");
      r.cell.classList.toggle("waiting", !hero.spawned);
      r.cell.classList.toggle("loot", hero.loot > 0);
    }
  }

  setTray(
    items: TrayItem[],
    tool: PieceId | "dig" | null,
    canUndo: boolean,
    digCost: number,
  ) {
    const key = JSON.stringify([items, tool, canUndo, digCost]);
    this.digBtn.classList.toggle("on", tool === "dig");
    this.undoBtn.disabled = !canUndo;
    (this.digBtn.querySelector(".lbl") as HTMLElement).textContent = digCost
      ? `Dig ${digCost}`
      : "Dig";
    if (key === this.lastTray) return;
    const prevScroll = this.trayItems.scrollLeft;
    this.lastTray = key;
    this.trayItems.replaceChildren(
      ...items.map((it, i) =>
        h(
          "button",
          {
            class: `piece${tool === it.id ? " on" : ""}${it.affordable ? "" : " poor"}${it.fresh ? " fresh" : ""} k-${PIECES[it.id].kind}`,
            "data-piece": it.id,
            "aria-label": `${PIECES[it.id].name}, ${it.cost} gold`,
            onclick: () => this.hd.tool(it.id),
          },
          pieceArt(it.id, 46),
          h(
            "span",
            { class: "cost" },
            icon("coin", "ic tiny"),
            String(it.cost),
          ),
          it.tier > 1 ? h("span", { class: "tier" }, roman(it.tier)) : null,
          i < 9 ? h("kbd", {}, String(i + 1)) : null,
        ),
      ),
    );
    this.trayItems.scrollLeft = prevScroll;
  }
  setRoute(len: number, ok: boolean) {
    this.routeEl.textContent = ok ? `Route ${len} tiles` : "No route to hoard!";
    this.startBtn.classList.toggle("blocked", !ok);
  }
  setStartLabel(text: string) {
    (this.startBtn.querySelector("b") as HTMLElement).textContent = text;
  }
  pieceButton(id: PieceId) {
    return this.trayItems.querySelector(
      `[data-piece="${id}"]`,
    ) as HTMLElement | null;
  }
  get startButton() {
    return this.startBtn;
  }
  get digButton() {
    return this.digBtn;
  }

  setPowers(
    powers: PowerId[],
    dread: number,
    cooldowns: Record<string, number>,
    selected: PowerId | null,
    relics: readonly string[] = [],
  ) {
    if (this.powersEl.childElementCount !== powers.length) {
      this.powersEl.replaceChildren(
        ...powers.map((p) =>
          h(
            "button",
            {
              class: "power",
              "data-power": p,
              "aria-label": POWERS[p].name,
              onclick: () => this.hd.power(p),
            },
            icon(
              p === "rockfall"
                ? "rock"
                : p === "chill"
                  ? "chill"
                  : p === "sinkhole"
                    ? "abyss"
                    : "shriek",
            ),
            h("span", { class: "pname" }, POWERS[p].name),
            h(
              "span",
              { class: "pcost" },
              icon("dread", "ic tiny"),
              String(powerCost(p, relics)),
            ),
            h("i", { class: "cd" }),
          ),
        ),
      );
    }
    for (const el of this.powersEl.children as HTMLCollectionOf<HTMLElement>) {
      const p = el.dataset.power as PowerId;
      const cd = cooldowns[p] ?? 0;
      el.classList.toggle("on", selected === p);
      const cost = powerCost(p, relics);
      el.classList.toggle("poor", dread < cost);
      el.classList.toggle("ready", dread >= cost && cd <= 0);
      (el.querySelector(".cd") as HTMLElement).style.height =
        `${Math.max(0, cd / POWERS[p].cooldown) * 100}%`;
    }
  }
  powerButton(p: PowerId) {
    return this.powersEl.querySelector(
      `[data-power="${p}"]`,
    ) as HTMLElement | null;
  }
  setSpeed(speed: number, paused: boolean) {
    this.speedBtn.textContent = `${speed}×`;
    this.pauseBtn.replaceChildren(icon(paused ? "play" : "pause"));
    this.pauseBtn.classList.toggle("on", paused);
  }
  setSound(muted: boolean) {
    this.soundBtn.replaceChildren(icon(muted ? "mute" : "sound"));
  }
  showShare(show: boolean) {
    this.shareBtn.hidden = !show;
  }

  showInfo(
    content: (HTMLElement | string)[],
    actions: HTMLElement[] = [],
    autoHideMs = 0,
  ) {
    clearTimeout(this.infoTimer);
    const close = h(
      "button",
      {
        class: "info-close",
        "aria-label": "Close",
        onclick: () => this.hideInfo(),
      },
      icon("close"),
    );
    this.info.replaceChildren(
      close,
      ...content,
      actions.length ? h("div", { class: "info-actions" }, ...actions) : "",
    );
    if (autoHideMs)
      this.infoTimer = window.setTimeout(() => this.hideInfo(), autoHideMs);
    this.info.hidden = false;
    this.info.classList.remove("in");
    void this.info.offsetWidth;
    this.info.classList.add("in");
  }
  hideInfo() {
    this.info.hidden = true;
  }

  toast(text: string, kind: "info" | "bad" | "good" | "gold" = "info") {
    const el = h("div", { class: `toast ${kind}` }, text);
    this.toasts.append(el);
    while (this.toasts.childElementCount > 3)
      this.toasts.firstElementChild?.remove();
    setTimeout(() => el.classList.add("out"), 2600);
    setTimeout(() => el.remove(), 3000);
  }
  banner(title: string, sub = "", kind = "") {
    this.bannerEl.className = `banner show ${kind}`;
    this.bannerEl.replaceChildren(
      h("b", {}, title),
      sub ? h("span", {}, sub) : "",
    );
    clearTimeout((this.bannerEl as unknown as { t: number }).t);
    (this.bannerEl as unknown as { t: number }).t = window.setTimeout(
      () => this.bannerEl.classList.remove("show"),
      1900,
    );
  }
  combo(n: number, gold: number) {
    this.comboEl.replaceChildren(
      h("b", {}, `${n}× COMBO`),
      h("span", {}, `+${gold} gold`),
    );
    this.comboEl.classList.remove("show");
    void this.comboEl.offsetWidth;
    this.comboEl.classList.add("show");
  }

  /** Contextual coach mark pointing at an element or screen position. */
  coach(
    text: string | null,
    target?: HTMLElement | { x: number; y: number } | null,
    place: "above" | "below" = "above",
  ) {
    document
      .querySelectorAll(".pulse-target")
      .forEach((e) => e.classList.remove("pulse-target"));
    if (!text) {
      this.coachEl.hidden = true;
      return;
    }
    this.coachEl.hidden = false;
    this.coachEl.textContent = text;
    let x = window.innerWidth / 2;
    let y = window.innerHeight * 0.4;
    if (target instanceof HTMLElement) {
      target.classList.add("pulse-target");
      const r = target.getBoundingClientRect();
      x = r.left + r.width / 2;
      y = place === "above" ? r.top - 12 : r.bottom + 12;
    } else if (target) {
      x = target.x;
      y = target.y;
    }
    this.coachEl.dataset.place = place;
    const w = Math.min(280, window.innerWidth - 24);
    this.coachEl.style.maxWidth = `${w}px`;
    const half = Math.min(w, this.coachEl.offsetWidth || w) / 2;
    const cx = Math.max(12 + half, Math.min(window.innerWidth - 12 - half, x));
    this.coachEl.style.left = `${cx}px`;
    this.coachEl.style.top = `${y}px`;
    this.coachEl.style.setProperty("--arrow", `${x - cx}px`);
  }
}
