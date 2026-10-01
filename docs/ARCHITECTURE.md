# Architecture

## Boundaries

- `src/core`: schemas, data-driven content, editor transactions, validation, templates, deterministic simulation and bounded playtest policies.
- `src/services`: local library/proofs, analytics, community transport, optional product measurements.
- `src/ui`: Canvas presentation, input, workshop/logic/community screens, localization and audio.
- `src/shared`: API contracts, challenges, progression, cosmetics and worlds.
- `server`: authentication, publishing, attempts, progression, social, moderation, worlds, worker verification and SQLite.
- `android` / `ios`: Capacitor shells with App/deep-link and Share plugins; bundled web assets.

## Simulation contract

One input advances a 250 ms turn. Integer positions/health, seeded randomness, stable event order and a 2,400-turn limit support replay without browser physics. Replays store an immutable snapshot/version, simulation version, seed and input stream. Events/states are reconstructed; the server compresses inputs and recording collections share one snapshot.

Simulation 1 and its original content definitions remain separate. Schema 2 selects simulation 2 for moving entities, environments, logic, bosses, quests and resources. Incompatible changes after release require a new simulation version; version 2 is the current unreleased expansion.

Signals are bounded at 256 per turn and 512 scheduled effects. Verification uses two workers, a 32-job queue, five-second timeout and memory limits. These are abuse bounds, not an exhaustive puzzle solver. Bot failure does not prove impossibility.

## Editor and feasibility

Commands clone, check budget and commit atomically; errors leave history unchanged. The last 100 edits are undoable. Copy/paste remaps internal IDs/rules; moves, mirrors and copies transform patrol routes. Floors are 15 by 13, at most four, with 160 construction points each.

Static validation checks required objects, floors, key-aware reachability, links, budget and configured spawn attack range. Mandatory replay verification proves at least one feasible route for the exact snapshot. All-state softlock checking for arbitrary rules is not implemented. Chambers in analytics are inferred from connected open areas at least two tiles wide; corridors remain separate.

Five dungeon-selected builds normalize starting stats. Loot affects the current run. Account progression unlocks design possibilities and earned cosmetics, not paid combat strength.

## Persistence and authority

SQLite uses WAL, foreign keys, transactions, indexes and a bounded statement cache. Salted scrypt protects passwords; session hashes expire after 30 days. Web cookies are HttpOnly/SameSite; native bearer tokens stay in memory. Production requires HTTPS/secure-cookie configuration.

Publishing reconstructs a clear before saving an immutable version. Attempts receive server seeds and 24-hour tickets; submitted inputs determine outcomes, rewards and analytics. Duplicate requests re-check committed ticket state. Account/dungeon permissions are checked again after asynchronous verification. Ledger uniqueness and reward caps prevent repeated first-clear payouts.

Online statistics include all verified attempts; the UI loads the latest 30 recordings for detailed playback. Difficulty is descriptive; internal challenge rating is heuristic. Ranked feeds use a bounded candidate pool and creator diversification, not learned recommendations.

Cloud/shared drafts use expected revisions. Listing a draft does not adopt a new write base; explicit loading does. Campaign chapters pin public versions with clear/flawless/optional-gold prerequisites. Guild members contribute their own worlds. Co-creation is asynchronous and rejects conflicts.

## Offline and presentation

The production worker precaches hashed assets and self-hosted fonts, never account responses or API writes. Local persistence failures warn without discarding in-memory work. Recovery keeps ten replaced drafts. Account-specific outbox entries retry independently; expired/rejected entries still need manual recovery tooling.

Rendering interpolates the camera without changing outcomes. Transient effects derive from events rather than unbounded physics entities. Optional synthesized sound includes theme ambience and danger/boss intensity. Contrast, text scaling, reduced motion, keyboard menus and touch controls are supported; full nonvisual Canvas gameplay is not.

English is shipped. Keyed/extracted static messages support locale registration, interpolation and RTL. `npm run locales:extract` refreshes the catalog without rewriting source. Some dynamic fragments still need review before a second language ships.

Optional usage measurements default off and exclude layouts, titles, passwords and input streams. Separate authoritative gameplay records support rewards, abuse handling and metrics. These records are pseudonymous, not irreversibly anonymous.
