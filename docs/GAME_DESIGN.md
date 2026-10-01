# Dungeon Architect
## Comprehensive Game Design & Implementation Plan

## 1. Product Vision

Build a mobile-first game called **Dungeon Architect**.

### Genre

- Dungeon Builder
- Roguelite
- Strategy
- Puzzle
- Asynchronous Multiplayer
- User-Generated Content

### Core fantasy

The player is not the hero.

The player is the **Dungeon Architect**.

They construct dangerous, clever, beautiful, and increasingly complex dungeons and then release them for adventurers to challenge.

The core loop is:

```text
Build
  ↓
Test
  ↓
Publish
  ↓
Adventurers attempt it
  ↓
Watch attempts / replays
  ↓
Analyze failures and successes
  ↓
Improve dungeon
  ↓
Earn rewards
  ↓
Unlock new mechanics
  ↓
Build more sophisticated dungeons
```

The game must make the player feel:

> "I designed this."

and later:

> "I can't believe someone actually solved it."

and eventually:

> "How can I make something that looks impossible but is still fair?"

The game should support years of additional content through a combination of:

- player-generated dungeons
- modular mechanics
- progression
- seasonal challenges
- discovery systems
- social systems
- dungeon archetypes
- increasingly powerful building tools

---

# 2. Product Goals

Prioritize these goals in order:

1. Extremely satisfying dungeon construction.
2. Extremely satisfying dungeon testing.
3. Easy-to-understand controls.
4. Deep strategic possibilities.
5. Fair but difficult challenges.
6. Strong replayability.
7. Strong asynchronous multiplayer.
8. Meaningful progression.
9. Large player-generated content ecosystem.
10. Long-term extensibility.

Do NOT build the game as a complicated level editor first.

The first version must be:

> Easy to build with, difficult to master.

---

# 3. Platform

Primary target:

- Android
- iOS

Design primarily for:

- portrait orientation where practical
- touch interaction
- one-handed interaction where possible
- short sessions
- 5–15 minute dungeon-building sessions
- 1–5 minute dungeon attempts

The architecture should allow future:

- tablet support
- PC support
- controller support

---

# 4. Core Gameplay Model

Every dungeon consists of a sequence/network of:

```text
Entrance
    ↓
Rooms
    ↓
Challenges
    ↓
Branches
    ↓
Rewards
    ↓
Boss / Final Challenge
    ↓
Treasure
```

However, the architecture must NOT force a linear structure.

Players should eventually be able to create:

- linear dungeons
- branching dungeons
- looping dungeons
- multi-floor dungeons
- vertical dungeons
- shortcut-based dungeons
- puzzle dungeons
- combat dungeons
- trap-heavy dungeons
- stealth dungeons
- resource-drain dungeons
- mixed dungeons

---

# 5. Player Roles

There are two sides.

## Architect

Builds and publishes dungeons.

## Adventurer

Attempts player-created dungeons.

Initially, the same player can perform both roles.

Do not require separate accounts/classes.

The player's global profile represents their entire career.

---

# 6. The First-Time Experience

The tutorial should be extremely short.

Do NOT introduce every mechanic.

Tutorial progression:

### Step 1

Place:

- entrance
- corridor
- room
- monster
- treasure

Test it.

### Step 2

Introduce traps.

### Step 3

Introduce doors and keys.

### Step 4

Publish a dungeon.

### Step 5

Show an NPC/player attempt.

### Step 6

Show the replay.

### Step 7

Explain:

> "Now make it better."

The player should create their first meaningful dungeon within approximately 5–10 minutes.

---

# 7. Dungeon Construction System

Create a grid-based construction system initially.

Each dungeon consists of cells.

Example:

```text
################
# E #     #    #
#   #  M  # T  #
#   ### ###    #
#       K      #
### ######## ###
#       B      #
################
```

However, visually present it as a beautiful 2D/2.5D dungeon rather than a developer-style grid.

---

# 8. Building Modes

Create separate building categories.

## Rooms

Examples:

- Small room
- Large room
- Corridor
- Hall
- Chamber
- Arena
- Treasure room
- Boss room
- Puzzle room
- Secret room

## Structural

- Walls
- Doors
- Gates
- Bridges
- Stairs
- Elevators
- Platforms
- Breakable walls
- Hidden passages
- Moving platforms

## Traps

Start with:

- Spike
- Arrow trap
- Falling rock
- Fire
- Saw
- Pit
- Crushing wall
- Projectile launcher

Later:

- rotating blades
- poison gas
- lava
- freezing zones
- electricity
- gravity traps
- teleport traps
- time traps
- chain reactions

## Monsters

Start with:

- melee enemy
- ranged enemy
- fast enemy
- tank enemy

Later:

- flying enemy
- invisible enemy
- summoner
- healer
- patrol enemy
- ambusher
- shield enemy
- mimic
- boss

## Puzzle Objects

- Pressure plate
- Lever
- Button
- Key
- Key door
- Switch
- Color switch
- Moving block
- Rotating mirror
- Pushable object
- Timed switch

