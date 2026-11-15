/** Full-screen and modal overlays. Each returns its root; callers close it. */
import { audio } from "../engine/audio";
import {
  ARCHITECTS,
  BIOMES,
  HEROES,
  INFAMY_TEXT,
  NIGHTS,
  PIECES,
  POWERS,
  RELICS,
  UNLOCKS,
  type ArchitectDef,
  type Biome,
  type HeroClass,
  type PieceId,
} from "../game/defs";
import type { Profile } from "../game/profile";
import {
  nextUnlock,
  unlockedArchitects,
  unlockedBiomes,
  unlockedPieces,
} from "../game/profile";
import type { Card, NightRecord, RunState } from "../game/run";
import type { RaidResult } from "../game/sim";
import { fmt, h, heroArt, icon, pieceArt } from "./dom";

export class Layer {
  root: HTMLElement;
  private stack: HTMLElement[] = [];
  private dismiss = new Map<HTMLElement, () => void>();
  constructor(root: HTMLElement) {
    this.root = root;
  }
  open(
    el: HTMLElement,
    opts: { modal?: boolean; onDismiss?: () => void } = {},
  ) {
    const wrap = h("div", { class: `layer${opts.modal ? " modal" : ""}` }, el);
    if (opts.onDismiss) {
      this.dismiss.set(wrap, opts.onDismiss);
      wrap.addEventListener("pointerdown", (e) => {
        if (e.target === wrap) {
          audio.play("click");
          opts.onDismiss!();
        }
      });
    }
    this.root.append(wrap);
    this.stack.push(wrap);
    requestAnimationFrame(() => wrap.classList.add("in"));
    const first = el.querySelector<HTMLElement>(
      "[autofocus], button:not([disabled])",
    );
    first?.focus({ preventScroll: true });
    return () => this.close(wrap);
  }
  close(wrap?: HTMLElement) {
    const w = wrap ?? this.stack[this.stack.length - 1];
    if (!w) return;
    this.stack = this.stack.filter((x) => x !== w);
    this.dismiss.delete(w);
    w.classList.remove("in");
    w.classList.add("out");
    setTimeout(() => w.remove(), 220);
  }
  /** Escape / back: only closes layers that allow dismissal. */
  dismissTop() {
    const top = this.stack[this.stack.length - 1];
    const f = top && this.dismiss.get(top);
    if (f) {
      audio.play("click");
      f();
    }
  }
  closeAll() {
    for (const w of [...this.stack]) this.close(w);
  }
  get open_count() {
    return this.stack.length;
  }
}

const btn = (
  label: string | Node,
  onclick: () => void,
  cls = "btn",
  extra: Record<string, string> = {},
) =>
  h(
    "button",
    {
      class: cls,
      ...extra,
      onclick: () => {
        audio.play("click");
        onclick();
      },
    },
    label,
  );

