/**
 * Rules v7: expeditions. The dungeon strikes back: send a war party up to
 * the surface to raid villages, caravans and temples while you are away.
 * Each expedition runs on the real clock (one to twelve hours), can't fail,
 * and is led by one of your forged pieces, whose forge level adds to the
 * spoils. Nothing decays and nothing is lost for coming back late.
 *
 * Offers are drawn from a seeded board that turns over whenever one is
 * taken, so reloading can't reroll them.
 */
import { Rng, hashString } from "../engine/math";
import { PIECES, type PieceId } from "./defs";
import {
  infamyLevel,
  rollHeirloom,
  wellRate,
  type Heirloom,
  type MetaProfile,
} from "./meta";

export type SpoilKind = "souls" | "infamy" | "heirloom" | "embers";
export interface ExpeditionOffer {
  /** Template index. */
  t: number;
  hours: number;
  kind: SpoilKind;
}
export interface Expedition extends ExpeditionOffer {
  id: number;
  leader: PieceId;
  /** Start and end times (ms since epoch). */
  start: number;
  end: number;
  /** Spoils fixed at departure (souls or infamy; item level for heirlooms). */
  amount: number;
}
export interface ExpeditionOwner extends MetaProfile {
  expeditions: Expedition[];
  /** Turns the offer board over. */
  expSeed: number;
  nextExpedition: number;
  forge: Record<string, number>;
  bestDepth: number;
}

export const TEMPLATES: { name: string; text: string }[] = [
  { name: "Raid the Miller's Granary", text: "Easy pickings by the river." },
  {
    name: "Ambush a Royal Caravan",
    text: "Gold under guard, guards under gold.",
  },
  {
    name: "Sack the Temple of Dawn",
    text: "The clerics won't need those relics.",
  },
  { name: "Haunt the Barrow Road", text: "Pilgrims pay to pass. Or else." },
  {
    name: "Burn the Adventurers' Guild",
    text: "Every hero you stop here is one less tonight.",
  },
  {
    name: "Plunder the Dwarven Outpost",
    text: "Pickaxes, ale and unguarded vaults.",
  },
  { name: "Waylay the Tax Collector", text: "The crown's tithe, redirected." },
  { name: "Raze the Watchtower", text: "Its fall will be sung of. Fearfully." },
  { name: "Rob the Wizard's Tower", text: "Mind the wards. Take the books." },
  {
    name: "Terrorise the Market Town",
    text: "Screams carry far on market day.",
  },
];
export const DURATIONS = [1, 4, 8, 12] as const;

/** Expedition slots: one, a second at infamy 15, a third at infamy 40. */
export const EXP_SLOT_LEVELS = [1, 15, 40] as const;
export const expeditionSlots = (p: Pick<MetaProfile, "infamyXp">) =>
  EXP_SLOT_LEVELS.filter((l) => infamyLevel(p.infamyXp).level >= l).length;
/** Expeditions open with the Soul Well, after the first conquest. */
export const expeditionsOpen = (bestDepth: number) => bestDepth >= 1;

/** The three offers on the board right now. */
export function expeditionOffers(
  p: Pick<ExpeditionOwner, "expSeed" | "bestDepth" | "rekindles">,
): ExpeditionOffer[] {
  const rng = new Rng(hashString(`expeditions:${p.expSeed}`));
  const ts = rng.shuffle(TEMPLATES.map((_, i) => i)).slice(0, 3);
  const hours = rng.shuffle([...DURATIONS]).slice(0, 3);
  return ts.map((t, i) => {
    const h = hours[i];
    // Embers come only from long expeditions, once the Heart has been rekindled.
    const kinds: SpoilKind[] = ["souls", "souls", "infamy", "heirloom"];
    if (h >= 8 && p.rekindles > 0) kinds.push("embers");
    return { t, hours: h, kind: rng.pick(kinds) };
  });
}

/** Bonus from the leader: +3% per forge level, without limit. */
export const leaderBonus = (forge: number) => 0.03 * Math.max(0, forge);