## Utility

- Teleporter
- Checkpoint
- Spawn point
- Camera trigger
- Event trigger
- Respawn zone

---

# 9. Dungeon Budget

Every dungeon has a construction budget.

Example:

```text
Budget: 100

Room       5
Monster    8
Trap       6
Boss       25
Treasure   10
Door       2
Puzzle     12
```

The player must decide where to spend resources.

This is critical.

A dungeon should not simply become:

> Place everything everywhere.

Instead:

> What gives me the most danger per budget?

---

# 10. Danger Budget

In addition to construction cost, implement a hidden/internal **Challenge Rating**.

Calculate it using:

- enemy strength
- trap density
- traversal length
- resource requirements
- healing availability
- checkpoint frequency
- puzzle complexity
- environmental hazards
- expected damage
- expected time
- escape opportunities

The system should estimate:

```text
Challenge Rating
1 ───────── 100
```

Use this internally to help matchmaking and dungeon discovery.

Do not expose the exact algorithm.

---

# 11. Dungeon Validation

A dungeon cannot be published until it passes validation.

Validation should verify:

### Reachability

Can the adventurer reach the treasure?

### Softlock detection

Can the player become permanently stuck?

### Impossible state detection

Can the player lose required keys?

### Spawn safety

Does the player spawn in a dangerous impossible state?

### Resource feasibility

Is the dungeon theoretically completable?

### Infinite loop detection

Detect problematic cycles.

### Required-object validation

If a door requires a key:

```text
Key must be obtainable before the door.
```

### Test completion

The architect must personally complete the dungeon before publishing.

This creates a powerful rule:

> If you can't beat your own dungeon, you can't publish it.

Later, introduce special modes that allow intentionally extreme/experimental dungeons.

---

# 12. Testing Mode

Testing should be one of the best parts of the game.

When pressing:

**TEST**

the builder enters the dungeon as an adventurer.

Provide:

- movement
- combat
- interaction
- health
- stamina/resources
- inventory
- checkpoint behavior

The test run should be recorded.

The player can immediately return to editing.

Important:

```text
TEST
↓
FAIL
↓
EDIT
↓
TEST AGAIN
```

must be extremely fast.

Avoid loading screens where possible.

---

# 13. Adventurer Simulation

For asynchronous gameplay, create a standardized adventurer simulation.

Each dungeon attempt should record:

```text
Position
Health
Inventory
Combat actions
Damage taken
Doors opened
Keys collected
Traps triggered
Enemies defeated
Time
Death location
```

This allows replay.

---

# 14. Replay System

The replay system is a major feature.

Do not initially record video.

Record deterministic gameplay events/state.

Example:

```text
t=0.0 Spawn
t=1.2 Move
t=2.4 OpenDoor
t=3.1 TriggerTrap
t=4.8 Attack
t=5.2 EnemyKilled
...
```

Reconstruct the run from recorded state/events.

This gives:

- small storage size
- fast replay
- deterministic visualization
- analytical data

---

# 15. Replay Viewer

The Architect should be able to watch attempts.

Provide:

- Play
- Pause
- 0.5x
- 1x
- 2x
- 4x
- Restart
- Jump to death
- Follow adventurer
- Floor overview

Display important events:

```text
💀 Player died here
⚔ Enemy killed
🔥 Trap activated
🔑 Key collected
🚪 Door opened
💎 Treasure reached
```

---

# 16. Death Heatmap

Aggregate all attempts.

Display a heatmap showing:

```text
Green   = players pass easily
Yellow  = moderate difficulty
Orange  = frequent failures
Red     = major failure point
```

This becomes one of the most important tools for Architects.

Example:

> 73% of adventurers die here.

The Architect can then inspect why.

---

# 17. Dungeon Analytics

Every published dungeon gets analytics.

Show:

### Attempts

`1,842`

### Completions

`426`

### Completion rate

`23.1%`

### Average time

`04:37`

### Average deaths

`3.8`

### Most dangerous trap

`Rotating Blades`

### Most dangerous room

`Room 7`

### First-death location

`Room 4`

### Most common escape route

`Secret corridor`

These statistics should be presented visually and simply.

---

# 18. Iterative Dungeon Improvement

The game should actively encourage iteration.

After publishing:

```text
Dungeon performed poorly
       ↓
Analyze
       ↓
Modify
       ↓
Republish
```

Do NOT punish players for updating dungeons.

Track versions:

```text
Dungeon v1
Dungeon v2
Dungeon v3
Dungeon v4
```

Allow the Architect to compare:

```text
Version 3
Completion: 31%

Version 4
Completion: 18%
```

---

# 19. Dungeon Rating

Avoid relying only on a simple 1–5 star rating.

Use multiple signals:

- completion rate
- likes/favorites
- plays
- rematches
- completion streaks
- challenge attempts
- player retention after attempting

Players can still provide:

- Like
- Favorite
- Report

But avoid allowing popularity alone to determine discovery.

---

# 20. Discovery System