// ---------------- Title ----------------
export interface TitleOpts {
  profile: Profile;
  run: RunState | null;
  dailyDone: boolean;
  onContinue(): void;
  onNew(): void;
  onDaily(): void;
  onWorkshop(): void;
  onCodex(): void;
  onSettings(): void;
}
export function titleScreen(o: TitleOpts) {
  const p = o.profile;
  const nu = nextUnlock(p);
  const prevAt = [...UNLOCKS].reverse().find((u) => u.at <= p.renown)?.at ?? 0;
  const prog = nu ? (p.renown - prevAt) / (nu.at - prevAt) : 1;
  return h(
    "div",
    { class: "title-screen" },
    h(
      "div",
      { class: "logo" },
      h("div", { class: "logo-mark" }, icon("crown", "ic big")),
      h(
        "h1",
        {},
        h("span", { class: "l1" }, "Dungeon"),
        h("span", { class: "l2" }, "Architect"),
      ),
      h("p", { class: "tag" }, "Build the dungeon. Break the heroes."),
    ),
    h(
      "nav",
      { class: "title-menu" },
      o.run
        ? btn(
            h(
              "span",
              {},
              h("b", {}, "Continue"),
              h(
                "small",
                {},
                o.run.daily
                  ? `Daily · Night ${o.run.night}`
                  : `Night ${o.run.night} of ${NIGHTS} · ${BIOMES[o.run.biome].name}`,
              ),
            ),
            o.onContinue,
            "btn primary big",
          )
        : null,
      btn(
        h(
          "span",
          {},
          h("b", {}, "New Descent"),
          h("small", {}, "A run of ten nights"),
        ),
        o.onNew,
        o.run ? "btn big" : "btn primary big",
      ),
      h(
        "div",
        { class: "row2" },
        btn(
          h(
            "span",
            {},
            icon("daily"),
            h("b", {}, "Daily"),
            h("small", {}, o.dailyDone ? "Done today" : "Same for everyone"),
          ),
          o.onDaily,
          `btn tile${o.dailyDone ? " done" : ""}`,
        ),
        btn(
          h(
            "span",
            {},
            icon("hammer"),
            h("b", {}, "Workshop"),
            h("small", {}, "Build & share"),
          ),
          o.onWorkshop,
          "btn tile",
        ),
      ),
      h(
        "div",
        { class: "row2 small" },
        btn(h("span", {}, icon("book"), " Codex"), o.onCodex, "btn ghost"),
        btn(
          h("span", {}, icon("menu"), " Settings"),
          o.onSettings,
          "btn ghost",
        ),
      ),
    ),
    h(
      "div",
      { class: "renown" },
      h(
        "div",
        { class: "renown-top" },
        h("span", {}, icon("star", "ic tiny"), ` Renown ${fmt(p.renown)}`),
        nu
          ? h("span", { class: "next" }, `Next: ${nu.label} at ${nu.at}`)
          : h("span", { class: "next" }, "Everything unlocked"),
      ),
      h(
        "div",
        { class: "bar" },
        h("i", { style: `width:${Math.round(prog * 100)}%` }),
      ),
    ),
  );
}

// ---------------- Run setup ----------------
export function setupScreen(
  profile: Profile,
  onStart: (o: {
    biome: Biome["id"];
    architect: ArchitectDef["id"];
    infamy: number;
  }) => void,
  onBack: () => void,
) {
  const biomes = unlockedBiomes(profile);
  const archs = unlockedArchitects(profile);
  let biome: Biome["id"] = biomes[biomes.length - 1];
  let arch: ArchitectDef["id"] = "mason";
  let infamy = profile.maxInfamy;
  const root = h("div", { class: "panel setup" });
  const render = () => {
    root.replaceChildren(
      h("h2", {}, "New Descent"),
      h("h3", {}, "Architect"),
      h(
        "div",
        { class: "choice-row" },
        ...ARCHITECTS.map((a) => {
          const locked = !archs.includes(a.id);
          return h(
            "button",
            {
              class: `choice arch${arch === a.id ? " on" : ""}${locked ? " locked" : ""}`,
              disabled: locked,
              onclick: () => {
                audio.play("click");
                arch = a.id;
                render();
              },
            },
            h("b", {}, a.name),
            h("small", {}, a.title),
            h("p", {}, locked ? `Unlocks at ${a.unlockRenown} renown` : a.text),
            locked
              ? null
              : h(
                  "div",
                  { class: "starts" },
                  ...a.start.map((s) => pieceArt(s, 30)),
                ),
          );
        }),
      ),
      h("h3", {}, "Depths"),
      h(
        "div",
        { class: "choice-row" },
        ...(Object.keys(BIOMES) as Biome["id"][]).map((id) => {
          const locked = !biomes.includes(id);
          const b = BIOMES[id];
          return h(
            "button",
            {
              class: `choice biome b-${id}${biome === id ? " on" : ""}${locked ? " locked" : ""}`,
              disabled: locked,
              onclick: () => {
                audio.play("click");
                biome = id;
                render();
              },
            },
            h("b", {}, b.name),
            h("p", {}, locked ? `Unlock with renown` : b.blurb),
          );
        }),
      ),
      profile.maxInfamy > 0
        ? h(
            "div",
            { class: "infamy" },
            h("h3", {}, "Infamy"),
            h(
              "div",
              { class: "stepper" },
              btn(
                "−",
                () => {
                  infamy = Math.max(0, infamy - 1);
                  render();
                },
                "btn small",
              ),
              h("b", {}, String(infamy)),
              btn(
                "+",
                () => {
                  infamy = Math.min(profile.maxInfamy, infamy + 1);
                  render();
                },
                "btn small",
              ),
            ),
            h(
              "p",
              {},
              infamy === 0
                ? "Standard difficulty."
                : INFAMY_TEXT.slice(1, infamy + 1).join(" "),
            ),
          )
        : "",
      h(
        "div",
        { class: "actions" },
        btn("Back", onBack, "btn ghost"),
        btn(
          h("b", {}, "Descend"),
          () => onStart({ biome, architect: arch, infamy }),
          "btn primary",
        ),
      ),
    );
  };
  render();
  return root;
}

