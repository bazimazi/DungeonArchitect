# Dungeon Architect

Build a dungeon of traps and monsters, then watch greedy heroes try to rob it.

Dungeon Architect is a roguelite dungeon-defense game. Each run lasts ten nights. Every night you dig tunnels, place traps and monsters, and see the party that's coming. Then night falls, and the heroes march on your hoard. After each raid you pick one of three boons. You win if your hoard survives the champion on night ten.

It runs in any modern browser, works offline after the first visit, and ships as Android and iOS apps via Capacitor. There is no server: dungeons are shared as links.

## Play

```sh
npm ci
npm run dev        # http://localhost:5173
```

|                        | Mouse / keyboard                                              | Touch                          |
| ---------------------- | ------------------------------------------------------------- | ------------------------------ |
| Pick a piece           | Click the tray, or keys `1`–`9`; `D` for dig                  | Tap the tray                   |
| Place / dig / fill     | Click a tile; drag to dig or fill a line                      | Tap; drag                      |
| Select / rotate / sell | Click a piece; `R` rotates; `Delete` sells; right-click sells | Tap a piece, then use its card |
| Undo                   | `Ctrl/Cmd+Z`                                                  | Undo button                    |
| Start the night        | `Enter`                                                       | Begin Night                    |
| Raid                   | `Space` pauses; `F` changes speed; `Q`/`W` use powers         | Buttons                        |
| Camera                 | Wheel zooms; drag pans                                        | Pinch; drag                    |

## Modes

- **Descent:** the ten-night run. Earns renown, which unlocks pieces, architects, biomes and a power.
- **Daily:** the same seeded run for everyone each UTC day, with a shareable result line.
- **Workshop:** unlimited gold and every unlocked piece. Test against any night's party and share your dungeon as a link.
- **Raid links:** opening `#raid=…` lets you assemble a hero party and try to rob a friend's dungeon.

## Develop

```sh
npm test                    # unit tests (simulation, run logic, link codec)
npm run test:e2e            # production build + Playwright (desktop and mobile)
npm run build               # type-check, bundle, generate the offline cache
BALANCE=1 npx vitest run tests/balance.test.ts   # difficulty curve report
```

### Layout

- `src/game`: the rules, all deterministic and DOM-free.
  - `defs.ts`: data and tuning.
  - `grid.ts`: maps, pathfinding and line of sight.
  - `sim.ts`: the raid simulation.
  - `run.ts`: nights, economy and drafts.
  - `share.ts`: link codec.
  - `profile.ts`: saves.
- `src/render`: the Canvas renderer.
  - `world.ts`: terrain cache, lighting, actors and telegraphs.
  - `sprites.ts`: procedural art.
  - `fx.ts`: particles and floating text.
- `src/engine`: seeded RNG, easing and noise (`math.ts`), and the synthesized audio and music (`audio.ts`).
- `src/ui`: the DOM HUD and the screens.
- `src/app.ts`: the game controller (loop, input, state machine, and the glue from simulation events to effects).

The simulation runs at a fixed 20 Hz and uses only IEEE-exact arithmetic. Identical inputs replay identically on any device, which is what makes daily runs and shared raids fair. The renderer interpolates between ticks and never feeds anything back into the simulation.

See [docs/DESIGN.md](docs/DESIGN.md) for the design pillars, systems and research notes. The original brief is kept for reference in [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md).

### Native apps

```sh
npm run native:sync      # build and copy into android/ and ios/
npm run android:debug    # needs Java 21 and the Android SDK
npm run native:ios       # opens Xcode (macOS)
```

## Deploy

Pushing to `main` builds `dist/` and deploys it as static files (see `.github/workflows/deploy.yml`).
