import { html, msg } from "./localization";
import type { Editor } from "../core/editor";
import { CONTENT } from "../core/content";
import { BUILDS, THEMES } from "../core/advanced-types";
import type {
  AdventurerBuild,
  BossPhase,
  LogicRule,
  ObjectConfig,
  Theme,
} from "../core/advanced-types";

import { t } from "./i18n";

const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const option = (value: string, label: string, selected = "") =>
  html`<option value="${esc(value)}" ${value === selected ? "selected" : ""}>
    ${esc(msg(label))}
  </option>`;
const number = (
  name: string,
  label: string,
  value: number,
  min: number,
  max: number,
) =>
  html`<label
    >${esc(msg(label))}<input
      type="number"
      name="${name}"
      value="${value}"
      min="${min}"
      max="${max}"
      required
  /></label>`;

export class WorkshopTools {
  readonly element = document.createElement("dialog");
  private view: "settings" | "object" | "logic" = "settings";
  private selected = "";
  constructor(
    private editor: () => Editor,
    private changed: () => void,
  ) {
    this.element.className = "community-dialog mechanics-dialog";
    document.body.append(this.element);
    this.element.addEventListener("click", (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-mechanic]",
      );
      if (!target) return;
      const action = target.dataset.mechanic;
      try {
        if (action === "close") this.element.close();
        else if (action === "floor") {
          this.editor().addFloor();
          this.changed();
          this.render();
        } else if (action === "delete-rule") {
          this.editor().rules(
            (this.editor().dungeon.rules ?? []).filter(
              (r) => r.id !== target.dataset.id,
            ),
          );
          this.changed();
          this.render();
        } else {
          this.view = action as typeof this.view;
          this.render();
        }
      } catch (error) {
        this.error(error);
      }
    });
    this.element.addEventListener("submit", (event) => {
      event.preventDefault();
      try {
        this.submit(new FormData(event.target as HTMLFormElement));
      } catch (error) {
        this.error(error);
      }
    });
  }
  get open(): boolean {
    return this.element.open;
  }
  show(view: "settings" | "object" | "logic", selected = ""): void {
    this.view = view;
    this.selected = selected;
    this.render();
    if (!this.open) this.element.showModal();
  }
  private error(error: unknown): void {
    this.element.querySelector(".community-message")!.textContent =
      error instanceof Error ? t(error.message) : msg("Unable to save.");
  }
  private options(selected = ""): string {
    return this.editor()
      .dungeon.objects.map((o) =>
        option(
          o.id,
          `${t(`object.${o.type}`)} · F${Math.floor(o.y / 13) + 1} (${o.x + 1},${(o.y % 13) + 1})`,
          selected,
        ),
      )
      .join("");
  }
  private render(): void {
    const d = this.editor().dungeon;
    let body = "";
    if (this.view === "settings") {
      body = html`<form class="community-form">
          <p>
            Advanced construction adds interactive objects, visual rules,
            normalized adventurer builds, and linked floors. Existing published
            versions keep their original rules.
          </p>
          <label
            >World theme<select name="theme">
              ${THEMES.map((v) => option(v, v.replaceAll("-", " "), d.theme)).join("")}
            </select></label
          ><label
            >Challenge build<select name="build">
              ${Object.keys(BUILDS)
                .map((v) => option(v, v, d.build ?? "warrior"))
                .join("")}
            </select></label
          >
          <div class="build-descriptions">
            ${Object.entries(BUILDS)
              .map(
                ([id, b]) =>
                  html`<p>
                    <b>${id}</b> · ${b.health} HP · ${b.attack} attack ·
                    ${b.defense} defense<br />${esc(msg(b.description))}
                  </p>`,
              )
              .join("")}
          </div>
          <p>
            Adventurers use the build you choose for this dungeon. Equipment
            collected inside a run can change it; account progression cannot
            overpower an older challenge.
          </p>
          <button class="button primary">
            Enable advanced workshop / save settings
          </button>
        </form>
        <h2>Floors</h2>
        <p>${d.height / 13} of 4 floors · ${d.budget} construction points</p>
        <button
          class="button outline"
          data-mechanic="floor"
          ${d.height >= 52 ? "disabled" : ""}
        >
          Add floor
        </button>
        <p>
          Place stairs on both floors and choose each destination in Object
          settings. A completed playtest remains required for publication.
        </p>`;
    } else if (this.view === "object") {
      const o = d.objects.find((o) => o.id === this.selected);
      if (!o) body = html`<p>Select an object in the workshop first.</p>`;
      else {
        const c = o.config ?? {},
          def = CONTENT[o.type];
        const enemy = def.behavior === "enemy",
          trap = def.behavior === "trap";
        body = html`<h2>${esc(t(`object.${o.type}`))}</h2>
          <p>${esc(t(`desc.${o.type}`))}</p>
          <form class="community-form">
            ${o.type === "camera-trigger" ? number("range", msg("Camera frame width (tiles)"), c.range ?? 6, 3, 8) + number("delay", msg("Camera hold (turns)"), c.delay ?? 8, 1, 100) : ""}
            ${enemy ? html`<label>Faction (optional)<input name="faction" maxlength="40" value="${esc(c.faction ?? "")}" /></label>` : ""}
            ${o.type === "npc" ? number("threshold", msg("Starting supplies"), c.threshold ?? 2, 1, 100) : ""}
            ${
              o.type === "boss"
                ? html`<label
                    >Body shape<select name="body">
                      ${["brute", "serpent", "sentinel"].map((v) => option(v, v, c.body ?? "brute")).join("")}
                    </select></label
                  >`
                : ""
            }
            <label
              >Starts enabled<select name="enabled">
                ${option("true", msg("Enabled"), String(c.enabled ?? !["gate", "lever", "button", "plate", "timer", "counter", "and-gate", "or-gate", "not-gate", "proximity", "elevator", "platform", "spawn-zone"].includes(o.type)))}${option("false", msg("Disabled"), String(c.enabled ?? true))}
              </select></label
            >${enemy || trap ? `${number("damage", msg("Damage"), c.damage ?? def.damage ?? 10, 0, 50)}${number("cooldown", msg("Cooldown (turns)"), c.cooldown ?? def.cooldown ?? 3, 1, 100)}${number("range", msg("Detection / attack range"), c.range ?? def.range ?? 1, 0, 8)}` : ""}${enemy ? number("hp", msg("Health"), c.hp ?? def.hp ?? 32, 1, 500) : ""}${["timer", "repeater", "button"].includes(o.type) ? number("delay", msg("Interval (turns)"), c.delay ?? 4, 1, 100) : ""}${o.type === "counter" ? number("threshold", msg("Required signals"), c.threshold ?? 3, 1, 100) : ""}${o.type === "proximity" ? number("range", msg("Detection radius"), c.range ?? 2, 0, 8) : ""}<label
              >Linked destination / monster<select name="target">
                <option value="">None</option>
                ${this.options(c.target)}
              </select></label
            >${o.type === "patrol" ? html`<label>Patrol route (x,y points on this floor, separated by semicolons)<input name="patrol" placeholder="3,3; 7,3; 7,6" value="${esc(c.patrol?.map((p) => `${p.x + 1},${(p.y % 13) + 1}`).join("; "))}" /></label>` : ""}${
              o.type === "npc"
                ? html`<label
                      >Dialogue<textarea name="dialogue" maxlength="300">
${esc(c.dialogue ?? msg("Every passage has a story."))}</textarea></label
                    ><label
                      >Faction<input
                        name="faction"
                        maxlength="40"
                        value="${esc(c.faction ?? "Wanderers")}" /></label
                    ><label
                      >Quest requirement<select name="quest">
                        <option value="">No quest</option>
                        ${["key", "monster", "treasure"].map((v) => option(v, v, c.quest)).join("")}
                      </select></label
                    >`
                : ""
            }${
              o.type === "boss"
                ? html`<h3>Boss phases</h3>
                    <p>
                      A phase begins at or below its health percentage. Summon
                      revives defeated allies; shatter destroys nearby arena
                      cover.
                    </p>
                    ${(
                      c.phases ?? [
                        {
                          threshold: 100,
                          attack: "melee",
                          cooldown: 3,
                          damage: 12,
                          armor: 5,
                        },
                        {
                          threshold: 75,
                          attack: "shatter",
                          cooldown: 4,
                          damage: 14,
                          armor: 3,
                        },
                        {
                          threshold: 50,
                          attack: "summon",
                          cooldown: 5,
                          damage: 12,
                          armor: 2,
                        },
                        {
                          threshold: 25,
                          attack: "cross",
                          cooldown: 2,
                          damage: 16,
                          armor: 0,
                        },
                      ]
                    )
                      .map(
                        (p, i) =>
                          html`<fieldset class="boss-phase">
                            <legend>Phase ${i + 1}</legend>
                            ${number(`phase-${i}-threshold`, msg("Health %"), p.threshold, 1, 100)}<label
                              >Attack<select name="phase-${i}-attack">
                                ${["melee", "cross", "charge", "summon", "shatter"].map((v) => option(v, v, p.attack)).join("")}
                              </select></label
                            >${number(`phase-${i}-cooldown`, msg("Cooldown"), p.cooldown, 1, 20)}${number(`phase-${i}-damage`, msg("Damage"), p.damage, 1, 40)}${number(`phase-${i}-armor`, msg("Armor"), p.armor, 0, 15)}
                          </fieldset>`,
                      )
                      .join("")}`
                : ""
            }<button class="button primary">Save object settings</button>
          </form>`;
      }
    } else {
      const rules = d.rules ?? [];
      body = html`<p>
          Connect an event to an action. Add a condition or delay when needed.
          All rules use the same deterministic clock as the dungeon.
        </p>
        <div class="logic-rules">
          ${
            rules
              .map(
                (r) =>
                  html`<article class="logic-rule">
                    <div>
                      <small>EVENT</small
                      ><strong
                        >${esc(t(`object.${d.objects.find((o) => o.id === r.source)!.type}`))}</strong
                      ><span>${r.event}</span>
                    </div>
                    <span>→</span>${
                      r.condition
                        ? html`<div>
                              <small>CONDITION</small
                              ><strong
                                >${r.condition.variable} ${r.condition.operator}
                                ${r.condition.value}</strong
                              >
                            </div>
                            <span>→</span>`
                        : ""
                    }
                    <div>
                      <small
                        >ACTION${r.delay ? ` / DELAY ${r.delay}` : ""}</small
                      ><strong
                        >${r.action}
                        ${esc(t(`object.${d.objects.find((o) => o.id === r.target)!.type}`))}</strong
                      >${r.otherwise ? html`<span>Else ${r.otherwise}</span>` : ""}
                    </div>
                    <button
                      class="button quiet"
                      data-mechanic="delete-rule"
                      data-id="${esc(r.id)}"
                    >
                      Remove
                    </button>
                  </article>`,
              )
              .join("") ||
            html`<p>No connections yet. Try plate → OnEnter → open gate.</p>`
          }
        </div>
        <form class="community-form">
          <div class="logic-builder">
            <fieldset>
              <legend>1 · EVENT</legend>
              <label
                >Source<select name="source" required>
                  ${this.options()}
                </select></label
              ><label
                >When<select name="event">
                  ${["OnEnter", "OnExit", "OnTrigger", "OnDamage", "OnDeath", "OnInteract", "OnActivate", "OnDeactivate", "OnTimer", "OnCollision", "OnDestroy", "OnSpawn"].map((v) => option(v, v)).join("")}
                </select></label
              >
            </fieldset>
            <fieldset>
              <legend>2 · CONDITION (optional)</legend>
              <label
                >Check<select name="variable">
                  <option value="">Always</option>
                  ${["keys", "health", "counter", "random"].map((v) => option(v, v)).join("")}
                </select></label
              ><label
                >Comparison<select name="operator">
                  ${["gte", "lte", "eq"].map((v) => option(v, v === "gte" ? msg("At least") : v === "lte" ? msg("At most") : "Equals")).join("")}
                </select></label
              >${number("value", msg("Value"), 1, 0, 1000)}
            </fieldset>
            <fieldset>
              <legend>3 · ACTION</legend>
              <label
                >Target<select name="target" required>
                  ${this.options()}
                </select></label
              ><label
                >Then<select name="action">
                  ${["open", "close", "activate", "deactivate", "toggle", "damage", "heal", "spawn", "destroy", "increment", "set", "teleport"].map((v) => option(v, v)).join("")}
                </select></label
              ><label
                >Else<select name="otherwise">
                  <option value="">Do nothing</option>
                  ${["open", "close", "activate", "deactivate", "spawn", "destroy", "increment"].map((v) => option(v, v)).join("")}
                </select></label
              >${number("delay", msg("Delay (turns)"), 0, 0, 100)}
            </fieldset>
          </div>
          <button class="button primary" ${!d.objects.length ? "disabled" : ""}>
            Connect rule
          </button>
        </form>
        <p>
          Events are bounded to 256 per turn and 512 pending delays. A runaway
          circuit ends the test with a visible warning and cannot certify a
          clear.
        </p>`;
    }
    this.element.innerHTML = html`<header class="community-header">
        <div>
          <p class="eyebrow">ADVANCED WORKSHOP</p>
          <h1>Make the dungeon respond.</h1>
        </div>
        <button class="button outline" data-mechanic="close">
          Back to building
        </button>
      </header>
      <nav class="community-tabs" aria-label="Advanced workshop">
        ${["settings", "object", "logic"].map((v) => html`<button data-mechanic="${v}" aria-current="${v === this.view ? "page" : "false"}">${v === "settings" ? msg("World & build") : v === "object" ? msg("Object settings") : msg("Visual logic")}</button>`).join("")}
      </nav>
      <p class="community-message error" role="status"></p>
      <section class="community-body">${body}</section>`;
  }
  private submit(form: FormData): void {
    const get = (name: string) => String(form.get(name) ?? "");
    const editor = this.editor();
    if (this.view === "settings")
      editor.settings(get("theme") as Theme, get("build") as AdventurerBuild);
    else if (this.view === "object") {
      const o = editor.dungeon.objects.find((o) => o.id === this.selected)!;
      const config: ObjectConfig = { enabled: get("enabled") === "true" };
      for (const name of [
        "damage",
        "cooldown",
        "range",
        "hp",
        "delay",
        "threshold",
      ] as const)
        if (form.has(name)) config[name] = Number(get(name));
      if (get("target")) config.target = get("target");
      if (form.has("patrol") && get("patrol").trim())
        config.patrol = get("patrol")
          .split(";")
          .map((pair) => {
            const [x, y] = pair.trim().split(",").map(Number);
            return { x: x - 1, y: y - 1 + Math.floor(o.y / 13) * 13 };
          });
      if (form.has("faction")) config.faction = get("faction");
      if (form.has("body")) config.body = get("body") as ObjectConfig["body"];
      if (form.has("dialogue")) {
        config.dialogue = get("dialogue");
        config.faction = get("faction");
        if (get("quest")) config.quest = get("quest") as ObjectConfig["quest"];
      }
      if (o.type === "boss") {
        config.phases = [];
        for (let i = 0; i < 4; i++)
          if (form.has(`phase-${i}-threshold`))
            config.phases.push({
              threshold: Number(get(`phase-${i}-threshold`)),
              attack: get(`phase-${i}-attack`) as BossPhase["attack"],
              cooldown: Number(get(`phase-${i}-cooldown`)),
              damage: Number(get(`phase-${i}-damage`)),
              armor: Number(get(`phase-${i}-armor`)),
            });
      }
      editor.configure(o.id, config);
    } else {
      const rule: LogicRule = {
        id: crypto.randomUUID(),
        source: get("source"),
        event: get("event") as LogicRule["event"],
        target: get("target"),
        action: get("action") as LogicRule["action"],
        delay: Number(get("delay")),
      };
      if (get("variable"))
        rule.condition = {
          variable: get("variable") as NonNullable<
            LogicRule["condition"]
          >["variable"],
          operator: get("operator") as NonNullable<
            LogicRule["condition"]
          >["operator"],
          value: Number(get("value")),
        };
      if (get("otherwise"))
        rule.otherwise = get("otherwise") as LogicRule["otherwise"];
      editor.rules([...(editor.dungeon.rules ?? []), rule]);
    }
    this.changed();
    this.render();
    this.element.querySelector(".community-message")!.textContent = msg(
      "Saved. Complete a fresh playtest before publishing.",
    );
  }
}