// ---------------- Results ----------------
export function resultsScreen(o: {
  night: number;
  result: RaidResult;
  stars: number;
  stolen: number;
  income: number;
  heroes: number;
  onContinue(): void;
  final: boolean;
  deadliest: string | null;
}) {
  const starEls = [0, 1, 2].map((i) =>
    h("span", { class: `star s${i}` }, icon("star")),
  );
  const labels = ["Defended", "No survivors", "Untouched hoard"];
  const rows: [string, string][] = [
    ["Heroes slain", `${o.result.killed} / ${o.heroes}`],
    ["Treasure stolen", o.stolen ? `${o.stolen}` : "None"],
    ["Bounties", `+${o.result.gold}`],
    ["Dawn tribute", `+${o.income}`],
  ];
  if (o.result.bestCombo > 1)
    rows.push(["Best combo", `${o.result.bestCombo}×`]);
  if (o.deadliest) rows.push(["Deadliest", o.deadliest]);
  const root = h(
    "div",
    { class: "panel results" },
    h("small", { class: "kicker" }, `Night ${o.night}`),
    h(
      "h2",
      {},
      o.stars === 3 ? "Flawless" : o.stars === 0 ? "Robbed" : "Dawn breaks",
    ),
    h("div", { class: "stars" }, ...starEls),
    h(
      "div",
      { class: "star-labels" },
      ...labels.map((l, i) =>
        h("span", { class: i < o.stars ? "got" : "" }, l),
      ),
    ),
    h(
      "div",
      { class: "rows" },
      ...rows.map(([k, v]) =>
        h("div", { class: "row" }, h("span", {}, k), h("b", {}, v)),
      ),
    ),
    h(
      "div",
      { class: "actions" },
      btn(
        h("b", {}, o.final ? "See your legend" : "Continue"),
        o.onContinue,
        "btn primary",
      ),
    ),
  );
  starEls.forEach((el, i) => {
    if (i < o.stars)
      setTimeout(
        () => {
          el.classList.add("got");
          audio.play("coin", { pitch: 1 + i * 0.25 });
        },
        450 + i * 320,
      );
  });
  root
    .querySelectorAll(".row")
    .forEach(
      (r, i) =>
        ((r as HTMLElement).style.animationDelay = `${0.25 + i * 0.08}s`),
    );
  return root;
}

