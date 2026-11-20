/**
 * Rules v7 screens: the siege ladders (one per champion and realm lord),
 * a siege's brief and result, and the Rogues' Gallery of nemeses.
 */
import { audio } from "../engine/audio";
import { HEROES, RELICS, type ChampionId, type FeatDef } from "../game/defs";
import {
  RARITIES,
  TROPHIES,
  heirloomName,
  statText,
  trophyLevel,
  trophyTotal,
  type Heirloom,
} from "../game/meta";
import {
  NEMESIS_MAX,
  nemesesPerRun,
  nemesisRank,
  NEM_DMG,
  NEM_HP,
} from "../game/nemesis";
import type { Profile } from "../game/profile";
import {
  SIEGE_BOSSES,
  bossAffixes,
  siegeDef,
  siegeDepth,
  siegeFrontier,
  siegeOpen,
  siegeReward,
  type SiegeDef,
} from "../game/sieges";
import { AFFIXES } from "../game/schools";
import { fmt, h, heroArt, icon } from "./dom";

const button = (
  label: Node | string,
  onclick: () => void,
  cls = "btn",
  extra: Record<string, string | boolean> = {},
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
const stars = (n: number, of = 3) =>
  h(
    "span",
    { class: "trial-stars", "aria-label": `${n} of ${of} stars` },
    ...Array.from({ length: of }, (_, i) =>
      icon("star", `ic tiny${i < n ? " got" : ""}`),
    ),
  );
const head = (title: string, onClose: () => void) =>
  h(
    "div",
    { class: "codex-head" },
    h("h2", {}, title),
    h(
      "button",
      { class: "icon-btn", "aria-label": "Close", onclick: onClose },
      icon("close"),
    ),
  );

/** Can the player see the sieges at all? (After slaying any champion.) */
export const siegesVisible = (p: Profile) =>
  SIEGE_BOSSES.some((b) => siegeOpen(p, b));

export function siegesScreen(o: {
  profile: Profile;
  onPlay(boss: ChampionId, level: number): void;
  onClose(): void;
}) {
  const p = o.profile;
  const root = h("div", { class: "panel sieges" });
  // The level picked per boss (defaults to the frontier).
  const pick: Partial<Record<ChampionId, number>> = {};
  const render = () => {
    root.replaceChildren(
      head("Sieges", o.onClose),
      h(
        "p",
        { class: "muted trials-intro" },
        `Single-night sieges against the champions you have slain, with no end to the levels. Level L brings the champion's final-night party from depth 2L + 1 (heroes reach full night-ten strength at level 6), with a fixed map, party, treasury and a few lent relics, every blueprint you own at tier III, your powers and the full Sanctum. Clearing a level for the first time raises that champion's trophy (a lasting Sanctum bonus) and pays souls, infamy and an heirloom. ${trophyTotal(p)} levels cleared.`,
      ),
      h(
        "div",
        { class: "siege-list" },
        ...SIEGE_BOSSES.map((b) => {
          const open = siegeOpen(p, b);
          const best = trophyLevel(p, b);
          const frontier = siegeFrontier(p, b);
          const lv = Math.min(frontier, Math.max(1, pick[b] ?? frontier));
          const t = TROPHIES[b];
          const d = open ? siegeDef(b, lv) : null;
          const rec = p.sieges[`${b}:${lv}`] ?? 0;
          const r = siegeReward(lv, 1, lv > best);
          return h(
            "section",
            { class: `siege-card${open ? "" : " locked"}` },
            h(
              "div",
              { class: "arm-head" },
              heroArt(b, 44),
              h(
                "div",
                {},
                h("b", {}, HEROES[b].name),
                h(
                  "small",
                  { class: "muted" },
                  open
                    ? `${t.name} · level ${best} · ${statText(t.stat, t.per * best)}`
                    : "Slay this champion in a descent to open the siege.",
                ),
              ),
            ),
            open && d
              ? h(
                  "div",
                  { class: "siege-body" },
                  h(
                    "div",
                    { class: "siege-level" },
                    h(
                      "button",
                      {
                        class: "icon-btn",
                        "aria-label": "Lower level",
                        disabled: lv <= 1,
                        onclick: () => {
                          pick[b] = lv - 1;
                          audio.play("click");
                          render();
                        },
                      },
                      "−",
                    ),
                    h(
                      "div",
                      {},
                      h("b", {}, `Level ${lv}`),
                      h(
                        "small",
                        {},
                        `like depth ${siegeDepth(lv)} · ${d.party.length} heroes${bossAffixes(lv) ? ` · ${bossAffixes(lv)} affix${bossAffixes(lv) > 1 ? "es" : ""}` : ""}`,
                      ),
                    ),
                    h(
                      "button",
                      {
                        class: "icon-btn",
                        "aria-label": "Raise level",
                        disabled: lv >= frontier,
                        onclick: () => {
                          pick[b] = lv + 1;
                          audio.play("click");
                          render();
                        },
                      },
                      "+",
                    ),
                  ),
                  h(
                    "div",
                    { class: "trial-party" },
                    ...d.party
                      .slice(0, 7)
                      .map((m) => heroArt(m.cls, 24, m.elite)),
                    d.party.length > 7
                      ? h("small", {}, `+${d.party.length - 7}`)
                      : null,
                  ),
                  h(
                    "small",
                    { class: "muted" },
                    lv > best
                      ? `First clear: ${fmt(r.souls)}+ souls, ${fmt(r.infamy)} infamy, an heirloom, trophy level ${lv}`
                      : `Cleared · replays pay ${fmt(r.souls)}+ souls`,
                  ),
                  rec ? stars(rec) : null,
                  button(
                    h("b", {}, lv > best ? "Lay siege" : "Replay"),
                    () => o.onPlay(b, lv),
                    `btn small${lv > best ? " primary" : ""}`,
                  ),
                )
              : null,
          );
        }),
      ),
    );
  };
  render();
  return root;
}

export function siegeBriefScreen(d: SiegeDef, onGo: () => void) {
  const boss = d.party.find((m) => m.cls === d.boss);
  return h(
    "div",
    { class: "panel trial-brief" },
    h("small", { class: "kicker" }, `Siege · level ${d.level}`),
    h("h2", {}, HEROES[d.boss].name),
    h(
      "p",
      {},
      `The champion comes for your hoard with ${d.party.length - 1} hero${d.party.length === 2 ? "" : "es"} at their back, from the final night at depth ${d.depth}.${d.relics.length ? ` The siege armory lends you: ${d.relics.map((r) => RELICS[r].name).join(", ")}.` : ""}`,
    ),
    h(
      "div",
      { class: "trial-party big" },
      ...d.party.map((m) => heroArt(m.cls, 40, m.elite)),
    ),
    boss?.affixes?.length
      ? h(
          "p",
          { class: "combo-hint" },
          `${HEROES[d.boss].name} carries ${boss.affixes.map((a) => AFFIXES[a].name).join(", ")}.`,
        )
      : null,
    h(
      "ul",
      { class: "trial-goals" },
      h("li", {}, stars(1, 1), " Slay the champion and keep the hoard"),
      h("li", {}, stars(1, 1), " Lose no treasure"),
      h("li", {}, stars(1, 1), " Leave no survivors"),
    ),
    h(
      "p",
      { class: "muted" },
      `Treasury ${fmt(d.gold)} gold · up to ${d.cap} pieces · every blueprint at tier III · ${d.relics.length} lent relic${d.relics.length === 1 ? "" : "s"} · your powers and the Sanctum apply.`,
    ),
    h(
      "div",
      { class: "actions" },
      button(h("b", {}, "Build"), onGo, "btn primary"),
    ),
  );
}

export function siegeResultScreen(o: {
  d: SiegeDef;
  stars: number;
  bossSlain: boolean;
  first: boolean;
  souls: number;
  infamy: number;
  heirloom: Heirloom | null;
  feats: FeatDef[];
  onRetry(): void;
  onNext(): void;
  onList(): void;
}) {
  const goal = (ok: boolean, text: string) =>
    h("li", { class: ok ? "ok" : "miss" }, stars(ok ? 1 : 0, 1), ` ${text}`);
  const t = TROPHIES[o.d.boss];
  return h(
    "div",
    { class: "panel results trial-result" },
    h(
      "small",
      { class: "kicker" },
      `Siege · ${HEROES[o.d.boss].name} · level ${o.d.level}`,
    ),
    h(
      "h2",
      {},
      o.stars >= 3 ? "Annihilated" : o.stars > 0 ? "Broken" : "Repelled",
    ),
    h(
      "div",
      { class: "stars" },
      ...[0, 1, 2].map((i) =>
        h(
          "span",
          { class: `star s${i}${i < o.stars ? " got" : ""}` },
          icon("star"),
        ),
      ),
    ),
    h(
      "ul",
      { class: "trial-goals" },
      goal(o.stars > 0, "Slay the champion and keep the hoard"),
      goal(o.stars >= 2, "Lose no treasure"),
      goal(o.stars >= 3, "Leave no survivors"),
    ),
    o.first
      ? h(
          "p",
          { class: "gain" },
          `${t.name} rises to level ${o.d.level}: ${statText(t.stat, t.per * o.d.level)}`,
        )
      : null,
    o.souls || o.infamy
      ? h(
          "p",
          { class: "gain souls" },
          `+${fmt(o.souls)} souls${o.infamy ? ` · +${fmt(o.infamy)} infamy` : ""}`,
        )
      : null,
    o.heirloom
      ? h(
          "p",
          {
            class: "gain heirloom-row",
            style: `--rc:${RARITIES[o.heirloom.rarity].color}`,
          },
          h(
            "b",
            {},
            `${RARITIES[o.heirloom.rarity].name} heirloom: ${heirloomName(o.heirloom)}`,
          ),
          ` · item level ${o.heirloom.ilvl}`,
        )
      : null,
    o.feats.length
      ? h(
          "div",
          { class: "unlocks feats-earned" },
          h("h3", {}, o.feats.length > 1 ? "Feats earned" : "Feat earned"),
          ...o.feats.map((f) =>
            h(
              "div",
              { class: "unlock" },
              icon("trophy", "ic tiny"),
              h("b", {}, f.name),
              h("small", {}, ` +${f.renown} renown`),
            ),
          ),
        )
      : null,
    !o.stars
      ? h(
          "p",
          { class: "combo-hint" },
          o.bossSlain
            ? "The champion fell, but the hoard was emptied. Guard the vault as well as the road."
            : "The champion survived. Raise your Sanctum, forge your best pieces, or rethink the maze and try again.",
        )
      : null,
    h(
      "div",
      { class: "actions" },
      button("Sieges", o.onList, "btn ghost"),
      button("Rebuild", o.onRetry, o.stars > 0 ? "btn" : "btn primary"),
      o.stars > 0
        ? button(h("b", {}, `Level ${o.d.level + 1}`), o.onNext, "btn primary")
        : null,
    ),
  );
}

/** The Rogues' Gallery: nemeses at large and those you have slain. */
export function rivalsScreen(p: Profile, onClose: () => void) {
  const list = [...p.nemeses].sort((a, b) => b.level - a.level || a.id - b.id);
  return h(
    "div",
    { class: "panel rivals" },
    head("Rogues' Gallery", onClose),
    h(
      "p",
      { class: "muted trials-intro" },
      `Heroes who escape with your treasure become nemeses (from depth 2, up to ${NEMESIS_MAX} at large). They return in later descents as elites (1 per descent below depth 8, 2 below depth 20, then 3), with +${Math.round(NEM_HP * 100)}% health and +${Math.round(NEM_DMG * 100)}% damage per level. Each escape raises their level and, at levels 3, 6 and 10, adds an affix. Slay one for a great bounty in souls and infamy and a guaranteed heirloom.`,
    ),
    h("h3", {}, `At large ${list.length}/${NEMESIS_MAX}`),
    list.length
      ? h(
          "div",
          { class: "rival-list" },
          ...list.map((x) =>
            h(
              "div",
              { class: "rival-card" },
              heroArt(x.cls, 44, true),
              h(
                "div",
                {},
                h("b", {}, x.name),
                h(
                  "small",
                  { class: "muted" },
                  `${nemesisRank(x.level)} ${HEROES[x.cls].name} · level ${x.level} · escaped ${x.escapes}× · stole ${x.stolen} · born at depth ${x.born}`,
                ),
                h(
                  "div",
                  { class: "affix-line" },
                  ...x.affixes.map((a) =>
                    h(
                      "span",
                      {
                        class: "affix-tag",
                        style: `--ac:${AFFIXES[a].color}`,
                        title: AFFIXES[a].text,
                      },
                      AFFIXES[a].name,
                    ),
                  ),
                ),
              ),
            ),
          ),
        )
      : h(
          "p",
          { class: "muted" },
          p.bestDepth >= 1
            ? "No one has got away with your gold. Yet."
            : "Heroes who escape with treasure from depth 2 onward will be remembered here.",
        ),
    p.vanquished.length
      ? h("h3", {}, `Vanquished · ${p.stats.nemeses} slain`)
      : null,
    p.vanquished.length
      ? h(
          "ul",
          { class: "bonus-list" },
          ...p.vanquished.map((v) =>
            h(
              "li",
              {},
              h("span", {}, `${v.name} · ${HEROES[v.cls].name}`),
              h("b", {}, `level ${v.level} · depth ${v.depth}`),
            ),
          ),
        )
      : null,
    h(
      "small",
      { class: "muted" },
      `Nemeses per descent at your deepest depth: ${nemesesPerRun(Math.max(1, p.maxDepth))}.`,
    ),
  );
}
