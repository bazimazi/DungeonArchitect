# Dungeon Architect

The player is not the hero. The player is the Dungeon Architect.

A mobile-friendly, offline-capable first playable slice of the **build → test → publish → watch → improve** loop. Built with TypeScript, Canvas 2D, and Vite, with a deterministic simulation that also runs without a browser.

## Play locally

Requires Node.js 22.12+, 24, or 26+ (Node 24 recommended).

```sh
npm ci
npm run dev
```

Open the URL printed by Vite, normally **http://127.0.0.1:5173**. If that port is occupied, use `npm run dev -- --port 5188`.

For the production build and offline caching:

```sh
npm run build
npm run preview
```

Open the preview URL once while connected and allow the service worker to finish installing. The production app, art, and fonts are then cached for offline reloads on that origin. HTTPS or localhost is required for service workers. The development server intentionally does not register one.

## First adventure

1. Start with **Mossveil Crypt**, or choose **New dungeon** for a blank grid.
2. Carve rooms and corridors; place monsters, traps, a key, a door, an entrance, and treasure. Every tile and object uses construction points.
3. **Validate dungeon**, then **Test dungeon**. Reach the treasure yourself to unlock publishing.
4. **Publish dungeon** stores an immutable local version. **Invite 6 adventurers** runs six simulated play styles using the same player rules.
5. Watch any attempt, scrub its replay, change playback speed, or jump to death. Inspect traffic and death counts on the heatmap.
6. Change the draft, complete a fresh test, and publish version 2. Version 1 and its attempts remain available for comparison.

## Controls

| Mode             | Controls                                                                                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Build            | Choose a tool, then tap/click a tile. Drag to paint. Right-click to erase.                                                                      |
| Selection        | Select tool, then click an object. Shift-click selects multiple objects. Move, duplicate, rotate, and delete are available in the inspector.    |
| Keyboard editing | Focus the canvas; arrows move the cursor, Enter places. Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z redoes, R rotates, Delete removes selected objects. |
| Camera           | Zoom buttons; Alt-drag or middle-drag to pan. Fit resets the view.                                                                              |
| Test             | WASD/arrows or the touch pad move. Bumping an enemy attacks it; Space attacks adjacent enemies; E waits.                                        |
| Replay           | Play/pause, restart, 0.5×–4× speed, timeline seeking, event jumps, and jump to death.                                                           |

Each input advances a 250 ms simulation turn. Enemies guard their tiles; archers attack along clear lines. Keys are permanent and unlock every door. Spikes and fire have cooldowns. The treasure ends the run. Your last 20 personal test recordings are saved, including failures; **Replay last test** opens the newest for the current dungeon.

## Included

- Transactional placement, budget enforcement, selection, movement, rotation, duplication, deletion, undo/redo, and JSON import/export.
- One 15 × 13 floor, 160 construction points, four enemy types, spikes, fire, healing, keys, and doors.
- Key-aware reachability, spawn safety, required-object checks, and mandatory completion verification against the exact current draft.
- Seeded combat, bounded deterministic runs, versioned replay inputs, and events reconstructed from the original dungeon snapshot.
- Local immutable publishing, six simulated adventurer policies, per-version analytics, death markers, and historical comparison.
- Procedural dungeon art, optional synthesized sound, reduced motion, keyboard-accessible menus, a mobile construction tray, and a localization dictionary.
- Offline production asset caching, local saves, and explicit feedback if device storage fails.

## Check the game

```sh
npx playwright install chromium
npm run check
```

`check` runs core tests, strict TypeScript compilation, a production build, and Chromium end-to-end tests at desktop and mobile viewport sizes. Browser checks cover construction, completion, publication, simulated attempts, replay seeking, failed test recordings, republishing, reload persistence, and offline production play. Screenshots and failure traces are written to the ignored `test-results/` directory. CI runs the same checks.

## Scope and next decisions

This is a local browser vertical slice. Publishing does **not** upload anything, and the adventurers are clearly labeled simulations. LocalStorage is not a security boundary. Online authentication, server ownership/anti-cheat, public discovery, progression, moderation, native Android/iOS packaging, multi-floor dungeons, checkpoints, and advanced logic remain future milestones. Canvas gameplay is not yet fully accessible to screen readers. The 60 FPS target still needs profiling on physical mid-range phones; mobile browser emulation does not establish device performance.

The local library retains up to 100 published versions and 180 published attempts; personal tests retain the latest 20. Dungeon export backs up the selected layout, not the full replay library. Keep the origin/browser profile stable to retain local saves.

See [architecture and simulation decisions](docs/ARCHITECTURE.md). Expand content only after playtesting this loop with people.
