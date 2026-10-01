export const COSMETICS = [
  {
    id: "moss-banner",
    name: "Mossbound banner",
    kind: "banner",
    color: "#98b77e",
    gold: 30,
    materials: 0,
    essence: 0,
  },
  {
    id: "ember-banner",
    name: "Ember architect",
    kind: "banner",
    color: "#e6a071",
    gold: 60,
    materials: 0,
    essence: 0,
  },
  {
    id: "moon-banner",
    name: "Moonstone architect",
    kind: "banner",
    color: "#a9a1d8",
    gold: 0,
    materials: 40,
    essence: 0,
  },
  {
    id: "star-banner",
    name: "Celestial architect",
    kind: "banner",
    color: "#d9c173",
    gold: 0,
    materials: 0,
    essence: 5,
  },
  {
    id: "winter-banner",
    name: "Frostwork founder",
    kind: "banner",
    color: "#90cbdf",
    gold: 80,
    materials: 20,
    essence: 1,
  },
] as const;
export interface CosmeticInventory {
  owned: string[];
  equipped: string | null;
}
export function currentSeason(now: Date): {
  id: string;
  title: string;
  description: string;
  endsAt: string;
  startsAt: string;
  tags: string[];
} {
  const month = now.getUTCMonth(),
    year = now.getUTCFullYear();
  const season =
    month >= 9 && month <= 10
      ? "haunted"
      : month === 11 || month <= 1
        ? "winter"
        : "ancient-gods";
  const startYear = month <= 1 ? year - 1 : year;
  const startMonth = season === "haunted" ? 9 : season === "winter" ? 11 : 2;
  const endMonth = season === "haunted" ? 11 : season === "winter" ? 14 : 9;
  return {
    id: `${season === "winter" ? startYear : year}-${season}`,
    title:
      season === "haunted"
        ? "The Haunted Workshop"
        : season === "winter"
          ? "The Frozen Circuit"
          : "The Ancient Gods",
    description:
      season === "haunted"
        ? "Build an ambush using darkness, stalkers, and hidden passages."
        : season === "winter"
          ? "Turn water into ice and build an elemental puzzle."
          : "Create a temple whose mechanisms respond to the adventurer.",
    startsAt: new Date(
      Date.UTC(season === "winter" ? startYear : year, startMonth, 1),
    ).toISOString(),
    endsAt: new Date(
      Date.UTC(season === "winter" ? startYear : year, endMonth, 1),
    ).toISOString(),
    tags:
      season === "haunted"
        ? ["Stealth", "Trap"]
        : season === "winter"
          ? ["Puzzle", "Precision"]
          : ["Puzzle", "Exploration"],
  };
}
