/**
 * Dawn visitors: now and then, after the boon, someone knocks with an offer.
 * Every offer is optional and fully explained, and which visitor comes (and
 * what they carry) is fixed by the run seed and the night, like everything
 * else that is offered in a run.
 */
import { Rng } from "../engine/math";
import {
  HEROES,
  NIGHTS,
  PIECES,
  RELICS,
  isChampion,
  roman,
  type PieceId,
  type RelicId,
} from "./defs";
import {
  TIER_MAX,
  applyCard,
  partyFor,
  reinforceCost,
  type RunState,
} from "./run";

export type EncounterId =
  | "merchant"
  | "smith"
  | "shrine"
  | "turncoat"
  | "cartographer"
  | "wager"
  | "altar"
  | "hunters"
  | "cache";

export interface Encounter {
  id: EncounterId;
  night: number;
  relic?: RelicId;
  pieces?: PieceId[];
  price?: number;
}

export interface EncounterDef {
  id: EncounterId;
  name: string;
  text: string;
  icon: string;
}

export const ENCOUNTERS: Record<EncounterId, EncounterDef> = {
  merchant: {
    id: "merchant",
    name: "Wandering Merchant",
    text: "A hooded trader opens a pack of curious things.",
    icon: "coin",
  },
  smith: {
    id: "smith",
    name: "Goblin Smith",
    text: "“Good iron, half price. No refunds.”",
    icon: "hammer",
  },
  shrine: {
    id: "shrine",
    name: "Cursed Shrine",
    text: "A relic glows on a black altar. Whoever takes it, the heroes' gods will notice.",
    icon: "relic",
  },
  turncoat: {
    id: "turncoat",
    name: "Turncoat",
    text: "A sellsword from tonight's party will stay home for the right price.",
    icon: "skull",
  },
  cartographer: {
    id: "cartographer",
    name: "Mad Cartographer",
    text: "He knows of old halls under your own. For a fee, he'll show you.",
    icon: "pick",
  },
  wager: {
    id: "wager",
    name: "Imp Bookmaker",
    text: "“A little bet on tonight? Three stars, or I keep the gold.”",
    icon: "star",
  },
  altar: {
    id: "altar",
    name: "Blood Altar",
    text: "The altar takes treasure and pays in gold. It never haggles.",
    icon: "hoard",
  },
  hunters: {
    id: "hunters",
    name: "Treasure Hunters",
    text: "Kobold diggers found a buried coffer. They'll sell you the map.",
    icon: "hoard",
  },
  cache: {
    id: "cache",
    name: "Forgotten Cache",
    text: "Your diggers broke into a sealed niche. Take one thing before it collapses.",
    icon: "relic",
  },
};

export interface EncounterOption {
  label: string;
  detail: string;
  /** Gold it costs (shown on the button). */
  cost: number;
  /** Can be taken right now. */
  ok: boolean;
  /** Declines the visitor. */
  leave?: boolean;
}

const RARITY_PRICE = { common: 50, rare: 75, legendary: 110 } as const;
const tierable = (run: RunState) =>
  run.owned.filter((p) => p !== "lure" && (run.tiers[p] ?? 1) < TIER_MAX);
const freeRelics = (run: RunState) =>
  (Object.keys(RELICS) as RelicId[]).filter((r) => !run.relics.includes(r));
const strongest = (run: RunState) => {
  const party = partyFor({ ...run, bribe: undefined }, run.night).filter(
    (p) => !isChampion(p.cls),
  );
  if (party.length < 2) return null;
  return party.reduce((a, b) =>
    HEROES[b.cls].points + (b.elite ? 3 : 0) >
    HEROES[a.cls].points + (a.elite ? 3 : 0)
      ? b
      : a,
  );
};

/**
 * Roll the visitor for the night the run is about to build for, if any.
 * Deterministic per run seed and night.
 */
