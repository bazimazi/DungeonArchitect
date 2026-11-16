/**
 * Deterministic raid simulation. Fixed 20 Hz ticks, seeded randomness and only
 * IEEE-exact arithmetic (+ - * / sqrt), so identical inputs give identical
 * raids on every device. Presentation reads state and drains `events`.
 */
import { Rng } from "../engine/math";
import {
  DX,
  DY,
  FEARLESS,
  HEROES,
  UNDEAD,
  UNSHAKABLE,
  isChampion,
  type MutatorId,
  type OmenId,
  MINIONS,
  MONSTERS,
  PIECES,
  RAID_HARD_LIMIT,
  RAID_RETREAT_AT,
  T,
  TICK,
  type HeroClass,
  type MonsterId,
  type MonsterStats,
  type PieceId,
  type PowerId,
  type RelicId,
  type TrapId,
} from "./defs";
import {
  cloneLayout,
  distanceField,
  idx,
  inside,
  lineOfSight,
  stepDown,
  tileAt,
  walkable,
  type Layout,
  type Placed,
} from "./grid";

export interface PartyMember {
  cls: HeroClass;
  elite?: boolean;
}
export interface RaidMods {
  heroHp: number;
  heroDmg: number;
  heroSpeed: number;
  monsterHp: number;
  /** Monster damage multiplier (Beastmaster). */
  monsterDmg?: number;
  /** Architect id, for architect-specific rules. */
  arch?: string;
  mutators?: MutatorId[];
  /** Omens the player chose for the run. */
  omens?: OmenId[];
  relics: RelicId[];
  tiers: Partial<Record<PieceId, number>>;
}
export interface RaidSetup {
  layout: Layout;
  party: PartyMember[];
  seed: number;
  night: number;
  hoard: number;
  /** Hoard capacity (defaults to the starting hoard). */
  hoardMax?: number;
  mods: RaidMods;
}
export interface Command {
  tick: number;
  power: PowerId;
  x: number;
  y: number;
}

type DmgType = "phys" | "magic" | "fire" | "poison" | "crush";

export interface Status {
  burn: number;
  poison: number;
  frozen: number;
  slow: number;
  fear: number;
  vuln: number;
  stun: number;
  /** Inspired by a bard or war cry: faster, stronger, fearless. */
  insp: number;
  /** Hexed by a totem: takes extra damage. */
  hex: number;
  /** The Shade's veil: monsters can't see her. */
  veil: number;
}
const noStatus = (): Status => ({
  insp: 0,
  hex: 0,
  veil: 0,
  burn: 0,
  poison: 0,
  frozen: 0,
  slow: 0,
  fear: 0,
  vuln: 0,
  stun: 0,
});

export interface UnitBase {
  uid: number;
  x: number;
  y: number;
  px: number;
  py: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  face: number; // -1 left, 1 right
  lastAtk: number; // tick of last attack (for lunge anim)
  lastHit: number; // tick last damaged
  st: Status;
  next: { x: number; y: number } | null;
  target: number;
  atkT: number;
  hop: {
    fx: number;
    fy: number;
    tx: number;
    ty: number;
    t: number;
    dur: number;
    h: number;
  } | null;
}
export type HeroState =
  | "seek"
  | "loot"
  | "lure"
  | "escape"
  | "flee"
  | "disarm"
  | "dig"
  | "throw"
  | "falling"
  | "dead"
  | "escaped";
export interface Hero extends UnitBase {
  side: "hero";
  cls: HeroClass;
  elite: boolean;
  armor: number;
  dmg: number;
  cd: number;
  speed: number;
  range: number;
  engage: number;
  state: HeroState;
  actT: number;
  actX: number;
  actY: number;
  loot: number;
  disarms: number;
  digs: number;
  lureDone: boolean;
  healT: number;
  spawnTick: number;
  spawned: boolean;
  touchedHoard: boolean;
  lastSource: string;
  lastType: DmgType;
  /** Champion ability timer (blink, war cry, roots, veil). */
  skillT: number;
  /** Sapper bombs left. */
  bombs: number;
  /** Ticks until a fallen hero rises again (Hollow King, Undying). */
  reviveT: number;
  /** Has already risen once (pays half bounty the second time). */
  revived: boolean;
  /** Damage multiplier while hexed. */
  hexMul: number;
  /** What set the hero burning (credited for burn kills). */
  burnSrc: string;
  /** Monk: the next dart or arrow is turned aside. */
  deflect: boolean;
}
export interface Monster extends UnitBase {
  side: "monster";
  kind: MonsterId | "minislime" | "risen";
  stats: MonsterStats;
  dmg: number;
  homeX: number;
  homeY: number;
  reforms: number;
  reformT: number;
  hidden: boolean;
  /** Gargoyles sleep as statues: immune and untargetable. */
  dormant: boolean;
  idleT: number;
  raiseT: number;
  pieceId: number;
  /** Ability timer (basilisk gaze, kobold repairs). */
  abilT: number;
}
export interface TrapState {
  obj: Placed;
  kind: TrapId;
  cd: number;
  disabled: boolean;
  known: boolean;
  used: boolean;
  /** flame/gas: seconds into cycle; saw: position along axis; boulder: roll pos */
  phase: number;
  active: boolean;
  warn: boolean;
  armT: number;
  pos: number;
  hitSet: number[];
  fuse: number;
  sawDir: number;
  tickT: number;
  /** Ticks left jammed by the Witch Queen's jinx. */
  jam: number;
}
export interface Projectile {
  id: number;
  kind:
    "dart" | "arrow" | "bolt" | "fireball" | "holy" | "shadow" | "note" | "web";
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  target: number; // uid for homing, -1 for linear
  dmg: number;
  dtype: DmgType;
  fromHero: boolean;
  splash: number;
  life: number;
  source: string;
  /** Monster that fired it (life drain). */
  owner: number;
}

export type RaidEvent =
  | { k: "spawn"; uid: number; x: number; y: number }
  | {
      k: "hit";
      uid: number;
      x: number;
      y: number;
      amount: number;
      dtype: DmgType;
      crit: boolean;
      hero: boolean;
    }
  | { k: "heal"; uid: number; x: number; y: number; amount: number }
  | {
      k: "kill";
      uid: number;
      x: number;
      y: number;
      cls: HeroClass;
      gold: number;
      combo: number;
    }
  | { k: "mdeath"; uid: number; x: number; y: number; kind: string }
  | { k: "reform"; uid: number; x: number; y: number }
  | { k: "trap"; kind: TrapId; x: number; y: number; dir: number }
  | { k: "disarm"; x: number; y: number; uid: number }
  | { k: "reveal"; x: number; y: number }
  | { k: "loot"; uid: number; x: number; y: number; amount: number }
  | { k: "recover"; uid: number; x: number; y: number; amount: number }
  | { k: "stolen"; uid: number; amount: number }
  | { k: "escape"; uid: number }
  | { k: "fall"; uid: number; x: number; y: number }
  | { k: "land"; uid: number; x: number; y: number }
  | { k: "freeze"; uid: number; x: number; y: number }
  | { k: "fear"; uid: number; x: number; y: number }
  | { k: "dig"; x: number; y: number; done: boolean }
  | { k: "ignite"; x: number; y: number }
  | { k: "explode"; x: number; y: number; r: number }
  | { k: "boulderEnd"; x: number; y: number }
  | { k: "attack"; uid: number; tx: number; ty: number; ranged: boolean }
  | { k: "shoot"; pid: number }
  | { k: "split"; x: number; y: number }
  | { k: "raise"; x: number; y: number }
  | { k: "power"; power: PowerId; x: number; y: number; phase: "warn" | "hit" }
  | { k: "retreat" }
  | { k: "lure"; x: number; y: number; uid: number }
  | { k: "mimic"; x: number; y: number }
  | { k: "zap"; pts: { x: number; y: number }[] }
  | { k: "blink"; uid: number; fx: number; fy: number; x: number; y: number }
  | { k: "warcry"; uid: number; x: number; y: number }
  | { k: "smash"; x: number; y: number }
  | { k: "inspire"; uid: number; x: number; y: number }
  | { k: "purge"; x: number; y: number }
  | { k: "bomb"; uid: number; fx: number; fy: number; x: number; y: number }
  | { k: "root"; uid: number; x: number; y: number }
  | { k: "veil"; uid: number; x: number; y: number }
  | { k: "rise"; uid: number; x: number; y: number }
  | { k: "slam"; x: number; y: number }
  | { k: "stone"; x: number; y: number }
  | { k: "pit"; x: number; y: number; open: boolean }
  | { k: "strike"; fx: number; fy: number; x: number; y: number }
  | { k: "step"; uid: number }
  | { k: "deflect"; uid: number; x: number; y: number }
  | {
      k: "jinx";
      uid: number;
      x: number;
      y: number;
      pts: { x: number; y: number }[];
    }
  | { k: "gaze"; uid: number; x: number; y: number; tx: number; ty: number }
  | { k: "repair"; x: number; y: number }
  | { k: "soul"; x: number; y: number; tx: number; ty: number }
  | { k: "spite"; x: number; y: number }
  | { k: "snap"; uid: number; x: number; y: number };

export interface RaidResult {
  killed: number;
  escaped: number;
  stolen: number;
  touchedHoard: boolean;
  gold: number;
  bestCombo: number;
  kills: Record<string, number>;
  damage: Record<string, number>;
  seconds: number;
  /** Kills by fire, by powers, and trapdoor falls (for feats). */
  fireKills: number;
  powerKills: number;
  falls: number;
  /** Champions slain this raid. */
  champions: HeroClass[];
}

const DISARMABLE: TrapId[] = [
  "beartrap",
  "lantern",
  "spikes",
  "trapdoor",
  "frost",
  "spring",
  "darts",
  "flame",
  "gas",
  "boulder",
  "keg",
  "pylon",
  "crusher",
  "totem",
];
const TRAP_KINDS = new Set<string>(
  (Object.keys(PIECES) as PieceId[]).filter((k) => PIECES[k].kind === "trap"),
);
/** Floor plates that floating heroes drift over. */
const FLOOR_PLATES: TrapId[] = [
  "spikes",
  "frost",
  "trapdoor",
  "spring",
  "beartrap",
];
const ROGUE_DETECT = 2;
const RANGER_DETECT = 3.2;
const s = (sec: number) => Math.round(sec / TICK);

export class Raid {
  readonly layout: Layout;
  readonly setup: RaidSetup;
  readonly rng: Rng;
  tick = 0;
  heroes: Hero[] = [];
  monsters: Monster[] = [];
  traps: TrapState[] = [];
  projectiles: Projectile[] = [];
  events: RaidEvent[] = [];
  tarFire = new Map<number, number>(); // tile index -> remaining burn seconds
  tarCool = new Map<number, number>();
  clouds: { x: number; y: number; t: number }[] = [];
  pendingPowers: { power: PowerId; x: number; y: number; t: number }[] = [];
  /** Open sinkholes. */
  pits: { x: number; y: number; t: number }[] = [];
  /** Hollow King: heroes he can still raise tonight. */
  riseCharges = 3;
  undyingUsed = false;
  phylacteryUsed = false;
  hoard: number;
  hoardMax: number;
  /** Treasure in the hoard when the raid began. */
  readonly hoardStart: number;
  dread = 3;
  dreadMax = 15;
  gold = 0;
  combo = 0;
  bestCombo = 0;
  lastKill = -999;
  finished = false;
  retreating = false;
  commands: Command[] = [];
  private uid = 1;
  private pid = 1;
  private fieldHoard: Float64Array | null = null;
  private fieldExit: Float64Array | null = null;
  private fieldDig: Float64Array | null = null;
  private fieldThane: Float64Array | null = null;
  private targetFields = new Map<number, Float64Array>();
  private dirty = true;
  stats = {
    kills: {} as Record<string, number>,
    damage: {} as Record<string, number>,
    fireKills: 0,
    powerKills: 0,
    falls: 0,
    champions: [] as HeroClass[],
  };
  readonly relics: Set<RelicId>;
  readonly mutators: Set<MutatorId>;
  readonly omens: Set<OmenId>;

