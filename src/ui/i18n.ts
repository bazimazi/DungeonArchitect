import { ROOM_TOOLS } from "../core/rooms";
import { translatedKey } from "./localization";
import { MECHANIC_DESCRIPTIONS } from "../core/advanced-content";
const en: Record<string, string> = {
  "app.name": "Dungeon Architect",
  "app.tagline": "Every great adventure needs an architect.",
  "nav.workshop": "Workshop",
  "nav.attempts": "Attempts",
  "nav.guide": "Field guide",
  "hero.eyebrow": "YOUR WORKSHOP",
  "hero.title": "Build something worth beating.",
  "hero.subtitle":
    "A clever trap. An unexpected turn. A dungeon they’ll remember.",
  "action.new": "New dungeon",
  "action.starter": "Open starter",
  "action.import": "Import",
  "action.export": "Export dungeon",
  "action.edit": "Build",
  "action.test": "Test dungeon",
  "action.publish": "Publish dungeon",
  "action.republish": "Publish new version",
  "action.undo": "Undo",
  "action.redo": "Redo",
  "action.grid": "Toggle grid",
  "action.sound": "Toggle sound",
  "action.motion": "Reduce motion",
  "action.zoomIn": "Zoom in",
  "action.zoomOut": "Zoom out",
  "action.fit": "Fit dungeon",
  "action.validate": "Validate dungeon",
  "action.back": "Back to building",
  "action.restart": "Restart",
  "action.attack": "Attack",
  "action.wait": "Wait",
  "action.play": "Play",
  "action.pause": "Pause",
  "action.death": "Jump to death",
  "action.simulate": "Invite 6 adventurers",
  "action.watchTest": "Replay last test",
  "run.architect": "You · Architect",
  "run.practice": "Your test runs",
  "action.rotate": "Rotate",
  "action.move": "Move",
  "action.duplicate": "Duplicate",
  "action.delete": "Delete",
  "action.close": "Close",
  "action.heatmap": "Death heatmap",
  "action.watch": "Watch replay",
  "action.overview": "Overview",
  "category.rooms": "Rooms",
  "category.traps": "Traps",
  "category.monsters": "Monsters",
  "category.objects": "Objects",
  "tool.select": "Select",
  "tool.room": "Small room",
  "tool.floor": "Corridor",
  "tool.wall": "Wall",
  "tool.erase": "Erase",
  "desc.room": "Carve a 3 × 3 room. Connect it with corridors.",
  "desc.floor": "Carve one floor tile. Drag to draw a corridor.",
  "desc.wall": "Build a wall by filling a floor tile.",
  "desc.erase": "Remove an object, or erase an empty floor tile.",
  "desc.select": "Inspect an object. Shift-click to select several.",
  "object.entrance": "Entrance",
  "object.treasure": "Treasure",
  "object.key": "Brass key",
  "object.door": "Locked door",
  "object.spikes": "Spike trap",
  "object.fire": "Ember vent",
  "object.skeleton": "Skeleton",
  "object.archer": "Archer",
  "object.slime": "Cave slime",
  "object.guardian": "Stone guardian",
  "object.potion": "Healing potion",
  "desc.entrance": "The adventure starts here. One entrance per dungeon.",
  "desc.treasure": "Reach this chest to complete the dungeon.",
  "desc.key": "A permanent key that opens every locked door.",
  "desc.door": "Requires a brass key. Make sure the key is reachable first.",
  "desc.spikes": "18 damage on contact. Resets every four turns.",
  "desc.fire": "12 damage on contact, then every two turns. Keep moving.",
  "desc.skeleton": "36 health · 8 damage. Guards adjacent tiles.",
  "desc.archer":
    "24 health · 7 damage. Shoots along clear rows and columns, up to three tiles.",
  "desc.slime": "24 health · 5 damage every turn. Small, but persistent.",
  "desc.guardian": "72 health · 14 damage. Slow, sturdy, and expensive.",
  "desc.potion": "Restores up to 35 health. Can be collected once.",
  "kit.title": "BUILDING KIT",
  "kit.hint": "Select a piece, then tap the dungeon.",
  "kit.budget": "Construction budget",
  "kit.points": "points",
  "kit.selected": "Selected piece",
  "kit.cost": "Cost",
  "kit.rotate": "Orientation",
  "kit.empty": "Nothing selected",
  "canvas.label":
    "Interactive dungeon. Use arrow keys to move the cursor and Enter to place the selected piece. In test mode, arrow keys move the adventurer.",
  "canvas.hint": "Tap to place · Drag to paint · Right-click to erase",
  "canvas.mobileHint": "Choose a piece below, then tap the dungeon.",
  "canvas.testHint": "WASD / arrows to move · Space to attack · E to wait",
  "canvas.replayHint": "A recorded adventure, reconstructed turn by turn.",
  "status.draft": "Draft",
  "status.updated": "Unpublished changes",
  "status.published": "Published",
  "status.saved": "Saved on this device",
  "status.unsaved": "Not saved — export a backup",
  "status.tested": "Completion verified",
  "status.untested": "Awaiting your test run",
  "status.local": "LOCAL PLAYTEST",
  "status.floor": "Forgotten Cave · Floor 01",
  "insight.title": "THE ARCHITECT’S NOTES",
  "insight.heading": "Make danger deliberate.",
  "insight.body":
    "Give adventurers a choice. A risky shortcut can be more memorable than a hallway full of traps.",
  "check.title": "Ready for adventurers?",
  "check.layout": "Entrance & treasure connected",
  "check.keys": "Keys & spawn are safe",
  "check.test": "Complete your own dungeon",
  "check.testHint": "If you can beat it, you can publish it.",
  "check.ready": "Your dungeon is ready to publish.",
  "analytics.title": "Dungeon insights",
  "analytics.subtitle": "Learn from every adventure.",
  "analytics.empty": "Your first audience awaits.",
  "analytics.emptyBody":
    "Complete your dungeon and publish it to invite simulated adventurers. Their journeys become your next idea.",
  "analytics.attempts": "Attempts",
  "analytics.clears": "Clear rate",
  "analytics.deaths": "Deaths",
  "analytics.time": "Average time",
  "analytics.recent": "Recent adventures",
  "analytics.version": "Dungeon version",
  "analytics.noDeaths":
    "No deaths recorded. Try a bolder challenge, or enjoy a welcoming dungeon.",
  "analytics.deadliest": "Most dangerous encounter",
  "analytics.local": "Simulated adventurers · stored on this device",
  "analytics.traffic": "Visited",
  "analytics.deathLegend": "Death count",
  "analytics.invited": "Six adventurers have explored your dungeon.",
  "analytics.noVersion": "Publish a dungeon to begin collecting attempts.",
  "run.health": "Health",
  "run.key": "Key collected",
  "run.noKey": "No key",
  "run.time": "Adventure time",
  "run.playing": "Your test run",
  "run.completed": "A worthy adventure.",
  "run.completedBody":
    "Treasure claimed. Your completion is verified — this dungeon can now be published.",
  "run.dead": "The dungeon wins.",
  "run.deadBody":
    "Every defeat is a design note. Adjust the encounter or try another route.",
  "run.abandoned": "Time to try another route.",
  "run.abandonedBody":
    "The run reached its turn limit. Return to building or restart.",
  "run.damage": "damage taken",
  "run.turns": "turns",
  "run.cleared": "Treasure reached",
  "run.failed": "Fell in the dungeon",
  "run.incomplete": "Incomplete",
  "replay.title": "Replay theatre",
  "replay.empty": "No adventures to replay yet.",
  "replay.timeline": "Replay position",
  "replay.speed": "Playback speed",
  "event.spawn": "Adventure begins",
  "event.move": "Moved",
  "event.blocked": "Path blocked",
  "event.attack": "Attack",
  "event.damage": "Damage taken",
  "event.kill": "Enemy defeated",
  "event.trap": "Trap triggered",
  "event.key": "Key collected",
  "event.door": "Door opened",
  "event.heal": "Health restored",
  "event.complete": "Treasure reached",
  "event.death": "Adventurer died",
  "event.timeout": "Turn limit reached",
  "validation.entrance": "Place exactly one entrance.",
  "validation.treasure": "Place exactly one treasure chest.",
  "validation.budget": "The dungeon exceeds its construction budget.",
  "validation.floor": "Every object must stand on a floor tile.",
  "validation.unreachable": "The treasure cannot be reached from the entrance.",
  "validation.key": "A locked door has no obtainable key.",
  "validation.spawn": "The entrance is in an enemy’s immediate attack range.",
  "validation.success":
    "Layout checks passed. Complete a test run to prove it is fair.",
  "editor.budgetExceeded":
    "Not enough construction points. Remove a piece to free up budget.",
  "editor.outside": "Choose a tile inside the dungeon.",
  "editor.needsFloor": "Place a room or corridor here first.",
  "editor.occupied": "This tile already contains an object.",
  "editor.emptyTitle": "Give your dungeon a name.",
  "editor.unique": "Entrances and treasure cannot be duplicated.",
  "editor.moveHint": "Tap a floor tile to move the selection.",
  "editor.duplicateHint": "Tap a floor tile for the duplicate.",
  "editor.placed": "Piece placed.",
  "editor.new": "A blank canvas for your next adventure.",
  "editor.imported":
    "Dungeon imported. Complete a fresh test before publishing.",
  "publish.testRequired":
    "Complete this exact dungeon yourself before publishing.",
  "publish.invalid": "Resolve the layout issues before publishing.",
  "publish.unchanged":
    "This version is already published. Make an improvement first.",
  "publish.success":
    "Your dungeon is published locally. Invite adventurers to see how it plays.",
  "publish.limit":
    "The local library has reached 100 versions. Export your work before starting a new browser profile.",
  "attempt.limit":
    "The local replay library is full. Export your dungeon to continue in a new browser profile.",
  "storage.invalidDungeon": "This file is not a supported dungeon package.",
  "storage.dungeonVersion": "This dungeon uses an unsupported save version.",
  "storage.invalidReplay":
    "The replay does not match a valid recorded adventure.",
  "storage.replayVersion":
    "This replay uses an unsupported simulation version.",
  "storage.loadFailed":
    "Saved data could not be loaded. The starter dungeon is open; your stored data has not been deleted.",
  "storage.saveFailed":
    "Device storage is unavailable or full. Your work remains open; export a backup before leaving.",
  "guide.title": "A small guide to great dungeons",
  "guide.intro":
    "You are the architect. Build a challenge you can beat, then watch what other adventurers do with it.",
  "guide.build": "1. Shape the journey",
  "guide.buildBody":
    "Carve rooms and connect them with corridors. Place one entrance and one treasure. Walls fill floor tiles; erase removes an object first.",
  "guide.test": "2. Prove it is possible",
  "guide.testBody":
    "Move with WASD, arrow keys, or the touch pad. Bump into an enemy to attack, or press Space. Each input advances one turn. Enemies guard their tiles; arrows need a clear line. Grab the key before a locked door.",
  "guide.watch": "3. Learn and improve",
  "guide.watchBody":
    "After reaching treasure, publish locally and invite six simulated adventurers. Watch their replays and inspect the death heatmap. Changes require a new completion and create a new published version.",
  "guide.shortcuts":
    "Editor shortcuts: Ctrl/Cmd Z to undo, Shift Z to redo, R to rotate, Delete to remove selected objects. Shift-click selects several objects. Arrow keys move the canvas cursor; Enter places a piece.",
  "guide.scope":
    "The workshop works offline. Community connects to your game server for accounts, publishing, verified adventures, campaigns and shared creation. Advanced workshop adds logic and linked floors. Native project files are included; device builds and release testing are separate steps.",
  "new.title": "Start a new dungeon?",
  "new.body":
    "Your current draft will be replaced and a recent-draft backup kept on this device. Published versions and their replays remain in your local library. Export important creations for a separate backup.",
  "new.confirm": "Create blank dungeon",
  "new.cancel": "Keep building",
  "generic.error": "That action could not be completed.",
  "brand.first": "Dungeon",
  "brand.second": "Architect",
  "nav.label": "Main navigation",
  "theme.cave": "Forgotten Cave",
  "dungeon.name": "Dungeon name",
  "dungeon.untitled": "Untitled dungeon",
  "run.testBadge": "Test run",
  "run.replayBadge": "Replay",
  "kit.categories": "Building categories",
  "kit.available": "{count} points available",
  "kit.selectionCount": "{count} selected",
  "analytics.adventureCount": "{count} adventures",
  "run.adventurer": "The adventurer",
  "run.arrowHint": "or arrow keys to move",
  "run.tip":
    "Bump into an enemy to attack. Every move advances one turn, so take your time.",
  "run.log": "Adventure log",
  "run.completeBadge": "Dungeon complete",
  "run.endBadge": "Adventure ended",
  "run.move": "Move {direction}",
  "direction.up": "up",
  "direction.down": "down",
  "direction.left": "left",
  "direction.right": "right",
  "analytics.noVersions": "No published versions",
  "analytics.brave": "Room to be brave.",
  "analytics.fell":
    "{deaths} of {attempts} adventurers fell to this encounter. Watch a replay to understand why.",
  "analytics.history": "Version history",
  "analytics.attemptCount": "{count} attempts",
  "analytics.clearPercent": "{percent}% clear",
  "replay.moments": "Key moments",
  "new.badge": "A new adventure",
};