export function rollEncounter(run: RunState): Encounter | null {
  const n = run.night;
  // Dailies keep their visitors too: everyone meets the same ones.
  if (run.trial || run.workshop) return null;
  if (n < 3) return null;
  if (run.lastEncounter !== undefined && run.lastEncounter >= n - 1)
    return null;
  const rng = new Rng((run.seed ^ Math.imul(n + 7, 0x632be5ab)) >>> 0);
  if (!rng.chance(n > NIGHTS ? 0.3 : 0.36)) return null;
  // The visitor is drawn from the full list first, so everyone in a daily
  // meets the same one; a visitor with nothing to offer this run stays away.
  const id = rng.pick(Object.keys(ENCOUNTERS) as EncounterId[]);
  if (id === "smith" && !tierable(run).length) return null;
  if (id === "turncoat" && !strongest(run)) return null;
  if (id === "altar" && run.hoard < 6) return null;
  const e: Encounter = { id, night: n };
  // Relics too: a fixed draw, stepping past ones this run already holds.
  const all = Object.keys(RELICS) as RelicId[];
  const roll = rng.next();
  const pickRelic = (pool: RelicId[]) => {
    const fits = all.filter((r) => pool.includes(r));
    const start = Math.floor(roll * all.length);
    for (let i = 0; i < all.length; i++) {
      const r = all[(start + i) % all.length];
      if (fits.includes(r)) return r;
    }
    return undefined;
  };
  switch (id) {
    case "merchant": {
      e.relic = pickRelic(freeRelics(run));
      if (!e.relic) return null;
      e.price = RARITY_PRICE[RELICS[e.relic].rarity] + 3 * Math.min(n, 20);
      break;
    }
    case "smith": {
      e.pieces = rng.shuffle(tierable(run)).slice(0, 2);
      break;
    }
    case "shrine":
      e.relic = pickRelic(
        freeRelics(run).filter((r) => RELICS[r].rarity !== "common"),
      );
      if (!e.relic) return null;
      break;
    case "turncoat": {
      const s = strongest(run)!;
      e.price =
        8 * HEROES[s.cls].points + 4 * Math.min(n, 20) + (s.elite ? 25 : 0);
      break;
    }
    case "cartographer":
      e.price = 60 + 5 * Math.min(n, 20);
      break;
    case "wager":
      e.price = 30 + 5 * Math.min(n, 20);
      break;
    case "altar":
      e.price = 90 + 10 * Math.min(n, 20);
      break;
    case "hunters":
      e.price = 45 + 5 * Math.min(n, 20);
      break;
    case "cache":
      e.relic = pickRelic(
        freeRelics(run).filter((r) => RELICS[r].rarity === "common"),
      );
      e.price = 40 + 5 * Math.min(n, 20);
      break;
  }
  return e;
}

