/**
 * Rules v6–v7: the Sanctum screen. Seven tabs: the Dungeon Heart (endless
 * upgrades), the Forge (piece levels and talents), the Dark Arts (talent
 * tree), the Heirloom vault (awakening, item talents and reforging),
 * expeditions, the Ember Throne (rekindling and Eternal Flames), and a
 * summary of every bonus in effect, trophies included.
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
  AWAKE_PER,
  AWAKE_ROWS,
  FLAMES,
  ITEM_TALENTS,
  REKINDLE_DEPTH,
  REKINDLE_LEVELS,
  TROPHIES,
  awakeLevel,
  buyFlame,
  emberYield,
  flameCost,
  forgeDiscount,
  heartDiscount,
  heartInvested,
  heartLevels,
  itemPick,
  openItemRows,
  reforge,
  reforgeCost,
  rekindle,
  rekindleBlock,
  setItemTalent,
  temperCap,
  trophyLevel,
  trophyTotal,
  type Branch,
  type Heirloom,
  type MetaStat,
} from "../game/meta";
import {
  EXP_SLOT_LEVELS,
  TEMPLATES,
  claimExpedition,
  expeditionOffers,
  expeditionRarity,
  expeditionReady,
  expeditionSlots,
  expeditionsOpen,
  leaders,
  readyCount,
  recallExpedition,
  spoils,
  startExpedition,
  type Expedition,
} from "../game/expeditions";
import {
  grantHeirloom,
  grantInfamy,
  syncMetaStats,
  unlockedPieces,
  type Profile,
} from "../game/profile";
import { MASTERY_NAMES, masteryRank } from "../game/progression";
import { SCHOOLS, SCHOOL_IDS } from "../game/schools";
import { fmt, h, icon, pieceArt } from "./dom";

export type SanctumTab =
  "heart" | "forge" | "arts" | "vault" | "expeditions" | "embers" | "bonuses";
const TABS: [SanctumTab, string][] = [
  ["heart", "Heart"],
  ["forge", "Forge"],
  ["arts", "Dark Arts"],
  ["vault", "Heirlooms"],
  ["expeditions", "Expeditions"],
  ["embers", "Embers"],
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
    const c = heartCost(d, p.heart[d.id] ?? 0, heartDiscount(p));
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
  /** A feat earned by an action on this screen. */
  onFeat?(id: string): void;
  onToast?(text: string): void;
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
          const cost = heartCost(d, level, heartDiscount(p));
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
      const cost = forgeCost(level, forgeDiscount(p));
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
    const aw = awakeLevel(it.awake);
    const rc = reforgeCost(it);
    const picks = it.atal ?? [];
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
          `${RARITIES[it.rarity].name} · item level ${it.ilvl}${it.temper ? ` · tempered +${it.temper}/${temperCap(it)}` : ""}${aw.level ? ` · awakened ${aw.level}` : ""}`,
        ),
      ),
      h(
        "ul",
        { class: "hd-affixes" },
        ...it.affixes.map(([stat, roll], i) =>
          h(
            "li",
            { class: i === 0 ? "implicit" : "" },
            h("span", {}, statText(stat, affixValue(it, stat, roll, i === 0))),
            i > 0 && rc !== null
              ? h(
                  "button",
                  {
                    class: "reforge",
                    disabled: p.souls < rc,
                    title: `Reroll this affix for ${fmt(rc)} souls`,
                    "aria-label": `Reforge ${STATS[stat].name} for ${rc} souls`,
                    onclick: () => {
                      if (reforge(p, it.id, i)) {
                        o.onFeat?.("reforged");
                        changed("unlock");
                      }
                    },
                  },
                  icon("reroll", "ic tiny"),
                  soul(rc),
                )
              : null,
          ),
        ),
        it.legend
          ? h("li", { class: "legend" }, LEGENDS[it.legend].text)
          : null,
        ...ITEM_TALENTS.map((pair, row) =>
          itemPick(it, row) >= 0
            ? h(
                "li",
                { class: "talent" },
                `${pair[itemPick(it, row)].name}: ${pair[itemPick(it, row)].text}`,
              )
            : null,
        ),
      ),
      h(
        "div",
        { class: "awaken" },
        h(
          "div",
          { class: "inf-top" },
          h("b", {}, `Awakening ${aw.level}`),
          h(
            "small",
            {},
            `${fmt((it.awake ?? 0) - aw.prev)}/${fmt(aw.next - aw.prev)} · +${Math.round(aw.level * AWAKE_PER * 100)}% to every value`,
          ),
        ),
        bar(aw.frac),
        h(
          "small",
          { class: "muted" },
          worn
            ? "Grows with every night survived while equipped."
            : "Equip it to awaken it: every night survived feeds it.",
        ),
        h(
          "div",
          { class: "forge-rows" },
          ...ITEM_TALENTS.map((pair, row) => {
            const at = AWAKE_ROWS[row];
            const lockedRow = aw.level < at;
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
                      if (
                        setItemTalent(p, it.id, row, picks[row] === c ? -1 : c)
                      )
                        changed("click");
                      else audio.play("deny");
                    },
                  },
                  h("b", {}, t.name),
                  h("small", {}, lockedRow ? `Awakening ${at}` : t.text),
                ),
              ),
            );
          }),
        ),
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

  // ---------- expeditions (rules v7) ----------
  let leader: PieceId | null = null;
  const expeditionsTab = () => {
    const now = Date.now();
    if (!expeditionsOpen(p.bestDepth))
      return [
        h(
          "p",
          { class: "muted intro" },
          "Conquer your first depth to send war parties to the surface.",
        ),
      ];
    const slots = expeditionSlots(p);
    const free = slots - p.expeditions.length;
    const can = leaders(p);
    if (!leader || !can.includes(leader)) leader = can[0] ?? null;
    const soulBonus = metaBonus(p).s.souls ?? 0;
    const offers = expeditionOffers(p);
    const left = (e: Expedition) => {
      const ms = Math.max(0, e.end - now);
      const hrs = Math.floor(ms / 3_600_000);
      const min = Math.ceil((ms % 3_600_000) / 60_000);
      return hrs ? `${hrs}h ${min}m` : `${min}m`;
    };
    const spoilText = (kind: string, amount: number, hours: number) =>
      kind === "souls"
        ? `${fmt(amount)} souls`
        : kind === "infamy"
          ? `${fmt(amount)} infamy`
          : kind === "embers"
            ? `${amount} ember${amount === 1 ? "" : "s"}`
            : `an heirloom (item level ${amount}${expeditionRarity(hours) ? `, at least ${RARITIES[expeditionRarity(hours)].name}` : ""})`;
    return [
      h(
        "p",
        { class: "muted intro" },
        "Send a war party to raid the surface while you are away. Each one is led by a forged piece (+3% spoils per forge level), takes real time, and always comes home. Nothing is lost by coming back late.",
      ),
      h("h3", {}, `War parties ${p.expeditions.length}/${slots}`),
      p.expeditions.length
        ? h(
            "div",
            { class: "exp-list" },
            ...p.expeditions.map((e) => {
              const ready = expeditionReady(e, now);
              const frac = Math.min(1, (now - e.start) / (e.end - e.start));
              return h(
                "div",
                { class: `exp-card away${ready ? " ready" : ""}` },
                h(
                  "div",
                  { class: "arm-head" },
                  pieceArt(e.leader, 36),
                  h(
                    "div",
                    {},
                    h("b", {}, TEMPLATES[e.t]?.name ?? "Expedition"),
                    h(
                      "small",
                      { class: "muted" },
                      `Led by ${PIECES[e.leader].name} · ${spoilText(e.kind, e.amount, e.hours)}`,
                    ),
                  ),
                ),
                bar(frac),
                ready
                  ? h(
                      "button",
                      {
                        class: "btn small primary",
                        onclick: () => {
                          const haul = claimExpedition(p, e.id, Date.now());
                          if (!haul) return;
                          p.stats.expeditions++;
                          if (haul.souls) p.stats.souls += haul.souls;
                          if (haul.infamy) grantInfamy(p, haul.infamy);
                          if (haul.heirloom) grantHeirloom(p, haul.heirloom);
                          o.onToast?.(
                            haul.heirloom
                              ? `Spoils: ${RARITIES[haul.heirloom.rarity].name} ${heirloomName(haul.heirloom)}`
                              : `Spoils: ${spoilText(e.kind, e.amount, e.hours)}`,
                          );
                          changed("coin");
                        },
                      },
                      "Collect spoils",
                    )
                  : h(
                      "div",
                      { class: "hd-actions" },
                      h("small", { class: "muted" }, `Home in ${left(e)}`),
                      h(
                        "button",
                        {
                          class: "btn small ghost",
                          onclick: () => {
                            if (recallExpedition(p, e.id)) changed("click");
                          },
                        },
                        "Recall (no spoils)",
                      ),
                    ),
              );
            }),
          )
        : null,
      h("h3", {}, "Targets"),
      can.length
        ? h(
            "div",
            { class: "exp-leaders" },
            h("small", { class: "muted" }, "Leader:"),
            ...can.slice(0, 12).map((id) =>
              h(
                "button",
                {
                  class: `chip-btn${leader === id ? " on" : ""}`,
                  "aria-pressed": leader === id ? "true" : "false",
                  title: `${PIECES[id].name} · forge ${p.forge[id]}`,
                  onclick: () => {
                    leader = id;
                    audio.play("click");
                    render();
                  },
                },
                pieceArt(id, 24),
                h("small", {}, `${p.forge[id]}`),
              ),
            ),
          )
        : h(
            "p",
            { class: "muted" },
            p.expeditions.length
              ? "Every forged piece is already away."
              : "Forge a piece once to let it lead an expedition.",
          ),
      h(
        "div",
        { class: "exp-list" },
        ...offers.map((x, i) => {
          const amount = spoils(
            x,
            p.bestDepth,
            leader ? (p.forge[leader] ?? 0) : 0,
            soulBonus,
          );
          return h(
            "div",
            { class: "exp-card" },
            h("b", {}, TEMPLATES[x.t].name),
            h("small", { class: "muted" }, TEMPLATES[x.t].text),
            h(
              "div",
              { class: "exp-meta" },
              h("span", {}, `${x.hours} h`),
              h(
                "span",
                { class: `spoil sp-${x.kind}` },
                spoilText(x.kind, amount, x.hours),
              ),
            ),
            h(
              "button",
              {
                class: `btn small${free > 0 && leader ? " primary" : ""}`,
                disabled: free <= 0 || !leader,
                onclick: () => {
                  if (
                    leader &&
                    startExpedition(p, i, leader, Date.now(), soulBonus)
                  )
                    changed("card");
                },
              },
              free <= 0 ? "No free war party" : "Send",
            ),
          );
        }),
      ),
      slots < EXP_SLOT_LEVELS.length
        ? h(
            "small",
            { class: "muted" },
            `Another war party joins at infamy ${EXP_SLOT_LEVELS[slots]}.`,
          )
        : null,
    ];
  };

  // ---------- the Ember Throne (rules v7) ----------
  const embersTab = () => {
    const block = rekindleBlock(p, p.bestDepth);
    const invested = heartInvested(p);
    const gain = emberYield(invested);
    let confirm = false;
    const rekindleBtn = h(
      "button",
      {
        class: `btn${block || !gain ? "" : " danger"}`,
        disabled: !!block || !gain,
      },
      `Rekindle the Heart · +${gain} ember${gain === 1 ? "" : "s"}`,
    );
    rekindleBtn.addEventListener("click", () => {
      if (!confirm) {
        confirm = true;
        rekindleBtn.textContent = `Really? Every Heart level returns to 0 for ${gain} embers`;
        audio.play("deny");
        return;
      }
      if (rekindle(p, p.bestDepth)) changed("victory");
    });
    return [
      h(
        "p",
        { class: "muted intro" },
        `Rekindling returns every Dungeon Heart level to the fire for embers (souls in hand are kept). Embers buy Eternal Flames, which are never lost. Embers grow with the square root of the souls your Heart has absorbed, so each rekindle asks for a bigger Heart. Needs ${REKINDLE_LEVELS} Heart levels and a conquest at depth ${REKINDLE_DEPTH}.`,
      ),
      h(
        "div",
        { class: "ember-purse" },
        h("div", {}, h("b", {}, fmt(p.embers)), h("small", {}, "embers")),
        h(
          "div",
          {},
          h("b", {}, fmt(p.rekindles)),
          h("small", {}, `rekindle${p.rekindles === 1 ? "" : "s"}`),
        ),
        h(
          "div",
          {},
          h("b", {}, fmt(heartLevels(p))),
          h("small", {}, "Heart levels"),
        ),
      ),
      h(
        "div",
        { class: "hd-actions" },
        rekindleBtn,
        h(
          "small",
          { class: "muted" },
          block === "depth"
            ? `Conquer depth ${REKINDLE_DEPTH} first.`
            : block === "levels"
              ? `${REKINDLE_LEVELS - heartLevels(p)} more Heart levels needed.`
              : `Next ember at ${fmt(400 * (gain + 1) * (gain + 1))} souls absorbed.`,
        ),
      ),
      h("h3", {}, "Eternal Flames"),
      h(
        "div",
        { class: "heart-grid" },
        ...FLAMES.map((d) => {
          const lv = p.flames[d.id] ?? 0;
          const cost = flameCost(d, lv);
          const can = cost !== null && p.embers >= cost;
          return h(
            "div",
            { class: `heart-card flame${cost === null ? " maxed" : ""}` },
            h(
              "div",
              { class: "hc-head" },
              h("b", {}, d.name),
              h(
                "small",
                {},
                `Lv ${lv}${d.max !== undefined ? `/${d.max}` : ""}`,
              ),
            ),
            h("small", { class: "muted" }, d.text),
            cost === null
              ? h("small", { class: "muted" }, "Complete.")
              : h(
                  "button",
                  {
                    class: `btn small${can ? " primary" : ""}`,
                    disabled: !can,
                    onclick: () => {
                      if (buyFlame(p, d.id)) {
                        if ((p.flames[d.id] ?? 0) >= 10) o.onFeat?.("flame10");
                        changed("unlock");
                      }
                    },
                  },
                  `Stoke · ${cost} ember${cost === 1 ? "" : "s"}`,
                ),
          );
        }),
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
      trophyTotal(p)
        ? h("h3", {}, `Siege trophies · ${trophyTotal(p)} levels`)
        : null,
      trophyTotal(p)
        ? h(
            "ul",
            { class: "bonus-list" },
            ...Object.entries(TROPHIES)
              .filter(([c]) => trophyLevel(p, c))
              .map(([c, t]) =>
                h(
                  "li",
                  {},
                  h("span", {}, `${t.name} · ${trophyLevel(p, c)}`),
                  h("b", {}, statText(t.stat, t.per * trophyLevel(p, c))),
                ),
              ),
          )
        : null,
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
              : tab === "expeditions"
                ? expeditionsTab()
                : tab === "embers"
                  ? embersTab()
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
              class: `tab${tab === id ? " on" : ""}${(id === "arts" && unspentPoints(p) > 0) || (id === "forge" && hasOpenRows(p)) || (id === "vault" && p.heirlooms.some((x) => p.equipped.includes(x.id) && openItemRows(x) > 0)) || (id === "expeditions" && readyCount(p, Date.now()) > 0) ? " dot" : ""}`,
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
  // Expedition timers tick while the screen is open.
  const timer = setInterval(() => {
    if (!root.isConnected) return clearInterval(timer);
    if (tab === "expeditions") render();
  }, 20_000);
  return root;
}

const hasOpenRows = (p: Profile) =>
  (Object.keys(p.forge) as PieceId[]).some((id) => openPieceRows(p, id) > 0);
