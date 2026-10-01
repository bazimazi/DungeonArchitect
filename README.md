# Dungeon Architect

A mobile-first dungeon builder with deterministic adventures, online publishing, verified replays, and tools for improving a dungeon from player feedback. TypeScript, Canvas 2D, Fastify, SQLite, and Capacitor.

## Run locally

Requires Node.js 24 or newer:

```sh
npm ci
npm run build
npm run server
```

Open **http://127.0.0.1:5187**. Register from **Community > Profile**. The database is saved in `data/dungeon-architect.sqlite`. Set `PORT` and `ALLOWED_ORIGINS` together if that port is occupied.

For development, leave the server running and use `npm run dev` in another terminal. Vite defaults to port 5173 and proxies the API to 5187; `DUNGEON_API_URL` overrides that target. Server variables are read from the process; `.env.example` is documentation, not an automatically loaded configuration file.

## Build, play, improve

1. Start with Mossveil Crypt, New dungeon, a template, or First steps.
2. Carve rooms; place encounters, an entrance, and treasure within the construction budget.
3. Validate and personally complete Test dungeon. Editing invalidates the proof.
4. Publish dungeon creates a local version; Publish online uploads after independent server verification.
5. Invite six labeled simulated adventurers locally, or let another account discover and play online.
6. Inspect replays, traffic, deaths, routes, and completion statistics. Edit, retest, and republish.

Offline editing/testing requires no account. Open the production website once to cache its assets for offline reloads. Browser saves belong to their origin/profile. Local limits: 100 versions, 180 published attempts, 20 personal tests, and 10 recoverable drafts. JSON export, recovery, and cloud drafts provide additional copies.

## Controls

| Area      | Controls                                                                                                        |
| --------- | --------------------------------------------------------------------------------------------------------------- |
| Editor    | Tap/click to place; drag to paint; Select for objects; Shift-click for multiple selection; right-click to erase |
| Touch     | Pinch zoom, two-finger pan, long-press actions; bottom construction tray                                        |
| Keyboard  | Canvas arrows/Enter; Ctrl/Cmd+Z undo, Shift+Z redo; Ctrl/Cmd+C/V copy/paste; R rotate; Delete remove            |
| Adventure | WASD/arrows or direction pad; bump enemies to attack; Space attacks; E waits; Interact and Ability buttons      |
| Camera    | Zoom/Fit; Alt-drag or middle-drag; Follow adventurer or Floor overview                                          |
| Replay    | Pause, seek, restart, 0.5x/1x/2x/4x, event/death jumps                                                          |

## Implemented systems

Four connected floors, 76 object types, eight themes, five normalized adventurer builds, configurable monsters/bosses, environmental interactions, event/condition/action logic, NPC quests and resources, eight templates, and optional collect-and-exit objectives. The editor includes transactional history, wiring-preserving duplication, patrol-aware transforms, and layers.

Community features include accounts, discovery, profiles, follows/favorites, QR/share codes, friend challenges, leaderboards, progression, earned cosmetics, rotating challenges, moderation, cloud drafts, shared revision-checked workshops, branching campaigns, and guild world collections. Online results and rewards are server verified.

## Verify and package

```sh
npx playwright install chromium
npm run check
npm run benchmark
npm run native:sync
```

Android requires Java 21 and the Android SDK through JAVA_HOME/ANDROID_HOME. Run `npm run android:debug`; output: `android/app/build/outputs/apk/debug/app-debug.apk`. The API 36 emulator smoke flow covers completion, publication, six simulated attempts, and replay seeking. iOS sources are generated; compilation requires Xcode on macOS.

Set `VITE_API_URL` to an HTTPS community host before building a connected native package. Without it, the native workshop works offline. Native authentication currently lasts for the app process. Custom invitation links use the dungeonarchitect scheme; HTTPS universal links need release-domain association files.

## Release status

This is an extensively implemented, locally verified game, **not a claim that the entire product vision is finished or released**. Public hosting/CDN, signing/store release, physical Android/iOS validation, and audience-dependent balance/retention targets remain unverified. Structural checks and a completion proof do not exhaustively prove every possible puzzle state avoids softlocks. Shared editing uses optimistic revisions, not simultaneous cursor synchronization.

See the [100-section audit](docs/IMPLEMENTATION_STATUS.md), [architecture](docs/ARCHITECTURE.md), [operations](docs/OPERATIONS.md), and unmodified [original design](docs/GAME_DESIGN.md).
