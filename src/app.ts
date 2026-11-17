/**
 * Game controller: owns the loop, input, state machine and glue between the
 * deterministic simulation and presentation (renderer, HUD, audio).
 */
import { audio } from "./engine/audio";
import { Rng, hashString } from "./engine/math";
import {
  BIOMES,
  BIOME_IDS,
  ARCHITECTS,
  HEROES,
  HERO_COUNTER,
  NIGHTS,
  PIECES,
  POWERS,
  RULES_VERSION,
  TICK,
  T,
  isChampion,
  powerCost,
  roman,
  type ArchitectId,
  type BiomeId,
  type ChampionId,
  type FeatDef,
  type HeroClass,
  type OmenId,
  type PieceId,
  type PowerId,
} from "./game/defs";
import {
  cloneLayout,
  distanceField,
  generateLayout,
  hasRoute,
  idx,
  inside,
  objectAt,
  pathTo,
  routeLength,
  walkable,
  type Layout,
} from "./game/grid";
import {
  activeAspects,
  archLevelOf,
  currentBoard,
  recordNight,
  recordWinXp,
  addSouls,
  syncMetaStats,
  type Progress,
} from "./game/profile";
import { SIGNATURE_LEVEL } from "./game/progression";
import {
  AFFIXES,
  ASPECTS,
  PIECE_SCHOOL,
  SCHOOLS,
  SCHOOL_IDS,
  schoolCounts,
} from "./game/schools";
import { armoryScreen } from "./ui/progress";
import { sanctumScreen, type SanctumTab } from "./ui/sanctum";
import {
  SOULS,
  collectWell,
  metaBonus,
  wellAmount,
  RARITIES,
  heirloomName,
} from "./game/meta";
import {
  allPlansWon,
  award,
  awardStats,
  defaultProfile,
  realmSwept,
  recordDepthWin,
  loadProfile,
  loadRun,
  loadWorkshop,
  saveProfile,
  saveRun,
  saveWorkshop,
  todayKey,
  unlockedPieces,
  unlockedPowers,
  unlocksBetween,
  type Profile,
} from "./game/profile";
import {
  applyCard,
  canDig,
  canFill,
  canPlace,
  capacityFor,
  championFor,
  dawnIncome,
  dig,
  digCost,
  draftFor,
  fill,
  interestFor,
  isChampionNight,
  isEliteNight,
  newRun,
  partyFor,
  pieceCost,
  place,
  raidMods,
  reinforce,
  reinforceCost,
  renownFor,
  rerollCost,
  runHeat,
  runTitle,
  sell,
  sellValue,
  starsFor,
  type BuildError,
  type RunState,
} from "./game/run";
import {
  decodeDungeon,
  encodeDungeon,
  shareUrl,
  type SharedDungeon,
} from "./game/share";
import { Raid, simulate, type PartyMember, type RaidEvent } from "./game/sim";
import {
  TRIALS,
  TRIAL_CHAPTERS,
  trialLayout,
  trialSetup,
  trialStars,
  trialStarsTotal,
  type TrialDef,
} from "./game/trials";
import { Renderer, type Ghost, type Scene } from "./render/world";
import { h, heroArt, icon, pieceArt } from "./ui/dom";
import { Hud } from "./ui/hud";
import {
  rollEncounter,
  resolveEncounter,
  settleWager,
} from "./game/encounters";
import {
  Layer,
  atlasScreen,
  challengeResult,
  codexScreen,
  draftScreen,
  encounterScreen,
  featsScreen,
  gameOverScreen,
  messageScreen,
  namePrompt,
  partyPicker,
  pauseScreen,
  resultsScreen,
  settingsScreen,
  setupScreen,
  titleScreen,
  trialBriefScreen,
  trialResultScreen,
  trialsScreen,
} from "./ui/screens";

type Kind = "title" | "run" | "workshop" | "challenge" | "trial";
type Phase = "title" | "build" | "raid" | "after";
type Tool = PieceId | "dig" | null;
interface Snapshot {
  layout: Layout;
  gold: number;
  fresh: number[];
  tiers: RunState["tiers"];
  dug: number;
}

const SPEEDS = [1, 2, 3, 4];
/** Feat earned for slaying each champion. */
const CHAMPION_FEAT: Record<ChampionId, string> = {
  paladin: "aldric",
  archmage: "veyla",
  warlord: "grukk",
  thane: "thane",
  shade: "shade",
  revenant: "revenant",
  witch: "witch",
};
const SOURCE_NAMES: Record<string, string> = {
  spikes: "Spike Plate",
  darts: "Dart Idol",
  flame: "Flame Jet",
  boulder: "Boulder",
  trapdoor: "Trapdoor",
  tar: "Burning Tar",
  frost: "Frost Rune",
  saw: "Saw Track",
  gas: "Miasma",
  keg: "Powder Keg",
  skeleton: "Skeleton",
  archer: "Goblin Archer",
  slime: "Gel Slime",
  ogre: "Cave Ogre",
  bat: "Bat Swarm",
  necro: "Necromancer",
  mimic: "Mimic",
  imp: "Fire Imp",
  ghost: "Wailing Ghost",
  rockfall: "Rockfall",
  chill: "Grave Chill",
  risen: "Risen dead",
  minislime: "Slimelings",
  crusher: "Crusher",
  totem: "Hex Totem",
  gargoyle: "Gargoyle",
  wraith: "Wraith",
  sinkhole: "Sinkhole",
  stormcall: "Stormcaller",
  sapper: "Sapper's bomb",
  pylon: "Storm Pylon",
  spider: "Cave Spider",
  golem: "Stone Golem",
  thorns: "Thorned Hides",
  beartrap: "Bear Trap",
  lantern: "Soul Lantern",
  basilisk: "Basilisk",
  kobold: "Kobold Tinker",
  spite: "Spiteful Dead",
  thornCrown: "Crown of Thorns",
  thorned: "Thorned hide",
  vaultSeal: "Vault Seal",
};
const ALL_PIECES = Object.keys(PIECES) as PieceId[];

export class Game {
  profile: Profile;
  kind: Kind = "title";
  phase: Phase = "title";
  run: RunState | null = null;
  raid: Raid | null = null;
  party: PartyMember[] = [];
  renderer: Renderer;
  hud: Hud;
  layer: Layer;
  private canvas: HTMLCanvasElement;
  private speedIdx = 0;
  private paused = false;
  private acc = 0;
  private hitstop = 0;
  private lastHitstop = 0;
  private tool: Tool = null;
  private selected: number | null = null;
  private undo: Snapshot[] = [];
  private power: PowerId | null = null;
  private powerCd: Record<string, number> = {};
  private nightK = 0;
  private nightTarget = 0;
  private time = 0;
  private last = performance.now();
  private pathKey = "";
  private path: { x: number; y: number }[] | null = null;
  private routeLen = 0;
  private hover: { x: number; y: number } | null = null;
  private pointers = new Map<
    number,
    {
      x: number;
      y: number;
      sx: number;
      sy: number;
      moved: boolean;
      type: string;
    }
  >();
  private paint: { mode: "dig" | "fill"; done: Set<number> } | null = null;
  private pinch: { d: number; cx: number; cy: number } | null = null;
  private gesture = false; // a multi-finger gesture happened; suppress taps until all fingers lift
  private hoardBefore = 0;
  private goldBefore = 0;
  /** Feats earned since the last results screen. */
  private pendingFeats: FeatDef[] = [];
  private demo: {
    layout: Layout;
    raid: Raid;
    seed: number;
    wait: number;
  } | null = null;
  private challenge: {
    shared: SharedDungeon;
    code: string;
    last: HeroClass[];
  } | null = null;
  private workshopNight = 3;
  /** Trial being played, and its layout as last built (kept between tries). */
  private trial: TrialDef | null = null;
  private raidToasts = new Set<string>();
  /** Warning for the next build phase: diggers shortened the route. */
  private tunnelNote: string | null = null;
  private dirtySave = false;
  private tutorialTimer = 0;
  private closeTitle: (() => void) | null = null;