  constructor(setup: RaidSetup) {
    this.setup = setup;
    this.layout = cloneLayout(setup.layout);
    this.rng = new Rng(setup.seed);
    this.hoard = setup.hoard;
    this.hoardStart = setup.hoard;
    this.hoardMax = setup.hoardMax ?? setup.hoard;
    this.relics = new Set(setup.mods.relics);
    this.mutators = new Set(setup.mods.mutators ?? []);
    this.omens = new Set(setup.mods.omens ?? []);
    if (this.relics.has("soulSiphon")) {
      this.dread = 8;
      this.dreadMax = 20;
    }
    if (this.mutators.has("leyLines"))
      this.dread = Math.min(this.dreadMax, this.dread + 6);
    const tierOf = (k: PieceId) => setup.mods.tiers[k] ?? 1;
    for (const o of this.layout.objects) {
      const def = PIECES[o.kind];
      if (def.kind === "trap") {
        this.traps.push({
          obj: o,
          kind: o.kind as TrapId,
          cd: 0,
          disabled: false,
          known: false,
          used: false,
          // Cycles are staggered by position so shared links keep timings.
          phase:
            o.kind === "flame"
              ? ((o.x * 7 + o.y * 3) * 0.9) % 4
              : o.kind === "gas"
                ? ((o.x * 5 + o.y * 7) * 1.3) % 5
                : 0,
          active: false,
          warn: false,
          armT: 0,
          pos: 0,
          hitSet: [],
          fuse: -1,
          sawDir: 1,
          tickT: 0,
          jam: 0,
        });
      } else {
        const m = this.makeMonster(
          o.kind as MonsterId,
          o.x + 0.5,
          o.y + 0.5,
          tierOf(o.kind),
        );
        m.pieceId = o.id;
        if (o.kind === "mimic") m.hidden = true;
        if (o.kind === "gargoyle") m.dormant = true;
        if (o.kind === "skeleton")
          m.reforms = this.relics.has("restless") ? 2 : 1;
      }
    }
    for (const t of this.traps) {
      if (t.kind === "saw") t.pos = 0;
      // Cartographers and Betrayal: heroes arrive knowing the map.
      if (
        (this.mutators.has("scouts") || this.omens.has("betrayal")) &&
        t.kind !== "lure"
      )
        t.known = true;
    }
    const e = this.layout.entrance;
    setup.party.forEach((p, i) => {
      const h = this.makeHero(p.cls, !!p.elite, e.x + 0.5, e.y + 0.5);
      h.spawnTick = s(0.4 + i * 1.1);
    });
  }

  // ---------- construction ----------
  private base(x: number, y: number, hp: number): UnitBase {
    return {
      uid: this.uid++,
      x,
      y,
      px: x,
      py: y,
      hp,
      maxHp: hp,
      alive: true,
      face: 1,
      lastAtk: -99,
      lastHit: -99,
      st: noStatus(),
      next: null,
      target: -1,
      atkT: 0,
      hop: null,
    };
  }
  private makeHero(cls: HeroClass, elite: boolean, x: number, y: number): Hero {
    const d = HEROES[cls];
    const m = this.setup.mods;
    const wrath = isChampion(cls) && this.omens.has("wrath") ? 1.4 : 1;
    const hp = Math.round(d.hp * m.heroHp * (elite ? 1.6 : 1) * wrath);
    const h: Hero = {
      ...this.base(x, y, hp),
      side: "hero",
      cls,
      elite,
      armor:
        d.armor +
        (this.mutators.has("ironclad") ? 2 : 0) +
        (this.omens.has("tempered") ? 1 : 0),
      dmg: d.dmg * m.heroDmg * (elite ? 1.25 : 1),
      cd: d.cd,
      speed: d.speed * m.heroSpeed,
      range: Math.max(d.range, 1.05),
      engage: d.engage,
      state: "seek",
      actT: 0,
      actX: 0,
      actY: 0,
      loot: 0,
      disarms: cls === "rogue" ? (elite ? 2 : 1) : 0,
      digs: cls === "dwarf" ? 5 : cls === "thane" ? 10 : 0,
      lureDone: false,
      healT: 0,
      spawnTick: 0,
      spawned: false,
      touchedHoard: false,
      lastSource: "",
      lastType: "phys",
      skillT:
        cls === "archmage"
          ? s(5)
          : cls === "warlord"
            ? s(3)
            : cls === "druid"
              ? s(2.5)
              : cls === "shade"
                ? s(4)
                : cls === "witch"
                  ? s(3)
                  : 0,
      bombs: cls === "sapper" ? (elite ? 2 : 1) : 0,
      reviveT: 0,
      revived: false,
      hexMul: 1,
      burnSrc: "flame",
      deflect: false,
    };
    h.alive = false;
    this.heroes.push(h);
    return h;
  }
  private makeMonster(
    kind: Monster["kind"],
    x: number,
    y: number,
    tier: number,
  ): Monster {
    const st =
      kind === "minislime" || kind === "risen" ? MINIONS[kind] : MONSTERS[kind];
    const tm = 1 + 0.4 * (tier - 1);
    let hpMul = this.setup.mods.monsterHp * tm;
    if (this.relics.has("warBanner")) hpMul *= 1.3;
    const hp = Math.round(st.hp * hpMul);
    const m: Monster = {
      ...this.base(x, y, hp),
      side: "monster",
      kind,
      stats: st,
      dmg: st.dmg * tm * (this.setup.mods.monsterDmg ?? 1),
      homeX: Math.floor(x),
      homeY: Math.floor(y),
      reforms: 0,
      reformT: 0,
      hidden: false,
      dormant: false,
      idleT: 0,
      raiseT: 0,
      pieceId: -1,
      abilT: kind === "basilisk" ? s(1.5) : kind === "kobold" ? s(2) : 0,
    };
    this.monsters.push(m);
    return m;
  }

  // ---------- helpers ----------
  private tierMul(k: PieceId) {
    return 1 + 0.4 * ((this.setup.mods.tiers[k] ?? 1) - 1);
  }
  private trapAt(x: number, y: number) {
    return this.traps.find((t) => t.obj.x === x && t.obj.y === y);
  }
  private emit(e: RaidEvent) {
    this.events.push(e);
  }
  private d2(ax: number, ay: number, bx: number, by: number) {
    const dx = ax - bx;
    const dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
  }
  /** Heroes that can be seen, hit and targeted (not mid-fall through a trapdoor). */
  private livingHeroes() {
    return this.heroes.filter((h) => h.alive && h.state !== "falling");
  }
  private tileOf(u: { x: number; y: number }) {
    return { x: Math.floor(u.x), y: Math.floor(u.y) };
  }
  /** A trap becomes known: heroes route around it from now on. */
  private mark(t: TrapState) {
    if (t.known) return;
    t.known = true;
    this.dirty = true;
  }
  /** Trap cycle speed: Oiled Gears and the Tinkerer both shorten it. */
  private rearmMul() {
    return (
      (this.relics.has("quickHands") ? 0.65 : 1) *
      (this.setup.mods.arch === "tinkerer" ? 0.75 : 1)
    );
  }
  private rearm(sec: number) {
    return s(sec * this.rearmMul());
  }
  /** Set a hero burning; Ember Heart doubles every burn. */
  private burn(h: Hero, sec: number, src: string) {
    const t = s(this.relics.has("emberHeart") ? sec * 2 : sec);
    if (t >= h.st.burn) h.burnSrc = src;
    h.st.burn = Math.max(h.st.burn, t);
  }

  private dangerCost = (x: number, y: number) => {
    const t = this.trapAt(x, y);
    if (
      t &&
      t.known &&
      !t.disabled &&
      t.kind !== "lure" &&
      t.kind !== "lantern"
    )
      return 40;
    return 0;
  };
  private hoardField() {
    if (this.dirty || !this.fieldHoard) this.rebuild();
    return this.fieldHoard!;
  }
  private exitField() {
    if (this.dirty || !this.fieldExit) this.rebuild();
    return this.fieldExit!;
  }
  private digField() {
    if (this.dirty || !this.fieldDig) this.rebuild();
    return this.fieldDig!;
  }
  private rebuild() {
    const l = this.layout;
    this.fieldHoard = distanceField(l, l.hoard.x, l.hoard.y, this.dangerCost);
    this.fieldExit = distanceField(
      l,
      l.entrance.x,
      l.entrance.y,
      this.dangerCost,
    );
    this.fieldDig = distanceField(l, l.hoard.x, l.hoard.y, this.dangerCost, 18);
    this.fieldThane = distanceField(l, l.hoard.x, l.hoard.y, undefined, 10);
    this.targetFields.clear();
    this.dirty = false;
  }
  private thaneField() {
    if (this.dirty || !this.fieldThane) this.rebuild();
    return this.fieldThane!;
  }
  private fieldTo(x: number, y: number) {
    if (this.dirty) this.rebuild();
    const key = idx(this.layout, x, y);
    let f = this.targetFields.get(key);
    if (!f) {
      f = distanceField(this.layout, x, y);
      this.targetFields.set(key, f);
    }
    return f;
  }

