/** Rules v5 screens: the Armory (mastery and aspects), bounties, progress. */
import { audio } from "../engine/audio";
import { HEROES, PIECES, roman, type PieceId } from "../game/defs";
import {
  activeAspects,
  type Profile,
  type Progress,
  unlockedPieces,
} from "../game/profile";
import {
  ARCH_REWARDS,
  ASPECT_RANK,
  BESTIARY_NAMES,
  BOARD_BONUS,
  MASTERY_AT,
  bountyText,
  masteryProgress,
  rankLabel,
  type BountyBoard,
} from "../game/progression";
import {
  AFFIXES,
  AFFIX_IDS,
  ASPECTS,
  SCHOOLS,
  SCHOOL_IDS,
  SCHOOL_TIERS,
} from "../game/schools";
import { fmt, h, icon, pieceArt } from "./dom";

const bar = (frac: number) =>
  h(
    "div",
    { class: "bar" },
    h("i", {
      style: `width:${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`,
    }),
  );

// ---------------- Armory ----------------
/**
 * Every piece, grouped by school: mastery rank, kills to the next rank, and
 * the aspect it unlocks. Unlocked aspects can be equipped or put away.
 */
export function armoryScreen(
  p: Profile,
  onChange: () => void,
  onClose: () => void,
) {
  const root = h("div", { class: "panel armory" });
  const owned = new Set(unlockedPieces(p));
  const render = () => {
    const on = new Set(activeAspects(p));
    const card = (id: PieceId) => {
      const kills = p.mastery[id] ?? 0;
      const m = masteryProgress(kills);
      const a = ASPECTS[id];
      const open = m.rank >= ASPECT_RANK;
      const equipped = on.has(id);
      return h(
        "div",
        {
          class: `arm-card${open ? " open" : ""}${equipped ? " on" : ""}${owned.has(id) ? "" : " unowned"}`,
        },
        h(
          "div",
          { class: "arm-head" },
          pieceArt(id, 40),
          h(
            "div",
            {},
            h("b", {}, PIECES[id].name),
            h(
              "small",
              { class: `rank r${m.rank}` },
              rankLabel(m.rank),
              ` · ${fmt(kills)} slain`,
            ),
          ),
        ),
        bar(m.frac),
        h(
          "small",
          { class: "muted" },
          m.next === null
            ? "Fully mastered."
            : `${fmt(m.next - kills)} more kills to rank ${roman(m.rank + 1)}`,
        ),
        h(
          "div",
          { class: "aspect" },
          h("b", {}, open ? a.name : `Aspect · ${a.name}`),
          h(
            "p",
            {},
            open
              ? a.text
              : `Unlocks at rank ${roman(ASPECT_RANK)} (${MASTERY_AT[ASPECT_RANK - 1]} kills).`,
          ),
        ),
        open
          ? h(
              "button",
              {
                class: `btn small${equipped ? " primary" : ""}`,
                "aria-pressed": equipped ? "true" : "false",
                onclick: () => {
                  audio.play(equipped ? "click" : "card");
                  if (equipped) p.aspects = p.aspects.filter((x) => x !== id);
                  else p.aspects.push(id);
                  onChange();
                  render();
                },
              },
              equipped ? "Equipped" : "Equip",
            )
          : null,
      );
    };
    const unlocked = SCHOOL_IDS.flatMap((s) => SCHOOLS[s].pieces).filter(
      (id) => masteryProgress(p.mastery[id] ?? 0).rank >= ASPECT_RANK,
    ).length;
    root.replaceChildren(
      h(
        "div",
        { class: "codex-head" },
        h("h2", {}, "Armory"),
        h(
          "button",
          { class: "icon-btn", "aria-label": "Close", onclick: onClose },
          icon("close"),
        ),
      ),
      h(
        "p",
        { class: "muted" },
        `Kills master a piece. Rank ${roman(ASPECT_RANK)} unlocks its aspect: a different way for it to work, not a stronger one. Equipped aspects apply to new descents (not dailies or trials). ${unlocked}/${Object.keys(ASPECTS).length} aspects unlocked.`,
      ),
      ...SCHOOL_IDS.map((s) => {
        const d = SCHOOLS[s];
        return h(
          "section",
          { class: "arm-school", style: `--sc:${d.color}` },
          h(
            "div",
            { class: "arm-school-head" },
            h("h3", {}, d.name),
            h(
              "small",
              {},
              `II (${SCHOOL_TIERS[0]} kinds): ${d.tiers[0]} · IV (${SCHOOL_TIERS[1]} kinds): ${d.tiers[1]}`,
            ),
          ),
          h("div", { class: "arm-grid" }, ...d.pieces.map(card)),
        );
      }),
    );
  };
  render();
  return root;
}

