# Dungeon Architect

Build a dungeon of traps and monsters, then watch greedy heroes try to rob it.

Dungeon Architect is a roguelite dungeon-defense game. Each descent lasts ten nights. Every night you dig tunnels, place traps and monsters, and see the party that's coming. Then night falls, and the heroes march on your hoard. After each raid you pick one of three boons. You win if your hoard survives the champion on night ten. Each win opens a deeper dungeon, and the depths never end. You can also carry a winning dungeon into the endless Abyss.

It runs in any modern browser, works offline after the first visit, and ships as Android and iOS apps via Capacitor. There is no server: dungeons are shared as links.

## Play

```sh
npm ci
npm run dev        # http://localhost:5173
```

|                        | Mouse / keyboard                                                     | Touch                          |
| ---------------------- | -------------------------------------------------------------------- | ------------------------------ |
| Pick a piece           | Click the tray, or keys `1`–`9`; `D` for dig                         | Tap the tray                   |
| Place / dig / fill     | Click a tile; drag to dig or fill a line                             | Tap; drag                      |
| Select / rotate / sell | Click a piece; `R` rotates; `Delete` sells; right-click sells        | Tap a piece, then use its card |
| Undo                   | `Ctrl/Cmd+Z`                                                         | Undo button                    |
| Start the night        | `Enter`                                                              | Begin Night                    |
| Raid                   | `Space` pauses; `F` changes speed (1–4×); `Q`/`W`/`E`/`R` use powers | Buttons                        |
| Camera                 | Wheel zooms; drag pans                                               | Pinch; drag                    |

## Modes

- **Descent:** the ten-night run at a chosen depth. Each depth is a named dungeon with its own **floorplan** (cellars, long galleries, forks, pillared halls, labyrinths, rifts, sealed vaults, caverns, mines, throne halls…), champion and twists, and depths get harder without limit. Every five depths form a **realm** whose last depth is guarded by a **realm lord** (Thane Brannoc, Nyx the Shade, the Hollow King, Morrigan the Witch Queen). Earns renown, which unlocks pieces, architects, biomes and powers, and raises your architect rank.
- **Atlas of the Deep:** every depth you have opened, realm by realm, with three **crowns** to earn on each: Conquered, Flawless (no treasure lost) and Ascendant (won at heat 5+). Pick any open depth to replay it.
- **Dawn visitors:** some mornings a visitor knocks with an optional deal: a merchant's relic, a goblin smith's half-price upgrade, a cursed shrine, a turncoat who skips tonight's raid, an imp's three-star wager, and more.
- **Schools:** every piece belongs to one of seven schools (Pyre, Steel, Stone, Grave, Wild, Arcana, Guile). Place two different pieces of a school to awaken its tier II bonus, four for tier IV. The build tray shows which schools are awake.
- **Armory and aspects:** kills master a piece through four ranks. Rank II unlocks its **aspect**, a sidegrade that changes how it works (Rusted Spikes poison, a Rolling Stone rolls again, Banshees wail, Kobold Bombers throw firebombs…). Equip aspects in the Armory; they apply to new descents.
- **Elite affixes:** from depth 2, elites carry a visible affix (Swift, Warded, Gilded, Vampiric, Regenerating, Thorned, Steadfast, Salamander). Scout them before you build.
- **Architect levels:** nights and stars level up each architect to 10. Level 2 opens an alternate starting kit, level 4 adds the architect's signature relic to drafts.
- **Bounties and bestiary:** three daily bounties pay renown, and every hero class has bestiary marks (with a line of lore) for slaying enough of them.
- **Omens:** after your first victory, add any of 15 curses to a descent (tougher heroes, fewer pieces, no powers, a blindfold, empowered elites, sleeping schools…). Each omen adds heat, up to 30, and every point of heat adds 10% renown.
- **Abyss:** after a victory, keep going. Every night is harder, and a champion comes every fifth night. How deep can your dungeon go?
- **Trials:** 25 handcrafted puzzle dungeons in six chapters. Each has a fixed party, fixed blueprints, a gold budget and no powers. Earn stars for defending, slaying everyone, and doing it under par.
- **Feats:** 74 long-term goals that pay renown.
- **Daily:** the same seeded run for everyone each UTC day, with a shareable result line.
- **Workshop:** unlimited gold and every unlocked piece. Test against any night's party and share your dungeon as a link.
- **Raid links:** opening `#raid=…` lets you assemble a hero party and try to rob a friend's dungeon.

## Develop

```sh
npm test                    # unit tests (simulation, run logic, link codec, every trial's reference solution)
npm run test:e2e            # production build + Playwright (desktop and mobile)
npm run build               # type-check, bundle, generate the offline cache
BALANCE=1 npx vitest run tests/balance.test.ts   # bot plays whole runs: win rate per depth, abyss, first run
```

### Layout

- `src/game`: the rules, all deterministic and DOM-free.
  - `defs.ts`: data and tuning.
  - `grid.ts`: maps, pathfinding and line of sight.
  - `sim.ts`: the raid simulation.
  - `run.ts`: depths, nights, the abyss, economy, capacity and drafts.
  - `floorplans.ts`: the map archetype of each depth.
  - `schools.ts`: schools, aspects and elite affixes (rules v5 data).
  - `progression.ts`: piece mastery, the bestiary, daily bounties and architect levels.
  - `encounters.ts`: dawn visitors and their offers.
  - `share.ts`: link codec.
  - `trials.ts`: the handcrafted trial dungeons.
  - `profile.ts`: saves, migrations and feats.
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
