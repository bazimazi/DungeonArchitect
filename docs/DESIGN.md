# Dungeon Architect — Design

This document replaces the original brief ([GAME_DESIGN.md](GAME_DESIGN.md)) as the source of truth for what the game is. The brief described a Mario-Maker-style level editor with accounts, servers and social feeds. The shipped game focuses on that brief's core fantasy instead: a single-player-first roguelite that is fun in its first minute, with sharing that works from a static website.

## The fantasy

> You are not the hero. You are the dungeon. Greedy adventurers come every night for your gold, and you decide what they find on the way.

## Design pillars

The pillars come from studying the games that do this best (see "Research" below).

1. **Readable, never random.** Raids are deterministic. Heroes follow simple, visible rules: they walk the highlighted route to your hoard, grab treasure, and run for the stairs. You see tonight's party before you build. Randomness only decides what you're offered (parties, maps, boons), never how a raid plays out. _(Into the Breach, Hoplite, Slay the Spire intents.)_
2. **Combos are the skill.** Every trap and monster carries one short rule plus a combo hint. Fire lights tar. Springs fling heroes onto spikes. Ogres knock heroes into traps. Bait lures rogues into kill boxes. Kills within 2.5 seconds of each other pay combo gold. _(Orcs Must Die, Dungeon Warfare.)_
3. **Every class breaks a lazy strategy.** Rogues disarm the first trap they reach. Rangers spot traps, and the party avoids spotted traps when another route exists. Dwarves tunnel through your maze. Clerics out-heal slow damage. Berserkers ignore fear. Knights can't be flung. _(Dungeon Keeper's thieves and dwarves; Kingdom Rush's flyers.)_
4. **Watching is a spectacle you can steer.** Raids are short (20–90 s) with 1×/2×/3× speed and pause, plus two Architect powers (Rockfall, Dread Shriek) so you are never idle. Hit-stop, screen shake, sparks, coins flying to the counter and dynamic music make a kill land. _(Vlambeer's "screenshake" talk; Loop Hero criticism: long fights with nothing to do.)_
5. **Graded, not pass/fail.** Each night earns 0–3 stars: Defended (nothing stolen), No survivors, Untouched hoard. Losing treasure hurts, but the run ends only when the hoard is empty. Stolen treasure comes back if you kill the thief before they reach the stairs. _(Clash of Clans, Kingdom Rush.)_
6. **Limits, not a blank canvas.** The grid is a fixed 11×15. Gold is the budget. Digging, filling and selling are fully refundable within a build phase, and undo is unlimited, so experimenting is free and the choices are about allocation. _(Into the Breach's 8×8 board; Mario Maker's instant edit/play.)_
7. **Meta progression widens options, never stats.** Renown unlocks new pieces in the draft pool, architects, biomes and a power. Infamy levels (up to 7) add difficulty after a win. Nothing permanently buffs your dungeon. _(Slay the Spire's Ascension; complaints about grind in Dungeon Warfare 2 and Loop Hero.)_
8. **Sharing works without a server.** A dungeon fits in a URL hash (~120 characters). Friends open it and pick a hero party to raid it, Clash-of-Clans style. The daily dungeon gives everyone the same seed and a Wordle-style share line. Links carry a rules version. _(Levelhead's "Play Problem": UGC needs zero-friction play.)_

## Core loop

```
Scout tonight's party ─▶ Build (dig, place, upgrade) ─▶ Night: raid plays out
        ▲                                                    │
        │                                                    ▼
   Pick 1 of 3 boons ◀── Dawn: stars, bounties, tribute ◀── Results
```

A run is 10 nights (about 20–30 minutes). Nights 4 and 7 bring an elite hero. Night 10 is Sir Aldric, the champion: he heals nearby heroes, can't be frightened or knocked back, and takes less crush damage. Your dungeon persists and grows across the run, and tunnels that dwarves dig stay dug.

### Economy

- Start: 110 gold (Grimwald gets +40). Digging costs 2 gold per tile. Gold veins pay 14 gold when dug.
- Bounties: 10–14 gold per hero, scaling with the night (+50% for elites). Combos add 3 gold per chained kill.
- Dawn tribute: 38 + 5×night + 8 per star.
- Selling refunds 100% of a piece's cost on the night it was placed and 75% afterwards.

### Heroes

| Class      | Rule                                                 | Counter                                                 |
| ---------- | ---------------------------------------------------- | ------------------------------------------------------- |
| Knight     | Armored; can't be flung; monsters focus him          | Fire, poison and magic ignore armor; trapdoors          |
| Rogue      | Fast; disarms the first trap ahead; steals double    | Monsters, cheap decoy traps, bait into a kill box       |
| Cleric     | Heals the most wounded ally and cleanses burns       | Burst damage; bats and archers that reach the back line |
| Mage       | Fireballs hit groups of monsters and ignite your tar | Spread monsters out; keep tar away from the front       |
| Ranger     | Long range; spots traps so the party avoids them     | Loops, so the avoided route is just as deadly           |
| Dwarf      | Tunnels through rock when your maze is long          | Traps near the hoard; masonry (bedrock) walls           |
| Berserker  | Fearless; hits harder when wounded                   | Burst damage and crowd control                          |
| Sir Aldric | Champion: aura heals allies; fearless; unshakable    | Everything you've got                                   |

### Pieces

Twelve traps and nine monsters. Each piece has one rule and one combo hint (see `src/game/defs.ts`). Upgrades (tiers II and III) add 40% power each.

### Powers

- **Rockfall** (5 dread): after 0.6 s, a 3×3 area takes 40 crush damage and is stunned.
- **Dread Shriek** (7 dread, unlocked at 12 renown): heroes nearby flee back toward the stairs, across your traps.

Dread builds by +1 every 2 s and +2 per kill, up to 15.

## Presentation

- **Rendering.** Canvas 2D with no art assets. Terrain is baked into an offscreen canvas: rock top faces, wall front faces that spill onto the floor below, ambient occlusion and torches. Actors are drawn procedurally with outlines and animate with walk bob, attack swings and white hit flashes. Lighting is a half-resolution light map multiplied over the scene, plus an additive glow pass. Building happens in daylight and raids at night.
- **Telegraphs.** The hero route is drawn as an animated dashed line. Ranges and lanes appear while placing. Flame lanes and boulder lanes are hatched before they fire. Revealed traps get an eye marker, and disarmed traps a cyan ✕.
- **Juice.** Hit-stop is 50–100 ms with a cooldown. Screen shake uses the trauma model (amount squared, value noise). Damage numbers merge within 150 ms. Particles are pooled and capped at 450.
- **Audio.** Every sound is synthesized with Web Audio: about 30 SFX with voice limiting and pitch variation, and a generative D-minor drone with bells. A 90 BPM pulse layer joins during raids, and a danger layer joins when treasure is at risk.
- **HUD.** The map is fullscreen. Resources sit at the top. The build tray (with keyboard numbers) sits in the thumb zone with a big "Begin Night" button. On wide screens the hero roster moves to the left flank.

## Onboarding

Night one is the tutorial, and it can't be lost. The starter tunnel already has a spike plate, the party is a single knight, and three coach marks appear in turn: the route, "Pick a Skeleton", and "Begin Night". Night two introduces the rogue and points at the Dig tool. A class's rule appears as a "New foe" card the first time that class appears.

## Research summary

These games were studied through reviews, postmortems and community discussion:

- **Dungeon Keeper and Dungeons:** villain humor, thieves and diggers; too much management.
- **Legend of Keepers:** morale combos; repetition.
- **Dungeon Warfare:** physics-trap chains; grind.
- **Orcs Must Die:** combo gold.
- **Super Mario Maker and Levelhead:** clear-checks, discovery problems.
- **Clash of Clans:** async raids, graded stars, layout links.
- **Into the Breach and Hoplite:** deterministic, telegraphed tactics.
- **Desktop Dungeons, Loop Hero, Despot's Game:** luck and idle complaints.
- **Kingdom Rush, Thronefall, Ratropolis:** wave pacing; predictable waves.
- **Slay the Spire and Monster Train:** pick 1 of 3; Ascension.

Pitfalls the design avoids:

- A blank-canvas start.
- Feeds that need a backend.
- Grind and timers.
- Opaque AI.
- Luck-driven outcomes.
- One killbox that solves everything.
- Unskippable fights.

## Tuning

`tests/balance.test.ts` (run with `BALANCE=1 npx vitest run tests/balance.test.ts`) plays naive builds against every night's party. It checks the curve: nights 1–2 are winnable with the starter kit, the midgame needs combos, and night 10 punishes unfocused dungeons. All tuning numbers live in `src/game/defs.ts` and `src/game/run.ts`.