  // ---------- damage ----------
  damage(
    u: Hero | Monster,
    raw: number,
    type: DmgType,
    source: string,
    crit = false,
  ): number {
    if (!u.alive) return 0;
    if (u.side === "monster" && u.dormant) return 0;
    let amt = raw;
    if (u.side === "hero") {
      if (type === "phys" || type === "crush") amt = Math.max(1, amt - u.armor);
      if (u.st.frozen > 0) amt *= this.relics.has("frostbite") ? 2 : 1.5;
      if (u.st.vuln > 0) amt *= 1.35;
      if (u.st.hex > 0) amt *= u.hexMul;
      if (u.st.fear > 0 && this.relics.has("haunted")) amt *= 1.25;
      // A templar's shield covers the allies around him (not himself).
      if (
        this.heroes.some(
          (t) =>
            t !== u &&
            t.cls === "templar" &&
            t.alive &&
            t.state !== "falling" &&
            this.d2(t.x, t.y, u.x, u.y) <= 2.05,
        )
      )
        amt *= 0.75;
      if (type === "fire" && this.mutators.has("fireproof")) amt *= 0.5;
      if (type === "poison" && this.relics.has("venom")) amt *= 2;
      if (this.relics.has("lastStand") && this.hoard * 2 < this.hoardMax)
        amt *= 1.3;
      if (isChampion(u.cls) && type === "crush") amt *= 0.7;
      if (this.relics.has("huntersMark") && (u.elite || isChampion(u.cls)))
        amt *= 1.25;
      if (
        this.setup.mods.arch === "alchemist" &&
        (type === "fire" || type === "poison")
      )
        amt *= 1.3;
      u.lastSource = source;
      u.lastType = type;
      this.stats.damage[source] =
        (this.stats.damage[source] ?? 0) + Math.min(amt, u.hp);
    } else if (this.relics.has("stoneskin")) amt *= 0.8;
    amt = Math.round(amt);
    if (amt <= 0) return 0;
    const dealt = Math.min(amt, u.hp);
    u.hp -= amt;
    u.lastHit = this.tick;
    this.emit({
      k: "hit",
      uid: u.uid,
      x: u.x,
      y: u.y,
      amount: amt,
      dtype: type,
      crit: crit || amt >= 40,
      hero: u.side === "hero",
    });
    if (u.hp <= 0) {
      u.hp = 0;
      if (u.side === "hero") this.killHero(u);
      else this.killMonster(u);
    }
    return dealt;
  }
  /** A monster's blow lands: life drain from wraiths and Blood Pact. */
  private monsterHit(
    m: Monster,
    target: Hero,
    dmg: number,
    type: DmgType,
    source: string,
  ) {
    const dealt = this.damage(target, dmg, type, source);
    const drain =
      (m.kind === "wraith" ? 0.5 : 0) + (this.relics.has("vampiric") ? 0.3 : 0);
    if (drain > 0 && dealt > 0 && m.alive && m.hp < m.maxHp)
      m.hp = Math.min(m.maxHp, m.hp + Math.max(1, Math.round(dealt * drain)));
  }
  private killHero(h: Hero) {
    h.alive = false;
    h.state = "dead";
    h.hop = null;
    const d = HEROES[h.cls];
    if (this.tick - this.lastKill <= s(2.5)) this.combo++;
    else this.combo = 1;
    this.lastKill = this.tick;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    const big = h.elite || isChampion(h.cls);
    let gold = Math.round(
      d.bounty *
        (1 + 0.06 * (Math.min(this.setup.night, 20) - 1)) *
        (h.elite ? 1.5 : 1) *
        (big && this.relics.has("wanted") ? 3 : 1) *
        (this.mutators.has("rich") ? 1.5 : 1) *
        (h.revived ? 0.5 : 1),
    );
    // Soul Lanterns harvest the deaths around them.
    const lantern = this.traps.find(
      (t) =>
        t.kind === "lantern" &&
        !t.disabled &&
        t.jam <= 0 &&
        this.d2(t.obj.x + 0.5, t.obj.y + 0.5, h.x, h.y) <= 2.05,
    );
    if (lantern) {
      gold = Math.round(gold * (1 + 0.6 * this.tierMul("lantern")));
      this.addDread(2);
      lantern.active = true;
      lantern.tickT = s(0.6);
      this.emit({
        k: "soul",
        x: h.x,
        y: h.y,
        tx: lantern.obj.x + 0.5,
        ty: lantern.obj.y + 0.3,
      });
    }
    if (this.relics.has("bloodMoney")) gold += 4;
    if (this.relics.has("toll") && TRAP_KINDS.has(h.lastSource)) gold += 5;
    const comboGold =
      Math.max(0, this.combo - 1) * 3 * (this.relics.has("echoes") ? 2 : 1);
    gold += comboGold;
    this.gold += gold;
    this.addDread(2);
    const src = h.lastSource || "unknown";
    this.stats.kills[src] = (this.stats.kills[src] ?? 0) + 1;
    if (h.lastType === "fire") this.stats.fireKills++;
    if (src === "rockfall" || src === "chill") this.stats.powerKills++;
    if (isChampion(h.cls)) this.stats.champions.push(h.cls);
    if (this.relics.has("deathKnell")) {
      for (const o of this.livingHeroes()) {
        if (o !== h && this.d2(o.x, o.y, h.x, h.y) <= 2)
          o.st.stun = Math.max(o.st.stun, s(1));
      }
    }
    this.emit({
      k: "kill",
      uid: h.uid,
      x: h.x,
      y: h.y,
      cls: h.cls,
      gold,
      combo: this.combo,
    });
    if (h.loot > 0) {
      this.hoard = Math.min(this.hoardMax, this.hoard + h.loot);
      this.emit({ k: "recover", uid: h.uid, x: h.x, y: h.y, amount: h.loot });
      h.loot = 0;
    }
    // The Hollow King raises the fallen near him; Undying spares the first.
    if (!isChampion(h.cls) && !h.revived) {
      const king = this.livingHeroes().find(
        (k) => k.cls === "revenant" && this.d2(k.x, k.y, h.x, h.y) <= 3.5,
      );
      if (king && this.riseCharges > 0) {
        this.riseCharges--;
        h.reviveT = s(1.6);
        h.revived = true;
        return;
      }
      if (this.mutators.has("undying") && !this.undyingUsed) {
        this.undyingUsed = true;
        h.reviveT = s(1.6);
        h.revived = true;
        return;
      }
    }
    for (const m of this.monsters) {
      if (m.alive && m.kind === "necro" && this.d2(m.x, m.y, h.x, h.y) <= 3.5) {
        const minions = this.monsters.filter(
          (q) =>
            (q.alive || q.reformT > 0) &&
            q.kind === "risen" &&
            q.pieceId === m.uid,
        ).length;
        if (minions < 3) {
          const r = this.makeMonster(
            "risen",
            Math.floor(h.x) + 0.5,
            Math.floor(h.y) + 0.5,
            this.setup.mods.tiers.necro ?? 1,
          );
          r.pieceId = m.uid;
          r.reformT = s(1);
          r.alive = false;
          r.hp = r.maxHp;
          this.emit({ k: "raise", x: r.x, y: r.y });
          break;
        }
      }
    }
  }
  private killMonster(m: Monster) {
    m.alive = false;
    if (this.relics.has("spite")) {
      this.emit({ k: "spite", x: m.x, y: m.y });
      for (const h of this.livingHeroes())
        if (!h.hop && this.d2(h.x, h.y, m.x, m.y) <= 1.3)
          this.damage(h, 20, "magic", "spite");
    }
    if (m.reforms > 0) {
      m.reforms--;
      m.reformT = s(4);
      this.emit({ k: "mdeath", uid: m.uid, x: m.x, y: m.y, kind: "bones" });
      return;
    }
    m.reformT = 0;
    this.emit({ k: "mdeath", uid: m.uid, x: m.x, y: m.y, kind: m.kind });
    if (m.kind === "slime") {
      for (const off of [-0.25, 0.25]) {
        const c = this.makeMonster(
          "minislime",
          m.x + off,
          m.y,
          this.setup.mods.tiers.slime ?? 1,
        );
        c.homeX = m.homeX;
        c.homeY = m.homeY;
      }
      this.emit({ k: "split", x: m.x, y: m.y });
    }
  }
  private addDread(n: number) {
    this.dread = Math.min(
      this.dreadMax,
      this.dread + n * (this.relics.has("grimTithe") ? 1.5 : 1),
    );
  }

  /** A fallen hero stands up again at half health. */
  private rise(h: Hero) {
    h.alive = true;
    h.hp = Math.max(1, Math.round(h.maxHp * 0.5));
    h.st = noStatus();
    h.state = this.retreating ? "escape" : "seek";
    h.next = null;
    h.hop = null;
    h.target = -1;
    h.atkT = s(0.6);
    this.emit({ k: "rise", uid: h.uid, x: h.x, y: h.y });
  }
  /** Drop a hero back to the entrance (trapdoor, sinkhole). */
  private dropHero(h: Hero) {
    this.emit({ k: "fall", uid: h.uid, x: h.x, y: h.y });
    this.stats.falls++;
    if (h.loot > 0) {
      this.hoard = Math.min(this.hoardMax, this.hoard + h.loot);
      this.emit({
        k: "recover",
        uid: h.uid,
        x: h.x,
        y: h.y,
        amount: h.loot,
      });
      h.loot = 0;
      if (h.state === "escape" && !this.retreating) h.state = "seek";
    }
    h.state = "falling";
    h.actT = s(1.1);
    h.next = null;
    h.hop = null;
    h.target = -1;
  }

  // ---------- player powers ----------
  cast(power: PowerId, x: number, y: number, cost: number) {
    if (this.dread < cost) return false;
    this.dread -= cost;
    this.commands.push({ tick: this.tick, power, x, y });
    this.pendingPowers.push({
      power,
      x,
      y,
      t: power === "rockfall" ? s(0.6) : 0,
    });
    this.emit({ k: "power", power, x, y, phase: "warn" });
    return true;
  }
  private resolvePower(p: { power: PowerId; x: number; y: number }) {
    this.emit({ k: "power", power: p.power, x: p.x, y: p.y, phase: "hit" });
    if (p.power === "rockfall") {
      for (const h of this.livingHeroes()) {
        if (
          Math.abs(Math.floor(h.x) - p.x) <= 1 &&
          Math.abs(Math.floor(h.y) - p.y) <= 1
        ) {
          this.damage(h, 40, "crush", "rockfall");
          if (h.alive) h.st.stun = Math.max(h.st.stun, s(1.2));
        }
      }
    } else if (p.power === "shriek") {
      for (const h of this.livingHeroes()) {
        if (this.d2(h.x, h.y, p.x + 0.5, p.y + 0.5) <= 2.6)
          this.frighten(h, 2.6);
      }
    } else if (p.power === "chill") {
      for (const h of this.livingHeroes()) {
        if (this.d2(h.x, h.y, p.x + 0.5, p.y + 0.5) <= 2.6) {
          this.damage(h, 8, "magic", "chill");
          if (h.alive) h.st.slow = Math.max(h.st.slow, s(4));
        }
      }
    } else if (p.power === "sinkhole") {
      if (!walkable(this.layout, p.x, p.y)) return;
      const l = this.layout;
      if (
        (p.x === l.entrance.x && p.y === l.entrance.y) ||
        (p.x === l.hoard.x && p.y === l.hoard.y)
      )
        return;
      this.pits.push({ x: p.x, y: p.y, t: s(4) });
      this.emit({ k: "pit", x: p.x, y: p.y, open: true });
    }
  }
  private updatePits() {
    if (!this.pits.length) return;
    for (const pit of this.pits) {
      pit.t--;
      for (const h of this.livingHeroes()) {
        if (h.hop || h.cls === "windcaller") continue;
        if (Math.floor(h.x) !== pit.x || Math.floor(h.y) !== pit.y) continue;
        h.lastSource = "sinkhole";
        this.dropHero(h);
      }
      if (pit.t <= 0) this.emit({ k: "pit", x: pit.x, y: pit.y, open: false });
    }
    this.pits = this.pits.filter((p) => p.t > 0);
  }
  /** Stormcaller: lightning finds the hero nearest the hoard. */
  private stormcall() {
    const field = this.hoardField();
    let best: Hero | null = null;
    let bd = Infinity;
    for (const h of this.livingHeroes()) {
      const tile = this.tileOf(h);
      const d =
        field[idx(this.layout, tile.x, tile.y)] - (h.loot > 0 ? 1000 : 0);
      if (d < bd) {
        bd = d;
        best = h;
      }
    }
    if (!best) return;
    this.emit({
      k: "strike",
      fx: best.x,
      fy: best.y - 4,
      x: best.x,
      y: best.y,
    });
    this.damage(best, 30, "magic", "stormcall");
  }
  private homeward(h: Hero): HeroState {
    return this.retreating || h.loot > 0 ? "escape" : "seek";
  }
  private fearless(h: Hero) {
    return (
      FEARLESS.includes(h.cls) || h.st.insp > 0 || this.mutators.has("zealots")
    );
  }
  private frighten(h: Hero, sec: number) {
    if (!h.alive || this.fearless(h)) return;
    if (h.st.fear <= 0) this.emit({ k: "fear", uid: h.uid, x: h.x, y: h.y });
    if (this.relics.has("haunted")) sec *= 1.5;
    h.st.fear = Math.max(h.st.fear, s(sec));
    if (
      h.state === "loot" ||
      h.state === "lure" ||
      h.state === "disarm" ||
      h.state === "dig" ||
      h.state === "throw"
    )
      h.state = this.homeward(h);
  }