Create several discovery categories.

## Recommended

Based on:

- player history
- difficulty
- preferred mechanics
- dungeon length

## New

Recently published.

## Trending

Rapidly increasing activity.

## Challenging

High difficulty but legitimate completion rate.

## Clever

High replay/interaction signals.

## Short

Fast dungeons.

## Long

Extended dungeons.

## Puzzle

Puzzle-oriented.

## Combat

Combat-oriented.

## Trap Master

Trap-focused.

## Community Favorites

High sustained engagement.

Avoid making discovery simply:

> Most likes first.

Otherwise the ecosystem becomes dominated by a tiny number of creators.

---

# 21. Dungeon Tags

Architects can select tags.

Examples:

```text
Combat
Puzzle
Trap
Stealth
Speed
Boss
Vertical
Maze
Resource Management
Precision
Exploration
```

Allow players to discover combinations:

```text
Puzzle + Boss
Trap + Speed
Combat + Vertical
Stealth + Maze
```

---

# 22. Procedural Daily Challenge

Every day generate a global constraint.

Examples:

### Minimalist

Budget:

```text
50
```

### Monster Master

Only monsters.

### Trap Week

Trap cost reduced.

### Tiny Dungeon

Maximum 25 cells.

### No Doors

Doors forbidden.

### One Boss

Exactly one boss.

Everyone builds under the same rules.

This creates recurring engagement.

---

# 23. Weekly Architect Challenge

Every week:

```text
Theme
Rules
Budget
Available mechanics
```

Example:

> Build the most interesting dungeon using only water-based hazards.

Players submit.

The game tracks:

- plays
- completion
- engagement
- community reactions

Do not automatically declare a "best" dungeon unless the game has a transparent contest system; instead present multiple community-selected categories such as "most played", "most attempted", and "most favorited."

---

# 24. Progression

Progression must unlock **new design possibilities**, not simply bigger numbers.

Primary progression:

```text
Architect Level
```

Secondary progression:

```text
Dungeon Mastery
```

Individual mechanic mastery:

```text
Trap Mastery
Monster Mastery
Puzzle Mastery
Architecture Mastery
Boss Mastery
```

---

# 25. World Progression

Start:

## Era 1 — Forgotten Cave

Unlock:

- basic rooms
- basic monsters
- basic traps
- doors
- treasure

Then:

## Era 2 — Ancient Ruins

Unlock:

- switches
- puzzles
- hidden rooms
- moving objects

## Era 3 — Castle

Unlock:

- guards
- gates
- elevators
- patrol systems
- siege mechanisms

## Era 4 — Fortress

Unlock:

- advanced combat
- defensive structures
- multi-floor architecture

## Era 5 — Temple

Unlock:

- magical mechanisms
- elemental traps
- mystical puzzles

## Era 6 — Underground City

Unlock:

- NPCs
- factions
- complex transportation
- multi-zone systems

## Era 7 — Hell

Unlock:

- extreme hazards
- demons
- portals
- corruption mechanics

## Era 8 — Alien Facility

Unlock:

- advanced technology
- lasers
- drones
- gravity
- teleportation
- temporal mechanics

Future eras should be data-driven.

---

# 26. Unlock Philosophy

Avoid:

> +10% trap damage

as the primary progression.

Prefer:

> New trap interaction.

Examples:

```text
Fire + Oil → larger fire
Water + Electricity → electrified water
Ice + Moving Platform → sliding platform
Wind + Projectile → trajectory modification
Gravity + Trap → altered trajectory
```

This creates combinatorial depth.

---

# 27. Mechanic Interaction System

Create a reusable interaction/event framework.

Every gameplay object can expose:

```text
OnEnter
OnExit
OnTrigger
OnDamage
OnDeath
OnInteract
OnActivate
OnDeactivate
OnTimer
OnCollision
OnDestroy
OnSpawn
```

Objects can subscribe to events.

Example:

```text
Pressure Plate
      ↓
Door opens

Pressure Plate
      ↓
Fire activates

Pressure Plate
      ↓
Monster cage opens
```

Later:

```text
Pressure Plate
→ activates conveyor
→ pushes barrel
→ barrel hits switch
→ opens gate
→ releases monster
```

This is the foundation of emergent dungeon design.

---

# 28. Environmental System

Create environmental states.

Examples:

- Fire
- Water
- Ice
- Poison
- Electricity
- Lava
- Wind
- Darkness
- Light
- Smoke

Environmental effects should interact.

Example:

```text
Water + Electricity
```

can electrify a region.

```text
Oil + Fire
```

creates spreading fire.

```text
Ice + Water
```

creates frozen terrain.

The system should be modular rather than hard-coded per object.

---

# 29. Advanced Automation

Eventually allow:

- timers
- counters
- conditional triggers
- AND gates
- OR gates
- NOT gates
- delayed events
- repeaters
- proximity triggers
- pressure sensors

Example:

```text
Player enters room
        ↓
Timer starts
        ↓
Player must hit 3 switches
        ↓
Gate opens
```