// ---------------- Draft ----------------
export function cardEl(c: Card, run: RunState) {
  if (c.type === "relic") {
    const r = RELICS[c.id];
    return h(
      "div",
      { class: "card relic" },
      h("small", {}, "Relic"),
      h("div", { class: "card-art" }, icon("relic", "ic huge")),
      h("b", {}, r.name),
      h("p", {}, r.text),
    );
  }
  const def = PIECES[c.id];
  if (c.type === "tier") {
    const t = (run.tiers[c.id] ?? 1) + 1;
    return h(
      "div",
      { class: "card tier" },
      h("small", {}, "Upgrade"),
      h(
        "div",
        { class: "card-art" },
        pieceArt(c.id, 84),
        h("span", { class: "tier-badge" }, "I".repeat(t)),
      ),
      h("b", {}, `${def.name} ${"I".repeat(t)}`),
      h("p", {}, `+40% power for every ${def.name}.`),
    );
  }
  return h(
    "div",
    { class: `card blueprint k-${def.kind}` },
    h("small", {}, def.kind === "trap" ? "Trap" : "Monster"),
    h("div", { class: "card-art" }, pieceArt(c.id, 84)),
    h("b", {}, def.name),
    h("p", {}, def.rule),
    def.combo ? h("p", { class: "combo-hint" }, def.combo) : null,
    h(
      "span",
      { class: "card-cost" },
      icon("coin", "ic tiny"),
      String(def.cost),
    ),
  );
}
export function draftScreen(
  cards: Card[],
  run: RunState,
  onPick: (c: Card | null) => void,
) {
  let picked = false;
  const root = h(
    "div",
    { class: "draft" },
    h("h2", {}, "Choose a boon"),
    h("p", { class: "sub" }, "One to keep. The rest return to the dark."),
    h(
      "div",
      { class: "cards" },
      ...cards.map((c, i) => {
        const el = h(
          "button",
          { class: "card-btn", style: `animation-delay:${0.1 + i * 0.12}s` },
          cardEl(c, run),
        );
        el.addEventListener("click", () => {
          if (picked) return;
          picked = true;
          audio.play("unlock");
          el.classList.add("picked");
          root.classList.add("done");
          setTimeout(() => onPick(c), 520);
        });
        setTimeout(
          () => audio.play("card", { pitch: 1 + i * 0.15 }),
          120 + i * 120,
        );
        return el;
      }),
    ),
    btn(
      "Skip  (+15 gold)",
      () => {
        if (picked) return;
        picked = true;
        onPick(null);
      },
      "btn ghost",
    ),
  );
  return root;
}

// ---------------- Run over ----------------
export function gameOverScreen(o: {
  run: RunState;
  renown: number;
  unlocked: string[];
  onMenu(): void;
  onAgain(): void;
  onShare(): void;
  dailyText: string | null;
}) {
  const won = !!o.run.victory;
  const stars = o.run.history.reduce((a, r) => a + r.stars, 0);
  const kills = o.run.history.reduce((a, r) => a + r.killed, 0);
  return h(
    "div",
    { class: `panel gameover ${won ? "won" : "lost"}` },
    h(
      "small",
      { class: "kicker" },
      o.run.daily ? `Daily ${o.run.daily}` : BIOMES[o.run.biome].name,
    ),
    h("h2", {}, won ? "The Hoard Endures" : "The Hoard Is Plundered"),
    h(
      "p",
      { class: "sub" },
      won
        ? "Sir Aldric lies among the bones. Bards will whisper your name."
        : `You held for ${o.run.history.length} night${o.run.history.length === 1 ? "" : "s"}. The dark remembers.`,
    ),
    h(
      "div",
      { class: "night-strip" },
      ...o.run.history.map((r: NightRecord) =>
        h(
          "span",
          {
            class: `n s${r.stars}`,
            title: `Night ${r.night}: ${r.stars} stars`,
          },
          String(r.night),
        ),
      ),
    ),
    h(
      "div",
      { class: "rows" },
      h(
        "div",
        { class: "row" },
        h("span", {}, "Stars"),
        h("b", {}, String(stars)),
      ),
      h(
        "div",
        { class: "row" },
        h("span", {}, "Heroes slain"),
        h("b", {}, String(kills)),
      ),
      h(
        "div",
        { class: "row big" },
        h("span", {}, "Renown earned"),
        h("b", {}, `+${o.renown}`),
      ),
    ),
    o.unlocked.length
      ? h(
          "div",
          { class: "unlocks" },
          h("h3", {}, "Unlocked"),
          ...o.unlocked.map((u) =>
            h("div", { class: "unlock" }, icon("star", "ic tiny"), u),
          ),
        )
      : null,
    o.dailyText ? h("pre", { class: "daily-share" }, o.dailyText) : null,
    h(
      "div",
      { class: "actions" },
      btn("Main menu", o.onMenu, "btn ghost"),
      o.dailyText
        ? btn(h("span", {}, icon("share"), " Share"), o.onShare, "btn")
        : btn(h("span", {}, icon("share"), " Share dungeon"), o.onShare, "btn"),
      o.run.daily
        ? null
        : btn(h("b", {}, "Descend again"), o.onAgain, "btn primary"),
    ),
  );
}

