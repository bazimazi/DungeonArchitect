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
7. **Meta progression widens options, never stats.** Renown unlocks new pieces in the draft pool, architects, biomes and powers. Winning a descent opens the next **depth**, an endless ladder of named dungeons that keeps getting harder. Feats and architect ranks give long-term goals. Nothing permanently buffs your dungeon. _(Slay the Spire's Ascension; Hades' Heat; complaints about grind in Dungeon Warfare 2 and Loop Hero.)_
8. **Sharing works without a server.** A dungeon fits in a URL hash (~120 characters). Friends open it and pick a hero party to raid it, Clash-of-Clans style. The daily dungeon gives everyone the same seed and a Wordle-style share line. Links carry a rules version. _(Levelhead's "Play Problem": UGC needs zero-friction play.)_

## Core loop

```
Scout tonight's party ─▶ Build (dig, place, upgrade) ─▶ Night: raid plays out
        ▲                                                    │
        │                                                    ▼
   Pick 1 of 3 boons ◀── Dawn: stars, bounties, tribute ◀── Results
```

A descent is 10 nights (about 20–30 minutes). Nights 4 and 7 bring an elite hero. Night 10 brings the depth's champion. Your dungeon persists and grows across the run, and tunnels that dwarves dig stay dug.

### Progression: depths, the abyss, feats

- **Depths (infinite).** Every descent is played at a depth. Depth 1 is _The Old Cellars_; winning at your deepest depth opens the next one. Each depth has a fixed identity derived from its number: a name (_The Burning Catacombs_), a night-10 champion (Sir Aldric, Archmage Veyla and Warlord Grukk rotate), and 0–4 **twists** (mutators such as Ironclad, The Horde, Blood Moon, Zealots, Cartographers, Lean Times, Hard Rock, plus rarer blessings such as Gilded Veins or Ancient Hoard). Depths 2–8 also stack fixed heat steps: more hero health, larger parties, less starting gold, more elites, a lighter hoard, faster heroes, and an honour guard for the champion. Past depth 8, heroes gain 7% health and 4% damage per depth and parties keep growing, without limit. Bards, windcallers and inquisitors join parties from depths 2, 3 and 4.
- **The Abyss (endless).** After winning night 10 the victory is banked (renown, records, next depth) and the player may delve into the abyss: the same dungeon continues with no end. Abyss parties are all led by elites, hero health and damage compound each night (×1.09 and ×1.04), and every fifth night (15, 20, 25…) brings the next champion with a growing guard. Each abyss night pays 2 renown plus its stars. The run ends when the hoard is empty, and the best abyss night is recorded.
- **Feats.** Thirty long-term goals (Kingslayer, Constellation, Abyss Walker, Pyromaniac, Guild of Five…) pay renown once. Counter feats show progress bars.
- **Ranks.** Ten architect titles from Apprentice to Eternal Architect, then numbered ranks every 120 renown, so renown keeps meaning something after the unlock track ends at 250.
- **Daily.** One seeded dungeon per UTC day at depth 2–4, with every piece in the draft pool so everyone sees the same offers.

### Economy

- Start: 100 gold (Grimwald gets +30; depth 4+ takes 30). Digging costs 2 gold per tile. Gold veins pay 14 gold when dug.
- Bounties: 10–15 gold per hero, scaling with the night (+50% for elites). Combos add 3 gold per chained kill.
- Dawn tribute: 30 + 4×night + 6 per star.
- **Capacity.** The dungeon holds 5 + 2×night pieces (7 on night 1, 25 on night 10, +1 per abyss night). Space, not gold, is the late-game limit, so every slot is a decision.
- **Reinforcing.** Spare gold raises a blueprint's tier for every copy: cost = piece cost × 4 × current tier, up to tier V. Drafts upgrade to tier III for free. Undo reverts reinforcing within a build phase.
- **Rerolls.** A draft can be rerolled for 10 gold, then 20, 30…
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
| Bard       | Inspires allies: faster, stronger and fearless       | Bats and archers that reach the back line               |
| Windcaller | Floats over floor plates; darts and arrows hurt +50% | Darts, archers, flame, gas and storm pylons             |
| Inquisitor | Fearless; smites undead so they never rise again     | Living monsters and traps                               |
| Sir Aldric | Champion: aura heals allies; fearless; unshakable    | Everything you've got                                   |
| Veyla      | Champion: blinks 4 tiles ahead every 7 s             | Guards at the hoard; saws and pylons she can't skip     |
| Grukk      | Champion: smashes floor plates; war cries rally      | Darts, flame, gas and monsters                          |

### Pieces

Thirteen traps and eleven monsters. Each piece has one rule and one combo hint (see `src/game/defs.ts`). Each tier above I adds 40% power. New in the expansion: the **Storm Pylon** (chain lightning through up to 3 heroes, ignores armor), the **Cave Spider** (webs slow heroes) and the **Stone Golem** (heroes nearby must fight it).

Relics come in three rarities (common, rare, legendary), weighted 4:2:1 in drafts. Five architects change the economy or starting kit: Grimwald, Vex, Morwen, Brakka the Beastmaster (cheaper, harder-hitting monsters) and Seraphine the Alchemist (fire and poison +30%).

### Powers

- **Rockfall** (5 dread): after 0.6 s, a 3×3 area takes 40 crush damage and is stunned.
- **Dread Shriek** (7 dread, unlocked at 12 renown): heroes nearby flee back toward the stairs, across your traps.
- **Grave Chill** (4 dread, unlocked at 98 renown): heroes nearby take 8 magic damage and move at half speed for 4 s.

Dread builds by +1 every 2 s and +2 per kill, up to 15 (20 with Soul Siphon).

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

All economy and scaling knobs live in `TUNE` in `src/game/defs.ts`.

`tests/bot.ts` is a heuristic "reasonable player". It never peeks at simulation results while building. It shapes a longer route, digs veins, spreads traps along the route, guards the hoard with monsters, reinforces its most-used pieces, picks boons by simple priorities and casts powers at clumps of heroes. `BALANCE=1 npx vitest run tests/balance.test.ts` plays whole runs with it at several depths, into the abyss, and with the starter kit (override knobs with `TUNE='{"hpPerNight":0.3}'`).

What the bot found, and what changed:

- Before the expansion, the map saturated. By night 7 a competent player had about 50 pieces and over 1,000 unspendable gold, and won every night (100% wins up to depth 8). Raids lasted 10–30 s. No amount of hero health fixed this, so the capacity limit and reinforcing were added.
- Current curve (bot with every unlock, 16 seeds): depth 1 ≈ 88% wins, depths 2–3 ≈ 70%, depth 5 ≈ 45%, depth 8 ≈ 15%. Raids last 30–45 s, and night 10 runs 55–85 s. The first descent with the starter kit wins ≈ 85%. Abyss runs end between nights 11 and 21, which spreads out the night-15/20/30 feats.
- In hand-played sessions the first nights at depth 1 felt easy for a deliberate player, and the night-10 champion was the first real threat. The ladder carries the difficulty from there.