This effectively turns the game into a lightweight visual logic programming system.

---

# 30. Dungeon Scripting — Advanced Endgame

Eventually introduce a visual rule system.

Example:

```text
WHEN player enters Room 4
IF key_count >= 2
THEN open Gate A
ELSE spawn Guardian
```

Do NOT expose traditional programming.

Use visual nodes.

Nodes:

```text
EVENT
CONDITION
ACTION
DELAY
COUNTER
VARIABLE
RANDOM
```

This gives expert Architects enormous depth.

---

# 31. Boss Construction

Do not make bosses merely stronger monsters.

Allow modular bosses.

Boss components:

```text
Body
Movement
Attack Pattern
Defense
Phase
Ability
Weakness
Arena Mechanic
```

Example:

```text
Stone Golem

Phase 1:
Melee

Phase 2:
Breaks arena

Phase 3:
Summons minions

Phase 4:
Loses armor
```

Architects can construct custom encounters.

---

# 32. Boss Arena Builder

Provide specialized boss tools:

- moving platforms
- hazards
- pillars
- cover
- destructible objects
- spawn zones
- phase triggers
- arena transitions

Boss fights should become an entire dungeon-design genre.

---

# 33. Treasure System

Treasure is not merely the endpoint.

Allow:

- gold
- equipment
- artifacts
- keys
- rare resources
- cosmetic rewards

Architects can place optional treasure.

This creates risk/reward decisions.

Example:

```text
Safe route → finish

Dangerous side route → rare treasure
```

---

# 34. Adventurer Progression

The adventurer side needs meaningful progression.

The player earns an adventurer profile by playing other dungeons.

Stats:

- Health
- Attack
- Defense
- Mobility
- Utility
- Equipment

However, avoid making player progression invalidate older dungeons.

Use normalized dungeon challenge rules.

Possible model:

```text
Dungeon difficulty
        +
Adventurer build
        +
Player skill
```

---

# 35. Adventurer Builds

Later add:

### Warrior

Strong combat.

### Rogue

Stealth and mobility.

### Mage

Elemental interactions.

### Engineer

Trap manipulation.

### Explorer

Better discovery and resource efficiency.

The Architect should be able to design challenges around different approaches.

---

# 36. Multiple Solutions

A high-quality dungeon should not necessarily have exactly one solution.

Encourage:

```text
Combat route
Puzzle route
Stealth route
Risky shortcut
Secret route
```

This increases replayability.

Example:

```text
Locked gate
   ├── Find key
   ├── Defeat guardian
   ├── Discover hidden passage
   └── Use explosive barrel
```

---

# 37. Emergent Gameplay

Prioritize systemic interactions over manually scripted content.

The game should produce surprising situations.

Example:

```text
Player
 ↓
Pushes barrel
 ↓
Barrel rolls into pressure plate
 ↓
Door opens
 ↓
Monster escapes
 ↓
Monster attacks explosive barrel
 ↓
Explosion destroys bridge
 ↓
Player falls
```

The player should feel:

> "The dungeon did that."

rather than:

> "The developer scripted that."

---

# 38. Dungeon Templates

Provide templates for new Architects.

Examples:

### Classic Dungeon

Entrance → rooms → boss → treasure.

### Gauntlet

Continuous combat.

### Puzzle Box

Mechanism-heavy.

### Maze

Navigation-heavy.

### Trap House

Trap-heavy.

### Boss Rush

Multiple bosses.

### Escape Dungeon

Player must escape before timer expires.

### Survival

Survive waves.

Templates reduce creation friction.

---

# 39. Undo / Redo

The editor MUST support:

- undo
- redo
- multi-select
- copy
- paste
- duplicate
- rotate
- mirror
- delete
- drag
- snap
- layer management

These features should be implemented early.

---

# 40. Mobile Editor UX

The editor is the heart of the game.

Do not make it feel like desktop level-editing software.

Use:

```text
Tap
Drag
Long press
Pinch
Two-finger pan
Context radial menu
```

Example:

Long-press object:

```text
Move
Duplicate
Rotate
Configure
Delete
```

Bottom toolbar:

```text
Rooms | Traps | Monsters | Objects | Logic | Decor
```

---

# 41. Object Configuration

When selecting an object, show only relevant options.

Example trap:

```text
Spike Trap

Damage       ███████
Cooldown     ███
Trigger      Pressure Plate
Direction    →
```

Avoid overwhelming the player with technical parameters.

Advanced options unlock later.

---

# 42. Visual Quality

The game can use relatively simple graphics.

Focus heavily on:

- animation
- particles
- lighting
- camera movement
- destruction
- environmental effects
- responsive interactions
- satisfying sound effects

The game should look impressive without requiring AAA assets.

---

# 43. Dungeon Visual Themes

Each era gets its own visual language.

Examples:

```text
Cave
Stone
Castle
Temple
Hell
Alien
```

Objects should share a common modular architecture so themes can be added without rewriting mechanics.

---

# 44. Camera

Implement:

- smooth camera movement
- zoom
- room framing
- dynamic combat camera
- cinematic boss camera
- editor camera
- replay camera

During editor mode, camera movement must feel instant.

During gameplay, camera movement should feel smooth and responsive.

---

# 45. Audio

Create layered audio.

### Ambient

Per dungeon theme.

### Gameplay

- footsteps
- traps
- doors
- switches
- attacks
- impacts

### Feedback

- success
- failure
- treasure
- discovery
- publish
- new follower

### Dynamic

Increase intensity during:

- boss encounters
- final room
- low health
- time pressure

---

# 46. Social System

Each player has:

```text
Architect Profile
```

Display:

- published dungeons
- total attempts received
- completions
- followers
- favorites
- architect level
- featured creations
- badges

Allow:

- follow
- favorite dungeon
- share dungeon
- challenge friend

---

# 47. Friend Challenges

Allow:

> Challenge a friend to beat your dungeon.

The friend receives:

```text
"You have been challenged."
```

The result should show:

```text
Completion time
Deaths
Damage taken
Secrets discovered
```

This creates natural social competition without requiring synchronous multiplayer.

---

# 48. Dungeon Sharing

Every dungeon receives a shareable ID.

Example:

```text
DA-7K4P-29M
```

Support:

- deep links
- QR codes
- social sharing

A shared link should open the dungeon directly.

---

# 49. Creator Reputation

Instead of only follower counts, create a creator profile based on measurable achievements.

Examples:

```text
Trap Architect
Puzzle Architect
Boss Architect
Chaos Architect
Logic Architect
```

Achievements should reflect actual behavior.

Example:

> 1,000 adventurers attempted your dungeons.

---

# 50. Seasonal Content

Introduce seasonal rule sets.

Examples:

### Halloween

- haunted rooms
- ghosts
- curses

### Winter

- ice
- snow
- frozen mechanics

### Ancient Gods

- temples
- divine mechanisms

Seasonal mechanics should ideally remain available in some form rather than deleting player creations.

---

# 51. Economy

Use a simple economy initially.

Currencies:

## Gold

Earned from playing dungeons.

## Architect Materials

Earned through publishing/testing.

## Rare Essence

Earned from achievements and difficult content.

Avoid excessive currencies.

Each currency must have a clear purpose.

---

# 52. Monetization

Do NOT sell power that changes dungeon difficulty unfairly.

Possible monetization:

- cosmetic themes
- cosmetic dungeon skins
- visual effects
- architect avatars
- decorations
- music packs
- seasonal cosmetic bundles
- optional premium content packs

Potentially:

```text
Premium Architect Pass
```

with additional cosmetic/editor content.

Avoid:

- pay-to-win
- paying to make dungeons stronger
- paid attempts
- energy systems that interrupt core gameplay

---

# 53. Anti-Abuse

User-generated content requires strong moderation.

Implement:

- report dungeon
- report player
- automated validation
- spam detection
- exploit detection
- inappropriate-name filtering
- rate limits
- duplicate detection

Allow administrators to:

- hide dungeon
- disable publishing
- suspend creator
- restore content

---

# 54. Anti-Cheat

Do not trust the client for:

- rewards
- completion results
- leaderboard results
- attempt statistics

Server-authoritative validation should verify important gameplay events.

---

# 55. Backend Architecture

Use a service-oriented architecture.

Core services:

```text
Authentication
Player Profile
Dungeon Service
Dungeon Version Service
Attempt Service
Replay Service
Analytics Service
Discovery Service
Social Service
Economy Service
Leaderboard Service
Moderation Service
Notification Service
```

Keep services modular.

Do not prematurely split into dozens of microservices.

A modular monolith is acceptable for the first release.

---

# 56. Core Data Model

Design entities such as:

```text
Player
PlayerProgression
Dungeon
DungeonVersion
DungeonObject
DungeonConnection
DungeonRule
DungeonTag
DungeonAttempt
DungeonReplay
DungeonAnalytics
DungeonFavorite
DungeonFollow
DungeonChallenge
Achievement
Season
Challenge
CurrencyTransaction
```

---

# 57. Dungeon Serialization

Dungeon data must be versioned.

Example:

```json
{
  "version": 12,
  "theme": "AncientRuins",
  "size": {
    "width": 32,
    "height": 24
  },
  "objects": [],
  "connections": [],
  "rules": []
}
```

Never make saved dungeon data dependent on internal class names.

Create a stable serialization format.

---

# 58. Deterministic Simulation

The replay system requires deterministic simulation.

Implement:

- deterministic random seed
- deterministic physics where practical
- deterministic event ordering
- fixed simulation tick
- explicit random state

Every attempt receives:

```text
DungeonVersionId
SimulationVersion
RandomSeed
Input/Event Stream
```

This allows old replays to remain reproducible.

---

# 59. Simulation Versioning

Because gameplay mechanics will evolve, replay compatibility must be planned.

Store:

```text
SimulationVersion = 3
```

Old replays can use their original simulation implementation or be migrated.