/** What the visitor offers. The last option always ends the visit. */
export function encounterOptions(
  run: RunState,
  e: Encounter,
): EncounterOption[] {
  const price = e.price ?? 0;
  const afford = run.gold >= price;
  const leave: EncounterOption = {
    label: "Send them away",
    detail: "",
    cost: 0,
    ok: true,
    leave: true,
  };
  switch (e.id) {
    case "merchant": {
      const r = RELICS[e.relic!];
      return [
        {
          label: `Buy ${r.name}`,
          detail: r.text,
          cost: price,
          ok: afford && !run.relics.includes(e.relic!),
        },
        leave,
      ];
    }
    case "smith":
      return [
        ...(e.pieces ?? []).map((id) => {
          const full = reinforceCost(run, id);
          const cost = full === null ? 0 : Math.ceil(full / 2);
          const tier = run.tiers[id] ?? 1;
          return {
            label: `${PIECES[id].name} to tier ${roman(tier + 1)}`,
            detail: "+40% power for every copy.",
            cost,
            ok: full !== null && run.gold >= cost,
          };
        }),
        leave,
      ];
    case "shrine": {
      const r = RELICS[e.relic!];
      return [
        {
          label: `Take ${r.name}`,
          detail: `${r.text} Heroes gain 8% health for the rest of the run.`,
          cost: 0,
          ok: !run.relics.includes(e.relic!),
        },
        leave,
      ];
    }
    case "turncoat": {
      const s = strongest(run);
      return [
        {
          label: s
            ? `Bribe the ${s.elite ? "elite " : ""}${HEROES[s.cls].name}`
            : "Bribe",
          detail: "Tonight's party loses its strongest hero.",
          cost: price,
          ok: afford && !!s,
        },
        leave,
      ];
    }
    case "cartographer":
      return [
        {
          label: "Buy the old plans",
          detail: "Your dungeon holds 2 more pieces for the rest of the run.",
          cost: price,
          ok: afford,
        },
        leave,
      ];
    case "wager":
      return [
        {
          label: `Bet ${price} gold`,
          detail: `Earn 3 stars tonight and collect ${price * 3}.`,
          cost: price,
          ok: afford,
        },
        { ...leave, label: "No bet" },
      ];
    case "altar":
      return [
        {
          label: "Offer 2 treasure",
          detail: `Gain ${price} gold. The hoard can still hold as much.`,
          cost: 0,
          ok: run.hoard >= 3,
        },
        leave,
      ];
    case "hunters":
      return [
        {
          label: "Buy the map",
          detail: "+2 treasure, and your hoard holds 2 more.",
          cost: price,
          ok: afford,
        },
        leave,
      ];
    case "cache": {
      const opts: EncounterOption[] = [
        {
          label: `Take ${price} gold`,
          detail: "Coins, a little damp.",
          cost: 0,
          ok: true,
        },
      ];
      if (e.relic)
        opts.push({
          label: `Take ${RELICS[e.relic].name}`,
          detail: RELICS[e.relic].text,
          cost: 0,
          ok: !run.relics.includes(e.relic),
        });
      return opts;
    }
  }
}

/**
 * Apply the chosen option (index into `encounterOptions`). Returns a short
 * line describing what happened, or null when the visitor was sent away.
 */
export function resolveEncounter(
  run: RunState,
  e: Encounter,
  choice: number,
): string | null {
  const opts = encounterOptions(run, e);
  const o = opts[choice];
  run.encounter = null;
  run.lastEncounter = e.night;
  if (!o || o.leave || !o.ok) return null;
  const price = e.price ?? 0;
  switch (e.id) {
    case "merchant":
      run.gold -= price;
      applyCard(run, { type: "relic", id: e.relic! });
      return `${RELICS[e.relic!].name} is yours.`;
    case "smith": {
      const id = e.pieces![choice];
      run.gold -= o.cost;
      run.tiers[id] = Math.min(TIER_MAX, (run.tiers[id] ?? 1) + 1);
      return `${PIECES[id].name} reinforced to tier ${roman(run.tiers[id]!)}.`;
    }
    case "shrine":
      applyCard(run, { type: "relic", id: e.relic! });
      run.blight = (run.blight ?? 0) + 1;
      return `${RELICS[e.relic!].name} is yours. The heroes' gods take note.`;
    case "turncoat":
      run.gold -= price;
      run.bribe = e.night;
      return "The turncoat stays home tonight.";
    case "cartographer":
      run.gold -= price;
      run.extraCap = (run.extraCap ?? 0) + 2;
      return "Your dungeon holds 2 more pieces.";
    case "wager":
      run.gold -= price;
      run.wager = { night: e.night, stake: price };
      return `Bet placed: 3 stars tonight pays ${price * 3}.`;
    case "altar":
      run.hoard = Math.max(1, run.hoard - 2);
      run.gold += price;
      return `The altar drinks deep. +${price} gold.`;
    case "hunters":
      run.gold -= price;
      run.hoardMax += 2;
      run.hoard += 2;
      return "+2 treasure.";
    case "cache":
      if (choice === 0) {
        run.gold += price;
        return `+${price} gold.`;
      }
      applyCard(run, { type: "relic", id: e.relic! });
      return `${RELICS[e.relic!].name} is yours.`;
  }
}

/** Settle a bet after the night it was placed on. Returns gold won. */
export function settleWager(run: RunState, night: number, stars: number) {
  const w = run.wager;
  if (!w || w.night !== night) return 0;
  run.wager = null;
  if (stars < 3) return 0;
  const won = w.stake * 3;
  run.gold += won;
  return won;
}