// ---------------- Pause ----------------
export function pauseScreen(o: {
  onResume(): void;
  onSettings(): void;
  onShare: (() => void) | null;
  onAbandon: (() => void) | null;
  onMenu(): void;
  title: string;
}) {
  return h(
    "div",
    { class: "panel pause" },
    h("h2", {}, o.title),
    h(
      "div",
      { class: "stack" },
      btn(h("b", {}, "Resume"), o.onResume, "btn primary"),
      o.onShare
        ? btn(h("span", {}, icon("share"), " Share this dungeon"), o.onShare)
        : null,
      btn("Settings", o.onSettings),
      btn("Save & quit to menu", o.onMenu),
      o.onAbandon ? btn("Abandon run", o.onAbandon, "btn danger") : null,
    ),
  );
}

// ---------------- Settings ----------------
export function settingsScreen(
  p: Profile,
  onChange: () => void,
  onClose: () => void,
  onReset: () => void,
) {
  const s = p.settings;
  const slider = (label: string, value: number, set: (v: number) => void) => {
    const input = h("input", {
      type: "range",
      min: 0,
      max: 100,
      value: Math.round(value * 100),
      "aria-label": label,
    }) as HTMLInputElement;
    input.addEventListener("input", () => {
      set(Number(input.value) / 100);
      onChange();
    });
    return h("label", { class: "setting" }, h("span", {}, label), input);
  };
  const toggle = (label: string, value: boolean, set: (v: boolean) => void) => {
    const input = h("input", {
      type: "checkbox",
      checked: value,
    }) as HTMLInputElement;
    input.addEventListener("change", () => {
      set(input.checked);
      audio.play("click");
      onChange();
    });
    return h(
      "label",
      { class: "setting toggle" },
      h("span", {}, label),
      input,
      h("i", { class: "sw" }),
    );
  };
  let confirmReset = false;
  const reset = btn(
    "Reset all progress",
    () => {
      if (!confirmReset) {
        confirmReset = true;
        reset.textContent = "Tap again to erase everything";
        return;
      }
      onReset();
    },
    "btn danger small",
  );
  return h(
    "div",
    { class: "panel settings" },
    h("h2", {}, "Settings"),
    slider("Effects volume", s.sfx, (v) => (s.sfx = v)),
    slider("Music volume", s.music, (v) => (s.music = v)),
    toggle("Sound", !s.muted, (v) => (s.muted = !v)),
    toggle("Screen shake", s.shake, (v) => (s.shake = v)),
    toggle(
      "Reduce motion & particles",
      s.reduceMotion,
      (v) => (s.reduceMotion = v),
    ),
    h(
      "div",
      { class: "actions" },
      reset,
      btn(h("b", {}, "Done"), onClose, "btn primary"),
    ),
  );
}