  // ---------- main step ----------
  step() {
    if (this.finished) return;
    this.tick++;
    for (const u of [...this.heroes, ...this.monsters]) {
      u.px = u.x;
      u.py = u.y;
    }
    for (const p of this.projectiles) {
      p.px = p.x;
      p.py = p.y;
    }
    // Passive dread.
    if (this.tick % s(2) === 0) this.addDread(1);

    // Spawns.
    for (const h of this.heroes) {
      if (!h.spawned && this.tick >= h.spawnTick) {
        h.spawned = true;
        h.alive = true;
        this.emit({ k: "spawn", uid: h.uid, x: h.x, y: h.y });
      }
      if (h.reviveT > 0 && h.state === "dead") {
        h.reviveT--;
        if (h.reviveT === 0) this.rise(h);
      }
    }
    // Retreat horn.
    if (!this.retreating && this.tick >= s(RAID_RETREAT_AT)) {
      this.retreating = true;
      this.emit({ k: "retreat" });
      for (const h of this.livingHeroes())
        if (h.state !== "falling") h.state = "escape";
    }

    // Powers.
    for (const p of this.pendingPowers) p.t--;
    const ready = this.pendingPowers.filter((p) => p.t <= 0);
    this.pendingPowers = this.pendingPowers.filter((p) => p.t > 0);
    for (const p of ready) this.resolvePower(p);
    this.updatePits();
    if (this.relics.has("stormcall") && this.tick % s(8) === 0)
      this.stormcall();

    this.updateTraps();
    for (const h of this.heroes)
      if (h.alive || h.state === "falling") this.updateHero(h);
    for (const m of this.monsters) this.updateMonster(m);
    this.updateProjectiles();
    this.updateFire();

    const allSpawned = this.heroes.every((h) => h.spawned);
    const anyActive = this.heroes.some(
      (h) => h.alive || h.state === "falling" || h.reviveT > 0,
    );
    if ((allSpawned && !anyActive) || this.tick >= s(RAID_HARD_LIMIT)) {
      for (const h of this.heroes) {
        if (h.alive) {
          h.alive = false;
          h.state = "escaped";
          if (h.loot > 0)
            this.emit({ k: "stolen", uid: h.uid, amount: h.loot });
        }
      }
      this.finished = true;
    }
  }

  result(): RaidResult {
    return {
      fireKills: this.stats.fireKills,
      powerKills: this.stats.powerKills,
      falls: this.stats.falls,
      champions: this.stats.champions,
      killed: this.heroes.filter((h) => h.state === "dead").length,
      escaped: this.heroes.filter((h) => h.state === "escaped").length,
      stolen: Math.max(0, this.hoardStart - this.hoard),
      touchedHoard: this.heroes.some((h) => h.touchedHoard),
      gold: this.gold,
      bestCombo: this.bestCombo,
      kills: this.stats.kills,
      damage: this.stats.damage,
      seconds: this.tick * TICK,
    };
  }

