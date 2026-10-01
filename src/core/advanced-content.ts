import { ADVANCED_OBJECTS } from "./advanced-types";
import type { AdvancedObjectType } from "./advanced-types";
import type { ContentDefinition } from "./types";

const traps = new Set([
  "arrow-trap",
  "falling-rock",
  "saw",
  "pit",
  "crusher",
  "launcher",
  "blade",
  "poison-gas",
  "lava",
  "freezer",
  "electric-coil",
  "gravity-trap",
  "teleport-trap",
  "time-trap",
]);
const enemies = new Set([
  "bat",
  "stalker",
  "summoner",
  "healer",
  "patrol",
  "ambusher",
  "shield",
  "mimic",
  "boss",
]);
const environments = new Set([
  "water",
  "oil",
  "wind",
  "darkness",
  "light",
  "smoke",
]);
const treasure = new Set([
  "gold",
  "equipment",
  "artifact",
  "resource",
  "cosmetic",
]);
export const ADVANCED_CONTENT = Object.fromEntries(
  ADVANCED_OBJECTS.map((id) => {
    const enemy = enemies.has(id),
      trap = traps.has(id);
    const definition: ContentDefinition = {
      id,
      nameKey: `object.${id}`,
      descriptionKey: `desc.${id}`,
      category: enemy ? "monsters" : trap ? "traps" : "objects",
      behavior: enemy
        ? "enemy"
        : trap
          ? "trap"
          : environments.has(id)
            ? "environment"
            : treasure.has(id)
              ? "loot"
              : "mechanism",
      cost:
        id === "boss" ? 35 : enemy ? 12 : trap ? 8 : treasure.has(id) ? 6 : 3,
      color: enemy
        ? "#d9959b"
        : trap
          ? "#eead78"
          : treasure.has(id)
            ? "#e6ba66"
            : "#8abfc7",
      ...(enemy
        ? {
            hp: id === "boss" ? 180 : id === "shield" ? 60 : 32,
            damage: id === "boss" ? 16 : 7,
            range: id === "summoner" ? 4 : 1,
            cooldown: 3,
          }
        : trap
          ? {
              damage: id === "pit" ? 30 : id === "crusher" ? 24 : 10,
              cooldown: 4,
              range: ["arrow-trap", "launcher", "electric-coil"].includes(id)
                ? 4
                : 0,
            }
          : {}),
    };
    return [id, definition];
  }),
) as Record<AdvancedObjectType, ContentDefinition>;
for (const definition of Object.values(ADVANCED_CONTENT)) {
  if (
    [
      "gate",
      "stairs",
      "elevator",
      "bridge",
      "breakable-wall",
      "hidden-passage",
      "platform",
      "pillar",
      "conveyor",
    ].includes(definition.id)
  )
    definition.category = "structural";
  else if (
    [
      "plate",
      "lever",
      "button",
      "color-switch",
      "block",
      "mirror",
      "timer",
      "counter",
      "and-gate",
      "or-gate",
      "not-gate",
      "proximity",
      "repeater",
    ].includes(definition.id)
  )
    definition.category = "puzzle";
  else if (
    [
      "teleporter",
      "checkpoint",
      "spawn-zone",
      "npc",
      "barrel",
      "camera-trigger",
      "exit",
    ].includes(definition.id)
  )
    definition.category = "utility";
  else if (definition.behavior === "environment")
    definition.category = "environment";
  else if (["banner", "statue"].includes(definition.id))
    definition.category = "decor";
  definition.unlockLevel = [
    "gravity-trap",
    "time-trap",
    "electric-coil",
    "launcher",
  ].includes(definition.id)
    ? 27
    : ["teleporter", "teleport-trap"].includes(definition.id)
      ? 21
      : definition.id === "npc"
        ? 16
        : [
              "water",
              "oil",
              "freezer",
              "lava",
              "wind",
              "darkness",
              "light",
              "smoke",
              "mirror",
            ].includes(definition.id)
          ? 12
          : ["stairs", "boss", "spawn-zone"].includes(definition.id)
            ? 8
            : definition.category === "monsters" ||
                ["elevator", "platform", "conveyor"].includes(definition.id)
              ? 5
              : 3;
  if (["exit", "banner", "statue"].includes(definition.id))
    definition.unlockLevel = 1;
}