for (const [id, room] of Object.entries(ROOM_TOOLS)) {
  en[`tool.${id}`] = room.name;
  en[`desc.${id}`] =
    `Carve a ${room.width} by ${room.height} room. Connect it with corridors.`;
}
for (const category of ["structural", "puzzle", "utility", "environment"])
  en[`category.${category}`] = category[0].toUpperCase() + category.slice(1);
for (const [id, description] of Object.entries(MECHANIC_DESCRIPTIONS)) {
  en[`object.${id}`] = id
    .split("-")
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join(" ");
  en[`desc.${id}`] = description;
}
Object.assign(en, {
  "storage.invalidConfiguration":
    "Object settings or logic connections are invalid.",
  "editor.maxFloors": "A dungeon can have up to four floors.",
  "event.signal": "Mechanism triggered",
  "event.interact": "Object activated",
  "event.ability": "Adventurer ability",
  "event.loot": "Optional treasure collected",
  "event.teleport": "Passage traversed",
  "event.environment": "Environment changed",
  "event.phase": "Boss phase changed",
  "event.quest": "Quest updated",
  "validation.link": "A passage needs a linked destination.",
  "validation.logic": "A logic connection references a missing object.",
});

export function t(
  key: string,
  values: Record<string, string | number> = {},
): string {
  return translatedKey(key, en[key] ?? key).replace(
    /\{(\w+)\}/g,
    (match, name: string) => String(values[name] ?? match),
  );
}
export function errorText(error: unknown): string {
  const key = error instanceof Error ? error.message : "generic.error";
  return en[key] ?? en["generic.error"];
}
export function duration(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)
    .toString()
    .padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
}
