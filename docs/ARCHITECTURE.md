# First playable slice

The initial repository had no application or game engine. This slice uses TypeScript, Vite, and a Canvas 2D renderer so it can be played immediately on desktop and portrait mobile browsers. It does not claim to be a native Android/iOS release or an online multiplayer service.

The milestone is build → personally complete → publish → simulated attempts → replay → inspect → edit → republish. Content expansion, accounts, discovery, economy, and online infrastructure are deferred until this loop has been playtested.

## Boundaries

- `src/core`: stable content IDs, versioned dungeon packages, transactional editor operations, key-aware validation, and a rendering-independent deterministic simulation.
- `src/services`: immutable local dungeon versions, replay verification, local persistence, and analytics derived from recorded attempts. Simulated adventurers use the same rules as the player.
- `src/ui`: Canvas renderer, audio feedback, localization, and browser controls. Rendering never decides combat results.

## Simulation contract

One input advances one 250 ms tick. Integer grid positions, integer health, explicit seeded randomness, and a stable object order make results reproducible. Replays store the dungeon snapshot, simulation version, seed, and input stream; the renderer reconstructs them with the simulation. Editing invalidates the completion certificate. Publishing replays the certificate against the exact current dungeon; client-provided success flags are never enough.

The slice deliberately uses turn-based movement and adjacent combat instead of introducing nondeterministic physics. Doors use one reusable dungeon key: acquiring it is permanent, and opening a door never consumes it. There are no one-way passages, movable blocks, or destructible keys in this slice, making key-aware graph search sufficient for structural softlock validation. Resource feasibility is proved by the architect's verified completion rather than a heuristic health calculation.

## Persistence and trust

Browser localStorage is a local adapter, not a security boundary. Data is schema-checked on import/load; publish and attempt results are re-simulated. Published snapshots remain unchanged when the draft evolves, and attempts always refer to a specific version. A future server must use these same pure rules behind authenticated ownership checks and its own storage; local verification does not provide online anti-cheat or reward authority.

Storage failures leave the in-memory game playable and show a warning. Reload persistence is only promised after a successful storage write. No remote telemetry is collected.

Personal test recordings are stored separately from published attempts and cannot change public-version analytics. The latest 20 are retained. Published attempts and versions have explicit local limits (180 and 100); reaching a limit is reported instead of silently discarding historical evidence.

Production builds generate a content-hashed service worker precache containing every bundled file, including self-hosted fonts. Only same-origin GET requests are handled. The cache is scoped to this app's name; old app caches are removed on activation. Static precache matching ignores `Vary` because bundled assets are invariant and module versus installation fetches may use different Origin headers. Development builds do not install the worker.

## Deliberate constraints

One floor, 15 × 13 cells, a 160-point construction budget, four enemies, spikes and fire, one key type, and a 2,400-tick run limit. Walls are implicit outside carved floor. Cycles and alternative routes are legal; bounded attempts prevent endless runs. A validation rule will never reject a harmless loop merely for being a loop.

Localization strings live in an English dictionary; object names and gameplay messages are referenced by stable keys. Reduced motion and sound preferences are persisted. Mobile controls use pointer events and touch-size targets.