/** Spoils of an offer led by a piece at this forge level. */
export function spoils(
  o: ExpeditionOffer,
  bestDepth: number,
  forge: number,
  soulBonus = 0,
) {
  const d = Math.max(1, bestDepth);
  const lead = 1 + leaderBonus(forge);
  // Longer expeditions pay a little more per hour.
  const hours = o.hours * (1 + 0.05 * o.hours);
  switch (o.kind) {
    case "souls":
      return Math.round(wellRate(d) * 1.6 * hours * lead * (1 + soulBonus));
    case "infamy":
      return Math.round((6 + 2 * d) * hours * lead);
    case "heirloom":
      // The item level; long, well-led expeditions bring finer things.
      return d + Math.floor(o.hours / 4) + Math.floor(forge / 10);
    case "embers":
      return Math.max(1, Math.round((o.hours / 8) * lead));
  }
}
/** Least rarity an heirloom expedition can bring back. */
export const expeditionRarity = (hours: number) =>
  hours >= 12 ? 2 : hours >= 4 ? 1 : 0;

/** Pieces that can lead: forged at least once and not already away. */
export function leaders(p: Pick<ExpeditionOwner, "forge" | "expeditions">) {
  const away = new Set(p.expeditions.map((e) => e.leader));
  return (Object.keys(p.forge) as PieceId[])
    .filter((id) => PIECES[id] && (p.forge[id] ?? 0) > 0 && !away.has(id))
    .sort((a, b) => (p.forge[b] ?? 0) - (p.forge[a] ?? 0));
}

export function startExpedition(
  p: ExpeditionOwner,
  offer: number,
  leader: PieceId,
  now: number,
  soulBonus = 0,
) {
  if (!expeditionsOpen(p.bestDepth)) return null;
  if (p.expeditions.length >= expeditionSlots(p)) return null;
  if (!leaders(p).includes(leader)) return null;
  const o = expeditionOffers(p)[offer];
  if (!o) return null;
  const e: Expedition = {
    ...o,
    id: p.nextExpedition++,
    leader,
    start: now,
    end: now + o.hours * 3_600_000,
    amount: spoils(o, p.bestDepth, p.forge[leader] ?? 0, soulBonus),
  };
  p.expeditions.push(e);
  p.expSeed++;
  return e;
}
/** Bring a war party home early, with nothing. */
export function recallExpedition(p: ExpeditionOwner, id: number) {
  const n = p.expeditions.length;
  p.expeditions = p.expeditions.filter((e) => e.id !== id);
  return p.expeditions.length !== n;
}
export interface Haul {
  souls: number;
  infamy: number;
  embers: number;
  heirloom: Heirloom | null;
}
/**
 * Collect a finished expedition. Infamy is returned for the caller to add
 * (it levels the architect); souls and embers go straight into the purse.
 */
export function claimExpedition(
  p: ExpeditionOwner,
  id: number,
  now: number,
): Haul | null {
  const e = p.expeditions.find((x) => x.id === id);
  if (!e || now < e.end) return null;
  p.expeditions = p.expeditions.filter((x) => x.id !== id);
  const haul: Haul = { souls: 0, infamy: 0, embers: 0, heirloom: null };
  if (e.kind === "souls") {
    haul.souls = e.amount;
    p.souls += e.amount;
  } else if (e.kind === "infamy") haul.infamy = e.amount;
  else if (e.kind === "embers") {
    haul.embers = e.amount;
    p.embers += e.amount;
  } else {
    const rng = new Rng(hashString(`expedition:${e.id}:${e.start}`));
    haul.heirloom = rollHeirloom(
      rng,
      p.nextItem++,
      e.amount,
      expeditionRarity(e.hours),
    );
  }
  return haul;
}
export const expeditionReady = (e: Expedition, now: number) => now >= e.end;
export const readyCount = (
  p: Pick<ExpeditionOwner, "expeditions">,
  now: number,
) => p.expeditions.filter((e) => now >= e.end).length;