Do not assume future physics will reproduce old behavior automatically.

---

# 60. Leaderboards

Create leaderboards for specific categories.

Examples:

```text
Fastest Completion
Fewest Deaths
Longest Survival
Most Treasure
Highest Difficulty Completed
```

Avoid one global leaderboard dominating the game.

Create:

- daily
- weekly
- seasonal
- friend
- dungeon-specific

leaderboards.

---

# 61. Dungeon-Specific Records

Every dungeon can display:

```text
Fastest completion
Fewest deaths
Most secrets
Longest streak
```

This creates a reason for players to replay.

---

# 62. Difficulty Calibration

Do not allow Architect-selected difficulty alone to determine actual difficulty.

Use observed data.

Possible calculated dimensions:

```text
Completion Rate
Median Completion Time
Death Density
Damage Taken
Retry Rate
```

The system can derive an estimated difficulty band.

Example:

```text
Very Easy
Easy
Moderate
Hard
Extreme
```

Treat these as descriptive measurements, not quality judgments.

---

# 63. Fairness Indicators

A dungeon can receive system-generated indicators such as:

```text
✓ Completable
✓ Tested
✓ Multiple solutions detected
⚠ High early death rate
⚠ Long average completion time
```

This helps players understand the challenge before entering.

---

# 64. Discovery Algorithm

Create a recommendation system using:

```text
Player interests
Difficulty preference
Mechanic preference
Session length
History
Creators followed
Dungeons completed
Dungeons abandoned
```

Avoid recommending only popular dungeons.

Include exploration.

---

# 65. New Creator Protection

New creators need visibility.

Give new dungeons controlled exposure.

For example:

```text
Small test audience
       ↓
Measure engagement
       ↓
Expand exposure if appropriate
```

This prevents the ecosystem from becoming impossible for newcomers.

---

# 66. Dungeon Lifecycle

Implement states:

```text
Draft
Testing
Published
Updated
Unlisted
Archived
Moderated
```

Never delete a dungeon merely because the creator updated it.

Preserve historical versions when needed.

---

# 67. Notifications

Useful notifications:

```text
Someone completed your dungeon.

Someone failed your dungeon.

Your dungeon received 100 attempts.

Someone favorited your dungeon.

Your friend completed your challenge.

Your dungeon is trending.

A new seasonal challenge is available.
```

Do not spam notifications.

---

# 68. Retention Loop

The long-term loop should become:

```text
Play
↓
Discover clever dungeon
↓
Learn a mechanic
↓
Build your own interpretation
↓
Publish
↓
Receive attempts
↓
Analyze
↓
Improve
↓
Gain reputation
↓
Unlock new mechanics
↓
Create something more ambitious
```

This is the central retention engine.

---

# 69. MVP

Do NOT implement the entire vision initially.

MVP should contain:

### Editor

- grid
- rooms
- walls
- doors
- traps
- 4 enemy types
- treasure
- entrance
- exit

### Gameplay

- movement
- combat
- health
- death
- restart
- treasure completion

### Publishing

- save dungeon
- validate
- publish

### Async system

- attempt recording
- replay
- basic analytics

### Progression

- architect XP
- unlock mechanics

### Discovery

- new
- popular
- recommended

### Social

- favorite
- share

That is enough to prove the concept.

---

# 70. Phase 1 — Foundation

Implement:

- project architecture
- rendering
- input
- game loop
- deterministic simulation
- entity/component architecture
- serialization
- save/load
- basic camera
- basic UI
- audio abstraction

Create automated tests immediately.

---

# 71. Phase 2 — Dungeon Editor

Implement:

- grid
- placement
- deletion
- selection
- movement
- rotation
- duplication
- undo/redo
- object configuration
- budget system
- validation

Build the editor before adding large amounts of content.

---

# 72. Phase 3 — Adventurer Gameplay

Implement:

- player controller
- collision
- combat
- enemies
- health
- damage
- traps
- doors
- keys
- treasure
- death
- restart

The gameplay must already be fun without online features.

---

# 73. Phase 4 — Test Mode

Connect:

```text
Editor
↔
Gameplay
```

Allow:

```text
Edit → Test → Edit
```

with minimal friction.

---

# 74. Phase 5 — Replay

Implement:

- event recording
- deterministic simulation
- replay serialization
- replay playback
- speed controls
- death markers

This is one of the highest-priority technical systems.

---

# 75. Phase 6 — Backend

Implement:

- authentication
- profiles
- dungeon storage
- dungeon versions
- publishing
- attempts
- replay storage
- analytics

Use server validation for published attempts.

---

# 76. Phase 7 — Discovery

Implement:

- dungeon feed
- search
- filtering
- tags
- recommended
- trending
- new
- difficulty filters

Make discovery enjoyable before adding hundreds of mechanics.

---

# 77. Phase 8 — Progression

Implement:

- architect XP
- unlock tree
- mechanic mastery
- achievements
- cosmetics
- profile

---

# 78. Phase 9 — Social

Implement:

- follows
- favorites
- challenges
- sharing
- notifications
- creator profiles

---

# 79. Phase 10 — Advanced Systems

Implement:

- environmental interactions
- logic nodes
- multi-floor dungeons
- advanced traps
- advanced monsters
- boss builder
- dynamic events

---

# 80. Phase 11 — Live Content

Implement:

- daily challenges
- weekly challenges
- seasons
- events
- rotating mechanics
- special dungeon rules

---

# 81. Phase 12 — Scale

Improve:

- backend performance
- replay storage
- analytics
- search
- recommendation quality
- moderation
- CDN
- caching
- database indexing

Test with large numbers of dungeons and attempts.

---

# 82. Technical Architecture Principles

Follow these principles:

### Data driven

Mechanics should be defined through data where practical.

### Modular

Adding a new trap should not require modifying unrelated systems.

### Deterministic

Gameplay simulation should be deterministic enough for replay.

### Server authoritative

Important progression/reward results must be verified.

### Versioned

Dungeon formats and simulations must be versioned.

### Testable

Core simulation should run without rendering.

### Offline-friendly

Editor and testing should work without network access whenever possible.

### Low bandwidth

Replay data should be compact.

---

# 83. Automated Testing

Create tests for:

## Editor

- placement
- deletion
- rotation
- budget
- serialization
- undo/redo

## Validation

- unreachable treasure
- impossible keys
- softlocks
- invalid connections
- invalid spawn

## Gameplay

- collision
- combat
- traps
- doors
- keys
- death
- completion

## Replay

- recording
- serialization
- deterministic playback
- version compatibility

## Backend

- publishing
- versioning
- attempts
- rewards
- permissions

---

# 84. Performance Targets

Target:

```text
60 FPS
```

on supported mid-range mobile devices.

Avoid unnecessary:

- allocations
- object creation
- physics calculations
- network traffic
- texture switching

Use pooling for:

- projectiles
- particles
- enemies
- temporary effects

---

# 85. Content Architecture

Every gameplay object should be data-driven.

Conceptually:

```text
TrapDefinition
MonsterDefinition
RoomDefinition
DoorDefinition
PuzzleDefinition
BossDefinition
```

Each definition contains:

```text
ID
Name
Description
Cost
UnlockLevel
Visual
Audio
Behavior
Configuration
Tags
```

This allows content expansion without rewriting the editor.

---

# 86. Save Format

Create a stable dungeon package:

```text
Dungeon
├── Metadata
├── Theme
├── Layout
├── Objects
├── Connections
├── Rules
├── Logic
├── SpawnPoints
└── ValidationData
```

Use IDs rather than object references.

---

# 87. AI Agent Development Rules

The coding agent must:

1. Inspect the repository before changing anything.
2. Understand existing architecture.
3. Avoid unnecessary rewrites.
4. Implement features incrementally.
5. Compile after meaningful changes.
6. Run tests frequently.
7. Fix warnings introduced by its work.
8. Keep systems modular.
9. Avoid speculative abstractions.
10. Document important architectural decisions.

Never implement the entire project in one giant change.

---

# 88. Agent Development Loop

For every milestone:

```text
Inspect
↓
Plan
↓
Implement
↓
Build
↓
Test
↓
Play/test manually
↓
Review
↓
Fix
↓
Refactor
↓
Commit
```

After every major feature, perform a regression review.

---

# 89. Vertical Slice Requirement

Before implementing the entire game, create one complete vertical slice:

```text
Create dungeon
↓
Place rooms
↓
Place monster
↓
Place trap
↓
Place treasure
↓
Test
↓
Publish
↓
Simulated adventurer attempts
↓
Replay
↓
Analytics
↓
Architect modifies dungeon
↓
Republish
```

This vertical slice must feel like a miniature finished game.

Do not continue expanding content until this loop is genuinely enjoyable.

---

# 90. UX Quality Requirements

Every major action should provide immediate feedback.

Examples:

Placement:

```text
Preview → Snap → Sound → Animation
```

Invalid placement:

```text
Clear visual feedback + reason
```

Publishing:

```text
Validation → Success animation → Published state
```

Player failure:

```text
Death → Clear reason → Restart
```

Architect analytics:

```text
Heatmap → Replay → Insight
```

Avoid unnecessary menus.

---

# 91. Accessibility

Implement:

- scalable UI
- high contrast
- color-independent indicators
- readable typography
- touch targets
- reduced motion option
- screen-reader-friendly menus where applicable
- audio-independent gameplay feedback

Do not communicate critical information through color alone.

---

# 92. Localization

Architect all text for localization from day one.

Initial languages can be:

- English

Architecture should support:

- Persian
- Arabic
- Spanish
- Portuguese
- German
- French
- Japanese
- Korean
- Chinese

Do not hard-code UI strings.

---

# 93. Analytics

Track anonymous gameplay events such as:

```text
DungeonCreated
DungeonPublished
DungeonAttempted
DungeonCompleted
DungeonFailed
DungeonFavorited
DungeonShared
DungeonUpdated
ReplayWatched
EditorOpened
ObjectPlaced
ObjectRemoved
ChallengeJoined
```

