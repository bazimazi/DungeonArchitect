/**
 * Rules v6: the Sanctum screen. Five tabs: the Dungeon Heart (endless
 * upgrades), the Forge (piece levels and talents), the Dark Arts (talent
 * tree), the Heirloom vault, and a summary of every bonus in effect.
 */
import { audio, type Sfx } from "../engine/audio";
import { PIECES, roman, type PieceId } from "../game/defs";
import {
  BASES,
  BRANCHES,
  FORGE_CAP,
  FORGE_PER,
  FORGE_ROWS,
  HEART,
  LEGENDS,
  PIECE_TALENTS,
  RARITIES,
  ROW_POINTS,
  SLOT_LEVELS,
  STATS,
  STAT_IDS,
  TALENTS,
  VAULT_SIZE,
  affixValue,
  buyHeart,
  canLower,
  canRaise,
  equip,
  forgeCap,
  forgeCost,
  forgePiece,
  heartCost,
  heirloomName,
  heirloomSlots,
  infamyLevel,
  lowerTalent,
  metaBonus,
  openPieceRows,
  pieceMeta,
  pointsBelow,
  raiseTalent,
  resetTalents,
  salvage,
  salvageAll,
  salvageValue,
  setPieceTalent,
  statText,
  temper,
  temperCost,
  unequip,
  unspentPoints,
  type Branch,
  type Heirloom,
  type MetaStat,
} from "../game/meta";
import { syncMetaStats, unlockedPieces, type Profile } from "../game/profile";
import { MASTERY_NAMES, masteryRank } from "../game/progression";
import { SCHOOLS, SCHOOL_IDS } from "../game/schools";
import { fmt, h, icon, pieceArt } from "./dom";

export type SanctumTab = "heart" | "forge" | "arts" | "vault" | "bonuses";
const TABS: [SanctumTab, string][] = [
  ["heart", "Heart"],
  ["forge", "Forge"],
  ["arts", "Dark Arts"],
  ["vault", "Heirlooms"],
  ["bonuses", "Bonuses"],
];

const bar = (frac: number) =>
  h(
    "div",
    { class: "bar" },
    h("i", {
      style: `width:${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`,
    }),
  );
const soul = (n: number) =>
  h("span", { class: "soul-cost" }, icon("dread", "ic tiny"), fmt(n));

/** Value of a stat for display (percent or flat). */
function statVal(stat: MetaStat, v: number) {
  return STATS[stat].pct
    ? `${v >= 0 ? "+" : ""}${Math.round(v * 1000) / 10}%`
    : `${v >= 0 ? "+" : ""}${Math.round(v * 10) / 10}`;
}

/** Is anything in the Sanctum worth a look (an affordable step or a free point)? */
export function sanctumAlert(p: Profile) {
  if (unspentPoints(p) > 0) return true;
  const lvl = infamyLevel(p.infamyXp).level;
  for (const d of HEART) {
    if (lvl < d.infamy) continue;
    const c = heartCost(d, p.heart[d.id] ?? 0);
    if (c !== null && c <= p.souls) return true;
  }
  return false;
}