// ---------------- Bounties ----------------
export function bountyPanel(board: BountyBoard) {
  const done = board.paid.filter(Boolean).length;
  return h(
    "div",
    { class: "bounties" },
    h(
      "div",
      { class: "bounty-head" },
      h("b", {}, "Today's bounties"),
      h(
        "small",
        {},
        done === 3
          ? "Board cleared"
          : `${done}/3 · clear all for +${BOARD_BONUS} renown`,
      ),
    ),
    ...board.bounties.map((b, i) => {
      const paid = board.paid[i];
      const prog = Math.min(b.goal, board.progress[i] ?? 0);
      return h(
        "div",
        { class: `bounty${paid ? " done" : ""}` },
        h(
          "span",
          { class: "b-text" },
          paid ? icon("star", "ic tiny") : null,
          bountyText(b),
        ),
        h(
          "small",
          {},
          paid ? `+${b.renown}` : `${prog}/${b.goal} · +${b.renown}`,
        ),
        paid ? null : bar(prog / b.goal),
      );
    }),
  );
}

// ---------------- Night progress ----------------
/** Mastery, aspects, bestiary marks, bounties and levels from one night. */
export function progressList(pr: Progress, archName?: string) {
  const items: HTMLElement[] = [];
  const row = (ic: string, main: string, sub = "") =>
    h(
      "div",
      { class: "unlock" },
      icon(ic, "ic tiny"),
      h("b", {}, main),
      sub ? h("small", {}, ` ${sub}`) : null,
    );
  for (const b of pr.bounties)
    items.push(
      row("trophy", "Bounty complete", `${bountyText(b)} +${b.renown}`),
    );
  if (pr.boardDone)
    items.push(row("crown", "Board cleared", `+${BOARD_BONUS} renown`));
  for (const id of pr.aspects)
    items.push(
      row("hammer", `Aspect unlocked: ${ASPECTS[id].name}`, PIECES[id].name),
    );
  for (const [id, rank] of pr.mastery)
    if (!pr.aspects.includes(id) || rank !== ASPECT_RANK)
      items.push(row("star", `${PIECES[id].name}: ${rankLabel(rank)}`));
  for (const [cls, mark] of pr.bestiary)
    items.push(
      row("book", `Bestiary: ${HEROES[cls].name}`, BESTIARY_NAMES[mark - 1]),
    );
  if (pr.archLevel)
    items.push(
      row(
        "crown",
        `${archName ?? "Architect"} reached level ${pr.archLevel}`,
        ARCH_REWARDS[pr.archLevel] ?? "",
      ),
    );
  if (!items.length) return null;
  return h(
    "div",
    { class: "unlocks progress-earned" },
    h("h3", {}, `Progress${pr.renown ? ` · +${pr.renown} renown` : ""}`),
    ...items,
  );
}

/** Codex section listing every affix. */
export function affixChips(
  show: (title: string, kind: string, text: string) => void,
) {
  return AFFIX_IDS.map((id) => {
    const a = AFFIXES[id];
    const b = h(
      "button",
      {
        class: "cx mutx affix",
        style: `--ac:${a.color}`,
        "aria-label": a.name,
      },
      a.name,
    );
    b.addEventListener("click", () =>
      show(a.name, `Elite affix · from depth ${a.from}`, a.text),
    );
    return b;
  });
}