export const MECHANIC_DESCRIPTIONS: Record<AdvancedObjectType, string> = {
  plate: "Sends enter and exit signals when stepped on or weighted by a block.",
  lever: "Interact to toggle connected mechanisms.",
  button: "Interact for a short activation pulse.",
  "color-switch": "Interact to cycle its channel counter.",
  gate: "A closed gate. Open it with a connected mechanism.",
  block: "Push onto a pressure plate or into a corridor.",
  barrel: "Push it or attack it to trigger a chain explosion.",
  mirror: "Interact to rotate it. Redirects projectile traps.",
  timer: "Emits timer signals after its configured delay.",
  counter: "Counts incoming signals; activates at its threshold.",
  "and-gate": "Activates when all incoming sources are active.",
  "or-gate": "Activates when any incoming source is active.",
  "not-gate": "Inverts its incoming source.",
  proximity: "Triggers when an adventurer enters its detection radius.",
  repeater: "Emits a timer signal repeatedly at its configured interval.",
  teleporter: "Transfers an adventurer to its linked destination.",
  stairs: "Connects floors through a linked stair tile.",
  elevator: "An activated lift to a linked destination.",
  checkpoint: "Restores health once and records a safe location.",
  bridge: "A fragile crossing; explosions can destroy it.",
  "breakable-wall": "Blocks passage until attacked or destroyed.",
  "hidden-passage": "Interact or use Explorer’s ability to reveal a shortcut.",
  platform: "Moves one tile along its direction when activated.",
  conveyor: "Pushes adventurers and movable objects along its direction.",
  pillar: "Destructible cover against line attacks.",
  "spawn-zone": "Activating it revives its linked monster.",
  "arrow-trap": "Shoots a directional line on its cooldown.",
  "falling-rock": "A heavy impact at predictable intervals.",
  saw: "Moves along its direction and cuts anything in its path.",
  pit: "Drops an adventurer back to a checkpoint at a health cost.",
  crusher: "A high damage hazard with a slow cooldown.",
  launcher: "Fires through a line, reflecting from mirrors.",
  blade: "Damages adjacent tiles on its cooldown.",
  "poison-gas": "Spreads poison into adjacent floor tiles.",
  lava: "Burns adventurers; water cools it into safe stone.",
  freezer: "Freezes nearby water and slows adventurers.",
  "electric-coil": "Electrifies connected water and deals line damage.",
  "gravity-trap": "Pulls nearby adventurers toward its center.",
  "teleport-trap": "Sends an adventurer to a linked destination.",
  "time-trap": "Slows movement for three turns.",
  water: "Conducts electricity, extinguishes fire, and can freeze.",
  oil: "Ignites when adjacent to fire, creating a chain reaction.",
  wind: "Pushes adventurers in its configured direction.",
  darkness: "Reduces hostile detection; light removes nearby darkness.",
  light: "Reveals nearby darkness and concealed enemies.",
  smoke: "Blocks sight until an adjacent wind clears it.",
  bat: "Fast flying hunter with a two-turn attack rhythm.",
  stalker: "Stays hidden until an adventurer approaches.",
  summoner: "Periodically revives a defeated allied monster.",
  healer: "Restores nearby monsters’ health instead of attacking at range.",
  patrol: "Follows configured waypoints until an adventurer approaches.",
  ambusher: "Waits motionless, then pursues at close range.",
  shield: "Takes less damage from its front.",
  mimic: "Disguises itself until an adventurer gets close.",
  boss: "Configure health-based phases, armor, attacks and arena effects.",
  gold: "Optional treasure worth additional verified gold on a first clear.",
  equipment: "Optional equipment improves attack during this run.",
  artifact: "Optional artifact reduces incoming damage during this run.",
  resource: "Optional cache grants materials on a first clear.",
  cosmetic: "Optional relic grants essence on a first clear.",
  npc: "Complete a quest to gain that faction's trust. Every eight turns inhabitants consume supplies and seek nearby resources; resupply emits OnTrigger.",
  "camera-trigger":
    "Focuses the camera on its linked object or this tile for a fixed number of turns. Does not change movement or combat.",
  banner:
    "A decorative banner. Walk through it freely; rotate to change its facing.",
  statue: "A decorative monument. Does not block the adventure route.",
  exit: "Optional escape point. When placed, adventurers must secure the main treasure and then reach this exit.",
};