// ---------------- Codex ----------------
export function codexScreen(p: Profile, onClose: () => void) {
  const unlocked = unlockedPieces(p);
  const detail = h(
    "div",
    { class: "codex-detail" },
    h("p", { class: "muted" }, "Tap an entry to learn its secrets."),
  );
  const show = (
    art: HTMLElement,
    title: string,
    kind: string,
    text: string,
    extra?: string,
  ) => {
    audio.play("click");
    detail.replaceChildren(
      h("div", { class: "cd-art" }, art),
      h("small", {}, kind),
      h("b", {}, title),
      h("p", {}, text),
      extra ? h("p", { class: "combo-hint" }, extra) : "",
    );
  };
  const heroes = (Object.keys(HEROES) as HeroClass[]).map((c) => {
    const seen = p.seen.includes(c);
    const b = h(
      "button",
      { class: `cx${seen ? "" : " locked"}` },
      heroArt(c, 44),
    );
    b.addEventListener("click", () =>
      seen
        ? show(
            heroArt(c, 84),
            HEROES[c].name,
            "Hero",
            HEROES[c].rule,
            `Health ${HEROES[c].hp} · Bounty ${HEROES[c].bounty} gold`,
          )
        : show(
            h("span", { class: "q" }, "?"),
            "Unknown hero",
            "Hero",
            "Survive more nights to meet them.",
          ),
    );
    return b;
  });
  const pieces = (Object.keys(PIECES) as PieceId[]).map((id) => {
    const open = unlocked.includes(id);
    const u = UNLOCKS.find((x) => x.id === id);
    const b = h(
      "button",
      { class: `cx${open ? "" : " locked"}` },
      pieceArt(id, 44),
    );
    b.addEventListener("click", () =>
      open
        ? show(
            pieceArt(id, 84),
            PIECES[id].name,
            `${PIECES[id].kind === "trap" ? "Trap" : "Monster"} · ${PIECES[id].cost} gold`,
            PIECES[id].rule,
            PIECES[id].combo,
          )
        : show(
            pieceArt(id, 84),
            PIECES[id].name,
            "Locked",
            `Reach ${u?.at ?? "?"} renown to add it to your drafts.`,
          ),
    );
    return b;
  });
  const relics = Object.values(RELICS).map((r) => {
    const b = h("button", { class: "cx relic" }, icon("relic", "ic"));
    b.addEventListener("click", () =>
      show(icon("relic", "ic huge"), r.name, "Relic", r.text),
    );
    return b;
  });
  const powers = Object.values(POWERS).map((pw) => {
    const b = h(
      "button",
      { class: "cx" },
      icon(pw.id === "rockfall" ? "rock" : "shriek", "ic"),
    );
    b.addEventListener("click", () =>
      show(
        icon(pw.id === "rockfall" ? "rock" : "shriek", "ic huge"),
        pw.name,
        `Power · ${pw.cost} dread`,
        pw.text,
      ),
    );
    return b;
  });
  return h(
    "div",
    { class: "panel codex" },
    h(
      "div",
      { class: "codex-head" },
      h("h2", {}, "Codex"),
      h(
        "button",
        { class: "icon-btn", "aria-label": "Close", onclick: onClose },
        icon("close"),
      ),
    ),
    detail,
    h(
      "div",
      { class: "codex-body" },
      h("h3", {}, "Heroes"),
      h("div", { class: "cx-grid" }, ...heroes),
      h("h3", {}, "Traps & Monsters"),
      h("div", { class: "cx-grid" }, ...pieces),
      h("h3", {}, "Powers"),
      h("div", { class: "cx-grid" }, ...powers),
      h("h3", {}, "Relics"),
      h("div", { class: "cx-grid" }, ...relics),
    ),
    h(
      "div",
      { class: "codex-stats" },
      h("span", {}, `Runs ${p.runs}`),
      h("span", {}, `Victories ${p.wins}`),
      h("span", {}, `Heroes slain ${fmt(p.kills)}`),
      h("span", {}, `Best combo ${p.bestCombo}×`),
    ),
  );
}