Use analytics to identify:

- tutorial drop-off
- editor friction
- failed publishing
- confusing mechanics
- discovery problems

Avoid collecting unnecessary personal data.

---

# 94. Important Product Metrics

Monitor:

### Creation

- percentage of players who create first dungeon
- time to first dungeon
- average editing session
- publish rate

### Gameplay

- attempts/player
- completion rate
- retries
- session length

### Social

- dungeons shared
- follows
- favorites
- challenges

### Retention

- D1
- D7
- D30

### Content ecosystem

- active creators
- active dungeons
- dungeon attempts
- dungeon updates

---

# 95. Major Design Risks

## Risk 1 — Editor is too complicated

Solution:

Progressive disclosure.

Start simple.

Unlock complexity gradually.

## Risk 2 — Dungeons are boring

Solution:

Systemic interactions.

## Risk 3 — Popular creators dominate

Solution:

Discovery diversification and exposure for new creators.

## Risk 4 — Impossible dungeons

Solution:

Validation + mandatory testing + analytics.

## Risk 5 — Players stop creating

Solution:

Challenges + progression + social feedback + seasonal mechanics.

## Risk 6 — Players only consume content

Solution:

Make creation extremely fast.

A player should be able to go:

```text
Play dungeon
→ "I can make this better"
→ Create
```

within seconds.

---

# 96. Long-Term Expansion

Future systems may include:

### Dungeon Contracts

Architects receive special constraints.

### Dungeon Campaigns

Multi-dungeon story sequences.

### Co-Architect Mode

Two players build together.

### Dungeon Guilds

Groups collaborate on large dungeon networks.

### Dungeon Worlds

Connect multiple dungeons into worlds.

### Campaign Builder

Create complete adventure campaigns.

### NPC Systems

Architects place NPCs with dialogue.

### Narrative Tools

Branches and story conditions.

### Dynamic Quests

Player actions change future rooms.

### Economy Simulation

Dungeon inhabitants have resources and behavior.

### Factions

Different factions occupy dungeon regions.

### Procedural Dungeon Assist

The game suggests:

- room layouts
- trap combinations
- puzzle ideas
- difficulty balancing

The AI should assist the Architect rather than replace them.

---

# 97. Ultimate Endgame

The eventual endgame should be:

> Build a dungeon that becomes memorable.

Players can progress from:

```text
Simple Cave
        ↓
Complex Dungeon
        ↓
Multi-floor Fortress
        ↓
Puzzle Network
        ↓
Boss Gauntlet
        ↓
Interactive World
        ↓
Full Adventure Campaign
```

The ultimate creation tool should approach a lightweight:

**"Dungeon game engine inside a game."**

But this depth should be introduced gradually.

---

# 98. What Makes the Game Special

The strongest differentiator should not simply be:

> "A game where you build dungeons."

It should be:

> **A living dungeon ecosystem where every dungeon learns from the people who play it.**

The core loop becomes:

```text
BUILD
  ↓
PLAY
  ↓
WATCH
  ↓
UNDERSTAND
  ↓
IMPROVE
  ↓
PUBLISH
  ↓
REPEAT
```

The Architect isn't just building levels.

They are experimenting on a living player ecosystem.

A dungeon can evolve through dozens of versions based on real player behavior.

---

# 99. First Playable Milestone

The first production milestone is complete only when a player can:

1. Start a new dungeon.
2. Place rooms.
3. Place walls.
4. Place a door.
5. Place a monster.
6. Place a trap.
7. Place treasure.
8. Set the entrance.
9. Validate the dungeon.
10. Test the dungeon.
11. Complete it.
12. Publish it.
13. Have another simulated/real player attempt it.
14. Record the attempt.
15. Replay the attempt.
16. See where the player died.
17. Modify the dungeon.
18. Publish a new version.

Everything else is secondary until this loop works extremely well.

---

# 100. Final Implementation Directive

Build Dungeon Architect as a **systemic game rather than a traditional level editor**.

Prioritize:

```text
SYSTEMS > CONTENT
INTERACTION > DECORATION
CREATION > MENUS
FEEDBACK > COMPLEXITY
REPLAYABILITY > LINEAR CAMPAIGNS
PLAYER CREATIVITY > SCRIPTED CONTENT
```

The architecture must make it cheap to add new:

- traps
- monsters
- rooms
- environmental effects
- puzzles
- bosses
- logic nodes
- themes
- progression mechanics

The game should be capable of growing for years without requiring a fundamental rewrite.

Most importantly:

**Do not attempt to build the complete vision immediately.**

Build the smallest version that proves this loop:

```text
CREATE
   ↓
TEST
   ↓
PUBLISH
   ↓
SOMEONE PLAYS
   ↓
WATCH REPLAY
   ↓
IMPROVE
```

If that loop is compelling, expand the systemic depth around it.
If it is not compelling, fix the loop before adding more content.