  // ---------- traps ----------
  private heroesOnTile(x: number, y: number) {
    return this.livingHeroes().filter(
      (h) => !h.hop && Math.floor(h.x) === x && Math.floor(h.y) === y,
    );
  }
  private laneTiles(x: number, y: number, dir: number, max: number) {
    const out: { x: number; y: number }[] = [];
    let cx = x;
    let cy = y;
    for (let i = 0; i < max; i++) {
      cx += DX[dir];
      cy += DY[dir];
      if (!walkable(this.layout, cx, cy)) break;
      out.push({ x: cx, y: cy });
    }
    return out;
  }
  private updateTraps() {
    for (const t of this.traps) {
      if (t.cd > 0) t.cd--;
      if (t.disabled) {
        t.active = false;
        t.warn = false;
        continue;
      }
      if (t.jam > 0) {
        // Jinxed by the Witch Queen: frozen mid-cycle until the hex fades.
        t.jam--;
        // A rolling boulder halts mid-lane and rolls on when the hex fades.
        if (t.kind !== "boulder") t.active = false;
        t.warn = false;
        continue;
      }
      if (t.kind === "lantern") {
        if (t.tickT > 0) t.tickT--;
        else t.active = false;
        continue;
      }
      const o = t.obj;
      const mul = this.tierMul(t.kind);
      switch (t.kind) {
        case "flame": {
          t.phase += TICK;
          if (t.phase >= 4) t.phase -= 4;
          const wasActive = t.active;
          t.warn = t.phase >= 2.2 && t.phase < 3;
          t.active = t.phase >= 3;
          if (t.active && !wasActive) {
            this.emit({ k: "trap", kind: "flame", x: o.x, y: o.y, dir: o.dir });
            t.tickT = 0;
          }
          if (t.active) {
            if (t.tickT <= 0) {
              t.tickT = s(0.25);
              const tiles = this.laneTiles(
                o.x,
                o.y,
                o.dir,
                this.relics.has("bonfire") ? 4 : 3,
              );
              for (const tile of tiles) {
                this.igniteAt(tile.x, tile.y);
                for (const h of this.heroesOnTile(tile.x, tile.y)) {
                  this.damage(h, 9 * mul, "fire", "flame");
                  if (h.alive) this.burn(h, 2, "flame");
                  this.mark(t);
                }
              }
            }
            t.tickT--;
          }
          break;
        }
        case "gas": {
          t.phase += TICK;
          if (t.phase >= 5) t.phase -= 5;
          const was = t.active;
          t.warn = t.phase >= 1.9 && t.phase < 2.5;
          t.active = t.phase >= 2.5;
          if (t.active && !was) {
            this.emit({ k: "trap", kind: "gas", x: o.x, y: o.y, dir: 0 });
            t.tickT = 0;
          }
          if (t.active) {
            if (t.tickT <= 0) {
              t.tickT = s(0.5);
              for (const h of this.livingHeroes()) {
                if (this.d2(h.x, h.y, o.x + 0.5, o.y + 0.5) <= 1.6) {
                  this.damage(h, 4 * mul, "poison", "gas");
                  h.st.poison = Math.max(h.st.poison, s(3));
                  this.mark(t);
                }
              }
            }
            t.tickT--;
          }
          break;
        }
        case "saw": {
          // Track = contiguous walkable tiles along the axis through the saw.
          const horizontal = o.dir % 2 === 1;
          const ax = horizontal ? 1 : 0;
          const ay = horizontal ? 0 : 1;
          let lo = 0;
          let hi = 0;
          while (
            walkable(this.layout, o.x - ax * (lo + 1), o.y - ay * (lo + 1)) &&
            lo < 12
          )
            lo++;
          while (
            walkable(this.layout, o.x + ax * (hi + 1), o.y + ay * (hi + 1)) &&
            hi < 12
          )
            hi++;
          t.pos += t.sawDir * 2.6 * TICK;
          if (t.pos > hi) {
            t.pos = hi;
            t.sawDir = -1;
          }
          if (t.pos < -lo) {
            t.pos = -lo;
            t.sawDir = 1;
          }
          t.active = true;
          const sx = o.x + 0.5 + ax * t.pos;
          const sy = o.y + 0.5 + ay * t.pos;
          if (t.tickT > 0) t.tickT--;
          for (const h of this.livingHeroes()) {
            if (h.hop) continue;
            if (this.d2(h.x, h.y, sx, sy) < 0.6) {
              const key = h.uid * 1000 + Math.floor(this.tick / s(0.4));
              if (!t.hitSet.includes(key)) {
                t.hitSet.push(key);
                if (t.hitSet.length > 40) t.hitSet.shift();
                this.damage(
                  h,
                  12 * mul * (this.relics.has("sharpIron") ? 1.4 : 1),
                  "phys",
                  "saw",
                );
                this.mark(t);
                if (t.tickT <= 0) {
                  this.emit({
                    k: "trap",
                    kind: "saw",
                    x: sx,
                    y: sy,
                    dir: o.dir,
                  });
                  t.tickT = s(0.3);
                }
              }
            }
          }
          break;
        }
        case "darts": {
          if (t.cd > 0) break;
          const lane = this.laneTiles(o.x, o.y, o.dir, 6);
          const seen =
            lane.some((tile) => this.heroesOnTile(tile.x, tile.y).length > 0) ||
            this.heroesOnTile(o.x, o.y).length > 0;
          if (seen) {
            t.cd = this.rearm(1.1);
            const dmg = 14 * mul * (this.relics.has("sharpIron") ? 1.4 : 1);
            this.spawnProjectile(
              "dart",
              o.x + 0.5,
              o.y + 0.5,
              DX[o.dir] * 12,
              DY[o.dir] * 12,
              -1,
              dmg,
              "phys",
              false,
              0,
              "darts",
            );
            this.emit({ k: "trap", kind: "darts", x: o.x, y: o.y, dir: o.dir });
          }
          break;
        }
        case "boulder": {
          if (t.used && !t.active && t.armT === 0) break;
          if (!t.active && t.armT === 0) {
            const lane = this.laneTiles(o.x, o.y, o.dir, 8);
            if (
              lane.some((tile) => this.heroesOnTile(tile.x, tile.y).length > 0)
            ) {
              t.armT = s(0.35);
              t.used = true;
              this.emit({
                k: "trap",
                kind: "boulder",
                x: o.x,
                y: o.y,
                dir: o.dir,
              });
            }
          } else if (t.armT > 0) {
            t.armT--;
            if (t.armT === 0) {
              t.active = true;
              t.pos = 0;
            }
          } else if (t.active) {
            t.pos += 6.5 * TICK;
            const bx = o.x + 0.5 + DX[o.dir] * t.pos;
            const by = o.y + 0.5 + DY[o.dir] * t.pos;
            for (const h of this.livingHeroes()) {
              if (
                !t.hitSet.includes(h.uid) &&
                this.d2(h.x, h.y, bx, by) < 0.65
              ) {
                t.hitSet.push(h.uid);
                this.damage(h, 75 * mul, "crush", "boulder");
                this.mark(t);
              }
            }
            const nx = Math.floor(bx + DX[o.dir] * 0.5);
            const ny = Math.floor(by + DY[o.dir] * 0.5);
            if (!walkable(this.layout, nx, ny)) {
              t.active = false;
              this.emit({ k: "boulderEnd", x: bx, y: by });
            }
          }
          break;
        }
        case "pylon": {
          t.active = false;
          if (t.phase < 3)
            t.phase += this.relics.has("quickHands") ? TICK / 0.65 : TICK;
          t.warn = t.phase >= 2.3;
          if (t.phase < 3) break;
          const cx = o.x + 0.5;
          const cy = o.y + 0.5;
          let first: Hero | null = null;
          let bd = 2.6;
          for (const h of this.livingHeroes()) {
            if (h.hop) continue;
            const d = this.d2(h.x, h.y, cx, cy);
            if (d <= bd && lineOfSight(this.layout, cx, cy, h.x, h.y)) {
              first = h;
              bd = d;
            }
          }
          if (!first) break;
          t.phase = 0;
          t.active = true;
          t.warn = false;
          this.mark(t);
          const chain: Hero[] = [first];
          while (chain.length < 3) {
            const last = chain[chain.length - 1];
            let next: Hero | null = null;
            let nd = 2.2;
            for (const h of this.livingHeroes()) {
              if (h.hop || chain.includes(h)) continue;
              const d = this.d2(h.x, h.y, last.x, last.y);
              if (d <= nd) {
                next = h;
                nd = d;
              }
            }
            if (!next) break;
            chain.push(next);
          }
          this.emit({ k: "trap", kind: "pylon", x: o.x, y: o.y, dir: 0 });
          this.emit({
            k: "zap",
            pts: [
              { x: cx, y: cy - 0.5 },
              ...chain.map((h) => ({ x: h.x, y: h.y - 0.4 })),
            ],
          });
          for (const h of chain) this.damage(h, 16 * mul, "magic", "pylon");
          break;
        }
        case "crusher": {
          t.phase += TICK / this.rearmMul();
          t.warn = t.phase >= 2.4;
          t.active = false;
          if (t.phase < 3) break;
          t.phase = 0;
          t.warn = false;
          t.active = true;
          const ahead = this.laneTiles(o.x, o.y, o.dir, 1)[0];
          if (!ahead) break;
          this.emit({
            k: "trap",
            kind: "crusher",
            x: ahead.x,
            y: ahead.y,
            dir: o.dir,
          });
          for (const h of this.heroesOnTile(ahead.x, ahead.y)) {
            this.damage(h, 45 * mul, "crush", "crusher");
            if (h.alive)
              h.st.stun = Math.max(h.st.stun, s(isChampion(h.cls) ? 0.5 : 1));
            this.mark(t);
          }
          break;
        }
        case "totem": {
          t.active = false;
          if (this.tick % 5 !== 0) break;
          const cx = o.x + 0.5;
          const cy = o.y + 0.5;
          const hexMul = 1 + 0.2 * mul;
          for (const h of this.livingHeroes()) {
            if (this.d2(h.x, h.y, cx, cy) > 2.05) continue;
            h.st.hex = Math.max(h.st.hex, s(0.5));
            h.hexMul = hexMul;
            t.active = true;
          }
          break;
        }
        case "keg": {
          if (t.used) break;
          if (t.fuse < 0) {
            for (const h of this.livingHeroes()) {
              if (!h.hop && this.d2(h.x, h.y, o.x + 0.5, o.y + 0.5) < 1.0) {
                t.fuse = s(0.6);
                this.emit({ k: "trap", kind: "keg", x: o.x, y: o.y, dir: 0 });
                break;
              }
            }
          } else if (t.fuse > 0) {
            t.fuse--;
            if (t.fuse === 0) this.explodeKeg(t);
          }
          break;
        }
        default:
          break;
      }
    }
  }
  private explodeKeg(t: TrapState) {
    if (t.used) return;
    t.used = true;
    t.fuse = -2;
    const cx = t.obj.x + 0.5;
    const cy = t.obj.y + 0.5;
    const caps = this.relics.has("blastCaps");
    const r = caps ? 2.4 : 1.7;
    this.emit({ k: "explode", x: cx, y: cy, r });
    for (const h of this.livingHeroes()) {
      if (this.d2(h.x, h.y, cx, cy) <= r)
        this.damage(
          h,
          55 * this.tierMul("keg") * (caps ? 1.5 : 1),
          "crush",
          "keg",
        );
    }
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        this.igniteAt(t.obj.x + dx, t.obj.y + dy);
    for (const o of this.traps) {
      if (
        o.kind === "keg" &&
        !o.used &&
        o.fuse < 0 &&
        this.d2(o.obj.x, o.obj.y, t.obj.x, t.obj.y) <= 2.3
      )
        o.fuse = s(0.25);
    }
  }
  /** Fire reaching a tile: lights tar, sets off kegs. */
  private igniteAt(x: number, y: number) {
    if (!inside(this.layout, x, y)) return;
    const t = this.trapAt(x, y);
    if (!t || t.disabled || t.jam > 0) return;
    if (t.kind === "tar") {
      const k = idx(this.layout, x, y);
      if (!this.tarFire.has(k) && !this.tarCool.has(k)) {
        this.tarFire.set(k, this.relics.has("emberHeart") ? 8 : 4);
        this.emit({ k: "ignite", x, y });
      }
    } else if (t.kind === "keg" && !t.used && t.fuse < 0) {
      t.fuse = s(0.2);
    }
  }
  private updateFire() {
    const l = this.layout;
    for (const [k, v] of [...this.tarCool]) {
      if (v - TICK <= 0) this.tarCool.delete(k);
      else this.tarCool.set(k, v - TICK);
    }
    for (const [k, v] of [...this.tarFire]) {
      const x = k % l.w;
      const y = (k - x) / l.w;
      const left = v - TICK;
      // Spread to adjacent tar half a second after catching.
      const full = this.relics.has("emberHeart") ? 8 : 4;
      if (v > full - 0.5 && left <= full - 0.5)
        for (let d = 0; d < 4; d++) this.igniteAt(x + DX[d], y + DY[d]);
      if (this.tick % s(0.5) === 0) {
        for (const h of this.heroesOnTile(x, y)) {
          this.damage(h, 7 * this.tierMul("tar"), "fire", "tar");
          if (h.alive) this.burn(h, 2, "tar");
        }
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const kt = this.trapAt(x + dx, y + dy);
            if (kt && kt.kind === "keg" && !kt.used && kt.fuse < 0)
              kt.fuse = s(0.3);
          }
      }
      if (left <= 0) {
        this.tarFire.delete(k);
        this.tarCool.set(k, 3);
      } else this.tarFire.set(k, left);
    }
  }

  /** Sapper: wreck the most dangerous trap in sight. */
  private findBombTarget(h: Hero) {
    let best: TrapState | null = null;
    let bv = 0;
    for (const t of this.traps) {
      if (t.disabled || t.kind === "lure" || (t.kind === "keg" && t.used))
        continue;
      const cx = t.obj.x + 0.5;
      const cy = t.obj.y + 0.5;
      if (this.d2(h.x, h.y, cx, cy) > 3.5) continue;
      if (!lineOfSight(this.layout, h.x, h.y, cx, cy)) continue;
      const v = PIECES[t.kind].cost * this.tierMul(t.kind);
      if (v > bv) {
        bv = v;
        best = t;
      }
    }
    return best;
  }
  /** A hero arrives on a tile center (or lands). Floor triggers fire here. */
  private onEnter(h: Hero, x: number, y: number) {
    const t = this.trapAt(x, y);
    if (!t || t.disabled || t.jam > 0 || t.cd > 0 || !h.alive) return;
    const mul = this.tierMul(t.kind);
    if (FLOOR_PLATES.includes(t.kind)) {
      // Windcallers drift over floor plates without setting them off.
      if (h.cls === "windcaller") return;
      // Grukk's boots break whatever he steps on (spikes still bite once).
      if (h.cls === "warlord") {
        if (t.kind === "spikes")
          this.damage(
            h,
            30 * mul * (this.relics.has("sharpIron") ? 1.4 : 1),
            "phys",
            "spikes",
          );
        t.disabled = true;
        this.dirty = true;
        this.emit({ k: "smash", x, y });
        return;
      }
    }
    switch (t.kind) {
      case "spikes":
        t.cd = this.relics.has("ironMaiden") ? s(0.25) : this.rearm(1.8);
        this.mark(t);
        this.emit({ k: "trap", kind: "spikes", x, y, dir: 0 });
        this.damage(
          h,
          30 * mul * (this.relics.has("sharpIron") ? 1.4 : 1),
          "phys",
          "spikes",
        );
        break;
      case "frost":
        t.cd = this.rearm(6);
        this.mark(t);
        this.emit({ k: "trap", kind: "frost", x, y, dir: 0 });
        h.st.frozen = s(isChampion(h.cls) ? 1 : 2 * (0.8 + 0.2 * mul));
        this.emit({ k: "freeze", uid: h.uid, x: h.x, y: h.y });
        this.damage(h, 6 * mul, "magic", "frost");
        break;
      case "trapdoor": {
        t.cd = this.rearm(5);
        this.mark(t);
        this.emit({ k: "trap", kind: "trapdoor", x, y, dir: 0 });
        h.lastSource = "trapdoor";
        this.dropHero(h);
        break;
      }
      case "spring": {
        if (UNSHAKABLE.includes(h.cls)) return;
        t.cd = this.rearm(1.5);
        this.mark(t);
        this.emit({ k: "trap", kind: "spring", x, y, dir: t.obj.dir });
        let tx = x;
        let ty = y;
        for (let i = 0; i < 3; i++) {
          if (!walkable(this.layout, tx + DX[t.obj.dir], ty + DY[t.obj.dir]))
            break;
          tx += DX[t.obj.dir];
          ty += DY[t.obj.dir];
        }
        if (tx !== x || ty !== y) this.hopTo(h, tx, ty, 0.45, 1.2);
        break;
      }
      case "beartrap": {
        t.cd = this.rearm(6);
        this.mark(t);
        this.emit({ k: "trap", kind: "beartrap", x, y, dir: 0 });
        this.emit({ k: "snap", uid: h.uid, x: h.x, y: h.y });
        this.damage(
          h,
          26 * mul * (this.relics.has("ironJaws") ? 1.5 : 1),
          "phys",
          "beartrap",
        );
        if (h.alive)
          h.st.stun = Math.max(h.st.stun, s(isChampion(h.cls) ? 1 : 2.5));
        break;
      }
      case "keg":
        break;
      default:
        break;
    }
  }
  private hopTo(
    u: Hero | Monster,
    tx: number,
    ty: number,
    dur: number,
    height: number,
  ) {
    // Being thrown interrupts looting, disarming, digging and bombing.
    if (
      u.side === "hero" &&
      (u.state === "loot" ||
        u.state === "lure" ||
        u.state === "disarm" ||
        u.state === "dig" ||
        u.state === "throw")
    )
      u.state = this.homeward(u);
    u.hop = {
      fx: u.x,
      fy: u.y,
      tx: tx + 0.5,
      ty: ty + 0.5,
      t: 0,
      dur: s(dur),
      h: height,
    };
    u.next = null;
  }

  // ---------- heroes ----------
  private updateHero(h: Hero) {
    const st = h.st;
    for (const key of [
      "burn",
      "poison",
      "frozen",
      "slow",
      "fear",
      "vuln",
      "stun",
      "insp",
      "hex",
      "veil",
    ] as const)
      if (st[key] > 0) st[key]--;
    if (h.state === "falling") {
      h.actT--;
      if (h.actT <= 0) {
        const e = this.layout.entrance;
        h.x = h.px = e.x + 0.5;
        h.y = h.py = e.y + 0.5;
        h.state = this.retreating ? "escape" : "seek";
        h.hop = null;
        h.next = null;
        this.emit({ k: "land", uid: h.uid, x: h.x, y: h.y });
        this.damage(
          h,
          this.relics.has("despair") ? 35 : 12,
          "crush",
          h.lastSource === "sinkhole" ? "sinkhole" : "trapdoor",
        );
      }
      return;
    }
    // DoTs.
    if (this.tick % s(0.5) === 0) {
      if (st.burn > 0) this.damage(h, 4, "fire", h.burnSrc);
      if (st.poison > 0 && h.alive) this.damage(h, 3, "poison", "gas");
      if (!h.alive) return;
    }
    // Nyx the Shade: a veil every 8s hides her from monsters.
    if (h.cls === "shade" && h.skillT <= 0 && !h.hop) {
      h.skillT = s(8);
      st.veil = s(3);
      this.emit({ k: "veil", uid: h.uid, x: h.x, y: h.y });
      for (const m of this.monsters) if (m.target === h.uid) m.target = -1;
    }
    // Paladin aura.
    if (h.cls === "paladin" && this.tick % s(1) === 0) {
      for (const a of this.livingHeroes()) {
        if (a !== h && a.hp < a.maxHp && this.d2(a.x, a.y, h.x, h.y) <= 2.5)
          this.heal(a, 5 * this.healMul());
      }
    }
    // Bard: inspire allies nearby.
    if (h.cls === "bard" && this.tick % s(1) === 0) {
      const dur = s(this.mutators.has("blessed") ? 2 : 1.3);
      let any = false;
      for (const a of this.livingHeroes()) {
        if (this.d2(a.x, a.y, h.x, h.y) > 2.5) continue;
        a.st.insp = Math.max(a.st.insp, dur);
        a.st.fear = 0;
        if (a !== h) any = true;
      }
      if (any) this.emit({ k: "inspire", uid: h.uid, x: h.x, y: h.y });
    }
    if (h.skillT > 0) h.skillT--;
    // Warlord: a war cry every 8s rallies the party.
    if (h.cls === "warlord" && h.skillT <= 0 && !h.hop) {
      h.skillT = s(8);
      this.emit({ k: "warcry", uid: h.uid, x: h.x, y: h.y });
      const dur = s(this.mutators.has("blessed") ? 4.5 : 3);
      for (const a of this.livingHeroes()) {
        if (this.d2(a.x, a.y, h.x, h.y) > 3.2) continue;
        a.st.insp = Math.max(a.st.insp, dur);
        a.st.fear = 0;
      }
    }
    // The Witch Queen jinxes the traps around her.
    if (h.cls === "witch" && h.skillT <= 0 && !h.hop) {
      const hit = this.traps.filter(
        (t) =>
          !t.disabled &&
          t.kind !== "lure" &&
          !(t.kind === "keg" && t.used) &&
          this.d2(t.obj.x + 0.5, t.obj.y + 0.5, h.x, h.y) <= 3.05,
      );
      if (hit.length) {
        h.skillT = s(8);
        h.lastAtk = this.tick;
        for (const t of hit) t.jam = Math.max(t.jam, s(4));
        this.emit({
          k: "jinx",
          uid: h.uid,
          x: h.x,
          y: h.y,
          pts: hit.map((t) => ({ x: t.obj.x + 0.5, y: t.obj.y + 0.5 })),
        });
      }
    }
    // Airborne (spring / knockback).
    if (h.hop) {
      const hp = h.hop;
      hp.t++;
      const k = Math.min(1, hp.t / hp.dur);
      h.x = hp.fx + (hp.tx - hp.fx) * k;
      h.y = hp.fy + (hp.ty - hp.fy) * k;
      if (k >= 1) {
        h.hop = null;
        this.emit({ k: "land", uid: h.uid, x: h.x, y: h.y });
        this.onEnter(h, Math.floor(h.x), Math.floor(h.y));
      }
      return;
    }
    if (st.frozen > 0 || st.stun > 0) return;
    if (h.atkT > 0) h.atkT--;

    // Timed actions.
    if (
      h.state === "loot" ||
      h.state === "lure" ||
      h.state === "disarm" ||
      h.state === "dig" ||
      h.state === "throw"
    ) {
      h.actT--;
      if (h.actT > 0) return;
      if (h.state === "throw") {
        h.bombs--;
        h.state = this.homeward(h);
        const t = this.trapAt(h.actX, h.actY);
        if (t && !t.disabled) {
          const cx = t.obj.x + 0.5;
          const cy = t.obj.y + 0.5;
          this.emit({ k: "bomb", uid: h.uid, fx: h.x, fy: h.y, x: cx, y: cy });
          if (t.kind === "keg" && !t.used) this.explodeKeg(t);
          else {
            t.disabled = true;
            this.dirty = true;
          }
          for (const m of this.monsters) {
            if (m.alive && !m.hidden && this.d2(m.x, m.y, cx, cy) <= 1.3)
              this.damage(m, 25, "crush", "sapper");
          }
        }
        return;
      }
      if (h.state === "loot") {
        const take = Math.min(
          HEROES[h.cls].loot + (this.mutators.has("thieves") ? 1 : 0),
          this.hoard,
        );
        h.loot = take;
        this.hoard -= take;
        h.state = "escape";
        if (take > 0)
          this.emit({ k: "loot", uid: h.uid, x: h.x, y: h.y, amount: take });
        if (take > 0 && this.relics.has("thornCrown"))
          this.damage(h, 40, "crush", "thornCrown");
      } else if (h.state === "lure") {
        h.lureDone = true;
        h.state = this.homeward(h);
        const t = this.trapAt(h.actX, h.actY);
        if (t && !t.used) {
          t.used = true;
          if (this.relics.has("cursedGold")) h.st.vuln = s(6);
          this.emit({ k: "lure", x: h.actX, y: h.actY, uid: h.uid });
        }
      } else if (h.state === "disarm") {
        const t = this.trapAt(h.actX, h.actY);
        if (t && !t.disabled) {
          t.disabled = true;
          this.dirty = true;
          this.emit({ k: "disarm", x: h.actX, y: h.actY, uid: h.uid });
        }
        h.disarms--;
        h.state = this.homeward(h);
      } else if (h.state === "dig") {
        const k = idx(this.layout, h.actX, h.actY);
        if (
          this.layout.tiles[k] === T.Rock ||
          this.layout.tiles[k] === T.Vein
        ) {
          this.layout.tiles[k] = T.Floor;
          this.dirty = true;
          this.emit({ k: "dig", x: h.actX, y: h.actY, done: true });
        }
        h.digs--;
        h.state = this.homeward(h);
      }
      return;
    }

    // Druid: roots monsters nearby.
    if (h.cls === "druid" && h.skillT <= 0 && st.fear <= 0) {
      let any = false;
      for (const m of this.monsters) {
        if (!m.alive || m.hidden || m.dormant) continue;
        if (this.d2(m.x, m.y, h.x, h.y) > 2.5) continue;
        m.st.stun = Math.max(m.st.stun, s(2));
        any = true;
      }
      if (any) {
        h.skillT = s(6);
        h.lastAtk = this.tick;
        this.emit({ k: "root", uid: h.uid, x: h.x, y: h.y });
      }
    }
    // Sapper: bomb the most dangerous trap in sight.
    if (
      h.cls === "sapper" &&
      h.bombs > 0 &&
      st.fear <= 0 &&
      (h.state === "seek" || h.state === "escape")
    ) {
      const t = this.findBombTarget(h);
      if (t) {
        h.state = "throw";
        h.actT = s(0.9);
        h.actX = t.obj.x;
        h.actY = t.obj.y;
        h.lastAtk = this.tick;
        return;
      }
    }

    // Healing.
    if (h.cls === "cleric") {
      if (h.healT > 0) h.healT--;
      else {
        let best: Hero | null = null;
        for (const a of this.livingHeroes()) {
          if (a.hp >= a.maxHp - 8 && a.st.burn <= 0 && a.st.poison <= 0)
            continue;
          if (this.d2(a.x, a.y, h.x, h.y) > 3.5) continue;
          if (!best || a.hp / a.maxHp < best.hp / best.maxHp) best = a;
        }
        if (best) {
          this.heal(
            best,
            13 * (h.elite ? 1.4 : 1) * this.setup.mods.heroDmg * this.healMul(),
          );
          best.st.burn = 0;
          best.st.poison = 0;
          h.healT = s(2.6);
          h.lastAtk = this.tick;
        }
      }
    }

    // Detection.
    if (h.cls === "rogue" || h.cls === "ranger") {
      const r =
        (h.cls === "rogue" ? ROGUE_DETECT : RANGER_DETECT) *
        (this.relics.has("wardStones") ? 0.5 : 1);
      for (const t of this.traps) {
        if (t.known || t.disabled || t.kind === "lure") continue;
        if (this.d2(h.x, h.y, t.obj.x + 0.5, t.obj.y + 0.5) <= r) {
          t.known = true;
          this.dirty = true;
          this.emit({ k: "reveal", x: t.obj.x, y: t.obj.y });
        }
      }
    }

    const feared = st.fear > 0;
    // Combat (not while fleeing or veiled).
    if (!feared && st.veil <= 0) {
      const target = this.pickHeroTarget(h);
      if (target) {
        h.target = target.uid;
        const d = this.d2(h.x, h.y, target.x, target.y);
        if (d <= h.range) {
          this.heroAttack(h, target);
          return;
        }
        this.moveToward(
          h,
          Math.floor(target.x),
          Math.floor(target.y),
          this.fieldTo(Math.floor(target.x), Math.floor(target.y)),
        );
        return;
      }
      h.target = -1;
    }

    // Navigation.
    const cur = this.tileOf(h);
    const l = this.layout;
    if (feared) {
      this.moveToward(h, l.entrance.x, l.entrance.y, this.exitField());
      return;
    }
    if (
      h.cls === "archmage" &&
      h.skillT <= 0 &&
      (h.state === "escape" || h.state === "seek") &&
      this.atCenter(h) &&
      this.blink(h, h.state === "escape" ? this.exitField() : this.hoardField())
    )
      return;
    if (h.state === "escape") {
      if (
        cur.x === l.entrance.x &&
        cur.y === l.entrance.y &&
        this.atCenter(h)
      ) {
        // Phylactery: the first thief to reach the stairs drops the loot.
        if (
          h.loot > 0 &&
          this.relics.has("phylactery") &&
          !this.phylacteryUsed
        ) {
          this.phylacteryUsed = true;
          this.hoard = Math.min(this.hoardMax, this.hoard + h.loot);
          this.emit({
            k: "recover",
            uid: h.uid,
            x: h.x,
            y: h.y,
            amount: h.loot,
          });
          h.loot = 0;
        }
        h.alive = false;
        h.state = "escaped";
        if (h.loot > 0) this.emit({ k: "stolen", uid: h.uid, amount: h.loot });
        this.emit({ k: "escape", uid: h.uid });
        return;
      }
      this.moveToward(h, l.entrance.x, l.entrance.y, this.exitField());
      return;
    }
    // Seek: bait first if greedy enough.
    if (!h.lureDone) {
      const bait = this.findBait(h);
      if (bait) {
        if (cur.x === bait.obj.x && cur.y === bait.obj.y && this.atCenter(h)) {
          const mimic = this.monsters.find(
            (m) =>
              m.alive && m.hidden && m.homeX === cur.x && m.homeY === cur.y,
          );
          if (mimic) {
            mimic.hidden = false;
            h.lureDone = true;
            this.emit({ k: "mimic", x: mimic.x, y: mimic.y });
            this.damage(
              h,
              45 *
                this.tierMul("mimic") *
                (this.relics.has("ironJaws") ? 1.5 : 1),
              "phys",
              "mimic",
            );
            mimic.lastAtk = this.tick;
            mimic.atkT = s(mimic.stats.cd);
            return;
          }
          h.state = "lure";
          h.actT = s(0.8);
          h.actX = cur.x;
          h.actY = cur.y;
          return;
        }
        this.moveToward(
          h,
          bait.obj.x,
          bait.obj.y,
          this.fieldTo(bait.obj.x, bait.obj.y),
        );
        return;
      }
    }
    if (cur.x === l.hoard.x && cur.y === l.hoard.y && this.atCenter(h)) {
      h.touchedHoard = true;
      h.state = "loot";
      h.actT = s(1);
      if (this.hoard <= 0) {
        h.state = "escape";
      }
      return;
    }
    const field =
      h.cls === "dwarf" && h.digs > 0
        ? this.digField()
        : h.cls === "thane" && h.digs > 0
          ? this.thaneField()
          : this.hoardField();
    this.moveToward(h, l.hoard.x, l.hoard.y, field);
  }

  private findBait(h: Hero) {
    const greed = HEROES[h.cls].greed;
    let best: TrapState | null = null;
    let bestD = Infinity;
    for (const t of this.traps) {
      if (t.kind !== "lure" || t.used) continue;
      const f = this.fieldTo(t.obj.x, t.obj.y);
      const d = f[idx(this.layout, Math.floor(h.x), Math.floor(h.y))] / 10;
      if (d <= greed && d < bestD) {
        best = t;
        bestD = d;
      }
    }
    // Mimics are baits too.
    for (const m of this.monsters) {
      if (!m.alive || !m.hidden) continue;
      const f = this.fieldTo(m.homeX, m.homeY);
      const d = f[idx(this.layout, Math.floor(h.x), Math.floor(h.y))] / 10;
      if (d <= greed && d < bestD) {
        best = {
          obj: { id: -1, kind: "lure", x: m.homeX, y: m.homeY, dir: 0 },
        } as TrapState;
        bestD = d;
      }
    }
    return best;
  }

  /** Archmage: teleport up to four tiles along her route. */
  private blink(h: Hero, field: Float64Array) {
    const l = this.layout;
    let at = this.tileOf(h);
    for (let i = 0; i < 4; i++) {
      if (at.x === l.hoard.x && at.y === l.hoard.y) break;
      const n = stepDown(l, field, at.x, at.y);
      if (!n || !walkable(l, n.x, n.y)) break;
      at = n;
    }
    const from = this.tileOf(h);
    if (at.x === from.x && at.y === from.y) return false;
    h.skillT = s(7);
    const fx = h.x;
    const fy = h.y;
    h.x = h.px = at.x + 0.5;
    h.y = h.py = at.y + 0.5;
    h.next = null;
    this.emit({ k: "blink", uid: h.uid, fx, fy, x: h.x, y: h.y });
    this.onEnter(h, at.x, at.y);
    return true;
  }

  private healMul() {
    return this.mutators.has("blessed") ? 1.35 : 1;
  }

  private reachable(h: Hero, m: Monster) {
    return (
      h.range > 1.5 ||
      this.fieldTo(Math.floor(m.x), Math.floor(m.y))[
        idx(this.layout, Math.floor(h.x), Math.floor(h.y))
      ] !== Infinity
    );
  }

  private pickHeroTarget(h: Hero): Monster | null {
    // Wraiths in the walls can only be struck from close by.
    for (const m of this.monsters) {
      if (m.kind !== "wraith" || !m.alive) continue;
      if (walkable(this.layout, Math.floor(m.x), Math.floor(m.y))) continue;
      if (this.d2(h.x, h.y, m.x, m.y) <= Math.min(h.range, 1.6) + 0.25)
        return m;
    }
    // Stone golems demand to be fought first.
    for (const m of this.monsters) {
      if (m.kind !== "golem" || !m.alive) continue;
      if (this.d2(h.x, h.y, m.x, m.y) > 2.2) continue;
      if (!lineOfSight(this.layout, h.x, h.y, m.x, m.y)) continue;
      if (this.reachable(h, m)) return m;
    }
    const cur =
      h.target >= 0
        ? this.monsters.find(
            (m) => m.uid === h.target && m.alive && !m.hidden && !m.dormant,
          )
        : undefined;
    if (
      cur &&
      this.d2(h.x, h.y, cur.x, cur.y) <= h.engage + 1.2 &&
      (cur.kind !== "wraith" ||
        walkable(this.layout, Math.floor(cur.x), Math.floor(cur.y)))
    )
      return cur;
    let best: Monster | null = null;
    let bestD = Infinity;
    for (const m of this.monsters) {
      if (!m.alive || m.hidden || m.dormant) continue;
      if (
        m.kind === "wraith" &&
        !walkable(this.layout, Math.floor(m.x), Math.floor(m.y))
      )
        continue;
      const d = this.d2(h.x, h.y, m.x, m.y);
      const attackingMe = m.target === h.uid && d <= 1.6;
      if (d > h.engage && !attackingMe) continue;
      if (!lineOfSight(this.layout, h.x, h.y, m.x, m.y)) continue;
      // Never commit to a monster the hero cannot walk to.
      if (
        h.range <= 1.5 &&
        this.fieldTo(Math.floor(m.x), Math.floor(m.y))[
          idx(this.layout, Math.floor(h.x), Math.floor(h.y))
        ] === Infinity
      )
        continue;
      if (d < bestD) {
        best = m;
        bestD = d;
      }
    }
    return best;
  }

  private heroAttack(h: Hero, m: Monster) {
    h.face = m.x < h.x ? -1 : m.x > h.x ? 1 : h.face;
    if (h.atkT > 0) return;
    h.atkT = s(h.cd);
    h.lastAtk = this.tick;
    let dmg = h.dmg;
    if (h.cls === "berserker" && h.hp < h.maxHp * 0.5) dmg *= 1.6;
    if (h.st.insp > 0) dmg *= 1.2;
    if (h.cls === "inquisitor" && UNDEAD.includes(m.kind)) {
      dmg *= 1.6;
      if (m.reforms > 0) {
        m.reforms = 0;
        this.emit({ k: "purge", x: m.x, y: m.y });
      }
    }
    const ranged = h.range > 1.5;
    this.emit({ k: "attack", uid: h.uid, tx: m.x, ty: m.y, ranged });
    if (ranged) {
      const fire = h.cls === "mage" || h.cls === "archmage";
      const kind: Projectile["kind"] = fire
        ? "fireball"
        : h.cls === "bard"
          ? "note"
          : h.cls === "windcaller"
            ? "bolt"
            : h.cls === "witch"
              ? "shadow"
              : "arrow";
      const sp = kind === "arrow" ? 11 : kind === "bolt" ? 9 : 7;
      this.spawnProjectile(
        kind,
        h.x,
        h.y,
        0,
        0,
        m.uid,
        dmg,
        fire ? "fire" : HEROES[h.cls].magic ? "magic" : "phys",
        true,
        HEROES[h.cls].splash ?? 0,
        h.cls,
        sp,
      );
    } else {
      this.damage(m, dmg, "phys", h.cls);
      if (this.relics.has("thornHides"))
        this.damage(h, dmg * 0.35, "phys", "thorns");
    }
  }

  private heal(u: Hero, amount: number) {
    const before = u.hp;
    u.hp = Math.min(u.maxHp, u.hp + Math.round(amount));
    if (u.hp > before)
      this.emit({
        k: "heal",
        uid: u.uid,
        x: u.x,
        y: u.y,
        amount: u.hp - before,
      });
  }

  private atCenter(u: UnitBase) {
    const cx = Math.floor(u.x) + 0.5;
    const cy = Math.floor(u.y) + 0.5;
    return Math.abs(u.x - cx) < 0.02 && Math.abs(u.y - cy) < 0.02;
  }

  /** Grid-locked movement along a distance field; triggers traps on arrival. */
  private moveToward(
    u: Hero | Monster,
    gx: number,
    gy: number,
    field: Float64Array,
  ) {
    const l = this.layout;
    if (!u.next) {
      const cur = this.tileOf(u);
      if (cur.x === gx && cur.y === gy) {
        // Already on the goal tile: settle to center.
        u.next = { x: cur.x, y: cur.y };
      } else {
        const n = stepDown(l, field, cur.x, cur.y);
        if (!n) {
          u.next = { x: cur.x, y: cur.y };
        } else {
          // Dwarves dig into rock instead of walking.
          if (u.side === "hero" && !walkable(l, n.x, n.y)) {
            const t = tileAt(l, n.x, n.y);
            if (
              (u.cls === "dwarf" || u.cls === "thane") &&
              u.digs > 0 &&
              (t === T.Rock || t === T.Vein)
            ) {
              u.state = "dig";
              u.actT = s(u.cls === "thane" ? 1.6 : 2.2);
              u.actX = n.x;
              u.actY = n.y;
              this.emit({ k: "dig", x: n.x, y: n.y, done: false });
              return;
            }
            u.next = { x: cur.x, y: cur.y };
          } else {
            // Rogues disarm the first armed trap in their way.
            if (u.side === "hero" && u.disarms > 0) {
              const t = this.trapAt(n.x, n.y);
              if (
                t &&
                !t.disabled &&
                DISARMABLE.includes(t.kind) &&
                !(t.kind === "keg" && t.used)
              ) {
                u.state = "disarm";
                u.actT = s(1.2);
                u.actX = n.x;
                u.actY = n.y;
                return;
              }
            }
            u.next = n;
          }
        }
      }
    }
    const n = u.next!;
    const tx = n.x + 0.5;
    const ty = n.y + 0.5;
    const dx = tx - u.x;
    const dy = ty - u.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    let speed = u.side === "hero" ? u.speed : u.stats.speed;
    if (u.side === "hero" && u.cls === "thane" && u.state === "escape")
      speed *= 1.1;
    // Monks shrug off every slow: tar, webs and chill.
    const monk = u.side === "hero" && u.cls === "monk";
    if (u.st.slow > 0 && !monk) speed *= 0.5;
    if (u.side === "monster" && this.relics.has("bloodhound")) speed *= 1.25;
    if (u.side === "hero") {
      if (u.loot > 0 && this.setup.mods.arch === "warden") speed *= 0.85;
      const tr = this.trapAt(Math.floor(u.x), Math.floor(u.y));
      if (
        tr &&
        tr.kind === "tar" &&
        !tr.disabled &&
        !monk &&
        u.cls !== "windcaller" &&
        u.cls !== "warlord"
      ) {
        // Tar holds heroes at half speed (a crawl with Quicksilver), and the
        // muck lingers for a moment after they leave. It doesn't stack.
        speed =
          (speed / (u.st.slow > 0 ? 0.5 : 1)) *
          (this.relics.has("quicksilver") ? 0.3 : 0.5);
        u.st.slow = Math.max(u.st.slow, s(0.6));
      }
      if (u.st.fear > 0) speed *= 1.15;
      if (u.st.insp > 0) speed *= 1.15;
    }
    const step = speed * TICK;
    if (dx !== 0) u.face = dx < 0 ? -1 : 1;
    if (d <= step) {
      u.x = tx;
      u.y = ty;
      u.next = null;
      if (u.side === "hero") {
        if (this.tick % 3 === 0) this.emit({ k: "step", uid: u.uid });
        this.onEnter(u, n.x, n.y);
      }
    } else {
      u.x += (dx / d) * step;
      u.y += (dy / d) * step;
    }
  }

  // ---------- monsters ----------
  private updateMonster(m: Monster) {
    if (!m.alive) {
      if (m.reformT > 0) {
        m.reformT--;
        if (m.reformT === 0) {
          m.alive = true;
          m.hp = m.maxHp;
          this.emit({ k: "reform", uid: m.uid, x: m.x, y: m.y });
        }
      }
      return;
    }
    if (m.hidden) return;
    if (m.dormant) {
      // A gargoyle wakes when a hero comes close, with a stunning slam.
      const near = this.livingHeroes().filter(
        (h) => !h.hop && this.d2(h.x, h.y, m.x, m.y) <= 1.6,
      );
      if (!near.length) return;
      m.dormant = false;
      m.idleT = 0;
      m.lastAtk = this.tick;
      m.atkT = s(0.8);
      this.emit({ k: "slam", x: m.x, y: m.y });
      for (const h of this.livingHeroes()) {
        if (h.hop || this.d2(h.x, h.y, m.x, m.y) > 1.6) continue;
        this.damage(h, m.dmg * 1.7, "crush", "gargoyle");
        if (h.alive)
          h.st.stun = Math.max(h.st.stun, s(isChampion(h.cls) ? 0.5 : 1));
      }
      return;
    }
    if (m.st.stun > 0) {
      m.st.stun--;
      if (m.atkT > 0) m.atkT--;
      return;
    }
    if (m.atkT > 0) m.atkT--;
    if (m.hop) {
      m.hop = null;
    }
    if (m.kind === "basilisk" || m.kind === "kobold") this.ability(m);
    const st = m.stats;
    const ghostly = m.kind === "wraith";
    const heroes = this.livingHeroes().filter((h) => !h.hop && h.st.veil <= 0);
    let target: Hero | null = null;
    let best = Infinity;
    const homeX = m.homeX + 0.5;
    const homeY = m.homeY + 0.5;
    // Taunt: knights and champions within 2.5 draw attention.
    for (const h of heroes) {
      const d = this.d2(h.x, h.y, m.x, m.y);
      const fromHome = this.d2(h.x, h.y, homeX, homeY);
      if (fromHome > st.leash + st.aggro) continue;
      if (d > st.aggro && m.target !== h.uid) continue;
      if (!ghostly && !lineOfSight(this.layout, m.x, m.y, h.x, h.y)) continue;
      const taunt =
        (h.cls === "knight" ||
          h.cls === "paladin" ||
          h.cls === "thane" ||
          h.cls === "templar") &&
        d <= 2.5
          ? -3
          : 0;
      const score = d + taunt;
      if (score < best) {
        best = score;
        target = h;
      }
    }
    if (target) {
      m.target = target.uid;
      m.idleT = 0;
      const d = this.d2(m.x, m.y, target.x, target.y);
      const reach = Math.max(st.range, 1.05);
      if (d <= reach) {
        m.face = target.x < m.x ? -1 : 1;
        if (m.atkT <= 0) {
          m.atkT = s(st.cd);
          m.lastAtk = this.tick;
          const ranged = st.range > 1.5;
          this.emit({
            k: "attack",
            uid: m.uid,
            tx: target.x,
            ty: target.y,
            ranged,
          });
          if (ranged) {
            const kind =
              m.kind === "imp"
                ? "fireball"
                : m.kind === "necro"
                  ? "shadow"
                  : m.kind === "spider"
                    ? "web"
                    : "arrow";
            const p = this.spawnProjectile(
              kind,
              m.x,
              m.y,
              0,
              0,
              target.uid,
              m.dmg,
              st.magic ? (kind === "fireball" ? "fire" : "magic") : "phys",
              false,
              st.splash ?? 0,
              m.kind,
              kind === "arrow" ? 11 : kind === "web" ? 8 : 7,
            );
            p.owner = m.uid;
          } else {
            this.monsterHit(
              m,
              target,
              m.dmg *
                (m.kind === "mimic" && this.relics.has("ironJaws") ? 1.5 : 1),
              st.magic ? "magic" : "phys",
              m.kind,
            );
            if (m.kind === "ghost") this.frighten(target, 2.2);
            if (
              m.kind === "ogre" &&
              target.alive &&
              !isChampion(target.cls) &&
              !UNSHAKABLE.includes(target.cls)
            )
              this.knockback(target, m);
          }
        }
        return;
      }
      const tt = this.tileOf(target);
      if (
        this.d2(m.x, m.y, homeX, homeY) <= st.leash + 0.5 ||
        this.d2(target.x, target.y, homeX, homeY) <= st.leash
      ) {
        if (st.range > 1.5 && this.d2(m.x, m.y, homeX, homeY) >= st.leash) {
          // Ranged monsters hold position at the edge of their leash.
        } else if (ghostly) {
          this.drift(m, target.x, target.y);
          return;
        } else {
          this.moveToward(m, tt.x, tt.y, this.fieldTo(tt.x, tt.y));
          return;
        }
      }
    } else m.target = -1;
    // Return home.
    if (
      Math.floor(m.x) !== m.homeX ||
      Math.floor(m.y) !== m.homeY ||
      !this.atCenter(m)
    ) {
      if (ghostly) this.drift(m, homeX, homeY);
      else if (walkable(this.layout, m.homeX, m.homeY))
        this.moveToward(m, m.homeX, m.homeY, this.fieldTo(m.homeX, m.homeY));
    } else if (m.kind === "gargoyle" && !target) {
      // Quiet halls: the gargoyle turns back to stone and mends.
      if (++m.idleT >= s(3)) {
        m.dormant = true;
        m.idleT = 0;
        m.hp = Math.min(m.maxHp, m.hp + Math.round(m.maxHp * 0.5));
        this.emit({ k: "stone", x: m.x, y: m.y });
      }
    }
  }
  /** Basilisk gaze and kobold repairs. */
  private ability(m: Monster) {
    if (m.abilT > 0) {
      m.abilT--;
      return;
    }
    if (m.kind === "basilisk") {
      let best: Hero | null = null;
      let bd = 4.05;
      for (const h of this.livingHeroes()) {
        if (h.hop || h.st.veil > 0) continue;
        const d = this.d2(h.x, h.y, m.x, m.y);
        if (d > bd || !lineOfSight(this.layout, m.x, m.y, h.x, h.y)) continue;
        best = h;
        bd = d;
      }
      if (!best) {
        m.abilT = s(0.3);
        return;
      }
      m.abilT = s(6);
      m.lastAtk = this.tick;
      m.face = best.x < m.x ? -1 : 1;
      this.emit({
        k: "gaze",
        uid: m.uid,
        x: m.x,
        y: m.y,
        tx: best.x,
        ty: best.y,
      });
      const sec = isChampion(best.cls) ? 1 : 2;
      best.st.stun = Math.max(best.st.stun, s(sec));
      best.st.vuln = Math.max(best.st.vuln, s(sec));
      best.lastSource = "basilisk";
      return;
    }
    // Kobold: put one broken trap nearby back in working order.
    const t = this.traps.find(
      (q) =>
        q.disabled &&
        !(q.kind === "keg" && q.used) &&
        this.d2(q.obj.x + 0.5, q.obj.y + 0.5, m.x, m.y) <= 3.05,
    );
    if (!t) {
      m.abilT = s(0.5);
      return;
    }
    m.abilT = s(5);
    m.lastAtk = this.tick;
    t.disabled = false;
    t.cd = s(0.5);
    this.dirty = true;
    this.emit({ k: "repair", x: t.obj.x + 0.5, y: t.obj.y + 0.5 });
  }
  /** Wraiths float straight through rock. */
  private drift(m: Monster, tx: number, ty: number) {
    const dx = tx - m.x;
    const dy = ty - m.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    const step =
      m.stats.speed *
      (m.st.slow > 0 ? 0.5 : 1) *
      (this.relics.has("bloodhound") ? 1.25 : 1) *
      TICK;
    m.next = null;
    if (dx !== 0) m.face = dx < 0 ? -1 : 1;
    if (d <= step) {
      m.x = tx;
      m.y = ty;
      return;
    }
    const nx = m.x + (dx / d) * step;
    const ny = m.y + (dy / d) * step;
    const l = this.layout;
    // Never leave the map or enter bedrock.
    if (tileAt(l, Math.floor(nx), Math.floor(ny)) === T.Bedrock) return;
    m.x = nx;
    m.y = ny;
  }
  private knockback(h: Hero, m: Monster) {
    const dx = h.x - m.x;
    const dy = h.y - m.y;
    let dir: number;
    if (Math.abs(dx) >= Math.abs(dy)) dir = dx >= 0 ? 1 : 3;
    else dir = dy >= 0 ? 2 : 0;
    const cx = Math.floor(h.x);
    const cy = Math.floor(h.y);
    const nx = cx + DX[dir];
    const ny = cy + DY[dir];
    if (walkable(this.layout, nx, ny)) this.hopTo(h, nx, ny, 0.25, 0.5);
  }

  // ---------- projectiles ----------
  private spawnProjectile(
    kind: Projectile["kind"],
    x: number,
    y: number,
    vx: number,
    vy: number,
    target: number,
    dmg: number,
    dtype: DmgType,
    fromHero: boolean,
    splash: number,
    source: string,
    speed = 10,
  ): Projectile {
    const p: Projectile = {
      id: this.pid++,
      kind,
      x,
      y,
      px: x,
      py: y,
      vx,
      vy,
      target,
      dmg,
      dtype,
      fromHero,
      splash,
      life: s(2),
      source,
      owner: -1,
    };
    if (target >= 0) {
      p.vx = speed;
    }
    this.projectiles.push(p);
    this.emit({ k: "shoot", pid: p.id });
    return p;
  }
  private unitByUid(uid: number): Hero | Monster | undefined {
    return (
      this.heroes.find((h) => h.uid === uid) ??
      this.monsters.find((m) => m.uid === uid)
    );
  }
  private updateProjectiles() {
    const keep: Projectile[] = [];
    for (const p of this.projectiles) {
      p.life--;
      if (p.target >= 0) {
        const t = this.unitByUid(p.target);
        if (!t || !t.alive || (t.side === "hero" && t.state === "falling"))
          continue;
        const speed = p.vx;
        const dx = t.x - p.x;
        const dy = t.y - p.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        const step = speed * TICK;
        if (d <= step + 0.15) {
          this.impact(p, t);
          continue;
        }
        p.x += (dx / d) * step;
        p.y += (dy / d) * step;
      } else {
        const near = () =>
          this.livingHeroes().find(
            (h) => !h.hop && this.d2(h.x, h.y, p.x, p.y) < 0.45,
          );
        const first = near();
        if (first) {
          this.impact(p, first);
          continue;
        }
        p.x += p.vx * TICK;
        p.y += p.vy * TICK;
        if (!walkable(this.layout, Math.floor(p.x), Math.floor(p.y))) continue;
        const hit = near();
        if (hit) {
          this.impact(p, hit);
          continue;
        }
      }
      if (p.life > 0) keep.push(p);
    }
    this.projectiles = keep;
  }
  private impact(p: Projectile, t: Hero | Monster) {
    if (
      t.side === "hero" &&
      t.cls === "monk" &&
      !p.fromHero &&
      (p.kind === "dart" || p.kind === "arrow")
    ) {
      t.deflect = !t.deflect;
      if (t.deflect) {
        this.emit({ k: "deflect", uid: t.uid, x: t.x, y: t.y });
        return;
      }
    }
    const exposed =
      t.side === "hero" &&
      t.cls === "windcaller" &&
      (p.kind === "dart" || p.kind === "arrow");
    const owner =
      !p.fromHero && t.side === "hero" && p.owner >= 0
        ? this.monsters.find((m) => m.uid === p.owner)
        : undefined;
    if (owner && t.side === "hero")
      this.monsterHit(owner, t, p.dmg * (exposed ? 1.5 : 1), p.dtype, p.source);
    else this.damage(t, p.dmg * (exposed ? 1.5 : 1), p.dtype, p.source);
    if (p.kind === "web" && t.side === "hero" && t.alive)
      t.st.slow = Math.max(t.st.slow, s(2.5));
    if (p.splash > 0) {
      const pool = p.fromHero ? this.monsters : this.heroes;
      for (const u of pool) {
        if (
          u !== t &&
          u.alive &&
          !(u.side === "monster" && (u.hidden || u.dormant)) &&
          !(u.side === "hero" && (u.state === "falling" || u.hop)) &&
          this.d2(u.x, u.y, t.x, t.y) <= p.splash
        ) {
          this.damage(u, p.dmg * 0.6, p.dtype, p.source);
        }
      }
    }
    if (p.kind === "fireball") {
      this.igniteAt(Math.floor(t.x), Math.floor(t.y));
      if (!p.fromHero && t.side === "hero" && t.alive)
        this.burn(t, 1.5, p.source);
    }
  }
}

/** Run a raid to completion without presentation (tests, previews, balance). */
export function simulate(setup: RaidSetup, maxTicks = 10_000): Raid {
  const r = new Raid(setup);
  while (!r.finished && r.tick < maxTicks) {
    r.step();
    r.events.length = 0;
  }
  return r;
}