// ---------------- Challenge (raid a shared dungeon) ----------------
export function partyPicker(o: {
  title: string;
  sub: string;
  budget: number;
  classes: HeroClass[];
  confirm: string;
  onGo(party: HeroClass[]): void;
  onBack(): void;
  initial?: HeroClass[];
}) {
  const party: HeroClass[] = [];
  for (const c of o.initial ?? [])
    if (
      party.reduce((a, x) => a + HEROES[x].points, 0) + HEROES[c].points <=
      o.budget
    )
      party.push(c);
  const root = h("div", { class: "panel picker" });
  const render = () => {
    const spent = party.reduce((a, c) => a + HEROES[c].points, 0);
    root.replaceChildren(
      h("h2", {}, o.title),
      h("p", { class: "sub" }, o.sub),
      h(
        "div",
        { class: "budget" },
        h("span", {}, "Party points"),
        h("b", {}, `${spent} / ${o.budget}`),
      ),
      h(
        "div",
        { class: "chosen" },
        ...(party.length
          ? party.map((c, i) =>
              h(
                "button",
                {
                  class: "hero-chip big",
                  "aria-label": `Remove ${HEROES[c].name}`,
                  onclick: () => {
                    audio.play("sell");
                    party.splice(i, 1);
                    render();
                  },
                },
                heroArt(c, 48),
              ),
            )
          : [h("p", { class: "muted" }, "Pick heroes below.")]),
      ),
      h(
        "div",
        { class: "classes" },
        ...o.classes.map((c) => {
          const d = HEROES[c];
          const can = spent + d.points <= o.budget && party.length < 8;
          return h(
            "button",
            {
              class: `class-pick${can ? "" : " poor"}`,
              disabled: !can,
              onclick: () => {
                audio.play("place");
                party.push(c);
                render();
              },
            },
            heroArt(c, 44),
            h("span", {}, h("b", {}, d.name), h("small", {}, d.rule)),
            h("i", { class: "pts" }, String(d.points)),
          );
        }),
      ),
      h(
        "div",
        { class: "actions" },
        btn("Back", o.onBack, "btn ghost"),
        btn(
          h("b", {}, o.confirm),
          () => party.length && o.onGo(party),
          `btn primary${party.length ? "" : " disabled"}`,
        ),
      ),
    );
  };
  render();
  return root;
}

export function challengeResult(o: {
  name: string;
  stolen: number;
  total: number;
  survivors: number;
  party: number;
  onRetry(): void;
  onShare(): void;
  onHome(): void;
}) {
  const stars =
    (o.stolen > 0 ? 1 : 0) +
    (o.stolen >= Math.ceil(o.total / 2) ? 1 : 0) +
    (o.survivors === o.party ? 1 : 0);
  return h(
    "div",
    { class: "panel results" },
    h("small", { class: "kicker" }, `Raid on ${o.name || "a rival dungeon"}`),
    h(
      "h2",
      {},
      stars === 0 ? "Repelled" : stars === 3 ? "Total plunder" : "A fine haul",
    ),
    h(
      "div",
      { class: "stars" },
      ...[0, 1, 2].map((i) =>
        h("span", { class: `star got-${i < stars}` }, icon("star")),
      ),
    ),
    h(
      "div",
      { class: "rows" },
      h(
        "div",
        { class: "row" },
        h("span", {}, "Treasure stolen"),
        h("b", {}, `${o.stolen} / ${o.total}`),
      ),
      h(
        "div",
        { class: "row" },
        h("span", {}, "Heroes who escaped"),
        h("b", {}, `${o.survivors} / ${o.party}`),
      ),
    ),
    h(
      "div",
      { class: "actions" },
      btn("Build your own", o.onHome, "btn ghost"),
      btn(h("span", {}, icon("share"), " Share result"), o.onShare),
      btn(h("b", {}, "Raid again"), o.onRetry, "btn primary"),
    ),
  );
}

export function namePrompt(
  current: string,
  onDone: (name: string) => void,
  onCancel: () => void,
) {
  const input = h("input", {
    type: "text",
    maxlength: 20,
    value: current,
    placeholder: "Your architect name",
    autofocus: true,
  }) as HTMLInputElement;
  const go = () => onDone(input.value.trim() || "Nameless Architect");
  input.addEventListener("keydown", (e) => e.key === "Enter" && go());
  return h(
    "div",
    { class: "panel small-panel" },
    h("h2", {}, "Sign your dungeon"),
    h("p", { class: "sub" }, "Raiders will see this name."),
    input,
    h(
      "div",
      { class: "actions" },
      btn("Cancel", onCancel, "btn ghost"),
      btn(h("b", {}, "Create link"), go, "btn primary"),
    ),
  );
}

export function messageScreen(
  title: string,
  text: string,
  actions: [string, () => void, string?][],
) {
  return h(
    "div",
    { class: "panel small-panel" },
    h("h2", {}, title),
    h("p", { class: "sub" }, text),
    h(
      "div",
      { class: "actions" },
      ...actions.map(([l, f, c]) => btn(h("b", {}, l), f, c ?? "btn")),
    ),
  );
}