  constructor(root: HTMLElement) {
    this.profile = loadProfile();
    this.canvas = h("canvas", { class: "world", "aria-label": "Dungeon view" });
    const hudRoot = h("div", { class: "hud" });
    const layerRoot = h("div", { class: "layers" });
    root.append(this.canvas, hudRoot, layerRoot);
    this.renderer = new Renderer(this.canvas);
    this.layer = new Layer(layerRoot);
    this.hud = new Hud(hudRoot, {
      tool: (id) => this.setTool(this.tool === id ? null : id),
      undo: () => this.doUndo(),
      start: () => this.startNight(),
      menu: () => this.openPause(),
      sound: () => this.toggleSound(),
      power: (p) => this.selectPower(p),
      speed: () => this.cycleSpeed(),
      pause: () => this.togglePause(),
      rotate: () => this.rotateSelected(),
      sell: () => this.sellSelected(),
      hero: (cls) => this.heroInfo(cls),
      share: () => this.shareDungeon(),
      testNight: (d) => {
        this.workshopNight = Math.max(
          1,
          Math.min(NIGHTS, this.workshopNight + d),
        );
        audio.play("click");
        if (this.kind === "workshop" && this.phase === "build")
          this.enterBuild("workshop");
      },
    });
    this.applySettings();
    this.bindInput();
    window.addEventListener("resize", () => this.layout());
    window.visualViewport?.addEventListener("resize", () => this.layout());
    window.addEventListener("hashchange", () => this.checkHash());
    window.addEventListener("beforeunload", () => this.flushSave());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        this.flushSave();
        if (this.phase === "raid" && !this.paused) this.togglePause();
      }
    });
    const unlock = () => audio.unlock();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    this.run = loadRun();
    this.layout();
    if (!this.checkHash()) this.showTitle();
    requestAnimationFrame(this.frame);
  }

  // ---------------- settings & persistence ----------------
  private applySettings() {
    const s = this.profile.settings;
    audio.setMuted(s.muted);
    audio.setVolumes(s.sfx, s.music);
    this.renderer.shakeEnabled = s.shake && !s.reduceMotion;
    this.renderer.fx.reduce = s.reduceMotion;
    document.documentElement.classList.toggle("reduce-motion", s.reduceMotion);
    this.hud.setSound(s.muted);
  }
  private save() {
    this.dirtySave = true;
  }
  private flushSave() {
    if (!this.dirtySave) return;
    this.dirtySave = false;
    if (this.kind === "run") saveRun(this.run);
    if (this.kind === "workshop" && this.run) saveWorkshop(this.run);
    saveProfile(this.profile);
  }
  private toggleSound() {
    this.profile.settings.muted = !this.profile.settings.muted;
    this.applySettings();
    saveProfile(this.profile);
    audio.play("click");
  }

  private layout() {
    const mobile = window.innerWidth < 760;
    const portrait = window.innerHeight > window.innerWidth;
    let top = 64;
    let bottom = 16;
    if (this.phase === "build") {
      top = mobile ? 116 : 76;
      bottom = mobile ? 172 : 108;
    } else if (this.phase === "raid") {
      top = mobile ? 114 : 76;
      bottom = mobile ? 96 : 40;
    } else if (this.phase === "title") {
      top = 20;
      bottom = 20;
    }
    this.renderer.insets = {
      top,
      bottom,
      left: portrait ? 8 : 16,
      right: portrait ? 8 : 16,
    };
    this.renderer.resize();
  }

  // ---------------- hash links ----------------
  private checkHash() {
    const m = location.hash.match(/raid=([A-Za-z0-9_-]+)/);
    if (!m) return false;
    const shared = decodeDungeon(m[1]);
    // Keep the entry's state: the back-button guard (see ui/back.ts) tags it.
    history.replaceState(
      history.state,
      "",
      location.pathname + location.search,
    );
    if (!shared) {
      this.showTitle();
      this.layer.open(
        messageScreen(
          "Broken link",
          "This dungeon link is damaged or from a different version of the game.",
          [["OK", () => this.layer.close(), "btn primary"]],
        ),
        { modal: true, onBack: () => this.layer.close() },
      );
      return true;
    }
    this.openChallenge(shared, m[1]);
    return true;
  }

  // ---------------- title ----------------
  showTitle() {
    this.flushSave();
    this.layer.closeAll();
    this.paused = false;
    document.body.classList.remove("paused");
    // Workshop and challenges borrow `run`; the campaign lives in storage.
    this.run = loadRun();
    this.kind = "title";
    this.phase = "title";
    this.raid = null;
    this.challenge = null;
    this.hud.setMode("hidden");
    this.hud.coach(null);
    this.nightTarget = 0.7;
    audio.intensity = 0;
    this.resetDemo();
    this.layout();
    this.renderer.resetView();
    this.titleEl = titleScreen(this.titleOpts());
    this.closeTitle = this.layer.open(
      this.titleEl,
      // The root screen: back leaves the game.
      { onBack: () => false },
    );
    this.introduceSanctum();
  }
  /** After the first descent, point at the Sanctum once (never blocking). */
  private introduceSanctum() {
    const p = this.profile;
    if (p.runs < 1 || p.seen.includes("sanctum")) return;
    p.seen.push("sanctum");
    saveProfile(p);
    this.hud.toast(
      `The Sanctum is open: ${p.souls} souls to spend on lasting power.`,
      "gold",
    );
  }
  private titleEl: HTMLElement | null = null;
  /** Redraw the title in place (souls, well, Sanctum alerts). */
  private refreshTitle() {
    if (!this.titleEl || this.kind !== "title") return;
    const fresh = titleScreen(this.titleOpts());
    this.titleEl.replaceChildren(...fresh.childNodes);
  }
  private wellReady() {
    const p = this.profile;
    if (p.bestDepth < 1) return null;
    return wellAmount(p, p.bestDepth, metaBonus(p).s.well ?? 0, Date.now());
  }
  private drawWell() {
    const p = this.profile;
    const v = collectWell(p, p.bestDepth, Date.now());
    if (v > 0) {
      p.stats.souls += v;
      p.stats.wells++;
      audio.play("coin");
      this.hud.toast(`The Soul Well gives ${v} souls`, "gold");
    }
    this.sanctumFeats();
    this.toastFeats();
    this.refreshTitle();
  }
  /** Feats earned in the Sanctum. */
  private sanctumFeats() {
    const p = this.profile;
    syncMetaStats(p);
    if (
      (p.talents.design ?? 0) +
      (p.talents.legion ?? 0) +
      (p.talents.fourth ?? 0)
    )
      this.earn("keystone");
    if (Object.values(p.forge).some((v) => (v ?? 0) >= 30))
      this.earn("forged30");
    if (p.heirlooms.some((x) => x.rarity >= 4 && x.temper >= 10))
      this.earn("temper10");
    this.pendingFeats.push(...awardStats(p));
  }
  private openSanctum(tab?: SanctumTab) {
    if (!this.profile.seen.includes("sanctumOpened")) {
      this.profile.seen.push("sanctumOpened");
      saveProfile(this.profile);
    }
    this.layer.open(
      sanctumScreen({
        profile: this.profile,
        tab,
        onChange: () => {
          this.sanctumFeats();
          this.toastFeats();
        },
        onClose: () => {
          this.layer.close();
          this.refreshTitle();
        },
      }),
      {
        modal: true,
        onDismiss: () => {
          this.layer.close();
          this.refreshTitle();
        },
      },
    );
  }
  private titleOpts() {
    const daily = this.profile.daily[todayKey()];
    return {
      profile: this.profile,
      run: this.run,
      dailyDone: !!daily,
      onContinue: () => this.continueRun(),
      onNew: () => this.openSetup(),
      onDaily: () => this.startDaily(),
      onWorkshop: () => this.openWorkshop(),
      onTrials: () => this.openTrials(),
      onAtlas: () => this.openAtlas(),
      onCodex: () =>
        this.layer.open(
          codexScreen(this.profile, () => this.layer.close()),
          { modal: true, onDismiss: () => this.layer.close() },
        ),
      onFeats: () =>
        this.layer.open(
          featsScreen(this.profile, () => this.layer.close()),
          { modal: true, onDismiss: () => this.layer.close() },
        ),
      onSettings: () => this.openSettings(),
      onArmory: () => this.openArmory(),
      board: currentBoard(this.profile),
      onSanctum: () => this.openSanctum(),
      well: this.wellReady(),
      onWell: () => this.drawWell(),
    };
  }
  private openArmory() {
    this.layer.open(
      armoryScreen(
        this.profile,
        () => saveProfile(this.profile),
        () => this.layer.close(),
      ),
      { modal: true, onDismiss: () => this.layer.close() },
    );
  }
  private resetDemo() {
    const seed = Math.floor(Math.random() * 1e9);
    const l = generateLayout(seed, BIOME_IDS[seed % BIOME_IDS.length]);
    const f = distanceField(l, l.hoard.x, l.hoard.y);
    const route = pathTo(l, f, l.entrance.x, l.entrance.y).slice(2, -2);
    const rng = new Rng(seed);
    const kit: PieceId[] = [
      "spikes",
      "skeleton",
      "darts",
      "tar",
      "flame",
      "archer",
      "frost",
      "slime",
      "keg",
      "pylon",
      "spider",
    ];
    for (let i = 0; i < 7; i++) {
      const spot = route[Math.floor(((i + 0.5) / 7) * route.length)];
      if (!spot || objectAt(l, spot.x, spot.y)) continue;
      const k = rng.pick(kit);
      l.objects.push({
        id: l.nextId++,
        kind: k,
        x: spot.x,
        y: spot.y,
        dir: bestDir(l, spot.x, spot.y),
      });
    }
    const party: PartyMember[] = [
      { cls: "knight" },
      {
        cls: rng.pick([
          "rogue",
          "mage",
          "ranger",
          "berserker",
          "bard",
          "windcaller",
          "inquisitor",
        ] as HeroClass[]),
      },
      { cls: "cleric" },
    ];
    const raid = new Raid({
      layout: l,
      party,
      seed,
      night: 4,
      hoard: 12,
      mods: {
        heroHp: 1.2,
        heroDmg: 1,
        heroSpeed: 1,
        monsterHp: 1,
        relics: [],
        tiers: {},
      },
    });
    this.demo = { layout: l, raid, seed, wait: 0 };
    this.demoBiome = BIOME_IDS[seed % BIOME_IDS.length];
  }
  private demoBiome: BiomeId = "crypt";

  private openSettings() {
    this.layer.open(
      settingsScreen(
        this.profile,
        () => {
          this.applySettings();
          saveProfile(this.profile);
        },
        () => this.layer.close(),
        () => {
          this.profile = defaultProfile();
          saveProfile(this.profile);
          saveRun(null);
          saveWorkshop(null);
          this.run = null;
          this.applySettings();
          this.showTitle();
        },
      ),
      { modal: true, onDismiss: () => this.layer.close() },
    );
  }

  private openAtlas() {
    this.layer.open(
      atlasScreen(
        this.profile,
        (depth) => {
          this.layer.close();
          this.openSetup(false, depth);
        },
        () => this.layer.close(),
      ),
      { modal: true, onDismiss: () => this.layer.close() },
    );
  }
  private openSetup(confirmed = false, depth?: number) {
    // Never silently replace a run: finished runs show their legend first,
    // unfinished ones ask before being abandoned.
    if (this.run && !confirmed) {
      if (this.run.victory !== null) {
        this.continueRun();
        return;
      }
      this.layer.open(
        messageScreen(
          "Abandon your run?",
          this.run.daily
            ? "Starting a new descent ends today's daily attempt."
            : `Your dungeon at ${runTitle(this.run)} will be lost. Renown is paid for the nights you survived.`,
          [
            ["Keep it", () => this.layer.close(), "btn ghost"],
            [
              "Abandon",
              () => {
                this.abandonRun(() => {
                  // Rebuild the title (its Continue button is stale) under setup.
                  this.showTitle();
                  this.openSetup(true, depth);
                });
              },
              "btn danger",
            ],
          ],
        ),
        { modal: true, onBack: () => this.layer.close() },
      );
      return;
    }
    const go = (o: {
      biome: BiomeId;
      architect: ArchitectId;
      depth: number;
      omens?: OmenId[];
      kit?: number;
      pure?: boolean;
    }) => {
      const seed = Math.floor(Math.random() * 2 ** 31);
      const p = this.profile;
      this.run = newRun({
        seed,
        ...o,
        powers: unlockedPowers(p),
        aspects: activeAspects(p),
        signature: archLevelOf(p, o.architect) >= SIGNATURE_LEVEL,
        // The Sanctum's power, frozen for the whole descent.
        meta: o.pure ? null : metaBonus(p),
        pool: unlockedPieces(p),
        pure: !!o.pure,
      });
      this.profile.pure = !!o.pure;
      this.profile.omens = [...(o.omens ?? [])];
      this.profile.lastArch = o.architect;
      this.profile.runs++;
      saveProfile(this.profile);
      saveRun(this.run);
      this.layer.closeAll();
      this.enterBuild("run");
    };
    // The very first descent skips the setup screen entirely.
    if (this.profile.runs === 0 && this.profile.maxDepth <= 1) {
      if (this.closeTitle) this.closeTitle();
      go({ biome: "crypt", architect: "mason", depth: 1 });
      return;
    }
    this.layer.open(
      setupScreen(this.profile, go, () => this.layer.close(), depth),
      { modal: true, onDismiss: () => this.layer.close() },
    );
  }
  /** Settle an unfinished run as a loss (renown for nights survived). */
  private abandonRun(then: () => void) {
    this.tunnelNote = null;
    const run = this.run;
    if (!run) return then();
    run.victory = false;
    this.settleRun(run);
    this.toastFeats();
    this.run = null;
    saveRun(null);
    then();
  }
  /** Feats earned outside a results screen are announced as toasts. */
  private toastFeats() {
    const feats = this.takeFeats();
    for (const f of feats)
      this.hud.toast(`Feat: ${f.name} · +${f.renown} renown`, "gold");
    for (const u of this.takeUnlocks(feats))
      this.hud.toast(`Unlocked: ${u}`, "gold");
    saveProfile(this.profile);
  }
  private continueRun() {
    if (!this.run) return;
    this.layer.closeAll();
    if (this.run.victory !== null) {
      this.kind = "run";
      this.finishRun();
      return;
    }
    if (this.run.raiding === this.run.night && this.run.phase === "build") {
      // The player left mid-raid: the night played out without them.
      this.enterBuild("run");
      this.resolveAbsentRaid();
      return;
    }
    if (this.run.phase === "draft" && this.run.draft) {
      this.kind = "run";
      this.enterBuild("run");
      this.openDraft();
      return;
    }
    this.enterBuild("run");
    if (this.run.encounter) this.openEncounter(() => this.afterDraft());
  }
  private startDaily() {
    const key = todayKey();
    if (this.profile.daily[key]) {
      const d = this.profile.daily[key];
      this.layer.open(
        messageScreen(
          "Daily complete",
          `You ${d.won ? "survived" : "fell on night " + d.nights} with ${d.stars} stars. A new dungeon awaits tomorrow.`,
          [
            ["Share", () => this.copyText(this.dailyText(key, d)), "btn"],
            ["OK", () => this.layer.close(), "btn primary"],
          ],
        ),
        { modal: true, onDismiss: () => this.layer.close() },
      );
      return;
    }
    if (this.run?.daily === key) {
      this.continueRun();
      return;
    }
    const seed = hashString(`daily-${key}`);
    const start = () => {
      this.layer.closeAll();
      this.abandonRun(() => {
        this.run = newRun({
          seed,
          biome: BIOME_IDS[seed % BIOME_IDS.length],
          architect: ARCHITECTS[(seed >>> 3) % ARCHITECTS.length].id,
          depth: 2 + ((seed >>> 7) % 3),
          daily: key,
          powers: ["rockfall", "shriek", "chill"],
        });
        saveRun(this.run);
        this.enterBuild("run");
      });
    };
    if (this.run && this.run.victory === null) {
      this.layer.open(
        messageScreen(
          "Abandon your run?",
          this.run.daily
            ? "An unfinished daily from another day will be closed."
            : "Starting the daily replaces your current descent. Renown is paid for the nights you survived.",
          [
            ["Cancel", () => this.layer.close(), "btn ghost"],
            ["Start daily", start, "btn primary"],
          ],
        ),
        { modal: true, onBack: () => this.layer.close() },
      );
      return;
    }
    if (this.run && this.run.victory !== null) {
      // A finished run still waiting for its legend screen: pay it out first.
      this.settleRun(this.run);
      this.toastFeats();
      this.run = null;
      saveRun(null);
    }
    start();
  }
  private dailyText(
    key: string,
    d: { stars: number; hoard: number; nights: number; won: boolean },
  ) {
    const strip =
      this.run?.daily === key
        ? this.run.history
            .map((r) => ["▫️", "🟫", "🟨", "🟩"][r.stars])
            .join("")
        : "";
    return `Dungeon Architect · Daily ${key}\n${d.won ? `Survived all ${NIGHTS} nights` : `Fell on night ${d.nights}`} · ${d.stars}★ · hoard ${d.hoard}\n${strip}\n${location.href.split("#")[0]}`;
  }

  // ---------------- trials ----------------
  private openTrials() {
    this.layer.open(
      trialsScreen(
        this.profile,
        (t) => {
          this.layer.closeAll();
          this.startTrial(t);
        },
        () => this.layer.close(),
      ),
      { modal: true, onDismiss: () => this.layer.close() },
    );
  }
  private startTrial(t: TrialDef) {
    const run = newRun({
      seed: hashString(`trial-${t.id}`),
      biome: BIOME_IDS[(t.chapter - 1) % BIOME_IDS.length],
      architect: "mason",
      depth: t.depth ?? 1,
      powers: [],
    });
    run.layout = trialLayout(t);
    run.gold = t.gold;
    run.owned = [...t.pieces];
    run.tiers = { ...(t.tiers ?? {}) };
    run.relics = [...(t.relics ?? [])];
    run.night = t.night;
    run.mutators = [];
    run.hoard = run.hoardMax = t.hoard ?? 12;
    run.trial = t.id;
    run.cap = t.cap;
    run.noDig = t.dig === false;
    run.locked = run.layout.objects.map((o) => o.id);
    run.gifts = [...run.locked];
    run.fresh = [];
    this.trial = t;
    this.run = run;
    this.layer.closeAll();
    this.enterBuild("trial");
    this.layer.open(
      trialBriefScreen(t, this.profile.trials[t.id] ?? 0, () =>
        this.layer.close(),
      ),
      { modal: true, onDismiss: () => this.layer.close() },
    );
  }
  private afterTrial(raid: Raid, result: ReturnType<Raid["result"]>) {
    const t = this.trial!;
    const p = this.profile;
    const spent = t.gold - this.goldBefore;
    const out = trialStars(t, result.stolen, result.escaped, spent);
    const prev = p.trials[t.id] ?? 0;
    const renownBefore = p.renown;
    let newStars = 0;
    if (out.stars > prev) {
      newStars = out.stars - prev;
      p.trials[t.id] = out.stars;
      p.renown += newStars;
      const souls = addSouls(p, newStars * SOULS.trialStar);
      if (souls) this.hud.toast(`+${souls} souls`, "gold");
    }
    p.stats.trialStars = trialStarsTotal(p.trials);
    p.kills += result.killed;
    p.stats.kills += result.killed;
    const feats = this.takeFeats();
    saveProfile(p);
    audio.play(out.stars >= 3 ? "victory" : out.stars ? "dawn" : "defeat");
    if (out.stars >= 3) this.coinRain(raid.layout);
    for (const u of unlocksBetween(renownBefore, p.renown))
      this.hud.toast(`Unlocked: ${u.label}`, "gold");
    if (feats.length) setTimeout(() => audio.play("feat"), 900);
    const i = TRIALS.indexOf(t);
    const next = TRIALS[i + 1] ?? null;
    const nextOpen =
      next &&
      trialStarsTotal(p.trials) >=
        (next.chapter === t.chapter ? 0 : this.chapterNeeds(next.chapter));
    this.layer.open(
      trialResultScreen({
        t,
        ...out,
        spent,
        newStars,
        feats,
        next: nextOpen ? next : null,
        onRetry: () => {
          this.layer.closeAll();
          this.enterBuild("trial");
        },
        onNext: () => {
          this.layer.closeAll();
          if (next) this.startTrial(next);
        },
        onList: () => {
          this.showTitle();
          this.openTrials();
        },
      }),
      { modal: true },
    );
  }
  private chapterNeeds(n: number) {
    return TRIAL_CHAPTERS.find((c) => c.n === n)?.needs ?? 0;
  }

  // ---------------- workshop ----------------
  private openWorkshop() {
    const saved = loadWorkshop();
    if (saved) this.run = saved;
    else {
      this.run = newRun({
        seed: Math.floor(Math.random() * 1e9),
        biome: "crypt",
        architect: "mason",
        depth: 1,
        powers: unlockedPowers(this.profile),
      });
      this.run.layout.objects = [];
    }
    this.run.workshop = true;
    this.run.gold = 1e9;
    this.run.owned = [...new Set([...unlockedPieces(this.profile)])];
    this.run.powers = unlockedPowers(this.profile);
    this.layer.closeAll();
    this.enterBuild("workshop");
  }

  // ---------------- challenge ----------------
  private openChallenge(shared: SharedDungeon, code: string) {
    this.flushSave();
    this.layer.closeAll();
    this.paused = false;
    document.body.classList.remove("paused");
    this.kind = "challenge";
    this.phase = "after";
    this.challenge = { shared, code, last: this.challenge?.last ?? [] };
    this.run = null;
    this.raid = null;
    this.demo = null;
    this.hud.setMode("hidden");
    this.layout();
    this.nightTarget = 0.4;
    const classes: HeroClass[] = [
      "knight",
      "rogue",
      "cleric",
      "mage",
      "ranger",
      "dwarf",
      "berserker",
      "bard",
      "windcaller",
      "inquisitor",
    ];
    this.layer.open(
      partyPicker({
        title: shared.name ? `${shared.name}'s dungeon` : "A rival dungeon",
        sub: "Assemble a party. Steal as much treasure as you can.",
        budget: shared.budget,
        classes,
        confirm: "Raid!",
        initial: this.challenge.last,
        onGo: (party) => {
          this.challenge!.last = party;
          this.layer.closeAll();
          this.startChallengeRaid(party);
        },
        onBack: () => this.showTitle(),
      }),
      { onBack: () => this.showTitle() },
    );
  }
  private startChallengeRaid(party: HeroClass[]) {
    const c = this.challenge!;
    this.party = party.map((cls) => ({ cls }));
    const setup = {
      layout: cloneLayout(c.shared.layout),
      party: this.party,
      seed: hashString(c.code),
      night: 6,
      hoard: 12,
      mods: {
        heroHp: 1.8,
        heroDmg: 1.35,
        heroSpeed: 1,
        monsterHp: 1,
        relics: [],
        tiers: c.shared.tiers,
        // Schools arrived with rules v5; older links raid by older rules.
        schools: c.shared.rules >= 5,
      },
    };
    this.beginRaid(setup, c.shared.biome);
  }

  // ---------------- build phase ----------------
  private enterBuild(kind: "run" | "workshop" | "trial", debutInfo = true) {
    const run = this.run!;
    this.kind = kind;
    this.phase = "build";
    this.raid = null;
    this.demo = null;
    this.tool = null;
    this.selected = null;
    this.power = null;
    this.undo = [];
    this.nightTarget = 0;
    audio.intensity = 0;
    this.hud.setMode("build", kind);
    this.hud.showShare(
      kind === "workshop" || (kind === "run" && run.history.length > 0),
    );
    this.renderer.resetView();
    this.layout();
    if (kind === "run") {
      this.party = partyFor(run, run.night);
      this.hud.setNight(
        run.night,
        NIGHTS,
        run.history.map((r) => r.stars),
      );
      this.hud.setMutators(run.mutators, run.omens ?? []);
      const champ = isChampionNight(run.night);
      this.hud.setParty(
        this.party,
        champ
          ? `${HEROES[championFor(run, run.night)].name}`
          : run.night > NIGHTS
            ? "The abyss stirs"
            : isEliteNight(run, run.night)
              ? "Elite raid"
              : "Tonight",
        this.fogged(run) && !champ,
      );
      this.hud.setStartLabel(champ ? "Face the Champion" : "Begin Night");
      const debut = this.fogged(run)
        ? undefined
        : this.party.find((p) => !this.profile.seen.includes(p.cls));
      if (debut && debutInfo && !run.encounter && this.profile.tutorial >= 99) {
        setTimeout(() => this.heroInfo(debut.cls, true), 500);
      }
    } else if (kind === "trial") {
      const t = this.trial!;
      this.hud.setMutators([]);
      this.party = t.party.map((p) => ({ ...p }));
      this.hud.setNightLabel(t.id);
      this.hud.setParty(this.party, `Trial · ${t.name}`);
      this.hud.setStartLabel("Begin Trial");
    } else {
      this.hud.setMutators([]);
      this.party = partyFor(
        { seed: 7, depth: 1, mutators: [], boss: "paladin" },
        this.workshopNight,
      );
      this.hud.setNightLabel("∞");
      this.hud.setTestNight(this.workshopNight);
      this.hud.setParty(this.party, `Test vs night ${this.workshopNight}`);
      this.hud.setStartLabel("Test raid");
    }
    this.refreshBuild();
    if (kind === "run") this.tutorialStep();
  }

  /** Thick Fog and the Blindfold omen hide who is coming. */
  private fogged(run: RunState) {
    return run.mutators.includes("fog") || !!run.omens?.includes("blind");
  }
  private refreshBuild() {
    const run = this.run;
    if (!run) return;
    const infinite = this.kind === "workshop";
    const full = run.layout.objects.length >= capacityFor(run);
    this.hud.setGold(run.gold, infinite);
    this.hud.setHoard(run.hoard, run.hoardMax);
    this.hud.setCapacity(run.layout.objects.length, capacityFor(run));
    const items = run.owned.map((id) => ({
      id,
      cost: pieceCost(run, id),
      affordable: infinite || (!full && run.gold >= pieceCost(run, id)),
      tier: run.tiers[id] ?? 1,
      fresh: false,
    }));
    this.hud.setTray(items, this.tool, this.undo.length > 0, digCost(run));
    this.hud.setSchools(
      schoolCounts(
        this.kind === "trial" ? [] : run.layout.objects.map((o) => o.kind),
        this.kind === "trial" ? [] : run.relics,
      ),
      !run.omens?.includes("discord"),
    );
    const key = run.layout.tiles.join("");
    if (key !== this.pathKey) {
      this.pathKey = key;
      const l = run.layout;
      const f = distanceField(l, l.hoard.x, l.hoard.y);
      this.path =
        f[idx(l, l.entrance.x, l.entrance.y)] < Infinity
          ? pathTo(l, f, l.entrance.x, l.entrance.y)
          : null;
      this.routeLen = routeLength(l);
    }
    this.hud.setRoute(this.routeLen, this.routeLen > 0);
  }

  private setTool(t: Tool) {
    this.tool = t;
    this.selected = null;
    audio.play("click");
    if (t && t !== "dig") this.showPieceInfo(t);
    else if (t === "dig") this.showDigInfo();
    else this.hud.hideInfo();
    this.refreshBuild();
    this.tutorialStep();
  }
  private showPieceInfo(id: PieceId) {
    const def = PIECES[id];
    const run = this.run!;
    const tier = run.tiers[id] ?? 1;
    this.hud.showInfo([
      h(
        "div",
        { class: "info-head" },
        pieceArt(id, 52),
        h(
          "div",
          {},
          h("b", {}, `${def.name}${tier > 1 ? " " + roman(tier) : ""}`),
          h(
            "small",
            {},
            `${def.kind === "trap" ? "Trap" : "Monster"} · `,
            icon("coin", "ic tiny"),
            ` ${pieceCost(run, id)}`,
          ),
        ),
      ),
      h("p", {}, def.rule),
      def.combo ? h("p", { class: "combo-hint" }, def.combo) : "",
      this.kind === "trial"
        ? ""
        : h(
            "p",
            {
              class: "school-hint",
              style: `--sc:${SCHOOLS[PIECE_SCHOOL[id]].color}`,
            },
            h("b", {}, SCHOOLS[PIECE_SCHOOL[id]].name),
            ` school · II: ${SCHOOLS[PIECE_SCHOOL[id]].tiers[0]}`,
          ),
      run.aspects?.includes(id)
        ? h(
            "p",
            { class: "aspect-hint" },
            h("b", {}, `Aspect: ${ASPECTS[id].name}. `),
            ASPECTS[id].text,
          )
        : "",
      this.reinforceButton(id),
      h(
        "p",
        { class: "hint" },
        window.matchMedia("(pointer:fine)").matches
          ? def.directional
            ? "Click a floor tile to place. R rotates."
            : "Click a floor tile to place."
          : "Tap a floor tile to place.",
      ),
    ]);
  }
  /** Spend gold to raise a blueprint's tier (every copy gets stronger). */
  private reinforceButton(id: PieceId): HTMLElement | "" {
    const run = this.run;
    if (!run || this.kind !== "run" || id === "lure") return "";
    const cost = reinforceCost(run, id);
    const tier = run.tiers[id] ?? 1;
    if (cost === null)
      return h("p", { class: "hint" }, `Fully reinforced (${roman(tier)}).`);
    return h(
      "button",
      {
        class: `btn small reinforce${run.gold < cost ? " poor" : ""}`,
        onclick: () => this.doReinforce(id),
      },
      icon("up", "ic tiny"),
      ` Reinforce to ${roman(tier + 1)} · `,
      icon("coin", "ic tiny"),
      ` ${cost}`,
    );
  }
  private doReinforce(id: PieceId) {
    const run = this.run;
    if (!run) return;
    const cost = reinforceCost(run, id);
    if (cost === null) return;
    if (run.gold < cost) {
      this.deny(`Reinforcing costs ${cost} gold`);
      return;
    }
    this.snapshot();
    reinforce(run, id);
    audio.play("unlock", { pitch: 1.2 });
    this.hud.toast(
      `${PIECES[id].name} reinforced to ${roman(run.tiers[id] ?? 1)}: +40% power`,
      "good",
    );
    for (const o of run.layout.objects)
      if (o.kind === id) {
        this.renderer.pop(o.id);
        this.renderer.fx.burst(o.x + 0.5, o.y + 0.4, 8, {
          color: "#ffd166",
          kind: "star",
          size: 0.06,
          speed: 1,
          up: 1.6,
          max: 0.6,
          add: true,
        });
      }
    this.save();
    this.refreshBuild();
    const sel = this.selected;
    if (sel !== null) this.select(sel, true);
    else this.showPieceInfo(id);
  }
  private showDigInfo() {
    const c = digCost(this.run!);
    this.hud.showInfo([
      h(
        "div",
        { class: "info-head" },
        icon("pick", "ic big"),
        h(
          "div",
          {},
          h("b", {}, "Dig & Fill"),
          h("small", {}, c ? `${c} gold per tile` : "Free"),
        ),
      ),
      h(
        "p",
        {},
        "Tap rock to dig a tunnel. Tap empty floor to fill it back. Drag to paint.",
      ),
      h(
        "p",
        { class: "combo-hint" },
        "Longer routes walk heroes past more traps. Gold veins pay out when dug.",
      ),
    ]);
  }

  private snapshot() {
    const run = this.run!;
    this.undo.push({
      layout: cloneLayout(run.layout),
      gold: run.gold,
      fresh: [...run.fresh],
      tiers: { ...run.tiers },
      dug: run.dug,
    });
    if (this.undo.length > 60) this.undo.shift();
  }
  private doUndo() {
    const s = this.undo.pop();
    if (!s || !this.run) return;
    this.run.layout = s.layout;
    this.run.gold = s.gold;
    this.run.fresh = s.fresh;
    this.run.tiers = s.tiers;
    this.run.dug = s.dug;
    this.selected = null;
    audio.play("sell");
    this.save();
    this.refreshBuild();
  }

  private errorText(e: BuildError) {
    return {
      gold: "Not enough gold",
      occupied: "Something is already there",
      rock: "Must be placed on floor",
      blocked: "Heroes need a route to the hoard",
      protected: "That spot can't change",
      floor: "Already open floor",
      full: `Your dungeon holds ${this.run ? capacityFor(this.run) : 0} pieces tonight. Sell one, or reinforce instead.`,
      none: "",
    }[e];
  }

  private tryPlace(x: number, y: number) {
    const run = this.run!;
    const id = this.tool as PieceId;
    const err = canPlace(run, id, x, y);
    if (err) {
      if (err === "occupied") {
        const o = objectAt(run.layout, x, y);
        if (o) this.select(o.id);
        return;
      }
      this.deny(this.errorText(err), x, y);
      if (err === "full") this.hud.pulseCapacity();
      return;
    }
    this.snapshot();
    const o = place(
      run,
      id,
      x,
      y,
      PIECES[id].directional ? bestDir(run.layout, x, y, this.path) : 2,
    );
    audio.play("place");
    this.renderer.pop(o.id);
    this.renderer.fx.burst(x + 0.5, y + 0.6, 10, {
      color: "rgba(200,190,170,0.7)",
      kind: "smoke",
      size: 0.08,
      size1: 0.2,
      speed: 1.2,
      up: 0.4,
      max: 0.5,
    });
    this.renderer.fx.emit({
      x: x + 0.5,
      y: y + 0.55,
      kind: "ring",
      size: 0.1,
      size1: 0.7,
      max: 0.35,
      color: "rgba(255,240,200,0.8)",
    });
    this.renderer.shake(0.08);
    if (this.kind === "run")
      this.renderer.fx.text(
        x + 0.5,
        y + 0.3,
        `-${pieceCost(run, id)}`,
        "#ffd166",
        0.8,
      );
    this.hud.pulseGold(true);
    if (this.kind === "workshop") run.gold = 1e9;
    this.save();
    this.refreshBuild();
    if (PIECES[id].directional) this.select(o.id, true);
    else if (window.innerWidth < 760) this.hud.hideInfo();
    this.tutorialStep("placed");
  }
  private deny(text: string, x?: number, y?: number) {
    audio.play("deny");
    if (x !== undefined && y !== undefined) {
      this.renderer.fx.text(x + 0.5, y + 0.4, "✕", "#ff6a5a", 1);
    }
    this.hud.toast(text, "bad");
  }
  private paintAt(x: number, y: number) {
    const run = this.run!;
    if (!this.paint || !inside(run.layout, x, y)) return;
    const k = idx(run.layout, x, y);
    if (this.paint.done.has(k)) return;
    this.paint.done.add(k);
    if (this.paint.mode === "dig") {
      const err = canDig(run, x, y);
      if (err) {
        if (err === "gold") this.deny("Not enough gold", x, y);
        return;
      }
      this.snapshot();
      const vein = dig(run, x, y);
      audio.play("dig", { pitch: 0.9 + Math.random() * 0.2 });
      this.renderer.shake(0.1);
      this.renderer.fx.burst(x + 0.5, y + 0.5, 14, {
        color: BIOMES[run.biome].rockTop,
        kind: "shard",
        size: 0.06,
        speed: 2.4,
        up: 2.5,
        g: 9,
        max: 0.7,
        spread: 0.6,
      });
      this.renderer.fx.burst(x + 0.5, y + 0.6, 6, {
        color: "rgba(180,170,160,0.6)",
        kind: "smoke",
        size: 0.12,
        size1: 0.35,
        speed: 0.8,
        up: 0.3,
        max: 0.7,
      });
      if (vein) {
        audio.play("coin");
        this.renderer.fx.text(x + 0.5, y + 0.3, `+${vein}`, "#ffd166", 1.2);
        this.flyCoins(x + 0.5, y + 0.5, 6);
        this.hud.toast(`Gold vein! +${vein} gold`, "gold");
      } else if (this.kind === "run" && digCost(run))
        this.renderer.fx.text(
          x + 0.5,
          y + 0.3,
          `-${digCost(run)}`,
          "#ffd166",
          0.7,
        );
      if (this.kind === "workshop") run.gold = 1e9;
      this.tutorialStep("dug");
    } else {
      const err = canFill(run, x, y);
      if (err) {
        if (err === "blocked") this.deny(this.errorText(err), x, y);
        return;
      }
      this.snapshot();
      fill(run, x, y);
      audio.play("place", { pitch: 0.6 });
      this.renderer.fx.burst(x + 0.5, y + 0.6, 8, {
        color: "rgba(180,170,160,0.6)",
        kind: "smoke",
        size: 0.12,
        size1: 0.3,
        speed: 0.8,
        up: 0.3,
        max: 0.6,
      });
    }
    this.save();
    this.refreshBuild();
  }

  private select(id: number | null, quiet = false) {
    const run = this.run;
    this.selected = id;
    if (id === null || !run) {
      this.hud.hideInfo();
      return;
    }
    const o = run.layout.objects.find((q) => q.id === id);
    if (!o) return;
    if (!quiet) audio.play("click");
    const def = PIECES[o.kind];
    const actions: HTMLElement[] = [];
    if (def.directional)
      actions.push(
        h(
          "button",
          { class: "btn small", onclick: () => this.rotateSelected() },
          icon("rotate"),
          " Rotate",
        ),
      );
    const value = this.kind === "workshop" ? 0 : sellValue(run, o.id);
    if (!run.locked?.includes(o.id))
      actions.push(
        h(
          "button",
          { class: "btn small danger", onclick: () => this.sellSelected() },
          icon("sell"),
          this.kind === "workshop" ? " Remove" : ` Sell +${value}`,
        ),
      );
    this.hud.showInfo(
      [
        h(
          "div",
          { class: "info-head" },
          pieceArt(o.kind, 52),
          h(
            "div",
            {},
            h(
              "b",
              {},
              def.name,
              (run.tiers[o.kind] ?? 1) > 1
                ? ` ${roman(run.tiers[o.kind] ?? 1)}`
                : "",
            ),
            h("small", {}, def.kind === "trap" ? "Trap" : "Monster"),
          ),
        ),
        h("p", {}, def.rule),
        this.reinforceButton(o.kind),
      ],
      actions,
    );
  }
  private rotateSelected() {
    const run = this.run;
    if (!run || this.selected === null) return;
    const o = run.layout.objects.find((q) => q.id === this.selected);
    if (!o || !PIECES[o.kind].directional) return;
    if (run.locked?.includes(o.id)) {
      this.deny("This piece is part of the trial.");
      return;
    }
    this.snapshot();
    o.dir = (o.dir + 1) % 4;
    audio.play("click", { pitch: 0.8 });
    this.save();
  }
  private sellSelected() {
    const run = this.run;
    if (!run || this.selected === null) return;
    const o = run.layout.objects.find((q) => q.id === this.selected);
    if (!o) return;
    if (run.locked?.includes(o.id)) {
      this.deny("This piece is part of the trial.");
      return;
    }
    this.snapshot();
    const v = sell(run, o.id);
    if (this.kind === "workshop") run.gold = 1e9;
    audio.play("sell");
    this.renderer.fx.burst(o.x + 0.5, o.y + 0.5, 10, {
      color: "#ffd166",
      kind: "coin",
      size: 0.06,
      speed: 1.6,
      up: 2,
      g: 8,
      max: 0.6,
    });
    if (this.kind === "run")
      this.renderer.fx.text(o.x + 0.5, o.y + 0.3, `+${v}`, "#ffd166", 0.9);
    this.select(null);
    this.save();
    this.refreshBuild();
  }

  // ---------------- night / raid ----------------
  private startNight() {
    if (this.phase !== "build" || !this.run) return;
    const run = this.run;
    // A boon must be chosen first (e.g. mid-reroll).
    if (this.kind === "run" && (run.phase === "draft" || run.draft)) return;
    if (!hasRoute(run.layout)) {
      this.deny("Heroes need a route from the stairs to your hoard.");
      return;
    }
    this.hud.coach(null);
    this.flushSave();
    if (this.kind === "trial") {
      this.goldBefore = run.gold;
      this.beginRaid(trialSetup(this.trial!, run.layout), run.biome);
      return;
    }
    if (this.kind === "workshop") {
      this.beginRaid(
        {
          layout: run.layout,
          party: this.party,
          seed: Math.floor(Math.random() * 1e9),
          night: this.workshopNight,
          hoard: 12,
          mods: raidMods({
            ...run,
            night: this.workshopNight,
            relics: [],
            tiers: {},
          }),
        },
        run.biome,
      );
      return;
    }
    for (const p of this.party)
      if (!this.profile.seen.includes(p.cls)) this.profile.seen.push(p.cls);
    saveProfile(this.profile);
    this.hoardBefore = run.hoard;
    this.goldBefore = run.gold;
    // Leaving mid-raid no longer restarts the night: it resolves on return.
    run.raiding = run.night;
    saveRun(run);
    this.beginRaid(this.raidSetup(run), run.biome);
  }
  private raidSetup(run: RunState) {
    return {
      layout: run.layout,
      party: this.party,
      seed: (run.seed ^ Math.imul(run.night, 2654435761)) >>> 0,
      night: run.night,
      hoard: run.hoard,
      hoardMax: run.hoardMax,
      mods: raidMods(run),
    };
  }
  /** Settle a night the player walked away from, without powers. */
  private resolveAbsentRaid() {
    const run = this.run!;
    this.party = partyFor(run, run.night);
    this.hoardBefore = run.hoard;
    this.goldBefore = run.gold;
    const raid = simulate(this.raidSetup(run));
    this.raid = raid;
    this.phase = "after";
    this.hud.setMode("after", "run");
    this.hud.toast("The night went on without you.", "info");
    this.afterRaid(raid, raid.result());
  }

  private beginRaid(
    setup: ConstructorParameters<typeof Raid>[0],
    biome: BiomeId,
  ) {
    this.raid = new Raid(setup);
    this.raidBiome = biome;
    this.phase = "raid";
    document.body.classList.remove("paused");
    this.tool = null;
    this.selected = null;
    this.power = null;
    this.powerCd = {};
    this.acc = 0;
    this.paused = false;
    this.speedIdx = Math.max(0, SPEEDS.indexOf(this.profile.settings.speed));
    this.raidToasts.clear();
    this.hud.setMode(
      "raid",
      this.kind === "title"
        ? "run"
        : (this.kind as "run" | "workshop" | "challenge" | "trial"),
    );
    this.hud.setSpeed(SPEEDS[this.speedIdx], false);
    const night = this.kind === "run" ? this.run!.night : 0;
    const champNight = this.kind === "run" && isChampionNight(night);
    this.hud.setParty(this.party, champNight ? "The Champion" : "Raiders");
    this.hud.bindRoster(this.raid);
    if (this.kind !== "run") this.hud.setGold(0, this.kind === "workshop");
    this.hud.setHoard(this.raid.hoard, this.raid.hoardMax);
    this.layout();
    this.nightTarget = 1;
    audio.intensity = 1;
    audio.play("nightfall");
    const title =
      this.kind === "run"
        ? night === NIGHTS
          ? "The Final Night"
          : night > NIGHTS
            ? `Abyss · Night ${night}`
            : `Night ${night}`
        : this.kind === "challenge"
          ? "The Raid"
          : "Test Raid";
    const sub =
      this.kind === "run"
        ? champNight
          ? `${HEROES[championFor(this.run!, night)].name} descends`
          : isEliteNight(this.run!, night)
            ? "An elite hero leads them"
            : `${this.party.length} hero${this.party.length > 1 ? "es" : ""} descend`
        : "";
    this.hud.banner(title, sub, "night");
    this.updatePowersHud();
  }
  private raidBiome: BiomeId = "crypt";

  private availablePowers(): PowerId[] {
    return this.kind === "run"
      ? (this.run?.powers ?? [])
      : this.kind === "workshop"
        ? unlockedPowers(this.profile)
        : [];
  }
  private selectPower(p: PowerId) {
    if (!this.raid || !this.availablePowers().includes(p)) return;
    if (this.power === p) {
      this.power = null;
    } else if (this.raid.dread < this.costOf(p)) {
      this.deny(`Needs ${this.costOf(p)} dread. Slay heroes to gain more.`);
      return;
    } else if ((this.powerCd[p] ?? 0) > 0) {
      audio.play("deny");
      return;
    } else {
      this.power = p;
      audio.play("click");
      this.hud.toast(POWERS[p].hint);
    }
    this.updatePowersHud();
  }
  private castAt(x: number, y: number) {
    const raid = this.raid;
    const p = this.power;
    if (!raid || !p || raid.finished) return;
    if (!inside(raid.layout, x, y)) return;
    const def = POWERS[p];
    if (!raid.cast(p, x, y, this.costOf(p))) return;
    this.powerCd[p] = def.cooldown;
    this.power = null;
    this.updatePowersHud();
    if (p === "shriek") audio.play("shriek");
    if (p === "chill") audio.play("chill");
    if (p === "sinkhole") audio.play("trapdoor", { pitch: 0.7 });
    this.tutorialStep("cast");
  }
  /** Dread a power costs in this raid (relics and Eclipse). */
  private costOf(p: PowerId) {
    const m = this.raid!.setup.mods;
    return powerCost(p, m.relics, m.mutators ?? []);
  }
  private updatePowersHud() {
    if (!this.raid) return;
    const powers = this.availablePowers();
    this.hud.setPowers(
      powers,
      this.raid.dread,
      this.powerCd,
      this.power,
      this.raid.setup.mods.relics,
      this.raid.setup.mods.mutators ?? [],
    );
    this.hud.setDread(this.raid.dread, this.raid.dreadMax);
  }
  private cycleSpeed() {
    this.speedIdx = (this.speedIdx + 1) % SPEEDS.length;
    this.profile.settings.speed = SPEEDS[this.speedIdx];
    this.hud.setSpeed(SPEEDS[this.speedIdx], this.paused);
    audio.play("click");
    this.save();
  }
  private togglePause() {
    if (this.phase !== "raid") return;
    this.paused = !this.paused;
    document.body.classList.toggle("paused", this.paused);
    this.hud.setSpeed(SPEEDS[this.speedIdx], this.paused);
    audio.play("click");
  }

  private endRaid() {
    const raid = this.raid!;
    const result = raid.result();
    this.phase = "after";
    document.body.classList.remove("paused");
    this.hud.setMode(
      "after",
      this.kind === "title"
        ? "run"
        : (this.kind as "run" | "workshop" | "challenge" | "trial"),
    );
    this.nightTarget = 0.35;
    audio.intensity = 0;
    this.power = null;
    const kind = this.kind;
    setTimeout(() => {
      // The player may have left for the menu during the pause.
      if (this.raid !== raid || this.phase !== "after" || this.kind !== kind)
        return;
      this.afterRaid(raid, result);
    }, 1100);
  }

  private afterRaid(raid: Raid, result: ReturnType<Raid["result"]>) {
    if (this.kind === "trial") {
      this.afterTrial(raid, result);
      return;
    }
    if (this.kind === "challenge") {
      const c = this.challenge!;
      const stolen = raid.hoardMax - raid.hoard;
      audio.play(stolen > 0 ? "victory" : "defeat");
      this.layer.open(
        challengeResult({
          name: c.shared.name,
          stolen,
          total: raid.hoardMax,
          survivors: result.escaped,
          party: this.party.length,
          onRetry: () => this.openChallenge(c.shared, c.code),
          onShare: () =>
            this.copyText(
              `I raided ${c.shared.name || "a dungeon"} in Dungeon Architect and stole ${stolen}/${raid.hoardMax} treasure. Can you do better?\n${shareUrl(c.code)}`,
            ),
          onHome: () => this.showTitle(),
        }),
        { onBack: () => this.showTitle() },
      );
      return;
    }
    if (this.kind === "workshop") {
      const stolen = raid.hoardMax - raid.hoard;
      this.hud.toast(
        stolen
          ? `Heroes stole ${stolen} treasure. ${result.killed}/${this.party.length} slain.`
          : `Defended! ${result.killed}/${this.party.length} slain.`,
        stolen ? "bad" : "good",
      );
      audio.play(stolen ? "defeat" : "dawn");
      this.enterBuild("workshop");
      return;
    }
    const run = this.run!;
    const p = this.profile;
    const stolen = Math.max(0, this.hoardBefore - raid.hoard);
    run.hoard = raid.hoard;
    delete run.raiding;
    const stars = starsFor(result, stolen);
    const income = dawnIncome(run, stars);
    const interest = interestFor(run, this.goldBefore);
    run.gold += result.gold + income + interest;
    const stake = run.wager?.night === run.night ? run.wager.stake : 0;
    const wagerWon = settleWager(run, run.night, stars);
    run.history.push({
      night: run.night,
      stars,
      killed: result.killed,
      escaped: result.escaped,
      stolen,
      gold: result.gold,
      combo: result.bestCombo,
    });
    // Tunnels dug by dwarves remain, and a shorter route is worth a warning.
    this.tunnelNote = null;
    const routeBefore = routeLength(run.layout);
    let dugTiles = 0;
    for (let i = 0; i < raid.layout.tiles.length; i++)
      if (raid.layout.tiles[i] !== run.layout.tiles[i]) dugTiles++;
    run.layout.tiles = raid.layout.tiles.slice();
    const routeAfter = routeLength(run.layout);
    const tunnels =
      dugTiles > 0
        ? { dug: dugTiles, from: routeBefore, to: routeAfter }
        : null;
    if (tunnels && routeAfter < routeBefore)
      this.tunnelNote = `Diggers cut your route from ${routeBefore} to ${routeAfter} tiles. Fill their tunnels!`;
    run.fresh = [];
    p.kills += result.killed;
    p.bestCombo = Math.max(p.bestCombo, result.bestCombo);
    p.stats.kills += result.killed;
    p.stats.fireKills += result.fireKills;
    p.stats.falls += result.falls;
    p.stats.powerKills += result.powerKills;
    const renownBefore = p.renown;
    const progress: Progress = recordNight(
      p,
      run,
      result,
      stars,
      run.hoard > 0,
    );
    run.souls = (run.souls ?? 0) + progress.souls;
    if (progress.heirloom) {
      const it = progress.heirloom;
      this.hud.toast(
        `${RARITIES[it.rarity].name} heirloom: ${heirloomName(it)}`,
        "gold",
      );
    }
    this.progressFeats(result);
    this.nightFeats(run, result, stars, stolen);
    const deadliest = Object.entries(result.kills).sort(
      (a, b) => b[1] - a[1],
    )[0];
    const night = run.night;
    const descentWon = !run.endless && night >= NIGHTS && run.hoard > 0;
    const final = run.hoard <= 0 || descentWon;
    audio.play(stars === 0 ? "defeat" : "dawn");
    if (run.endless && run.hoard > 0) {
      p.bestAbyss = Math.max(p.bestAbyss, night);
      p.stats.abyssNights++;
    }
    if (run.hoard <= 0) run.victory = false;
    else if (descentWon) run.victory = true;
    else {
      // Advance before saving so a reload can never replay a finished night.
      run.night++;
      run.draft = draftFor(run, this.draftPool(run));
      run.phase = "draft";
      run.encounter = rollEncounter(run);
    }
    saveRun(run);
    saveProfile(p);
    const feats = this.takeFeats();
    // Progress renown (mastery, bestiary, bounties, levels) can open unlocks too.
    const unlocked = unlocksBetween(renownBefore, p.renown).map((u) => u.label);
    saveProfile(p);
    this.layer.open(
      resultsScreen({
        progress,
        archName: ARCHITECTS.find((a) => a.id === run.architect)?.name,
        unlocked,
        night,
        result,
        stars,
        stolen,
        income,
        interest,
        wager: stake ? { stake, won: wagerWon } : null,
        tunnels,
        heroes: this.party.length,
        final,
        feats,
        deadliest: deadliest
          ? `${SOURCE_NAMES[deadliest[0]] ?? deadliest[0]} (${deadliest[1]})`
          : null,
        onContinue: () => {
          this.layer.closeAll();
          if (final) this.finishRun();
          else {
            this.enterBuild("run");
            this.openDraft();
          }
        },
      }),
    );
    if (feats.length) setTimeout(() => audio.play("feat"), 1300);
    this.hud.setGold(run.gold);
  }

  /** Daily runs draft from every piece so everyone gets the same offers. */
  private draftPool(run: RunState) {
    return run.daily ? ALL_PIECES : unlockedPieces(this.profile);
  }

  private earn(id: string) {
    const f = award(this.profile, id);
    if (f) this.pendingFeats.push(f);
  }
  private takeFeats() {
    this.pendingFeats.push(...awardStats(this.profile));
    const out = this.pendingFeats;
    this.pendingFeats = [];
    return out;
  }
  /** Unlocks reached by feat renown during a run (announced right away). */
  private takeUnlocks(feats: FeatDef[]) {
    const gained = feats.reduce((a, f) => a + f.renown, 0);
    if (!gained) return [];
    return unlocksBetween(
      this.profile.renown - gained,
      this.profile.renown,
    ).map((u) => u.label);
  }
  /** Feats for schools, mastery and architect levels. */
  private progressFeats(result: ReturnType<Raid["result"]>) {
    const p = this.profile;
    const lv = SCHOOL_IDS.map((s) => result.schools?.[s] ?? 0);
    if (lv.some((v) => v >= 2)) this.earn("school4");
    if (lv.filter((v) => v >= 1).length >= 3) this.earn("schools3");
    if (SCHOOL_IDS.every((s) => p.schools4.includes(s)))
      this.earn("schoolsAll4");
    if (Object.values(p.mastery).some((k) => (k ?? 0) >= 300))
      this.earn("mythic");
    const best = Math.max(0, ...ARCHITECTS.map((a) => archLevelOf(p, a.id)));
    if (best >= 5) this.earn("archLevel5");
    if (best >= 10) this.earn("archLevel10");
  }
  /** Feats that can be earned by a single night. */
  private nightFeats(
    run: RunState,
    result: ReturnType<Raid["result"]>,
    stars: number,
    stolen: number,
  ) {
    if (result.killed > 0) this.earn("firstBlood");
    if (stars === 3) this.earn("flawless");
    if (result.bestCombo >= 5) this.earn("combo5");
    if (result.bestCombo >= 8) this.earn("combo8");
    if (result.bestCombo >= 12) this.earn("combo12");
    for (const c of result.champions)
      if (isChampion(c)) this.earn(CHAMPION_FEAT[c]);
    if (run.gold >= 400) this.earn("hoarder");
    if (
      run.night >= 6 &&
      stolen === 0 &&
      run.hoard > 0 &&
      run.layout.objects.length <= 6
    )
      this.earn("minimal");
    if (run.owned.length >= 14) this.earn("collector");
    if (run.relics.length >= 6) this.earn("relics6");
    if (Object.values(run.tiers).some((t) => (t ?? 1) >= 3)) this.earn("tier3");
    if (run.endless && run.hoard > 0) {
      if (run.night >= 15) this.earn("abyss15");
      if (run.night >= 20) this.earn("abyss20");
      if (run.night >= 30) this.earn("abyss30");
      if (run.night >= 40) this.earn("abyss40");
    }
  }

  private openDraft() {
    const run = this.run!;
    if (!run.draft) return;
    this.hud.setMode("hidden");
    const cost = rerollCost(run);
    this.layer.open(
      draftScreen(
        run.draft,
        run,
        (c) => {
          if (c) {
            applyCard(run, c);
            if (c.type === "piece")
              this.hud.toast(
                `${PIECES[c.id].name} added to your blueprints`,
                "good",
              );
            if (c.type === "tier" && (run.tiers[c.id] ?? 1) >= 3)
              this.earn("tier3");
            if (c.type === "relic" && run.relics.length >= 6)
              this.earn("relics6");
            if (c.type === "piece" && run.owned.length >= 14)
              this.earn("collector");
          } else run.gold += 15;
          run.draft = null;
          run.phase = "build";
          saveRun(run);
          this.layer.closeAll();
          if (run.encounter) {
            this.openEncounter(() => this.afterDraft());
            return;
          }
          this.afterDraft();
        },
        {
          cost,
          onReroll: () => {
            run.gold -= cost;
            run.rerolls++;
            run.draft = draftFor(run, this.draftPool(run));
            saveRun(run);
            audio.play("card");
            this.layer.closeAll();
            this.hud.setGold(run.gold);
            this.openDraft();
          },
        },
      ),
      { modal: true },
    );
  }
  /** Back to building once the boon (and any visitor) is settled. */
  private afterDraft() {
    const run = this.run!;
    this.hud.setMode("build", "run");
    this.refreshBuild();
    audio.play("dawn");
    if (this.tunnelNote) {
      this.hud.toast(this.tunnelNote, "bad");
      this.tunnelNote = null;
    }
    const late = this.takeFeats();
    for (const f of late) {
      this.hud.toast(`Feat: ${f.name} · +${f.renown} renown`, "gold");
      audio.play("feat");
    }
    for (const u of this.takeUnlocks(late))
      this.hud.toast(`Unlocked: ${u}`, "gold");
    saveProfile(this.profile);
    this.tutorialStep();
    const debut = this.fogged(run)
      ? undefined
      : this.party.find((q) => !this.profile.seen.includes(q.cls));
    if (debut && this.profile.tutorial >= 99)
      setTimeout(() => this.heroInfo(debut.cls, true), 300);
  }
  /** A dawn visitor: answer before building. */
  private openEncounter(then: () => void) {
    const run = this.run!;
    const e = run.encounter;
    if (!e) return then();
    this.hud.setMode("hidden");
    this.hud.hideInfo();
    audio.play("card");
    this.layer.open(
      encounterScreen(run, e, (i) => {
        const msg = resolveEncounter(run, e, i);
        if (msg) {
          this.profile.stats.encounters++;
          this.hud.toast(msg, "good");
        }
        saveRun(run);
        saveProfile(this.profile);
        this.layer.closeAll();
        // The visitor may have changed tonight's party, gold or capacity.
        this.enterBuild("run", false);
        then();
      }),
      { modal: true },
    );
  }

  /**
   * Pay out renown and records for a finished (or abandoned) run, once.
   * Returns what changed so the legend screen can show it.
   */
  private settleRun(run: RunState) {
    const p = this.profile;
    const before = p.renown;
    const out = {
      renown: 0,
      unlocked: [] as string[],
      newDepth: null as number | null,
      dailyText: null as string | null,
      crowns: [] as string[],
    };
    if (run.settled) {
      out.renown = run.renownPaid;
      return out;
    }
    const earned = Math.max(0, renownFor(run) - run.renownPaid);
    p.renown += earned;
    run.renownPaid += earned;
    out.renown = earned;
    const descentWon = run.victory === true && !run.endless;
    if (descentWon) {
      p.wins++;
      // Daily dungeons don't climb the ladder or credit architects.
      if (!run.daily) {
        p.bestDepth = Math.max(p.bestDepth, run.depth);
        if (run.depth >= p.maxDepth) {
          p.maxDepth = run.depth + 1;
          out.newDepth = p.maxDepth;
        }
        if (!p.archWins.includes(run.architect)) p.archWins.push(run.architect);
        if (run.depth >= 3) this.earn("depth3");
        if (run.depth >= 5) this.earn("depth5");
        if (run.depth >= 6) this.earn("depth6");
        if (run.depth >= 10) this.earn("depth10");
        if (run.depth >= 15) this.earn("depth15");
        if (run.depth >= 20) this.earn("depth20");
        if (run.depth >= 30) this.earn("depth30");
        if (run.depth >= 40) this.earn("depth40");
        if (run.depth >= 50) this.earn("depth50");
        const heat = runHeat(run);
        p.bestHeat = Math.max(p.bestHeat, heat);
        if (heat >= 3) this.earn("heat3");
        if (heat >= 8) this.earn("heat8");
        if (heat >= 15) this.earn("heat15");
        if (heat >= 20) this.earn("heat20");
        if (heat >= 26) this.earn("heat26");
        const xp = recordWinXp(p, run.architect);
        out.renown += xp.renown;
        if (xp.archLevel)
          this.hud.toast(
            `${ARCHITECTS.find((a) => a.id === run.architect)?.name} reached level ${xp.archLevel}`,
            "gold",
          );
        if (archLevelOf(p, run.architect) >= 5) this.earn("archLevel5");
        if (archLevelOf(p, run.architect) >= 10) this.earn("archLevel10");
        const crowns = recordDepthWin(p, run);
        out.crowns = crowns.crowns.filter((c) => c !== "Conquered");
        out.renown += crowns.renown;
        if (realmSwept(p, run.depth)) this.earn("realmSweep");
        if (allPlansWon(p)) this.earn("planner");
        if (run.pure && run.depth >= 8) this.earn("purist");
      }
      if (run.history.every((r) => r.stolen === 0)) this.earn("perfect");
      if (run.history.every((r) => r.stars === 3)) this.earn("allStars");
      if (ARCHITECTS.every((a) => p.archWins.includes(a.id)))
        this.earn("allArchitects");
      if (!run.dug) this.earn("noDig");
    }
    if (run.daily && !p.daily[run.daily]) {
      const descent = run.history.filter((r) => r.night <= NIGHTS);
      const d = {
        stars: descent.reduce((a, r) => a + r.stars, 0),
        hoard: Math.max(0, run.hoard),
        nights: descent.length,
        won: run.victory === true || run.endless,
      };
      p.daily[run.daily] = d;
      p.stats.dailies++;
      addSouls(p, SOULS.daily + SOULS.dailyStar * d.stars);
      out.dailyText = this.dailyText(run.daily, d);
    }
    run.settled = true;
    out.unlocked = unlocksBetween(before, p.renown).map((u) => u.label);
    saveProfile(p);
    return out;
  }

  private finishRun() {
    this.tunnelNote = null;
    const run = this.run!;
    const firstTime = !run.settled;
    const settled = this.settleRun(run);
    const feats = this.takeFeats();
    // Feats may have pushed renown over more unlocks.
    if (feats.length)
      settled.unlocked = unlocksBetween(
        this.profile.renown -
          settled.renown -
          feats.reduce((a, f) => a + f.renown, 0),
        this.profile.renown,
      ).map((u) => u.label);
    let totalRenown = settled.renown + feats.reduce((a, f) => a + f.renown, 0);
    // A reload shows the same payout as the first time this screen appeared.
    if (firstTime) {
      run.lastPaid = totalRenown;
      run.lastCrowns = settled.crowns;
    } else totalRenown = run.lastPaid ?? totalRenown;
    saveProfile(this.profile);
    // Keep the finished run saved until the player leaves the legend screen,
    // so a reload returns here without paying out twice.
    saveRun(run);
    if (firstTime) {
      audio.play(run.victory || run.endless ? "victory" : "defeat");
      if (run.victory) this.coinRain(run.layout);
      if (settled.unlocked.length || feats.length)
        setTimeout(() => audio.play("unlock"), 900);
    }
    const leave = (then: () => void) => {
      this.run = null;
      saveRun(null);
      then();
    };
    const canDelve = run.victory === true && !run.endless && !run.daily;
    this.hud.setMode("hidden");
    this.layer.open(
      gameOverScreen({
        run,
        renown: totalRenown,
        unlocked: settled.unlocked,
        feats,
        newDepth: settled.newDepth,
        crowns: run.lastCrowns ?? [],
        dailyText:
          settled.dailyText ??
          (run.daily && this.profile.daily[run.daily]
            ? this.dailyText(run.daily, this.profile.daily[run.daily])
            : null),
        onMenu: () => leave(() => this.showTitle()),
        onAgain: () =>
          leave(() => {
            this.showTitle();
            this.openSetup();
          }),
        onShare: () => {
          const d = run.daily && this.profile.daily[run.daily];
          if (run.daily && d) this.copyText(this.dailyText(run.daily, d));
          else this.shareLayout(run.layout, run.biome, run.tiers);
        },
        onAbyss: canDelve ? () => this.delve(run) : null,
      }),
    );
  }

  /** Continue a won descent into the endless abyss. */
  private delve(run: RunState) {
    run.endless = true;
    run.victory = null;
    run.settled = false;
    run.night = NIGHTS + 1;
    run.draft = draftFor(run, this.draftPool(run));
    run.phase = "draft";
    run.encounter = rollEncounter(run);
    saveRun(run);
    audio.play("nightfall");
    this.layer.closeAll();
    this.enterBuild("run");
    this.hud.banner("The Abyss", "No more dawns. Only deeper nights.", "night");
    this.openDraft();
  }

  private coinRain(l: Layout) {
    let n = 0;
    const id = window.setInterval(() => {
      for (let i = 0; i < 6; i++)
        this.renderer.fx.emit({
          x: Math.random() * l.w,
          y: Math.random() * l.h,
          z: 6 + Math.random() * 3,
          vz: 0,
          g: 9,
          max: 2.2,
          size: 0.08,
          kind: "coin",
          color: "#ffd166",
          rot: Math.random() * 6,
          vr: 8,
        });
      if (++n > 30) clearInterval(id);
    }, 80);
  }

  // ---------------- sharing ----------------
  private shareDungeon() {
    if (!this.run) return;
    this.shareLayout(this.run.layout, this.run.biome, this.run.tiers);
  }
  private shareLayout(
    layout: Layout,
    biome: BiomeId,
    tiers: RunState["tiers"],
  ) {
    const make = (name: string) => {
      this.profile.name = name;
      saveProfile(this.profile);
      const pieces = layout.objects.reduce(
        (a, o) => a + PIECES[o.kind].cost,
        0,
      );
      const budget = Math.max(8, Math.min(30, Math.round(6 + pieces / 40)));
      const code = encodeDungeon({
        name,
        biome,
        layout,
        tiers,
        budget,
        rules: RULES_VERSION,
      });
      const url = shareUrl(code);
      this.layer.close();
      this.copyText(`Can you rob my dungeon? ${url}`, url);
    };
    this.layer.open(
      namePrompt(this.profile.name, make, () => this.layer.close()),
      { modal: true, onDismiss: () => this.layer.close() },
    );
  }
  private async copyText(text: string, url?: string) {
    const nav = navigator as Navigator & {
      share?: (d: ShareData) => Promise<void>;
    };
    try {
      if (nav.share && window.matchMedia("(pointer:coarse)").matches) {
        await nav.share({ text, url });
        return;
      }
    } catch {
      // Fall back to clipboard.
    }
    try {
      await navigator.clipboard.writeText(text);
      this.hud.toast("Link copied to clipboard", "good");
      audio.play("confirm");
    } catch {
      this.layer.open(
        messageScreen("Share", text, [
          ["Close", () => this.layer.close(), "btn primary"],
        ]),
        { modal: true, onBack: () => this.layer.close() },
      );
    }
  }

  // ---------------- menus ----------------
  /**
   * The platform back action: Escape, browser back and the Android back
   * button. Closes the top screen or selection, otherwise opens the pause
   * menu. Returns false only on the title screen, so the platform may leave.
   */
  back(): boolean {
    switch (this.layer.back()) {
      case "done":
        return true;
      case "pass":
        return false;
      case "blocked":
        // A screen that needs an answer (results, boon, visitor, legend):
        // offer the pause menu over it so the player can still get out.
        if (this.kind !== "title") this.openPause(true);
        return true;
    }
    if (this.tool || this.selected !== null || this.power) {
      this.tool = null;
      this.power = null;
      this.select(null);
      this.refreshBuild();
      this.updatePowersHud();
      audio.play("click");
      return true;
    }
    if (this.hud.infoOpen) {
      this.hud.hideInfo();
      audio.play("click");
      return true;
    }
    if (this.kind === "title") return false;
    // Between screens (e.g. the pause after a raid) back does nothing.
    this.openPause();
    return true;
  }

  /** `over`: open on top of a screen that is waiting for an answer. */
  private openPause(over = false) {
    if (!over && (this.layer.open_count || this.phase === "after")) return;
    const wasPaused = this.paused;
    if (this.phase === "raid" && !this.paused) this.togglePause();
    const resume = () => {
      this.layer.close();
      if (this.phase === "raid" && !wasPaused && this.paused)
        this.togglePause();
    };
    this.layer.open(
      pauseScreen({
        title:
          this.kind === "workshop"
            ? "Workshop"
            : this.kind === "challenge"
              ? "Raid"
              : this.kind === "trial"
                ? `Trial ${this.trial?.id ?? ""}`
                : `Night ${this.run?.night ?? ""}`,
        onResume: resume,
        onSettings: () => this.openSettings(),
        onShare:
          this.run && this.phase === "build" && !over
            ? () => this.shareDungeon()
            : null,
        // A finished run (legend, final results) can no longer be abandoned.
        onAbandon:
          this.kind === "run" && this.run && this.run.victory === null
            ? () => {
                this.layer.open(
                  messageScreen(
                    "Abandon this run?",
                    "Your dungeon will be lost. Renown is earned for nights already survived.",
                    [
                      ["Keep playing", () => this.layer.close(), "btn ghost"],
                      [
                        "Abandon",
                        () => {
                          this.layer.closeAll();
                          // Leave the raid cleanly before settling the run.
                          this.raid = null;
                          this.phase = "after";
                          this.paused = false;
                          document.body.classList.remove("paused");
                          if (this.run) {
                            this.run.victory = false;
                            this.finishRun();
                          }
                        },
                        "btn danger",
                      ],
                    ],
                  ),
                  { modal: true, onBack: () => this.layer.close() },
                );
              }
            : null,
        onMenu: () => {
          if (this.phase === "raid" && this.kind === "run") {
            // The night plays out without the player (see resolveAbsentRaid).
            this.raid = null;
          }
          this.showTitle();
        },
      }),
      { modal: true, onDismiss: resume },
    );
  }

  private heroInfo(cls: HeroClass, debut = false) {
    const d = HEROES[cls];
    audio.play(debut ? "unlock" : "click");
    this.hud.showInfo(
      [
        h(
          "div",
          { class: "info-head" },
          heroArt(cls, 52),
          h(
            "div",
            {},
            h(
              "b",
              {},
              debut
                ? `${isChampion(cls) ? "Champion" : "New foe"}: ${d.name}`
                : d.name,
            ),
            h("small", {}, `Health ${d.hp} · Bounty ${d.bounty}`),
          ),
        ),
        h("p", {}, d.rule),
        h("p", { class: "combo-hint" }, `Counter: ${HERO_COUNTER[cls]}`),
        ...[
          ...new Set(
            this.party
              .filter((q) => q.cls === cls)
              .flatMap((q) => q.affixes ?? []),
          ),
        ].map((a) =>
          h(
            "p",
            { class: "affix-hint", style: `--ac:${AFFIXES[a].color}` },
            h("b", {}, `${AFFIXES[a].name}: `),
            AFFIXES[a].text,
          ),
        ),
      ],
      [],
      debut ? 6000 : 0,
    );
  }

  // ---------------- tutorial ----------------
  private tutorialStep(event?: "placed" | "dug" | "cast") {
    const p = this.profile;
    if (p.tutorial >= 99 || this.kind !== "run" || !this.run) return;
    const run = this.run;
    const step = p.tutorial;
    const coach = (
      text: string,
      target: HTMLElement | { x: number; y: number } | null,
      place: "above" | "below" = "above",
    ) => setTimeout(() => this.hud.coach(text, target, place), 60);
    if (this.phase === "build" && run.night === 1) {
      if (step === 0) {
        if (this.path && this.path.length > 4) {
          const mid = this.path[Math.floor(this.path.length / 2)];
          const [sx, sy] = this.renderer.toScreen(mid.x + 1.6, mid.y + 0.5);
          coach("Heroes march this path from the stairs to your gold.", {
            x: sx + 40,
            y: sy - 20,
          });
        }
        this.tutorialTimer = 3.2;
        p.tutorial = 1;
        return;
      }
      if (step === 1 && (event === "placed" || this.tutorialTimer <= 0)) {
        p.tutorial = 2;
      }
      if (p.tutorial === 2) {
        if (event === "placed") {
          p.tutorial = 3;
        } else {
          const b =
            this.hud.pieceButton("skeleton") ??
            this.hud.pieceButton(run.owned[0]);
          if (this.tool && this.tool !== "dig")
            coach(
              "Now tap a floor tile on their path.",
              { x: window.innerWidth / 2, y: window.innerHeight * 0.3 },
              "below",
            );
          else if (b) coach("Pick a Skeleton to guard the path.", b);
          return;
        }
      }
      if (p.tutorial === 3) {
        coach("Ready? Night falls when you say so.", this.hud.startButton);
        p.tutorial = 4;
        return;
      }
    }
    if (this.phase === "raid" && p.tutorial === 4 && event === "cast") {
      this.hud.coach(null);
      p.tutorial = 5;
    }
    if (this.phase === "build" && run.night === 2 && p.tutorial <= 5) {
      if (event === "dug") {
        this.hud.coach(null);
        p.tutorial = 99;
        saveProfile(p);
        return;
      }
      coach(
        "Dig new tunnels. Longer routes pass more traps.",
        this.hud.digButton,
      );
      p.tutorial = 5;
    }
    if (run.night > 2 && p.tutorial < 99) {
      p.tutorial = 99;
      saveProfile(p);
    }
  }

  // ---------------- input ----------------
  private bindInput() {
    const c = this.canvas;
    c.addEventListener("contextmenu", (e) => e.preventDefault());
    c.addEventListener("pointerdown", (e) => {
      c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, {
        x: e.clientX,
        y: e.clientY,
        sx: e.clientX,
        sy: e.clientY,
        moved: false,
        type: e.pointerType,
      });
      if (this.pointers.size === 2) {
        this.gesture = true;
        this.paint = null;
        const [a, b] = [...this.pointers.values()];
        this.pinch = {
          d: Math.hypot(a.x - b.x, a.y - b.y),
          cx: (a.x + b.x) / 2,
          cy: (a.y + b.y) / 2,
        };
        return;
      }
      if (this.phase === "build" && this.tool === "dig" && e.button === 0) {
        const t = this.renderer.tileAtScreen(e.clientX, e.clientY);
        const l = this.run!.layout;
        if (!inside(l, t.x, t.y)) return;
        const isFloor = walkable(l, t.x, t.y);
        this.paint = { mode: isFloor ? "fill" : "dig", done: new Set() };
        this.paintAt(t.x, t.y);
      }
      if (this.phase === "build" && e.button === 2) {
        const t = this.renderer.tileAtScreen(e.clientX, e.clientY);
        const o = objectAt(this.run!.layout, t.x, t.y);
        if (o) {
          this.selected = o.id;
          this.sellSelected();
        }
      }
    });
    c.addEventListener("pointermove", (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) {
        if (e.pointerType === "mouse")
          this.hover = this.renderer.tileAtScreen(e.clientX, e.clientY);
        return;
      }
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (Math.hypot(p.x - p.sx, p.y - p.sy) > 9) p.moved = true;
      if (this.pinch && this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const cx = (a.x + b.x) / 2;
        const cy = (a.y + b.y) / 2;
        this.renderer.zoomAt(d / this.pinch.d, cx, cy);
        this.renderer.panBy(cx - this.pinch.cx, cy - this.pinch.cy);
        this.pinch = { d, cx, cy };
        return;
      }
      this.hover = this.renderer.tileAtScreen(e.clientX, e.clientY);
      if (this.paint) {
        this.paintAt(this.hover.x, this.hover.y);
        return;
      }
      const placing =
        this.phase === "build" && this.tool && this.tool !== "dig";
      if (p.moved && !placing && !this.power) this.renderer.panBy(dx, dy);
    });
    const up = (e: PointerEvent) => {
      const p = this.pointers.get(e.pointerId);
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      const gesture = this.gesture;
      if (this.pointers.size === 0) this.gesture = false;
      if (!p || gesture) return;
      const wasPaint = !!this.paint;
      this.paint = null;
      if (e.type === "pointercancel" || e.button === 2) return;
      if (p.type !== "mouse") this.hover = null;
      if (wasPaint) return;
      const t = this.renderer.tileAtScreen(e.clientX, e.clientY);
      const placing =
        this.phase === "build" && this.tool && this.tool !== "dig";
      if (p.moved && !placing) return;
      this.tap(t.x, t.y);
    };
    c.addEventListener("pointerup", up);
    c.addEventListener("pointercancel", up);
    c.addEventListener("pointerleave", (e) => {
      if (e.pointerType === "mouse") this.hover = null;
    });
    c.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.renderer.zoomAt(
          e.deltaY < 0 ? 1.12 : 1 / 1.12,
          e.clientX,
          e.clientY,
        );
      },
      { passive: false },
    );
    window.addEventListener("keydown", (e) => this.key(e));
  }

  private tap(x: number, y: number) {
    if (this.phase === "raid") {
      if (this.power) this.castAt(x, y);
      return;
    }
    if (this.phase !== "build" || !this.run) return;
    const l = this.run.layout;
    if (this.tool && this.tool !== "dig") {
      if (!inside(l, x, y)) return;
      this.tryPlace(x, y);
      return;
    }
    if (!this.tool) {
      const o = inside(l, x, y) ? objectAt(l, x, y) : undefined;
      if (o) {
        if (this.selected === o.id && PIECES[o.kind].directional)
          this.rotateSelected();
        else this.select(o.id);
      } else this.select(null);
    }
  }

  private key(e: KeyboardEvent) {
    const k = e.key.toLowerCase();
    if (k === "escape") {
      // Escape works inside text fields too (it cancels the name prompt).
      // On the title screen it does nothing: only real back buttons leave.
      if (!e.repeat) this.back();
      return;
    }
    if (e.target instanceof HTMLInputElement) return;
    if (this.layer.open_count) return;
    if (this.phase === "build") {
      if ((e.ctrlKey || e.metaKey) && k === "z") {
        e.preventDefault();
        this.doUndo();
        return;
      }
      if (k >= "1" && k <= "9") {
        const id = this.run?.owned[Number(k) - 1];
        if (id) this.setTool(this.tool === id ? null : id);
      } else if (k === "d") this.setTool(this.tool === "dig" ? null : "dig");
      else if (k === "r") {
        if (this.selected !== null) this.rotateSelected();
      } else if (k === "delete" || k === "backspace") this.sellSelected();
      else if (k === "enter") this.startNight();
    } else if (this.phase === "raid") {
      if (k === " ") {
        e.preventDefault();
        this.togglePause();
      } else if (k === "f") this.cycleSpeed();
      else if (k === "q") this.selectPower("rockfall");
      else if (k === "w") this.selectPower("shriek");
      else if (k === "e") this.selectPower("chill");
      else if (k === "r") this.selectPower("sinkhole");
    }
  }

  // ---------------- raid events → presentation ----------------
  private flyCoins(x: number, y: number, n: number) {
    const [sx, sy] = this.renderer.toScreen(x, y);
    const r = this.hud.goldRect();
    for (let i = 0; i < n; i++) {
      this.renderer.fx.fly({
        sx,
        sy,
        tx: r.left + r.width / 2,
        ty: r.top + r.height / 2,
        dur: 0.55,
        delay: i * 0.05,
        color: "#ffd166",
        kind: "coin",
        done: () => i === n - 1 && this.hud.pulseGold(),
      });
    }
  }
  private once(key: string, f: () => void) {
    if (this.raidToasts.has(key)) return;
    this.raidToasts.add(key);
    f();
  }
  private heroOf(uid: number) {
    return this.raid?.heroes.find((h) => h.uid === uid);
  }

  private onEvent(e: RaidEvent) {
    const fx = this.renderer.fx;
    const r = this.renderer;
    const big = (amount: number) => {
      if (this.time - this.lastHitstop > 0.25) {
        this.hitstop = Math.max(this.hitstop, amount);
        this.lastHitstop = this.time;
      }
    };
    switch (e.k) {
      case "deflect":
        audio.play("disarm", { pitch: 1.6, volume: 0.6 });
        fx.text(e.x, e.y - 0.8, "Deflect", "#f0c070", 0.7);
        fx.burst(e.x + 0.15, e.y - 0.4, 6, {
          color: "#fff2c0",
          kind: "spark",
          size: 0.03,
          speed: 2.5,
          up: 1,
          max: 0.25,
          add: true,
        });
        this.once("deflect", () =>
          this.hud.toast(
            "Monks turn aside every other dart and arrow. Use melee and fire.",
            "bad",
          ),
        );
        break;
      case "jinx":
        audio.play("magic", { pitch: 0.4, volume: 0.9 });
        r.shake(0.1);
        fx.emit({
          x: e.x,
          y: e.y,
          kind: "ring",
          size: 0.2,
          size1: 3,
          max: 0.6,
          color: "rgba(150,230,110,0.8)",
        });
        for (const q of e.pts) {
          this.trail(e.x, e.y - 0.5, q.x, q.y, "rgba(170,120,230,0.85)", 6);
          fx.text(q.x, q.y - 0.3, "Jinxed", "#c890ff", 0.7);
        }
        this.once("jinx", () =>
          this.hud.toast(
            "Morrigan jinxes your traps near her. Spread them out and send monsters.",
            "bad",
          ),
        );
        break;
      case "gaze":
        audio.play("freeze", { pitch: 0.6 });
        this.trail(
          e.x,
          e.y - 0.45,
          e.tx,
          e.ty - 0.4,
          "rgba(255,240,140,0.9)",
          9,
        );
        fx.text(e.tx, e.ty - 0.9, "Stone!", "#e8e0b0", 0.8);
        fx.burst(e.tx, e.ty - 0.4, 10, {
          color: "#b8b0a0",
          kind: "dot",
          size: 0.04,
          speed: 1.2,
          up: 0.6,
          max: 0.5,
        });
        break;
      case "repair":
        audio.play("place", { pitch: 1.3, volume: 0.7 });
        fx.text(e.x, e.y - 0.3, "Repaired", "#ffb870", 0.8);
        fx.burst(e.x, e.y, 8, {
          color: "#ffd18a",
          kind: "spark",
          size: 0.03,
          speed: 2,
          up: 1,
          max: 0.3,
          add: true,
        });
        break;
      case "soul":
        audio.play("magic", { pitch: 1.4, volume: 0.5 });
        this.trail(e.x, e.y - 0.4, e.tx, e.ty, "rgba(140,230,255,0.9)", 8);
        break;
      case "spite":
        fx.burst(e.x, e.y - 0.3, 12, {
          color: "rgba(200,120,255,0.8)",
          kind: "spark",
          size: 0.04,
          speed: 2.4,
          up: 0.8,
          max: 0.35,
          add: true,
        });
        break;
      case "snap":
        audio.play("spike", { pitch: 0.7 });
        r.shake(0.14);
        fx.text(e.x, e.y - 0.9, "Snap!", "#d8d0c4", 0.7);
        break;
      case "spawn":
        fx.burst(e.x, e.y + 0.3, 8, {
          color: "rgba(200,210,255,0.5)",
          kind: "smoke",
          size: 0.1,
          size1: 0.3,
          speed: 0.8,
          up: 0.3,
          max: 0.6,
        });
        audio.play("step", { volume: 2 });
        break;
      case "hit": {
        const color = e.hero
          ? e.dtype === "fire"
            ? "#ffae5a"
            : e.dtype === "poison"
              ? "#a6ff7a"
              : e.dtype === "magic"
                ? "#d5b3ff"
                : "#ffffff"
          : "#ff8f80";
        fx.text(
          e.x,
          e.y,
          String(e.amount),
          color,
          e.crit ? 1.35 : e.hero ? 1 : 0.8,
          e.uid,
          e.amount,
        );
        if (e.dtype !== "poison" && e.dtype !== "fire") {
          fx.burst(e.x, e.y - 0.3, e.crit ? 10 : 5, {
            color: e.hero ? "#ffe9b0" : "#ffb0a0",
            kind: "spark",
            size: 0.035,
            speed: 4,
            up: 1,
            max: 0.25,
            add: true,
          });
          audio.play(e.amount >= 30 ? "heavyHit" : "hit", {
            volume: e.hero ? 0.9 : 0.5,
          });
        }
        if (e.crit) {
          r.shake(0.15);
          big(0.05);
        }
        break;
      }
      case "heal":
        fx.text(e.x, e.y, `+${e.amount}`, "#8dffa0", 0.9);
        fx.burst(e.x, e.y - 0.4, 6, {
          color: "#c8ffb0",
          kind: "star",
          size: 0.07,
          speed: 0.6,
          up: 1.4,
          max: 0.7,
          add: true,
        });
        audio.play("heal", { volume: 0.6 });
        this.once("heal", () =>
          this.hud.toast("Clerics heal. Strike them first.", "info"),
        );
        break;
      case "kill": {
        big(0.1);
        r.shake(0.32);
        r.zoomPunch(0.025);
        r.flash(e.x, e.y - 0.3, 2.2, "#fff2d0", 0.3);
        fx.burst(e.x, e.y - 0.35, 26, {
          color: "#fff4e0",
          kind: "dot",
          size: 0.05,
          size1: 0,
          speed: 3.2,
          up: 2.4,
          g: 5,
          max: 0.6,
          add: true,
        });
        fx.burst(e.x, e.y - 0.2, 10, {
          color: "#ffd166",
          kind: "coin",
          size: 0.06,
          speed: 2.4,
          up: 3,
          g: 10,
          max: 0.8,
        });
        fx.emit({
          x: e.x,
          y: e.y - 0.3,
          vz: 1.2,
          vx: 0,
          max: 1.4,
          size: 0.14,
          size1: 0.02,
          color: "#e8f4ff",
          kind: "dot",
          add: true,
        });
        fx.emit({
          x: e.x,
          y: e.y,
          kind: "ring",
          size: 0.1,
          size1: 1.1,
          max: 0.45,
          color: "rgba(255,240,210,0.9)",
        });
        fx.text(e.x, e.y - 0.3, `+${e.gold}`, "#ffd166", 1.2);
        audio.play("death");
        audio.play("coin");
        audio.duck(0.6, 0.3);
        this.flyCoins(e.x, e.y - 0.3, Math.min(8, Math.ceil(e.gold / 4)));
        if (e.combo >= 2) {
          this.hud.combo(
            e.combo,
            Math.max(0, e.combo - 1) *
              3 *
              (this.raid?.relics.has("echoes") ? 2 : 1),
          );
          audio.play("unlock", { pitch: 0.8 + e.combo * 0.1 });
        }
        if (isChampion(e.cls)) {
          r.shake(0.9);
          this.hud.banner(`${HEROES[e.cls].name} Falls`, "", "gold");
        }
        if (this.kind === "run" || this.kind === "workshop")
          this.hud.setGold(
            (this.run?.gold ?? 0) + (this.raid?.gold ?? 0),
            this.kind === "workshop",
          );
        break;
      }
      case "mdeath":
        fx.burst(e.x, e.y - 0.3, 14, {
          color:
            e.kind === "bones" || e.kind === "skeleton"
              ? "#e8e0cc"
              : e.kind === "slime" || e.kind === "minislime"
                ? "#5fd3a2"
                : "#a89aa8",
          kind: "shard",
          size: 0.05,
          speed: 2,
          up: 2,
          g: 8,
          max: 0.6,
        });
        audio.play("monsterDeath");
        if (e.kind === "bones")
          this.once("bones", () =>
            this.hud.toast("Skeletons rise again once.", "info"),
          );
        break;
      case "reform":
        fx.burst(e.x, e.y - 0.3, 10, {
          color: "#e8e0cc",
          kind: "dot",
          size: 0.04,
          speed: 1,
          up: 1.5,
          max: 0.5,
        });
        audio.play("magic", { pitch: 0.7, volume: 0.6 });
        break;
      case "trap":
        this.trapFx(e.kind, e.x, e.y, e.dir);
        break;
      case "disarm":
        fx.text(e.x + 0.5, e.y + 0.3, "Disarmed", "#7ef0ff", 0.9);
        fx.burst(e.x + 0.5, e.y + 0.5, 10, {
          color: "#7ef0ff",
          kind: "spark",
          size: 0.03,
          speed: 2.5,
          up: 1,
          max: 0.3,
          add: true,
        });
        audio.play("disarm");
        this.once("disarm", () =>
          this.hud.toast("A rogue disarmed your trap!", "bad"),
        );
        break;
      case "reveal":
        fx.emit({
          x: e.x + 0.5,
          y: e.y + 0.5,
          kind: "ring",
          size: 0.1,
          size1: 0.6,
          max: 0.4,
          color: "rgba(126,240,255,0.9)",
        });
        this.once("reveal", () =>
          this.hud.toast(
            "Spotted traps are avoided if another path exists.",
            "info",
          ),
        );
        break;
      case "loot":
        fx.text(e.x, e.y - 0.3, `-${e.amount}`, "#ff6a5a", 1.3);
        fx.burst(e.x, e.y - 0.2, 12, {
          color: "#ffd166",
          kind: "coin",
          size: 0.06,
          speed: 1.6,
          up: 3,
          g: 10,
          max: 0.8,
        });
        audio.play("steal");
        r.shake(0.25);
        this.hud.setHoard(this.raid!.hoard, this.raid!.hoardMax);
        this.once("loot", () =>
          this.hud.toast(
            "Treasure taken! Kill them before they escape.",
            "bad",
          ),
        );
        break;
      case "recover": {
        fx.text(e.x, e.y - 0.6, `+${e.amount} treasure`, "#ffe08a", 1.1);
        audio.play("recover");
        const [sx, sy] = r.toScreen(e.x, e.y);
        const t = this.hud.hoardRect();
        for (let i = 0; i < e.amount * 2; i++)
          fx.fly({
            sx,
            sy,
            tx: t.left + t.width / 2,
            ty: t.top + t.height / 2,
            dur: 0.6,
            delay: i * 0.06,
            color: "#ffd166",
            kind: "gem",
            done: () =>
              this.hud.setHoard(
                this.raid?.hoard ?? 0,
                this.raid?.hoardMax ?? 1,
              ),
          });
        break;
      }
      case "stolen": {
        const hero = this.heroOf(e.uid);
        audio.play("escape");
        r.shake(0.4);
        this.hud.toast(
          `${hero ? HEROES[hero.cls].name : "A hero"} escaped with ${e.amount} treasure`,
          "bad",
        );
        this.hud.setHoard(this.raid!.hoard, this.raid!.hoardMax);
        break;
      }
      case "escape":
        audio.play("escape", { volume: 0.6 });
        break;
      case "fall":
        fx.burst(e.x, e.y, 12, {
          color: "rgba(120,100,80,0.7)",
          kind: "smoke",
          size: 0.1,
          size1: 0.3,
          speed: 1,
          up: 0.2,
          max: 0.6,
        });
        this.once("fall", () =>
          this.hud.toast("Down they go — back to the entrance!", "good"),
        );
        break;
      case "land":
        fx.emit({
          x: e.x,
          y: e.y + 0.1,
          kind: "ring",
          size: 0.1,
          size1: 0.5,
          max: 0.3,
          color: "rgba(220,210,190,0.7)",
        });
        audio.play("step", { volume: 3 });
        break;
      case "freeze":
        fx.burst(e.x, e.y - 0.3, 14, {
          color: "#d8f4ff",
          kind: "shard",
          size: 0.04,
          speed: 2,
          up: 1.5,
          g: 6,
          max: 0.6,
        });
        r.flash(e.x, e.y, 1.5, "#7ad0ff", 0.4);
        break;
      case "fear":
        fx.emit({
          x: e.x,
          y: e.y - 0.4,
          kind: "ring",
          size: 0.1,
          size1: 0.8,
          max: 0.5,
          color: "rgba(200,160,255,0.9)",
        });
        break;
      case "dig":
        fx.burst(e.x + 0.5, e.y + 0.5, e.done ? 18 : 6, {
          color: BIOMES[this.raidBiome].rockTop,
          kind: "shard",
          size: 0.06,
          speed: 2.4,
          up: 2.5,
          g: 9,
          max: 0.7,
          spread: 0.6,
        });
        audio.play("dig");
        if (e.done) {
          r.shake(0.2);
          this.once("dig", () =>
            this.hud.toast("The dwarf tunneled through your rock!", "bad"),
          );
        }
        break;
      case "ignite":
        audio.play("fire", { volume: 0.7 });
        r.flash(e.x + 0.5, e.y + 0.5, 2, "#ff8a3a", 0.5);
        this.once("ignite", () => this.hud.toast("The tar is ablaze!", "good"));
        break;
      case "explode":
        big(0.08);
        r.shake(0.6);
        r.zoomPunch(0.04);
        r.flash(e.x, e.y, 4, "#ffcf7a", 0.5);
        fx.burst(e.x, e.y, 30, {
          color: "#ffb04a",
          kind: "dot",
          size: 0.12,
          size1: 0,
          speed: 5,
          up: 3,
          max: 0.5,
          add: true,
        });
        fx.burst(e.x, e.y, 16, {
          color: "rgba(80,70,70,0.7)",
          kind: "smoke",
          size: 0.2,
          size1: 0.6,
          speed: 2,
          up: 1,
          max: 1,
        });
        fx.burst(e.x, e.y, 12, {
          color: "#6a4a2a",
          kind: "shard",
          size: 0.06,
          speed: 4,
          up: 3,
          g: 9,
          max: 0.9,
        });
        fx.emit({
          x: e.x,
          y: e.y,
          kind: "ring",
          size: 0.2,
          size1: e.r * 1.2,
          max: 0.4,
          color: "rgba(255,220,160,1)",
        });
        audio.play("rockfall");
        audio.duck(0.4, 0.4);
        break;
      case "boulderEnd":
        r.shake(0.35);
        fx.burst(e.x, e.y, 16, {
          color: "#8f877c",
          kind: "shard",
          size: 0.07,
          speed: 3,
          up: 2.5,
          g: 9,
          max: 0.8,
        });
        audio.play("heavyHit");
        break;
      case "shoot": {
        const p = this.raid?.projectiles.find((q) => q.id === e.pid);
        if (p)
          audio.play(
            p.kind === "note"
              ? "lute"
              : p.kind === "fireball" ||
                  p.kind === "shadow" ||
                  p.kind === "bolt"
                ? "magic"
                : "arrow",
            { volume: p.kind === "note" ? 0.4 : 0.6 },
          );
        break;
      }
      case "zap":
        r.zap(e.pts);
        r.shake(0.12);
        for (const q of e.pts.slice(1))
          fx.burst(q.x, q.y, 8, {
            color: "#cfe4ff",
            kind: "spark",
            size: 0.03,
            speed: 3,
            up: 1,
            max: 0.25,
            add: true,
          });
        this.once("zap", () =>
          this.hud.toast("Lightning arcs through clumped heroes!", "good"),
        );
        break;
      case "blink":
        audio.play("blink");
        for (const [x, y] of [
          [e.fx, e.fy],
          [e.x, e.y],
        ]) {
          fx.emit({
            x,
            y: y - 0.4,
            kind: "ring",
            size: 0.1,
            size1: 0.9,
            max: 0.4,
            color: "rgba(200,150,255,0.9)",
          });
          fx.burst(x, y - 0.4, 12, {
            color: "#c38cff",
            kind: "star",
            size: 0.05,
            speed: 1.5,
            up: 1,
            max: 0.5,
            add: true,
          });
        }
        this.once("blink", () =>
          this.hud.toast(
            "Veyla blinks past your traps. Guard the hoard!",
            "bad",
          ),
        );
        break;
      case "warcry":
        audio.play("warcry");
        r.shake(0.35);
        for (let i = 0; i < 2; i++)
          fx.emit({
            x: e.x,
            y: e.y - 0.5,
            kind: "ring",
            size: 0.2 + i * 0.3,
            size1: 3.2,
            max: 0.5 + i * 0.15,
            color: "rgba(255,140,80,0.85)",
          });
        this.once("warcry", () =>
          this.hud.toast(
            "A war cry! Nearby heroes are fearless and fast.",
            "bad",
          ),
        );
        break;
      case "smash":
        audio.play("smash");
        r.shake(0.25);
        fx.text(e.x + 0.5, e.y + 0.2, "Smashed", "#ff9a6a", 0.9);
        fx.burst(e.x + 0.5, e.y + 0.5, 14, {
          color: "#8f877c",
          kind: "shard",
          size: 0.06,
          speed: 2.5,
          up: 2,
          g: 9,
          max: 0.6,
        });
        this.once("smash", () =>
          this.hud.toast(
            "Grukk breaks floor traps. Use darts and monsters.",
            "bad",
          ),
        );
        break;
      case "inspire":
        fx.burst(e.x, e.y - 0.8, 2, {
          color: "#ff9fd0",
          kind: "star",
          size: 0.05,
          speed: 0.6,
          up: 1.2,
          max: 0.6,
          add: true,
        });
        this.once("inspire", () =>
          this.hud.toast(
            "The bard inspires the party. Silence the music!",
            "info",
          ),
        );
        break;
      case "purge":
        fx.text(e.x, e.y - 0.6, "Purged", "#fff2b0", 0.9);
        fx.burst(e.x, e.y - 0.3, 10, {
          color: "#fff2b0",
          kind: "star",
          size: 0.05,
          speed: 1.2,
          up: 1.5,
          max: 0.5,
          add: true,
        });
        this.once("purge", () =>
          this.hud.toast("Inquisitors stop the undead from rising.", "bad"),
        );
        break;
      case "split":
        fx.burst(e.x, e.y - 0.2, 16, {
          color: "#5fd3a2",
          kind: "dot",
          size: 0.06,
          speed: 2,
          up: 2,
          g: 8,
          max: 0.6,
        });
        break;
      case "raise":
        fx.emit({
          x: e.x,
          y: e.y,
          kind: "ring",
          size: 0.1,
          size1: 0.9,
          max: 0.6,
          color: "rgba(180,140,255,0.9)",
        });
        fx.burst(e.x, e.y - 0.2, 14, {
          color: "#b48cff",
          kind: "dot",
          size: 0.05,
          speed: 1,
          up: 2,
          max: 0.8,
          add: true,
        });
        audio.play("magic", { pitch: 0.6 });
        this.once("raise", () =>
          this.hud.toast("The fallen rise to serve you.", "good"),
        );
        break;
      case "power":
        if (e.power === "rockfall" && e.phase === "hit") {
          big(0.06);
          r.shake(0.65);
          r.zoomPunch(0.03);
          audio.play("rockfall");
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              fx.burst(e.x + dx + 0.5, e.y + dy + 0.5, 5, {
                color: "#8f877c",
                kind: "shard",
                size: 0.08,
                speed: 1.5,
                up: 0.5,
                g: 9,
                max: 0.8,
                z: 2,
              } as never);
              fx.burst(e.x + dx + 0.5, e.y + dy + 0.6, 3, {
                color: "rgba(160,150,140,0.6)",
                kind: "smoke",
                size: 0.2,
                size1: 0.5,
                speed: 0.8,
                up: 0.2,
                max: 0.9,
              });
            }
        }
        if (e.power === "chill" && e.phase === "hit") {
          fx.emit({
            x: e.x + 0.5,
            y: e.y + 0.5,
            kind: "ring",
            size: 0.2,
            size1: 2.6,
            max: 0.6,
            color: "rgba(170,225,255,0.9)",
          });
          fx.burst(e.x + 0.5, e.y + 0.5, 30, {
            color: "#dff4ff",
            kind: "shard",
            size: 0.04,
            speed: 3,
            up: 1,
            g: 2,
            max: 0.8,
            spread: 2,
          });
          r.flash(e.x + 0.5, e.y + 0.5, 3, "#9fdcff", 0.5);
        }
        if (e.power === "shriek" && e.phase === "hit") {
          for (let i = 0; i < 3; i++)
            fx.emit({
              x: e.x + 0.5,
              y: e.y + 0.5,
              kind: "ring",
              size: 0.2 + i * 0.3,
              size1: 2.6 + i * 0.3,
              max: 0.6 + i * 0.15,
              color: "rgba(200,160,255,0.85)",
            });
          r.shake(0.3);
        }
        break;
      case "retreat":
        this.hud.banner("Retreat!", "The heroes flee for the surface");
        break;
      case "lure":
        fx.burst(e.x + 0.5, e.y + 0.4, 10, {
          color: "#ffd166",
          kind: "star",
          size: 0.08,
          speed: 1,
          up: 2,
          max: 0.7,
          add: true,
        });
        audio.play("coin", { pitch: 0.8 });
        this.once("lure", () =>
          this.hud.toast("Greed lured them off the path.", "good"),
        );
        break;
      case "mimic":
        r.shake(0.4);
        big(0.08);
        fx.text(e.x, e.y - 0.7, "MIMIC!", "#ff6a5a", 1.4);
        audio.play("heavyHit");
        break;
      case "step":
        audio.play("step", { volume: 0.6 });
        break;
      case "attack":
        break;
      case "firebomb":
        audio.play("fire", { pitch: 1.3, volume: 0.6 });
        this.trail(e.fx, e.fy, e.x, e.y, "#ffb35a", 6);
        fx.emit({
          x: e.x,
          y: e.y,
          kind: "ring",
          size: 0.1,
          size1: 1.2,
          max: 0.35,
          color: "rgba(255,140,60,0.9)",
        });
        fx.burst(e.x, e.y - 0.1, 16, {
          color: "#ff8a3a",
          kind: "spark",
          size: 0.05,
          speed: 3,
          up: 2,
          max: 0.45,
          add: true,
        });
        break;
      case "wail":
        audio.play("shriek", { pitch: 1.25, volume: 0.5 });
        fx.emit({
          x: e.x,
          y: e.y,
          kind: "ring",
          size: 0.2,
          size1: 2.1,
          max: 0.5,
          color: "rgba(190,230,255,0.8)",
        });
        break;
      case "ward": {
        audio.play("magic", { pitch: 0.8 });
        fx.emit({
          x: e.x,
          y: e.y - 0.4,
          kind: "ring",
          size: 0.5,
          size1: 0.9,
          max: 0.3,
          color: "rgba(200,216,255,0.9)",
        });
        fx.text(e.x, e.y - 0.8, "Ward broken", "#c9d8ff", 0.8);
        break;
      }
      case "seal":
        audio.play("rockfall", { pitch: 1.2, volume: 0.7 });
        r.shake(0.35);
        fx.text(e.x, e.y - 0.8, "Sealed!", "#ffd166", 1);
        break;
      case "bomb":
        audio.play("boulder", { pitch: 1.4 });
        r.shake(0.3);
        fx.emit({
          x: e.x,
          y: e.y,
          kind: "ring",
          size: 0.1,
          size1: 1.3,
          max: 0.35,
          color: "rgba(255,160,80,0.9)",
        });
        fx.burst(e.x, e.y - 0.1, 18, {
          color: "#ffb35a",
          kind: "spark",
          size: 0.04,
          speed: 3.5,
          up: 2,
          max: 0.4,
          add: true,
        });
        fx.text(e.x, e.y - 0.4, "Wrecked", "#ff9a6a", 0.9);
        this.once("bomb", () =>
          this.hud.toast(
            "Sappers bomb your best trap in sight. Kill them early.",
            "bad",
          ),
        );
        break;
      case "root":
        audio.play("magic", { pitch: 0.5, volume: 0.7 });
        fx.emit({
          x: e.x,
          y: e.y,
          kind: "ring",
          size: 0.2,
          size1: 2.5,
          max: 0.5,
          color: "rgba(140,220,90,0.85)",
        });
        this.once("root", () =>
          this.hud.toast("The druid roots your monsters in place.", "bad"),
        );
        break;
      case "veil":
        audio.play("blink", { pitch: 0.6 });
        fx.burst(e.x, e.y - 0.4, 14, {
          color: "rgba(120,90,200,0.7)",
          kind: "smoke",
          size: 0.1,
          size1: 0.3,
          speed: 0.8,
          up: 0.5,
          max: 0.6,
        });
        this.once("veil", () =>
          this.hud.toast(
            "Nyx vanishes: monsters lose her, but traps still bite.",
            "bad",
          ),
        );
        break;
      case "rise":
        audio.play("magic", { pitch: 0.45 });
        fx.emit({
          x: e.x,
          y: e.y,
          kind: "ring",
          size: 0.1,
          size1: 1,
          max: 0.6,
          color: "rgba(140,255,210,0.9)",
        });
        fx.text(e.x, e.y - 0.7, "Risen", "#9fe0c8", 1);
        this.once("rise", () =>
          this.hud.toast(
            "The fallen rise again! Kill the Hollow King or split them up.",
            "bad",
          ),
        );
        break;
      case "slam":
        audio.play("smash");
        r.shake(0.3);
        fx.emit({
          x: e.x,
          y: e.y,
          kind: "ring",
          size: 0.2,
          size1: 1.6,
          max: 0.35,
          color: "rgba(200,200,220,0.9)",
        });
        fx.burst(e.x, e.y - 0.2, 12, {
          color: "#8a8f9c",
          kind: "shard",
          size: 0.05,
          speed: 2.5,
          up: 2,
          g: 9,
          max: 0.5,
        });
        break;
      case "stone":
        fx.burst(e.x, e.y - 0.3, 8, {
          color: "rgba(160,160,180,0.6)",
          kind: "smoke",
          size: 0.08,
          size1: 0.2,
          speed: 0.5,
          up: 0.4,
          max: 0.5,
        });
        break;
      case "pit":
        if (e.open) {
          r.shake(0.2);
          fx.burst(e.x + 0.5, e.y + 0.5, 14, {
            color: "rgba(120,100,80,0.7)",
            kind: "smoke",
            size: 0.1,
            size1: 0.3,
            speed: 1,
            up: 0.3,
            max: 0.6,
          });
        }
        break;
      case "strike":
        r.zap([
          { x: e.fx, y: e.fy },
          { x: e.x, y: e.y - 0.4 },
        ]);
        r.shake(0.2);
        audio.play("zap");
        r.flash(e.x, e.y - 0.3, 2, "#cfe4ff", 0.3);
        break;
    }
  }

  /** A short-lived streak of particles from one point to another. */
  private trail(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    color: string,
    n: number,
  ) {
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      this.renderer.fx.emit({
        x: x0 + (x1 - x0) * k,
        y: y0 + (y1 - y0) * k,
        kind: "dot",
        size: 0.06,
        size1: 0.01,
        max: 0.25 + k * 0.2,
        color,
        add: true,
      });
    }
  }
  private trapFx(kind: string, x: number, y: number, dir: number) {
    const fx = this.renderer.fx;
    const r = this.renderer;
    void dir;
    switch (kind) {
      case "spikes":
        audio.play("spike");
        r.shake(0.12);
        fx.burst(x + 0.5, y + 0.6, 6, {
          color: "rgba(200,190,170,0.6)",
          kind: "smoke",
          size: 0.06,
          size1: 0.18,
          speed: 1,
          up: 0.5,
          max: 0.4,
        });
        break;
      case "darts":
        audio.play("arrow");
        break;
      case "flame":
        audio.play("fire");
        r.shake(0.1);
        break;
      case "boulder":
        audio.play("boulder");
        r.shake(0.25);
        break;
      case "trapdoor":
        audio.play("trapdoor");
        r.shake(0.15);
        break;
      case "spring":
        audio.play("spring");
        break;
      case "saw":
        audio.play("saw", { volume: 0.7 });
        break;
      case "gas":
        audio.play("gas");
        break;
      case "keg":
        audio.play("click", { pitch: 0.5 });
        fx.burst(x + 0.5, y + 0.2, 8, {
          color: "#ffd166",
          kind: "spark",
          size: 0.03,
          speed: 2,
          up: 2,
          max: 0.3,
          add: true,
        });
        break;
      case "frost":
        audio.play("freeze");
        break;
      case "pylon":
        audio.play("zap");
        break;
      case "crusher":
        audio.play("smash", { pitch: 1.2 });
        r.shake(0.15);
        fx.burst(x + 0.5, y + 0.6, 8, {
          color: "rgba(180,170,160,0.6)",
          kind: "smoke",
          size: 0.08,
          size1: 0.2,
          speed: 1.2,
          up: 0.4,
          max: 0.4,
        });
        break;
    }
  }

  // ---------------- frame ----------------
  private frame = (now: number) => {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    this.tutorialTimer -= dt;
    if (
      this.profile.tutorial === 1 &&
      this.tutorialTimer <= 0 &&
      this.phase === "build"
    )
      this.tutorialStep();
    let alpha = 1;
    let raid = this.raid;
    // Title attract mode.
    if (this.kind === "title" && this.demo) {
      const d = this.demo;
      raid = d.raid;
      if (d.raid.finished) {
        d.wait += dt;
        if (d.wait > 2.5) this.resetDemo();
      } else {
        this.acc += dt;
        while (this.acc >= TICK) {
          d.raid.step();
          for (const e of d.raid.events)
            if (
              e.k === "kill" ||
              e.k === "trap" ||
              e.k === "mdeath" ||
              e.k === "explode"
            )
              this.onDemoEvent(e);
          d.raid.events.length = 0;
          this.acc -= TICK;
        }
        alpha = this.acc / TICK;
      }
    } else if (raid && this.phase === "raid") {
      if (!this.paused) {
        for (const k of Object.keys(this.powerCd))
          this.powerCd[k] = Math.max(
            0,
            this.powerCd[k] - dt * SPEEDS[this.speedIdx],
          );
        if (this.hitstop > 0) this.hitstop -= dt;
        else {
          this.acc += dt * SPEEDS[this.speedIdx];
          let steps = 0;
          while (this.acc >= TICK && steps < 8 && !raid.finished) {
            raid.step();
            for (const e of raid.events) this.onEvent(e);
            raid.events.length = 0;
            this.acc -= TICK;
            steps++;
            if (this.hitstop > 0) {
              this.acc = 0;
              break;
            }
          }
          if (raid.finished) this.endRaid();
        }
      }
      alpha = Math.min(1, this.acc / TICK);
      this.hud.updateRoster(raid);
      this.updatePowersHud();
      // Low-treasure tension.
      audio.intensity =
        raid.hoard <= Math.ceil(raid.hoardMax * 0.3) ||
        raid.heroes.some((h) => h.loot > 0 && h.alive)
          ? 2
          : 1;
    } else if (raid && this.phase === "after") {
      alpha = 1;
    }
    this.nightK += (this.nightTarget - this.nightK) * Math.min(1, dt * 1.6);
    if (
      this.dirtySave &&
      Math.floor(this.time * 2) !== Math.floor((this.time - dt) * 2)
    )
      this.flushSave();

    const layout = raid
      ? raid.layout
      : (this.run?.layout ??
        this.challenge?.shared.layout ??
        this.demo?.layout);
    if (layout) {
      const ghost = this.ghost();
      const scene: Scene = {
        mode: this.phase === "build" ? "build" : raid ? "raid" : "idle",
        layout,
        biome:
          this.kind === "title"
            ? this.demoBiome
            : raid
              ? this.raidBiome
              : (this.run?.biome ?? this.challenge?.shared.biome ?? "crypt"),
        raid,
        alpha,
        hoard: raid ? raid.hoard : (this.run?.hoard ?? 12),
        hoardMax: raid ? raid.hoardMax : (this.run?.hoardMax ?? 12),
        night: this.nightK,
        path: this.phase === "build" ? this.path : null,
        ghost,
        selected: this.phase === "build" ? this.selected : null,
        time: this.time,
        spotlight: null,
        pendingPowers: raid ? raid.pendingPowers : [],
      };
      this.renderer.render(scene, dt);
    }
    requestAnimationFrame(this.frame);
  };

  private onDemoEvent(e: RaidEvent) {
    const fx = this.renderer.fx;
    if (e.k === "kill") {
      fx.burst(e.x, e.y - 0.35, 20, {
        color: "#fff4e0",
        kind: "dot",
        size: 0.05,
        size1: 0,
        speed: 3,
        up: 2.4,
        g: 5,
        max: 0.6,
        add: true,
      });
      fx.burst(e.x, e.y - 0.2, 8, {
        color: "#ffd166",
        kind: "coin",
        size: 0.06,
        speed: 2.4,
        up: 3,
        g: 10,
        max: 0.8,
      });
    } else if (e.k === "explode") {
      fx.burst(e.x, e.y, 24, {
        color: "#ffb04a",
        kind: "dot",
        size: 0.12,
        size1: 0,
        speed: 5,
        up: 3,
        max: 0.5,
        add: true,
      });
    } else if (e.k === "mdeath") {
      fx.burst(e.x, e.y - 0.3, 10, {
        color: "#e8e0cc",
        kind: "shard",
        size: 0.05,
        speed: 2,
        up: 2,
        g: 8,
        max: 0.6,
      });
    }
  }

  private ghost(): Ghost | null {
    // Aiming a power: outline the target tile.
    if (this.phase === "raid" && this.power && this.hover)
      return {
        kind: "sell",
        x: this.hover.x,
        y: this.hover.y,
        dir: 0,
        ok: true,
      };
    if (!this.hover || !this.run) return null;
    const { x, y } = this.hover;
    if (this.phase !== "build") return null;
    const run = this.run;
    if (!inside(run.layout, x, y)) return null;
    if (this.tool === "dig") {
      const t = run.layout.tiles[idx(run.layout, x, y)];
      if (t === T.Floor)
        return { kind: "fill", x, y, dir: 0, ok: !canFill(run, x, y) };
      return { kind: "dig", x, y, dir: 0, ok: !canDig(run, x, y) };
    }
    if (this.tool) {
      const err = canPlace(run, this.tool, x, y);
      return {
        kind: this.tool,
        x,
        y,
        dir: PIECES[this.tool].directional
          ? bestDir(run.layout, x, y, this.path)
          : 2,
        ok: !err,
      };
    }
    return null;
  }
}

/** Default facing for directional pieces: along the hero route, else the longest lane. */
function bestDir(
  l: Layout,
  x: number,
  y: number,
  path?: { x: number; y: number }[] | null,
) {
  const DXs = [0, 1, 0, -1];
  const DYs = [-1, 0, 1, 0];
  let best = 2;
  let bestScore = -1;
  for (let d = 0; d < 4; d++) {
    let len = 0;
    let onPath = 0;
    let cx = x;
    let cy = y;
    for (let i = 0; i < 8; i++) {
      cx += DXs[d];
      cy += DYs[d];
      if (!walkable(l, cx, cy)) break;
      len++;
      if (path?.some((p) => p.x === cx && p.y === cy)) onPath++;
    }
    const score = onPath * 3 + len;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}