export function sanctumScreen(o: {
  profile: Profile;
  tab?: SanctumTab;
  /** Called after every change (save, feats). */
  onChange(): void;
  onClose(): void;
}) {
  const p = o.profile;
  let tab: SanctumTab = o.tab ?? "heart";
  let picked: number | null = null;
  const root = h("div", { class: "panel sanctum" });
  const body = h("div", { class: "sanctum-body" });
  const changed = (sound: Sfx = "card") => {
    audio.play(sound);
    syncMetaStats(p);
    o.onChange();
    render();
  };

  // ---------- header ----------
  const header = () => {
    const inf = infamyLevel(p.infamyXp);
    const pts = unspentPoints(p);
    return h(
      "div",
      { class: "sanctum-purse" },
      h(
        "div",
        { class: "purse-souls" },
        icon("dread", "ic"),
        h("b", {}, fmt(p.souls)),
        h("small", {}, "souls"),
      ),
      h(
        "div",
        { class: "purse-infamy" },
        h(
          "div",
          { class: "inf-top" },
          h("b", {}, `Infamy ${inf.level}`),
          h(
            "small",
            {},
            `${fmt(p.infamyXp - inf.prev)}/${fmt(inf.next - inf.prev)}`,
          ),
        ),
        bar(inf.frac),
        h(
          "small",
          { class: pts ? "pts on" : "pts" },
          pts
            ? `${pts} talent point${pts === 1 ? "" : "s"} to spend`
            : "Every level is a talent point",
        ),
      ),
    );
  };

  // ---------- Heart ----------
  const heartTab = () => {
    const lvl = infamyLevel(p.infamyXp).level;
    return [
      h(
        "p",
        { class: "muted intro" },
        "Feed the Dungeon Heart with souls. Its gifts apply to every new descent (not dailies, trials, the workshop or raid links). Most never stop growing.",
      ),
      h(
        "div",
        { class: "heart-grid" },
        ...HEART.map((d) => {
          const level = p.heart[d.id] ?? 0;
          const locked = lvl < d.infamy;
          const cost = heartCost(d, level);
          const maxed = cost === null;
          const can = !locked && !maxed && p.souls >= (cost ?? 0);
          const buy = (n: number) => {
            let k = 0;
            while (k < n && buyHeart(p, d.id)) k++;
            if (k) changed("unlock");
          };
          return h(
            "div",
            {
              class: `heart-card${locked ? " locked" : ""}${maxed ? " maxed" : ""}`,
            },
            h(
              "div",
              { class: "hc-head" },
              h("b", {}, d.name),
              h(
                "small",
                {},
                locked
                  ? `Infamy ${d.infamy}`
                  : `Lv ${level}${d.max !== undefined ? `/${d.max}` : ""}`,
              ),
            ),
            h(
              "div",
              { class: "hc-effect" },
              level ? statText(d.stat, level * d.per) : STATS[d.stat].name,
            ),
            h(
              "small",
              { class: "muted" },
              maxed
                ? "Complete."
                : `Next: ${statVal(d.stat, d.per)} ${d.max === undefined ? "· endless" : ""}`,
            ),
            h("p", { class: "flavor" }, d.flavor),
            locked
              ? null
              : maxed
                ? null
                : h(
                    "div",
                    { class: "hc-buy" },
                    h(
                      "button",
                      {
                        class: `btn small${can ? " primary" : ""}`,
                        disabled: !can,
                        onclick: () => buy(1),
                      },
                      "Raise ",
                      soul(cost!),
                    ),
                    h(
                      "button",
                      {
                        class: "btn small ghost",
                        disabled: !can,
                        title: "Raise as many times as you can afford",
                        onclick: () => buy(1000),
                      },
                      "Max",
                    ),
                  ),
          );
        }),
      ),
    ];
  };

  // ---------- Forge ----------
  const forgeTab = () => {
    const owned = new Set(unlockedPieces(p));
    const card = (id: PieceId) => {
      const level = p.forge[id] ?? 0;
      const kills = p.mastery[id] ?? 0;
      const rank = masteryRank(kills);
      const cap = forgeCap(kills);
      const capped = level >= cap;
      const cost = forgeCost(level);
      const can = !capped && p.souls >= cost;
      const m = pieceMeta(level, p.ptalents[id]);
      const picks = p.ptalents[id] ?? [];
      const open = openPieceRows(p, id);
      return h(
        "div",
        { class: `forge-card${open ? " alert" : ""}` },
        h(
          "div",
          { class: "arm-head" },
          pieceArt(id, 36),
          h(
            "div",
            {},
            h("b", {}, PIECES[id].name),
            h(
              "small",
              { class: "muted" },
              `Forge ${level}${cap === Infinity ? "" : `/${cap}`} · ${m.pow ? `+${Math.round(m.pow * 100)}% power` : "unforged"}`,
            ),
          ),
        ),
        h(
          "div",
          { class: "forge-rows" },
          ...PIECE_TALENTS.map((pair, row) => {
            const at = FORGE_ROWS[row];
            const lockedRow = level < at;
            return h(
              "div",
              { class: `ft-row${lockedRow ? " locked" : ""}` },
              ...pair.map((t, c) =>
                h(
                  "button",
                  {
                    class: `ft${picks[row] === c ? " on" : ""}`,
                    disabled: lockedRow,
                    title: t.text,
                    "aria-pressed": picks[row] === c ? "true" : "false",
                    onclick: () => {
                      setPieceTalent(p, id, row, picks[row] === c ? -1 : c);
                      changed("click");
                    },
                  },
                  h("b", {}, t.name),
                  h("small", {}, lockedRow ? `Forge ${at}` : t.text),
                ),
              ),
            );
          }),
        ),
        capped
          ? h(
              "small",
              { class: "muted cap-note" },
              rank < 4
                ? `Mastery ${MASTERY_NAMES[rank + 1]} (rank ${roman(rank + 1)}) raises the cap to ${FORGE_CAP[rank + 1] === Infinity ? "endless" : FORGE_CAP[rank + 1]}.`
                : "",
            )
          : h(
              "button",
              {
                class: `btn small${can ? " primary" : ""}`,
                disabled: !can,
                onclick: () => {
                  if (forgePiece(p, id)) changed("unlock");
                },
              },
              `Forge +${Math.round(FORGE_PER * 100)}% `,
              soul(cost),
            ),
      );
    };
    return [
      h(
        "p",
        { class: "muted intro" },
        `Each forge level adds ${Math.round(FORGE_PER * 100)}% power to a piece (damage, and health for monsters). Mastery caps the forge: ${FORGE_CAP.slice(0, 4).join(", ")} levels by rank, endless at rank IV. Talent rows open at forge ${FORGE_ROWS.join(", ")}; switch them freely.`,
      ),
      ...SCHOOL_IDS.map((s) => {
        const d = SCHOOLS[s];
        const ids = d.pieces.filter((id) => owned.has(id));
        if (!ids.length) return null;
        return h(
          "section",
          { class: "arm-school", style: `--sc:${d.color}` },
          h("div", { class: "arm-school-head" }, h("h3", {}, d.name)),
          h("div", { class: "arm-grid" }, ...ids.map(card)),
        );
      }),
    ];
  };

  // ---------- Dark Arts ----------
  const artsTab = () => {
    const pts = unspentPoints(p);
    const branch = (b: Branch) => {
      const rows = [0, 1, 2, 3].map((row) => {
        const need = row * ROW_POINTS;
        const have = pointsBelow(p.talents, b, row);
        const open = have >= need;
        return h(
          "div",
          { class: `arts-row${open ? "" : " locked"}` },
          row
            ? h(
                "small",
                { class: "row-need" },
                open
                  ? `Row ${row + 1}`
                  : `Row ${row + 1} · ${need - have} more points above`,
              )
            : null,
          h(
            "div",
            { class: "arts-nodes" },
            ...TALENTS.filter((t) => t.branch === b && t.row === row).map(
              (t) => {
                const rank = p.talents[t.id] ?? 0;
                const why = canRaise(p, t.id);
                const endless = t.max === undefined;
                return h(
                  "div",
                  {
                    class: `node${rank ? " on" : ""}${t.key || t.max === 1 ? " keystone" : ""}${endless ? " endless" : ""}`,
                  },
                  h(
                    "button",
                    {
                      class: "node-main",
                      disabled: why !== null,
                      title: t.text,
                      onclick: () => {
                        if (raiseTalent(p, t.id)) changed("card");
                      },
                    },
                    h("b", {}, t.name),
                    h(
                      "small",
                      { class: "rank" },
                      endless ? `${rank}` : `${rank}/${t.max}`,
                    ),
                    h("small", { class: "node-text" }, t.text),
                    rank && t.per
                      ? h(
                          "small",
                          { class: "node-val" },
                          statText(t.stat, rank * t.per),
                        )
                      : null,
                  ),
                  rank
                    ? h(
                        "button",
                        {
                          class: "node-minus",
                          "aria-label": `Take a point out of ${t.name}`,
                          disabled: !canLower(p, t.id),
                          onclick: () => {
                            if (lowerTalent(p, t.id)) changed("click");
                          },
                        },
                        "−",
                      )
                    : null,
                );
              },
            ),
          ),
        );
      });
      return h(
        "section",
        { class: `arts-branch br-${b}` },
        h(
          "div",
          { class: "arts-head" },
          h("h3", {}, BRANCHES[b].name),
          h("small", {}, BRANCHES[b].text),
        ),
        ...rows,
      );
    };
    return [
      h(
        "div",
        { class: "arts-top" },
        h(
          "p",
          { class: "muted intro" },
          `Each infamy level is a talent point. Rows need ${ROW_POINTS} points in the rows above them. Respecs are free.`,
        ),
        h(
          "div",
          { class: "arts-actions" },
          h("b", { class: pts ? "pts on" : "pts" }, `${pts} unspent`),
          h(
            "button",
            {
              class: "btn small ghost",
              onclick: () => {
                resetTalents(p);
                changed("click");
              },
            },
            "Reset all",
          ),
        ),
      ),
      h(
        "div",
        { class: "arts-tree" },
        branch("engineer"),
        branch("warlord"),
        branch("overseer"),
      ),
    ];
  };

  // ---------- Heirlooms ----------
  const itemTile = (it: Heirloom, small = false) =>
    h(
      "button",
      {
        class: `heirloom r${it.rarity}${picked === it.id ? " picked" : ""}${p.equipped.includes(it.id) ? " worn" : ""}${small ? " small" : ""}`,
        style: `--rc:${RARITIES[it.rarity].color}`,
        "aria-label": heirloomName(it),
        onclick: () => {
          audio.play("click");
          picked = picked === it.id ? null : it.id;
          render();
        },
      },
      icon(BASES[it.base].glyph, "ic"),
      h("small", { class: "ilvl" }, `${it.ilvl}`),
      it.temper ? h("small", { class: "temper" }, `+${it.temper}`) : null,
      it.locked ? h("small", { class: "lock" }, "🔒") : null,
    );
  const detail = (it: Heirloom) => {
    const worn = p.equipped.includes(it.id);
    const tc = temperCost(it);
    const slots = heirloomSlots(p.infamyXp);
    return h(
      "div",
      { class: "heirloom-detail", style: `--rc:${RARITIES[it.rarity].color}` },
      h(
        "div",
        { class: "hd-head" },
        h("b", {}, heirloomName(it)),
        h(
          "small",
          {},
          `${RARITIES[it.rarity].name} · item level ${it.ilvl}${it.temper ? ` · tempered +${it.temper}` : ""}`,
        ),
      ),
      h(
        "ul",
        { class: "hd-affixes" },
        ...it.affixes.map(([stat, roll], i) =>
          h(
            "li",
            { class: i === 0 ? "implicit" : "" },
            statText(stat, affixValue(it, stat, roll, i === 0)),
          ),
        ),
        it.legend
          ? h("li", { class: "legend" }, LEGENDS[it.legend].text)
          : null,
      ),
      h(
        "div",
        { class: "hd-actions" },
        h(
          "button",
          {
            class: `btn small${worn ? "" : " primary"}`,
            disabled: !worn && p.equipped.length >= slots,
            onclick: () => {
              if (worn ? unequip(p, it.id) : equip(p, it.id)) changed("card");
            },
          },
          worn
            ? "Unequip"
            : p.equipped.length >= slots
              ? "Slots full"
              : "Equip",
        ),
        tc === null
          ? h("small", { class: "muted" }, "Fully tempered")
          : h(
              "button",
              {
                class: "btn small",
                disabled: p.souls < tc,
                title: "+8% to every value",
                onclick: () => {
                  if (temper(p, it.id)) changed("unlock");
                },
              },
              "Temper ",
              soul(tc),
            ),
        h(
          "button",
          {
            class: "btn small ghost",
            onclick: () => {
              it.locked = !it.locked;
              changed("click");
            },
          },
          it.locked ? "Unlock" : "Lock",
        ),
        h(
          "button",
          {
            class: "btn small danger",
            disabled: worn || !!it.locked,
            onclick: () => {
              if (salvage(p, it.id)) {
                picked = null;
                changed("coin");
              }
            },
          },
          "Salvage ",
          soul(salvageValue(it)),
        ),
      ),
    );
  };
  const vaultTab = () => {
    const slots = heirloomSlots(p.infamyXp);
    const worn = p.equipped
      .map((id) => p.heirlooms.find((x) => x.id === id))
      .filter(Boolean) as Heirloom[];
    const items = [...p.heirlooms].sort(
      (a, b) => b.rarity - a.rarity || b.ilvl - a.ilvl || b.id - a.id,
    );
    const sel = p.heirlooms.find((x) => x.id === picked);
    return [
      h(
        "p",
        { class: "muted intro" },
        "Heirlooms turn up on good nights and every conquest; deeper dungeons drop better ones. Equipped heirlooms apply to new descents.",
      ),
      h("h3", {}, `Equipped ${worn.length}/${slots}`),
      h(
        "div",
        { class: "slots" },
        ...SLOT_LEVELS.map((lvl, i) =>
          worn[i]
            ? itemTile(worn[i])
            : h(
                "div",
                { class: `slot${i < slots ? "" : " locked"}` },
                i < slots ? "Empty" : `Infamy ${lvl}`,
              ),
        ),
      ),
      sel ? detail(sel) : null,
      h(
        "div",
        { class: "vault-head" },
        h("h3", {}, `Vault ${p.heirlooms.length}/${VAULT_SIZE}`),
        h(
          "button",
          {
            class: "btn small ghost",
            disabled: !p.heirlooms.some(
              (x) => x.rarity <= 1 && !x.locked && !p.equipped.includes(x.id),
            ),
            onclick: () => {
              if (salvageAll(p, 1)) {
                picked = null;
                changed("coin");
              }
            },
          },
          "Salvage commons & magic",
        ),
      ),
      items.length
        ? h("div", { class: "vault" }, ...items.map((it) => itemTile(it, true)))
        : h(
            "p",
            { class: "muted" },
            "No heirlooms yet. Earn two or three stars on a night, or conquer a depth.",
          ),
    ];
  };

  // ---------- bonuses ----------
  const bonusTab = () => {
    const m = metaBonus(p);
    const rows = STAT_IDS.filter((k) => m.s[k]);
    return [
      h(
        "p",
        { class: "muted intro" },
        "Everything the Sanctum adds to a new descent. A descent can be started with the Sanctum sealed for a pure challenge; earning bonuses still apply.",
      ),
      rows.length || m.keys.length
        ? h(
            "ul",
            { class: "bonus-list" },
            ...rows.map((k) =>
              h(
                "li",
                {},
                h("span", {}, STATS[k].name),
                h("b", {}, statVal(k, m.s[k]!)),
              ),
            ),
            ...m.keys.map((k) =>
              h(
                "li",
                {},
                h("span", {}, "Legion"),
                h("b", {}, k === "legion" ? "Extra monster blueprint" : k),
              ),
            ),
          )
        : h("p", { class: "muted" }, "No bonuses yet."),
      h("h3", {}, "Forged pieces"),
      (() => {
        const forged = (Object.keys(p.forge) as PieceId[])
          .filter((id) => (p.forge[id] ?? 0) > 0)
          .sort((a, b) => (p.forge[b] ?? 0) - (p.forge[a] ?? 0));
        return forged.length
          ? h(
              "ul",
              { class: "bonus-list" },
              ...forged.map((id) => {
                const pm = pieceMeta(p.forge[id] ?? 0, p.ptalents[id]);
                const bits = [
                  pm.pow ? `+${Math.round(pm.pow * 100)}% power` : "",
                  pm.cost ? `−${Math.round(pm.cost * 100)}% cost` : "",
                  pm.gold ? `+${Math.round(pm.gold * 100)}% gold` : "",
                  pm.dread ? `+${pm.dread} dread/kill` : "",
                  pm.tier ? `joins tier ${roman(1 + pm.tier)}` : "",
                  pm.reinforce
                    ? `−${Math.round(pm.reinforce * 100)}% reinforce`
                    : "",
                ].filter(Boolean);
                return h(
                  "li",
                  {},
                  h("span", {}, `${PIECES[id].name} · ${p.forge[id]}`),
                  h("b", {}, bits.join(", ")),
                );
              }),
            )
          : h("p", { class: "muted" }, "Nothing forged yet.");
      })(),
    ];
  };

  const render = () => {
    const keep = body.scrollTop;
    const content =
      tab === "heart"
        ? heartTab()
        : tab === "forge"
          ? forgeTab()
          : tab === "arts"
            ? artsTab()
            : tab === "vault"
              ? vaultTab()
              : bonusTab();
    body.replaceChildren(...(content.filter(Boolean) as HTMLElement[]));
    root.replaceChildren(
      h(
        "div",
        { class: "codex-head" },
        h("h2", {}, "The Sanctum"),
        h(
          "button",
          { class: "icon-btn", "aria-label": "Close", onclick: o.onClose },
          icon("close"),
        ),
      ),
      header(),
      h(
        "div",
        { class: "tabs", role: "tablist" },
        ...TABS.map(([id, label]) =>
          h(
            "button",
            {
              class: `tab${tab === id ? " on" : ""}${(id === "arts" && unspentPoints(p) > 0) || (id === "forge" && hasOpenRows(p)) ? " dot" : ""}`,
              role: "tab",
              "aria-selected": tab === id ? "true" : "false",
              "data-tab": id,
              onclick: () => {
                if (tab === id) return;
                audio.play("click");
                tab = id;
                body.scrollTop = 0;
                render();
              },
            },
            label,
          ),
        ),
      ),
      body,
    );
    body.scrollTop = keep;
  };
  render();
  return root;
}

const hasOpenRows = (p: Profile) =>
  (Object.keys(p.forge) as PieceId[]).some((id) => openPieceRows(p, id) > 0);
