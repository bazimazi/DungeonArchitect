/**
 * World renderer: cached 2.5D terrain, lit with a multiplied light map,
 * live actors, telegraphs and effects. Draws in tile units after a camera
 * transform; tile (0,0) top-left is world origin.
 */
import { cellHash, clamp, damp, ease, noise1 } from "../engine/math";
import {
  BIOMES,
  DX,
  DY,
  MONSTERS,
  PIECES,
  T,
  TICK,
  isChampion,
  type Biome,
  type PieceId,
  type TrapId,
} from "../game/defs";
import { tileAt, walkable, type Layout, type Placed } from "../game/grid";
import type { Hero, Monster, Raid, TrapState } from "../game/sim";
import { Fx } from "./fx";
import {
  drawHero,
  drawMonster,
  drawSawBlade,
  drawTrap,
  shadow,
} from "./sprites";

const FACE = 0.36; // height of rock front faces in tiles
const MARGIN = 5;

export interface Ghost {
  kind: PieceId | "dig" | "fill" | "sell";
  x: number;
  y: number;
  dir: number;
  ok: boolean;
}
export interface Scene {
  mode: "build" | "raid" | "idle";
  layout: Layout;
  biome: Biome["id"];
  raid: Raid | null;
  alpha: number;
  hoard: number;
  hoardMax: number;
  night: number;
  path: { x: number; y: number }[] | null;
  ghost: Ghost | null;
  selected: number | null;
  time: number;
  spotlight: { x: number; y: number; r: number } | null;
  pendingPowers: { power: string; x: number; y: number; t: number }[];
}

interface ActorView {
  walk: number;
  lx: number;
  ly: number;
}

export class Renderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  fx = new Fx();
  W = 0;
  H = 0;
  dpr = 1;
  // Camera (tile units): center and pixels per tile.
  cx = 5.5;
  cy = 7.5;
  scale = 40;
  private fitScale = 40;
  private fitCx = 5.5;
  private fitCy = 7.5;
  zoom = 1;
  panX = 0;
  panY = 0;
  insets = { top: 70, bottom: 150, left: 12, right: 12 };
  trauma = 0;
  kickX = 0;
  kickY = 0;
  punch = 0;
  shakeEnabled = true;
  private terrain: HTMLCanvasElement | null = null;
  private terrainKey = "";

  private torches: { x: number; y: number }[] = [];
  private light = document.createElement("canvas");
  private lctx = this.light.getContext("2d")!;
  private lightSprites = new Map<string, HTMLCanvasElement>();
  private actors = new Map<number, ActorView>();
  private flashes: {
    x: number;
    y: number;
    r: number;
    color: string;
    life: number;
    max: number;
  }[] = [];
  private motes: { x: number; y: number; s: number; p: number }[] = [];
  private vignette: HTMLCanvasElement | null = null;
  private pops = new Map<number, number>();
  private clock = 0;
  layoutW = 11;
  layoutH = 15;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    for (let i = 0; i < 60; i++)
      this.motes.push({
        x: Math.random() * 11,
        y: Math.random() * 15,
        s: Math.random(),
        p: Math.random() * 10,
      });
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = Math.max(1, r.width);
    this.H = Math.max(1, r.height);
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
    this.light.width = Math.ceil(this.W / 2);
    this.light.height = Math.ceil(this.H / 2);
    this.vignette = null;
    this.fit();
  }

  fit() {
    const availW = this.W - this.insets.left - this.insets.right;
    const availH = this.H - this.insets.top - this.insets.bottom;
    const w = this.layoutW + 0.3;
    const h = this.layoutH + 0.2;
    this.fitScale = Math.max(12, Math.min(availW / w, availH / h, 92));
    this.fitCx =
      this.layoutW / 2 -
      (this.insets.left - this.insets.right) / 2 / this.fitScale;
    this.fitCy =
      this.layoutH / 2 -
      0.15 -
      (this.insets.top - this.insets.bottom) / 2 / this.fitScale;
  }

  resetView() {
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
  }
  zoomAt(factor: number, sx: number, sy: number) {
    const before = this.toWorld(sx, sy);
    this.zoom = clamp(this.zoom * factor, 1, 2.6);
    this.updateCamera(1);
    const after = this.toWorld(sx, sy);
    this.panX += before.x - after.x;
    this.panY += before.y - after.y;
    this.clampPan();
  }
  panBy(dxPx: number, dyPx: number) {
    this.panX -= dxPx / this.scale;
    this.panY -= dyPx / this.scale;
    this.clampPan();
  }
  private clampPan() {
    const lim = (this.zoom - 1) * 4 + 0.5;
    this.panX = clamp(this.panX, -lim * 1.3, lim * 1.3);
    this.panY = clamp(this.panY, -lim * 1.6, lim * 1.6);
  }
  private updateCamera(dt: number) {
    const target = this.fitScale * this.zoom * (1 + this.punch);
    this.scale = dt >= 1 ? target : damp(this.scale, target, 18, dt);
    this.cx = this.fitCx + this.panX;
    this.cy = this.fitCy + this.panY;
  }

  toScreen = (x: number, y: number): [number, number] => [
    (x - this.cx) * this.scale + this.W / 2,
    (y - this.cy) * this.scale + this.H / 2,
  ];
  toWorld(sx: number, sy: number) {
    return {
      x: (sx - this.W / 2) / this.scale + this.cx,
      y: (sy - this.H / 2) / this.scale + this.cy,
    };
  }
  /** Tile under a screen point, accounting for raised rock faces. */
  tileAtScreen(sx: number, sy: number) {
    const w = this.toWorld(sx, sy);
    return { x: Math.floor(w.x), y: Math.floor(w.y) };
  }

  shake(amount: number) {
    if (!this.shakeEnabled) return;
    this.trauma = Math.min(1, this.trauma + amount);
  }
  kick(dx: number, dy: number, px = 5) {
    if (!this.shakeEnabled) return;
    const d = Math.hypot(dx, dy) || 1;
    this.kickX += (dx / d) * px;
    this.kickY += (dy / d) * px;
  }
  zoomPunch(a = 0.03) {
    if (!this.shakeEnabled) return;
    this.punch = Math.max(this.punch, a);
  }
  /** Scale-in for freshly placed pieces: 0 → 1.15 → 1 (easeOutBack). */
  pop(id: number) {
    this.pops.set(id, this.clock);
  }
  private popScale(id: number) {
    const t0 = this.pops.get(id);
    if (t0 === undefined) return 1;
    const k = (this.clock - t0) / 0.24;
    if (k >= 1) {
      this.pops.delete(id);
      return 1;
    }
    return Math.max(0.01, ease.outBack(k));
  }
  flash(x: number, y: number, r: number, color: string, life = 0.35) {
    this.flashes.push({ x, y, r, color, life, max: life });
  }
  /** Lightning arc through a list of points (storm pylons). */
  zap(pts: { x: number; y: number }[]) {
    this.zaps.push({ pts, life: 0.25, seed: Math.random() * 1000 });
  }
  private zaps: {
    pts: { x: number; y: number }[];
    life: number;
    seed: number;
  }[] = [];
  private drawZaps(ctx: CanvasRenderingContext2D, dt: number) {
    for (const z of this.zaps) {
      const a = Math.max(0, z.life / 0.25);
      for (const [w, color] of [
        [0.14, `rgba(120,170,255,${0.5 * a})`],
        [0.05, `rgba(235,245,255,${a})`],
      ] as const) {
        ctx.beginPath();
        for (let i = 0; i < z.pts.length - 1; i++) {
          const p = z.pts[i];
          const q = z.pts[i + 1];
          if (i === 0) ctx.moveTo(p.x, p.y);
          const steps = 5;
          for (let k = 1; k <= steps; k++) {
            const f = k / steps;
            const j =
              k === steps
                ? 0
                : Math.sin(z.seed + i * 7 + k * 3.3 + z.life * 60) * 0.18;
            ctx.lineTo(
              p.x + (q.x - p.x) * f + j * (q.y - p.y > 0 ? 1 : -1),
              p.y + (q.y - p.y) * f + j,
            );
          }
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = w;
        ctx.lineJoin = "round";
        ctx.stroke();
      }
      z.life -= dt;
    }
    this.zaps = this.zaps.filter((z) => z.life > 0);
  }

  // ---------- terrain cache ----------
  private buildTerrain(l: Layout, biomeId: Biome["id"]) {
    // Quantised and independent of the kill zoom-punch, so the cache isn't
    // rebuilt every frame while zooming or celebrating a kill.
    const px = Math.min(
      96,
      Math.max(16, Math.ceil((this.fitScale * this.zoom * this.dpr) / 12) * 12),
    );
    const key = `${biomeId}|${px}|${l.tiles.join("")}`;
    if (key === this.terrainKey && this.terrain) return;
    this.terrainKey = key;

    const b = BIOMES[biomeId];
    const cw = (l.w + MARGIN * 2) * px;
    const ch = (l.h + MARGIN * 2) * px;
    const c = this.terrain ?? document.createElement("canvas");
    c.width = cw;
    c.height = ch;
    this.terrain = c;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(px, 0, 0, px, MARGIN * px, MARGIN * px);
    ctx.fillStyle = b.rockDark;
    ctx.fillRect(-MARGIN, -MARGIN, l.w + MARGIN * 2, l.h + MARGIN * 2);
    const solid = (x: number, y: number) => {
      if (x === l.entrance.x && y < 0) return false;
      return tileAt(l, x, y) !== T.Floor;
    };
    // Floors.
    for (let y = 0; y < l.h; y++)
      for (let x = 0; x < l.w; x++)
        if (!solid(x, y)) this.drawFloor(ctx, l, x, y, b, solid);
    // Entrance stairs climbing out of the map.
    this.drawEntrance(ctx, l, b);
    // Rock, row by row so front faces overlap correctly.
    this.torches = [];
    for (let y = -MARGIN; y < l.h + MARGIN; y++)
      for (let x = -MARGIN; x < l.w + MARGIN; x++) {
        if (!solid(x, y)) continue;
        this.drawRock(ctx, l, x, y, b, solid);
      }
    // Fade the outer margin into darkness.
    const fade = (x0: number, y0: number, x1: number, y1: number) => {
      const g = ctx.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, "rgba(6,4,10,0)");
      g.addColorStop(1, "rgba(6,4,10,0.9)");
      return g;
    };
    ctx.fillStyle = fade(0, 0, -MARGIN, 0);
    ctx.fillRect(-MARGIN, -MARGIN, MARGIN, l.h + MARGIN * 2);
    ctx.fillStyle = fade(l.w, 0, l.w + MARGIN, 0);
    ctx.fillRect(l.w, -MARGIN, MARGIN, l.h + MARGIN * 2);
    ctx.fillStyle = fade(0, l.h, 0, l.h + MARGIN);
    ctx.fillRect(-MARGIN, l.h, l.w + MARGIN * 2, MARGIN);
    ctx.fillStyle = fade(0, 0, 0, -MARGIN);
    ctx.fillRect(-MARGIN, -MARGIN, l.w + MARGIN * 2, MARGIN);
  }

  private drawFloor(
    ctx: CanvasRenderingContext2D,
    _l: Layout,
    x: number,
    y: number,
    b: (typeof BIOMES)[keyof typeof BIOMES],
    solid: (x: number, y: number) => boolean,
  ) {
    const h = cellHash(x, y, 1);
    ctx.fillStyle = h < 0.5 ? b.floorA : b.floorB;
    ctx.fillRect(x, y, 1, 1);
    // Flagstones: two layouts chosen per tile.
    const stones =
      h < 0.33
        ? [
            [0.04, 0.04, 0.44, 0.44],
            [0.52, 0.04, 0.44, 0.44],
            [0.04, 0.52, 0.92, 0.44],
          ]
        : h < 0.66
          ? [
              [0.04, 0.04, 0.92, 0.44],
              [0.04, 0.52, 0.44, 0.44],
              [0.52, 0.52, 0.44, 0.44],
            ]
          : [
              [0.04, 0.04, 0.44, 0.92],
              [0.52, 0.04, 0.44, 0.44],
              [0.52, 0.52, 0.44, 0.44],
            ];
    stones.forEach(([sx, sy, sw, sh], i) => {
      const v = cellHash(x * 3 + i, y * 5, 2);
      ctx.fillStyle = `rgba(${v < 0.5 ? "255,255,255" : "0,0,0"},${0.03 + v * 0.05})`;
      ctx.beginPath();
      ctx.roundRect(x + sx, y + sy, sw, sh, 0.05);
      ctx.fill();
      // Top highlight edge.
      ctx.fillStyle = "rgba(255,255,255,0.045)";
      ctx.fillRect(x + sx + 0.03, y + sy, sw - 0.06, 0.025);
    });
    // Details.
    const d = cellHash(x, y, 9);
    if (d < 0.12) {
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = 0.02;
      ctx.beginPath();
      ctx.moveTo(x + 0.2, y + 0.3);
      ctx.lineTo(x + 0.4, y + 0.45);
      ctx.lineTo(x + 0.35, y + 0.7);
      ctx.stroke();
    } else if (d < 0.2) {
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = "rgba(0,0,0,0.3)";
        ctx.beginPath();
        ctx.arc(
          x + 0.2 + cellHash(x, y, 20 + i) * 0.6,
          y + 0.3 + cellHash(x, y, 30 + i) * 0.5,
          0.025,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    } else if (d < 0.26 && b.id === "crypt") {
      ctx.strokeStyle = "rgba(220,210,190,0.35)";
      ctx.lineWidth = 0.035;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x + 0.3, y + 0.6);
      ctx.lineTo(x + 0.6, y + 0.5);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x + 0.66, y + 0.48, 0.05, 0, Math.PI * 2);
      ctx.stroke();
    } else if (d < 0.3 && b.id === "grotto") {
      ctx.fillStyle = "rgba(126,240,200,0.5)";
      ctx.beginPath();
      ctx.ellipse(x + 0.7, y + 0.7, 0.08, 0.05, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (d < 0.3 && b.id === "glacier") {
      ctx.fillStyle = "rgba(200,240,255,0.35)";
      ctx.beginPath();
      ctx.moveTo(x + 0.3, y + 0.75);
      ctx.lineTo(x + 0.38, y + 0.5);
      ctx.lineTo(x + 0.46, y + 0.75);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x + 0.5, y + 0.8);
      ctx.lineTo(x + 0.56, y + 0.62);
      ctx.lineTo(x + 0.62, y + 0.8);
      ctx.closePath();
      ctx.fill();
    } else if (d < 0.3 && b.id === "abyss") {
      ctx.strokeStyle = "rgba(208,122,255,0.45)";
      ctx.lineWidth = 0.025;
      ctx.beginPath();
      ctx.moveTo(x + 0.15, y + 0.4);
      ctx.lineTo(x + 0.4, y + 0.55);
      ctx.lineTo(x + 0.35, y + 0.75);
      ctx.lineTo(x + 0.7, y + 0.85);
      ctx.stroke();
    } else if (d < 0.3 && b.id === "forge") {
      ctx.strokeStyle = "rgba(255,110,40,0.4)";
      ctx.lineWidth = 0.025;
      ctx.beginPath();
      ctx.moveTo(x + 0.1, y + 0.8);
      ctx.lineTo(x + 0.45, y + 0.7);
      ctx.lineTo(x + 0.6, y + 0.85);
      ctx.stroke();
    }
    // Ambient occlusion from neighbouring rock.
    const ao = (
      x0: number,
      y0: number,
      x1: number,
      y1: number,
      rx: number,
      ry: number,
      rw: number,
      rh: number,
      a: number,
    ) => {
      const g = ctx.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, `rgba(0,0,0,${a})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(rx, ry, rw, rh);
    };
    if (solid(x, y - 1))
      ao(0, y + FACE, 0, y + FACE + 0.35, x, y + FACE, 1, 0.35, 0.5);
    if (solid(x - 1, y)) ao(x, 0, x + 0.3, 0, x, y, 0.3, 1, 0.45);
    if (solid(x + 1, y)) ao(x + 1, 0, x + 0.7, 0, x + 0.7, y, 0.3, 1, 0.45);
    if (solid(x, y + 1)) ao(0, y + 1, 0, y + 0.85, x, y + 0.85, 1, 0.15, 0.3);
  }

  private drawEntrance(
    ctx: CanvasRenderingContext2D,
    l: Layout,
    b: (typeof BIOMES)[keyof typeof BIOMES],
  ) {
    const { x, y } = l.entrance;
    for (let i = 0; i < 4; i++) {
      const yy = y - i * 0.5;
      ctx.fillStyle = i % 2 ? b.floorB : b.floorA;
      ctx.fillRect(x + 0.08, yy, 0.84, 0.5);
      ctx.fillStyle = `rgba(255,255,255,${0.06 + i * 0.03})`;
      ctx.fillRect(x + 0.08, yy, 0.84, 0.06);
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.fillRect(x + 0.08, yy + 0.44, 0.84, 0.06);
    }
  }

  private drawRock(
    ctx: CanvasRenderingContext2D,
    l: Layout,
    x: number,
    y: number,
    b: (typeof BIOMES)[keyof typeof BIOMES],
    solid: (x: number, y: number) => boolean,
  ) {
    const t =
      x >= 0 && y >= 0 && x < l.w && y < l.h ? tileAt(l, x, y) : T.Bedrock;
    const outside = x < 0 || y < 0 || x >= l.w || y >= l.h;
    const bed = t === T.Bedrock;
    const h = cellHash(x, y, 4);
    if (outside) {
      ctx.fillStyle = b.rockDark;
      ctx.fillRect(x, y, 1, 1);
      if (h < 0.35) {
        ctx.fillStyle = "rgba(255,255,255,0.025)";
        ctx.beginPath();
        ctx.ellipse(
          x + 0.3 + h,
          y + 0.5,
          0.25 + h * 0.4,
          0.18,
          h * 5,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    } else if (bed) {
      // Carved masonry: undiggable.
      ctx.fillStyle = shade(b.rockFace, -0.15 + (h - 0.5) * 0.08);
      ctx.fillRect(x, y, 1, 1);
      ctx.fillStyle = shade(b.rockFace, 0.06);
      ctx.beginPath();
      ctx.roundRect(x + 0.07, y + 0.07, 0.86, 0.86, 0.06);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fillRect(x + 0.1, y + 0.08, 0.8, 0.05);
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.fillRect(x + 0.1, y + 0.86, 0.8, 0.05);
      ctx.strokeStyle = "rgba(0,0,0,0.3)";
      ctx.lineWidth = 0.025;
      ctx.beginPath();
      ctx.moveTo(x + 0.07, y + 0.5);
      ctx.lineTo(x + 0.93, y + 0.5);
      ctx.moveTo(x + 0.35 + h * 0.3, y + 0.07);
      ctx.lineTo(x + 0.35 + h * 0.3, y + 0.5);
      ctx.stroke();
    } else {
      // Raw rock: dark rubble lumps.
      ctx.fillStyle = shade(b.rockTop, (h - 0.5) * 0.12);
      ctx.fillRect(x, y, 1, 1);
      for (let i = 0; i < 4; i++) {
        const v = cellHash(x, y, 50 + i);
        const rx = x + 0.18 + cellHash(x, y, 60 + i) * 0.64;
        const ry = y + 0.18 + cellHash(x, y, 70 + i) * 0.64;
        const rr = 0.12 + v * 0.12;
        ctx.fillStyle = shade(b.rockTop, 0.05 + v * 0.07);
        ctx.beginPath();
        ctx.ellipse(rx, ry, rr, rr * 0.8, v * 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.05)";
        ctx.beginPath();
        ctx.ellipse(
          rx - rr * 0.25,
          ry - rr * 0.3,
          rr * 0.5,
          rr * 0.3,
          v * 3,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }
    // Lit rim where rock meets open floor.
    if (!outside) {
      ctx.fillStyle = shade(b.rockFace, 0.28);
      if (!solid(x, y - 1)) ctx.fillRect(x, y, 1, 0.07);
      if (!solid(x - 1, y)) ctx.fillRect(x, y, 0.06, 1);
      if (!solid(x + 1, y)) ctx.fillRect(x + 0.94, y, 0.06, 1);
    }
    if (t === T.Vein) {
      for (let i = 0; i < 6; i++) {
        const vx = x + 0.15 + cellHash(x, y, 80 + i) * 0.7;
        const vy = y + 0.15 + cellHash(x, y, 90 + i) * 0.7;
        ctx.fillStyle = i % 2 ? "#ffd166" : "#c8962a";
        ctx.beginPath();
        ctx.moveTo(vx, vy - 0.07);
        ctx.lineTo(vx + 0.05, vy);
        ctx.lineTo(vx, vy + 0.07);
        ctx.lineTo(vx - 0.05, vy);
        ctx.fill();
      }
    }
    // Front face spills onto the floor tile below.
    if (!solid(x, y + 1)) {
      const g = ctx.createLinearGradient(0, y + 1, 0, y + 1 + FACE);
      g.addColorStop(0, shade(b.rockFace, 0.12));
      g.addColorStop(1, shade(b.rockFace, -0.25));
      ctx.fillStyle = g;
      ctx.fillRect(x, y + 1, 1, FACE);
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.fillRect(x, y + 1, 1, 0.03);
      // Brick courses.
      ctx.strokeStyle = "rgba(0,0,0,0.28)";
      ctx.lineWidth = 0.02;
      ctx.beginPath();
      ctx.moveTo(x, y + 1 + FACE * 0.5);
      ctx.lineTo(x + 1, y + 1 + FACE * 0.5);
      const off = cellHash(x, y, 7) * 0.4;
      for (let i = 0; i < 3; i++) {
        const bx = x + off + i * 0.4;
        if (bx < x + 1) {
          ctx.moveTo(bx, y + 1);
          ctx.lineTo(bx, y + 1 + FACE * 0.5);
        }
        const bx2 = bx + 0.2;
        if (bx2 < x + 1) {
          ctx.moveTo(bx2, y + 1 + FACE * 0.5);
          ctx.lineTo(bx2, y + 1 + FACE);
        }
      }
      ctx.stroke();
      if (b.id === "grotto" && cellHash(x, y, 11) < 0.4) {
        ctx.fillStyle = "rgba(90,160,110,0.45)";
        ctx.beginPath();
        ctx.ellipse(
          x + 0.3 + cellHash(x, y, 12) * 0.4,
          y + 1.02,
          0.18,
          0.06,
          0,
          0,
          Math.PI,
        );
        ctx.fill();
      }
      // Torches on some walls facing open floor.
      if (
        !outside &&
        y >= 0 &&
        cellHash(x, y, 13) < 0.2 &&
        !(x === l.entrance.x)
      ) {
        this.torches.push({ x: x + 0.5, y: y + 1 + FACE * 0.45 });
        ctx.fillStyle = "#2a1e16";
        ctx.fillRect(x + 0.45, y + 1 + FACE * 0.35, 0.1, FACE * 0.45);
      }
    }
  }

  // ---------- lighting ----------
  private lightSprite(color: string) {
    let s = this.lightSprites.get(color);
    if (s) return s;
    s = document.createElement("canvas");
    s.width = s.height = 128;
    const c = s.getContext("2d")!;
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, color);
    g.addColorStop(0.35, withAlpha(color, 0.55));
    g.addColorStop(1, withAlpha(color, 0));
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 128);
    this.lightSprites.set(color, s);
    return s;
  }

  // ---------- frame ----------
  render(scene: Scene, dt: number) {
    const ctx = this.ctx;
    const l = scene.layout;
    this.layoutW = l.w;
    this.layoutH = l.h;
    this.fx.update(dt);
    this.clock += dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    this.kickX = damp(this.kickX, 0, 14, dt);
    this.kickY = damp(this.kickY, 0, 14, dt);
    this.punch = damp(this.punch, 0, 6, dt);
    this.updateCamera(dt);
    this.buildTerrain(l, scene.biome);
    const b = BIOMES[scene.biome];
    const time = scene.time;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = "#07050b";
    ctx.fillRect(0, 0, this.W, this.H);

    const sh = this.trauma * this.trauma;
    const ox = sh * 10 * noise1(time * 25) + this.kickX;
    const oy = sh * 10 * noise1(time * 25 + 77) + this.kickY;
    const rot = sh * 0.02 * noise1(time * 20 + 33);
    const s = this.scale;
    const world = () => {
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.translate(this.W / 2 + ox, this.H / 2 + oy);
      ctx.rotate(rot);
      ctx.scale(s, s);
      ctx.translate(-this.cx, -this.cy);
    };
    world();
    ctx.imageSmoothingEnabled = true;
    if (this.terrain) {
      ctx.drawImage(
        this.terrain,
        -MARGIN,
        -MARGIN,
        l.w + MARGIN * 2,
        l.h + MARGIN * 2,
      );
    }

    const raid = scene.raid;
    const tick = raid ? raid.tick - 1 + scene.alpha : 0;
    const trapStates = new Map<number, TrapState>();
    if (raid) for (const t of raid.traps) trapStates.set(t.obj.id, t);

    // Hoard.
    this.drawHoard(ctx, l, scene.hoard, scene.hoardMax, time);

    // Danger telegraphs under actors.
    if (raid) this.drawTelegraphs(ctx, raid, time, false);

    // Traps.
    for (const o of l.objects) {
      const def = PIECES[o.kind];
      if (def.kind !== "trap") continue;
      const st = trapStates.get(o.id);
      this.drawTrapAt(ctx, o, st, raid, time);
    }

    // Build path preview.
    if (scene.mode === "build" && scene.path)
      this.drawPath(ctx, scene.path, time);

    // Actors, sorted by y.
    const actors: { y: number; draw: () => void; sh: () => void }[] = [];
    if (raid) {
      for (const h of raid.heroes) {
        if (!h.alive) continue;
        const v = this.actorView(h, scene.alpha);
        actors.push({
          y: v.y,
          sh: () => this.shadowAt(ctx, v.x, v.y, h.hop ? 0.18 : 0.26),
          draw: () => this.drawHeroActor(ctx, h, v, tick, time),
        });
      }
      for (const m of raid.monsters) {
        if (!m.alive) continue;
        const v = this.actorView(m, scene.alpha);
        actors.push({
          y: v.y,
          sh: () =>
            this.shadowAt(ctx, v.x, v.y, m.kind === "ogre" ? 0.36 : 0.24),
          draw: () => this.drawMonsterActor(ctx, m, v, tick, time),
        });
      }
    } else {
      for (const o of l.objects) {
        if (PIECES[o.kind].kind !== "monster") continue;
        const x = o.x + 0.5;
        const y = o.y + 0.62;
        actors.push({
          y,
          sh: () => this.shadowAt(ctx, x, y, 0.24),
          draw: () => {
            ctx.save();
            ctx.translate(x, y);
            const ps = this.popScale(o.id);
            ctx.scale(ps * 0.9, ps * 0.9);
            drawMonster(
              ctx,
              o.kind as never,
              {
                t: time + o.id,
                walk: -1,
                atk: -1,
                flash: false,
                face: o.dir === 3 ? -1 : 1,
              },
              o.kind === "mimic",
            );
            ctx.restore();
          },
        });
      }
    }
    actors.sort((a, b2) => a.y - b2.y);
    for (const a of actors) a.sh();
    for (const a of actors) a.draw();

    // Rolling boulders and saw blades sit above actors.
    if (raid) this.drawMovingTraps(ctx, raid, scene.alpha, time);
    else {
      for (const o of l.objects) {
        if (o.kind === "saw") {
          ctx.save();
          ctx.translate(o.x + 0.5, o.y + 0.55);
          drawSawBlade(ctx, time * 0.3);
          ctx.restore();
        }
      }
    }
    // Projectiles.
    if (raid) this.drawProjectiles(ctx, raid, scene.alpha);

    this.fx.drawWorld(ctx, false);

    // ---------- lighting ----------
    const nightK = scene.night;
    const amb = b.ambient;
    const bright = [200, 190, 215];
    const ar = Math.round(bright[0] + (amb[0] - bright[0]) * nightK);
    const ag = Math.round(bright[1] + (amb[1] - bright[1]) * nightK);
    const ab = Math.round(bright[2] + (amb[2] - bright[2]) * nightK);
    const lc = this.lctx;
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.globalCompositeOperation = "source-over";
    lc.fillStyle = `rgb(${ar},${ag},${ab})`;
    lc.fillRect(0, 0, this.light.width, this.light.height);
    lc.globalCompositeOperation = "lighter";
    lc.setTransform(0.5, 0, 0, 0.5, 0, 0);
    lc.translate(this.W / 2 + ox, this.H / 2 + oy);
    lc.rotate(rot);
    lc.scale(s, s);
    lc.translate(-this.cx, -this.cy);
    const addLight = (
      x: number,
      y: number,
      r: number,
      color: string,
      a = 1,
    ) => {
      lc.globalAlpha = a;
      lc.drawImage(this.lightSprite(color), x - r, y - r, r * 2, r * 2);
    };
    for (const t of this.torches) {
      const f =
        0.88 +
        0.08 * noise1(time * 6 + t.x * 7) +
        0.04 * Math.sin(time * 23 + t.y);
      addLight(t.x, t.y, 2.6 * f, b.torch, 0.85);
    }
    const hp = scene.hoardMax ? scene.hoard / scene.hoardMax : 1;
    addLight(
      l.hoard.x + 0.5,
      l.hoard.y + 0.5,
      2.2 + hp * 1.2 + Math.sin(time * 2) * 0.15,
      "#ffcf6a",
      0.9,
    );
    addLight(l.entrance.x + 0.5, l.entrance.y, 2.4, "#9fc2ff", 0.8);
    for (let y = 0; y < l.h; y++)
      for (let x = 0; x < l.w; x++)
        if (l.tiles[y * l.w + x] === T.Vein)
          addLight(x + 0.5, y + 0.5, 0.9, "#ffd166", 0.35);
    for (const z of this.zaps)
      for (const p of z.pts) addLight(p.x, p.y, 1.6, "#bcd8ff", z.life / 0.25);
    for (const o of l.objects) {
      if (o.kind === "pylon" && !raid)
        addLight(o.x + 0.5, o.y, 0.9, "#9fc8ff", 0.4);
      if (o.kind === "frost")
        addLight(o.x + 0.5, o.y + 0.5, 1.1, "#7ad0ff", 0.5);
      if (o.kind === "necro")
        addLight(o.x + 0.5, o.y + 0.5, 1.2, "#b48cff", 0.5);
    }
    if (raid) {
      for (const h of raid.heroes) {
        if (!h.alive) continue;
        const v = this.actorView(h, scene.alpha);
        const c =
          h.cls === "mage" || h.cls === "archmage"
            ? "#c79bff"
            : h.cls === "paladin" || h.cls === "cleric"
              ? "#fff0b0"
              : h.cls === "windcaller"
                ? "#9ff0e8"
                : h.cls === "bard"
                  ? "#ffb0d8"
                  : "#ffbe70";
        addLight(v.x, v.y - 0.4, isChampion(h.cls) ? 2.6 : 1.7, c, 0.75);
      }
      for (const m of raid.monsters) {
        if (!m.alive) continue;
        if (m.kind === "imp") addLight(m.x, m.y - 0.3, 1.2, "#ff6a3a", 0.6);
        if (m.kind === "ghost") addLight(m.x, m.y - 0.3, 1.2, "#bfe6ff", 0.45);
      }
      for (const t of raid.traps) {
        if (t.kind === "flame" && t.active) {
          for (let i = 1; i <= 3; i++)
            addLight(
              t.obj.x + 0.5 + DX[t.obj.dir] * i,
              t.obj.y + 0.5 + DY[t.obj.dir] * i,
              1.5,
              "#ff8a3a",
              0.8,
            );
        }
        if (t.kind === "flame" && t.warn)
          addLight(t.obj.x + 0.5, t.obj.y + 0.5, 0.9, "#ff5a2a", 0.5);
        if (t.kind === "gas" && t.active)
          addLight(t.obj.x + 0.5, t.obj.y + 0.5, 1.8, "#89d36a", 0.4);
        if (t.kind === "pylon" && !t.disabled)
          addLight(
            t.obj.x + 0.5,
            t.obj.y,
            t.warn ? 1.6 : 0.9,
            "#9fc8ff",
            t.warn ? 0.8 : 0.4,
          );
      }
      for (const [k] of raid.tarFire)
        addLight(
          (k % l.w) + 0.5,
          Math.floor(k / l.w) + 0.5,
          1.6,
          "#ff7a2a",
          0.85,
        );
      for (const p of raid.projectiles)
        if (p.kind === "fireball" || p.kind === "shadow")
          addLight(
            p.x,
            p.y - 0.3,
            1.1,
            p.kind === "fireball" ? "#ff8a3a" : "#b48cff",
            0.8,
          );
    }
    for (const f of this.flashes)
      addLight(f.x, f.y, f.r, f.color, f.life / f.max);
    this.flashes = this.flashes.filter((f) => (f.life -= dt) > 0);
    lc.globalAlpha = 1;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "multiply";
    ctx.drawImage(this.light, 0, 0, this.canvas.width, this.canvas.height);
    ctx.globalCompositeOperation = "source-over";

    // ---------- additive glow pass ----------
    world();
    ctx.globalCompositeOperation = "lighter";
    for (const t of this.torches) {
      const f = 0.85 + 0.15 * noise1(time * 9 + t.x * 3);
      ctx.globalAlpha = 0.9;
      ctx.drawImage(
        this.lightSprite(b.torch),
        t.x - 0.22 * f,
        t.y - 0.34 * f,
        0.44 * f,
        0.5 * f,
      );
      ctx.globalAlpha = 0.25;
      ctx.drawImage(
        this.lightSprite("#ff9a40"),
        t.x - 0.6,
        t.y - 0.6,
        1.2,
        1.2,
      );
    }
    ctx.globalAlpha = 0.3 + Math.sin(time * 2) * 0.08;
    ctx.drawImage(
      this.lightSprite("#ffcf6a"),
      l.hoard.x - 0.4,
      l.hoard.y - 0.5,
      1.8,
      1.8,
    );
    ctx.globalAlpha = 1;
    this.drawZaps(ctx, dt);
    if (raid) this.drawTelegraphs(ctx, raid, time, true);
    this.fx.drawWorld(ctx, true);
    // Dust motes catching the light.
    if (!this.fx.reduce) {
      ctx.fillStyle = "#fff4dc";
      for (const m of this.motes) {
        m.p += dt;
        m.y -= dt * (0.05 + m.s * 0.08);
        m.x += Math.sin(m.p * 0.7 + m.s * 9) * dt * 0.06;
        if (m.y < -0.5) {
          m.y = l.h + 0.5;
          m.x = Math.random() * l.w;
        }
        ctx.globalAlpha = 0.08 + m.s * 0.12;
        ctx.beginPath();
        ctx.arc(m.x, m.y, 0.015 + m.s * 0.02, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = "source-over";

    // ---------- overlays (unlit, always readable) ----------
    if (raid) {
      this.drawTelegraphOutlines(ctx, raid, time);
      for (const h of raid.heroes)
        if (h.alive)
          this.drawHeroBadges(ctx, h, this.actorView(h, scene.alpha), tick);
      for (const m of raid.monsters)
        if (m.alive && m.hp < m.maxHp)
          this.drawBar(
            ctx,
            this.actorView(m, scene.alpha),
            m.hp / m.maxHp,
            "#ff7a6b",
            m.kind === "ogre" ? 1.15 : 0.9,
          );
    }
    for (const p of scene.pendingPowers) this.drawPowerWarn(ctx, p, time);
    if (scene.ghost) this.drawGhost(ctx, l, scene.ghost, time, scene.raid);
    if (scene.selected !== null) {
      const o = l.objects.find((q) => q.id === scene.selected);
      if (o) {
        this.drawRange(ctx, l, o.kind, o.x, o.y, o.dir, time, true);
        this.tileOutline(ctx, o.x, o.y, "#7ef0ff", time);
      }
    }

    // ---------- screen space ----------
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (scene.spotlight) {
      const [sx, sy] = this.toScreen(scene.spotlight.x, scene.spotlight.y);
      const r = scene.spotlight.r * this.scale;
      const g = ctx.createRadialGradient(sx, sy, r * 0.7, sx, sy, r * 1.6);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, "rgba(0,0,0,0.6)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.W, this.H);
    }
    this.drawVignette(ctx, nightK);
    this.fx.drawText(ctx, this.toScreen, this.scale);
    this.fx.drawFlights(ctx);
  }

  private drawVignette(ctx: CanvasRenderingContext2D, nightK: number) {
    if (!this.vignette) {
      const v = document.createElement("canvas");
      v.width = 256;
      v.height = 256;
      const c = v.getContext("2d")!;
      const g = c.createRadialGradient(128, 128, 60, 128, 128, 182);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, "rgba(0,0,0,1)");
      c.fillStyle = g;
      c.fillRect(0, 0, 256, 256);
      this.vignette = v;
    }
    ctx.globalAlpha = 0.45 + nightK * 0.2;
    ctx.drawImage(this.vignette, 0, 0, this.W, this.H);
    ctx.globalAlpha = 1;
  }

  // ---------- pieces ----------
  private actorView(u: Hero | Monster, alpha: number) {
    const x = u.px + (u.x - u.px) * alpha;
    const y = u.py + (u.y - u.py) * alpha;
    let z = 0;
    if (u.hop) {
      const k = Math.min(1, (u.hop.t + alpha) / u.hop.dur);
      z = Math.sin(k * Math.PI) * u.hop.h;
    }
    let av = this.actors.get(u.uid);
    if (!av) {
      av = { walk: -1, lx: x, ly: y };
      this.actors.set(u.uid, av);
    }
    const moved = Math.hypot(x - av.lx, y - av.ly);
    if (moved > 0.001) av.walk = (av.walk < 0 ? 0 : av.walk) + moved * 9;
    else av.walk = -1;
    av.lx = x;
    av.ly = y;
    // Spread units sharing a tile so groups read as groups (presentation only).
    const sx = (((u.uid * 37) % 7) - 3) * 0.055;
    const sy = (((u.uid * 53) % 5) - 2) * 0.04;
    return { x: x + sx, y: y + 0.14 + sy, z, walk: av.walk };
  }
  private shadowAt(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
  ) {
    ctx.save();
    ctx.translate(x, y);
    shadow(ctx, r);
    ctx.restore();
  }
  private drawHeroActor(
    ctx: CanvasRenderingContext2D,
    h: Hero,
    v: { x: number; y: number; z: number; walk: number },
    tick: number,
    time: number,
  ) {
    const since = (tick - h.lastAtk) * TICK;
    const atk = since >= 0 && since < 0.3 ? since / 0.3 : -1;
    const flash = (tick - h.lastHit) * TICK < 0.08 && tick - h.lastHit >= 0;
    ctx.save();
    ctx.translate(v.x, v.y - v.z);
    if (atk >= 0.35 && h.target >= 0)
      ctx.translate(
        h.face * 0.08 * Math.sin(((atk - 0.35) / 0.65) * Math.PI),
        0,
      );
    if (h.st.fear > 0) ctx.translate(Math.sin(time * 40) * 0.02, 0);
    const squash = v.z > 0 ? 1.08 : 1;
    ctx.scale(1 / squash, squash);
    ctx.scale(0.9, 0.9);
    if (h.st.insp > 0) {
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.18 + Math.sin(time * 6) * 0.06;
      ctx.drawImage(this.lightSprite("#ffb0d8"), -0.5, -1.0, 1.0, 1.1);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
    }
    if (h.elite || isChampion(h.cls)) {
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.25 + Math.sin(time * 4) * 0.1;
      ctx.drawImage(this.lightSprite("#ffd166"), -0.6, -1.2, 1.2, 1.3);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
    }
    drawHero(
      ctx,
      h.cls,
      { t: time + h.uid, walk: v.walk, atk, flash, face: h.face },
      h.elite,
      h.loot > 0,
    );
    ctx.restore();
    if (h.st.frozen > 0) {
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = "#bfeaff";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 0.03;
      ctx.beginPath();
      ctx.roundRect(v.x - 0.26, v.y - 0.72, 0.52, 0.76, 0.06);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    // Status particles.
    if (h.st.burn > 0 && Math.random() < 0.4)
      this.fx.emit({
        x: v.x + (Math.random() - 0.5) * 0.3,
        y: v.y - 0.3,
        vz: 0.8,
        max: 0.45,
        size: 0.06,
        size1: 0,
        color: "#ffab3a",
        kind: "dot",
        add: true,
      });
    if (h.st.poison > 0 && Math.random() < 0.12)
      this.fx.emit({
        x: v.x + (Math.random() - 0.5) * 0.3,
        y: v.y - 0.4,
        vz: 0.5,
        max: 0.7,
        size: 0.03,
        size1: 0.06,
        color: "#9dff7a",
        kind: "bubble",
      });
  }
  private drawMonsterActor(
    ctx: CanvasRenderingContext2D,
    m: Monster,
    v: { x: number; y: number; z: number; walk: number },
    tick: number,
    time: number,
  ) {
    const since = (tick - m.lastAtk) * TICK;
    const atk = since >= 0 && since < 0.35 ? since / 0.35 : -1;
    const flash = (tick - m.lastHit) * TICK < 0.08 && tick - m.lastHit >= 0;
    ctx.save();
    ctx.translate(v.x, v.y - v.z);
    if (atk >= 0.35)
      ctx.translate(
        m.face * 0.08 * Math.sin(((atk - 0.35) / 0.65) * Math.PI),
        0,
      );
    ctx.scale(0.9, 0.9);
    drawMonster(
      ctx,
      m.kind,
      { t: time + m.uid, walk: v.walk, atk, flash, face: m.face },
      m.hidden,
    );
    ctx.restore();
  }
  private drawBar(
    ctx: CanvasRenderingContext2D,
    v: { x: number; y: number },
    k: number,
    color: string,
    h: number,
  ) {
    const w = 0.56;
    const x = v.x - w / 2;
    const y = v.y - h;
    ctx.fillStyle = "rgba(10,6,14,0.85)";
    ctx.beginPath();
    ctx.roundRect(x - 0.03, y - 0.03, w + 0.06, 0.12, 0.04);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * Math.max(0, k), 0.06);
  }
  private drawHeroBadges(
    ctx: CanvasRenderingContext2D,
    h: Hero,
    v: { x: number; y: number; z: number },
    tick: number,
  ) {
    const boss = isChampion(h.cls);
    const lift =
      h.cls === "warlord"
        ? 0.45
        : boss
          ? 0.3
          : h.cls === "windcaller"
            ? 0.15
            : 0;
    const top = v.y - v.z - 0.95 - lift;
    this.drawBar(
      ctx,
      { x: v.x, y: top + 0.95 + (boss ? 0.3 : 0) },
      h.hp / h.maxHp,
      h.hp / h.maxHp > 0.35 ? "#7ee081" : "#ff5a4a",
      0.95 + (boss ? 0.3 : 0),
    );
    // Action ring: looting, disarming, digging.
    if (
      h.state === "loot" ||
      h.state === "lure" ||
      h.state === "disarm" ||
      h.state === "dig"
    ) {
      const total =
        h.state === "loot"
          ? 1
          : h.state === "lure"
            ? 0.8
            : h.state === "disarm"
              ? 1.2
              : 2.2;
      const k = 1 - (h.actT * TICK) / total;
      const color =
        h.state === "disarm"
          ? "#7ef0ff"
          : h.state === "dig"
            ? "#e0a060"
            : "#ffd166";
      ctx.beginPath();
      ctx.arc(v.x, top - 0.12, 0.16, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(10,6,14,0.8)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(
        v.x,
        top - 0.12,
        0.12,
        -Math.PI / 2,
        -Math.PI / 2 + Math.PI * 2 * clamp(k, 0, 1),
      );
      ctx.strokeStyle = color;
      ctx.lineWidth = 0.05;
      ctx.stroke();
    }
    if (h.st.fear > 0) {
      ctx.font = "900 0.34px Nunito, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = "#d9b3ff";
      ctx.strokeStyle = "#1a0f24";
      ctx.lineWidth = 0.06;
      ctx.strokeText("!", v.x, top - 0.05);
      ctx.fillText("!", v.x, top - 0.05);
    }
    void tick;
  }

  private drawHoard(
    ctx: CanvasRenderingContext2D,
    l: Layout,
    hoard: number,
    max: number,
    time: number,
  ) {
    const x = l.hoard.x + 0.5;
    const y = l.hoard.y + 0.62;
    const k = max ? clamp(hoard / max, 0, 1) : 0;
    ctx.save();
    ctx.translate(x, y);
    ctx.lineWidth = 0.035;
    ctx.strokeStyle = "#0b0910";
    // Coin pile.
    const pile = 0.15 + k * 0.4;
    ctx.fillStyle = "#b8862a";
    ctx.beginPath();
    ctx.ellipse(0, 0.05, 0.42 * (0.6 + k * 0.5), pile * 0.6, 0, Math.PI, 0);
    ctx.fill();
    ctx.stroke();
    const coins = Math.round(4 + k * 14);
    for (let i = 0; i < coins; i++) {
      const a = cellHash(i, 3, 1) * Math.PI;
      const r = cellHash(i, 4, 1) * 0.36 * (0.6 + k * 0.5);
      const cx = Math.cos(a) * r;
      const cy = 0.02 - Math.sin(a) * r * pile * 1.4;
      ctx.fillStyle = i % 3 ? "#ffd166" : "#f2b33a";
      ctx.beginPath();
      ctx.ellipse(cx, cy, 0.06, 0.035, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 0.015;
      ctx.stroke();
    }
    ctx.lineWidth = 0.035;
    // Chest behind.
    if (k > 0) {
      ctx.fillStyle = "#7a4a22";
      ctx.beginPath();
      ctx.roundRect(-0.22, -0.32 - pile * 0.3, 0.44, 0.24, 0.04);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#ffd166";
      ctx.fillRect(-0.04, -0.26 - pile * 0.3, 0.08, 0.08);
    }
    // Gems.
    for (let i = 0; i < Math.round(k * 4); i++) {
      ctx.fillStyle = ["#ff4a6a", "#4ad0ff", "#7aff8a", "#c77aff"][i];
      const gx = -0.2 + i * 0.13;
      const gy = -0.02 - pile * 0.5 + Math.sin(i * 2) * 0.05;
      ctx.beginPath();
      ctx.moveTo(gx, gy - 0.05);
      ctx.lineTo(gx + 0.04, gy);
      ctx.lineTo(gx, gy + 0.05);
      ctx.lineTo(gx - 0.04, gy);
      ctx.fill();
    }
    // Sparkle.
    const sp = (time * 1.3) % 1;
    if (k > 0 && sp < 0.3) {
      ctx.globalAlpha = 1 - sp / 0.3;
      ctx.fillStyle = "#fffbe6";
      const sx = Math.sin(Math.floor(time * 1.3) * 7) * 0.2;
      ctx.beginPath();
      ctx.moveTo(sx, -pile - 0.12);
      ctx.lineTo(sx + 0.03, -pile - 0.06);
      ctx.lineTo(sx + 0.09, -pile - 0.04);
      ctx.lineTo(sx + 0.03, -pile - 0.02);
      ctx.lineTo(sx, -pile + 0.04);
      ctx.lineTo(sx - 0.03, -pile - 0.02);
      ctx.lineTo(sx - 0.09, -pile - 0.04);
      ctx.lineTo(sx - 0.03, -pile - 0.06);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawTrapAt(
    ctx: CanvasRenderingContext2D,
    o: Placed,
    st: TrapState | undefined,
    raid: Raid | null,
    time: number,
  ) {
    const kind = o.kind as TrapId;
    let fresh = 0;
    if (st) {
      if (kind === "spikes" || kind === "trapdoor" || kind === "spring") {
        const total = kind === "spikes" ? 1.8 : kind === "trapdoor" ? 5 : 1.5;
        const passed = total - st.cd * TICK;
        fresh =
          st.cd > 0
            ? passed < 0.25
              ? 1
              : Math.max(0, 1 - (passed - 0.25) * 3)
            : 0;
      }
    }
    const burning = raid ? raid.tarFire.has(o.y * raid.layout.w + o.x) : false;
    ctx.save();
    const ps = this.popScale(o.id);
    ctx.translate(o.x + 0.5, o.y + 0.58);
    ctx.scale(ps, ps);
    ctx.translate(-0.5, -0.5);
    drawTrap(ctx, kind, {
      t: time + o.id * 0.7,
      dir: o.dir,
      active: !!st?.active || (kind === "keg" && !!st && st.fuse > 0),
      warn: !!st?.warn,
      cooling: !!st && st.cd > 0,
      disabled: !!st?.disabled,
      used: !!st?.used,
      fresh,
      burning,
    });
    ctx.restore();
    if (st?.disabled) {
      ctx.save();
      ctx.strokeStyle = "#7ef0ff";
      ctx.lineWidth = 0.05;
      ctx.beginPath();
      ctx.moveTo(o.x + 0.25, o.y + 0.3);
      ctx.lineTo(o.x + 0.75, o.y + 0.8);
      ctx.moveTo(o.x + 0.75, o.y + 0.3);
      ctx.lineTo(o.x + 0.25, o.y + 0.8);
      ctx.stroke();
      ctx.restore();
    } else if (st?.known && raid && kind !== "lure") {
      // Revealed traps get an eye marker so players see why heroes detour.
      ctx.save();
      ctx.fillStyle = "rgba(126,240,255,0.9)";
      ctx.beginPath();
      ctx.ellipse(o.x + 0.84, o.y + 0.22, 0.1, 0.06, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#0b0910";
      ctx.beginPath();
      ctx.arc(o.x + 0.84, o.y + 0.22, 0.035, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawMovingTraps(
    ctx: CanvasRenderingContext2D,
    raid: Raid,
    alpha: number,
    time: number,
  ) {
    void alpha;
    for (const t of raid.traps) {
      const o = t.obj;
      if (t.kind === "saw") {
        const horizontal = o.dir % 2 === 1;
        const x = o.x + 0.5 + (horizontal ? t.pos : 0);
        const y = o.y + 0.55 + (horizontal ? 0 : t.pos);
        ctx.save();
        ctx.translate(x, y);
        if (t.disabled) ctx.globalAlpha = 0.4;
        drawSawBlade(ctx, t.disabled ? 0 : time);
        ctx.restore();
      }
      if (t.kind === "boulder" && t.active) {
        const x = o.x + 0.5 + DX[o.dir] * t.pos;
        const y = o.y + 0.5 + DY[o.dir] * t.pos;
        ctx.save();
        ctx.translate(x, y);
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.beginPath();
        ctx.ellipse(0, 0.25, 0.36, 0.12, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.rotate(t.pos * 2.5 * (o.dir === 3 ? -1 : 1));
        ctx.lineWidth = 0.04;
        ctx.strokeStyle = "#0b0910";
        ctx.fillStyle = "#8f877c";
        ctx.beginPath();
        ctx.arc(0, -0.05, 0.38, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = "#5a524a";
        ctx.beginPath();
        ctx.moveTo(-0.2, -0.1);
        ctx.lineTo(0.15, 0.05);
        ctx.moveTo(-0.05, -0.3);
        ctx.lineTo(0.05, -0.15);
        ctx.stroke();
        ctx.restore();
        if (Math.random() < 0.5)
          this.fx.emit({
            x,
            y: y + 0.2,
            vx: (Math.random() - 0.5) * 0.6,
            vz: 0.4,
            max: 0.6,
            size: 0.05,
            size1: 0.14,
            color: "rgba(160,150,140,0.6)",
            kind: "smoke",
          });
      }
    }
  }

  private drawProjectiles(
    ctx: CanvasRenderingContext2D,
    raid: Raid,
    alpha: number,
  ) {
    for (const p of raid.projectiles) {
      const x = p.px + (p.x - p.px) * alpha;
      const y = p.py + (p.y - p.py) * alpha - 0.38;
      const ang = Math.atan2(p.y - p.py, p.x - p.px);
      ctx.save();
      ctx.translate(x, y);
      if (p.kind === "dart" || p.kind === "arrow") {
        ctx.rotate(ang);
        ctx.strokeStyle = "#0b0910";
        ctx.lineWidth = 0.07;
        ctx.beginPath();
        ctx.moveTo(-0.22, 0);
        ctx.lineTo(0.16, 0);
        ctx.stroke();
        ctx.strokeStyle = p.kind === "dart" ? "#d9c08a" : "#c8a070";
        ctx.lineWidth = 0.035;
        ctx.stroke();
        ctx.fillStyle = "#e8e8f0";
        ctx.beginPath();
        ctx.moveTo(0.22, 0);
        ctx.lineTo(0.12, -0.05);
        ctx.lineTo(0.12, 0.05);
        ctx.fill();
      } else {
        const color =
          p.kind === "fireball"
            ? "#ff8a3a"
            : p.kind === "shadow"
              ? "#b48cff"
              : p.kind === "note"
                ? "#ff9fd0"
                : p.kind === "web"
                  ? "#e8e0ff"
                  : p.kind === "bolt"
                    ? "#9ff0e8"
                    : "#fff0b0";
        ctx.globalCompositeOperation = "lighter";
        ctx.drawImage(this.lightSprite(color), -0.3, -0.3, 0.6, 0.6);
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = "#fff6d8";
        ctx.beginPath();
        ctx.arc(0, 0, 0.07, 0, Math.PI * 2);
        ctx.fill();
        if (Math.random() < 0.6)
          this.fx.emit({
            x,
            y: y + 0.38,
            z: 0.38,
            max: 0.3,
            size: 0.07,
            size1: 0,
            color,
            add: true,
          });
      }
      ctx.restore();
    }
  }

  private laneTiles(l: Layout, x: number, y: number, dir: number, max: number) {
    const out: { x: number; y: number }[] = [];
    let cx = x;
    let cy = y;
    for (let i = 0; i < max; i++) {
      cx += DX[dir];
      cy += DY[dir];
      if (!walkable(l, cx, cy)) break;
      out.push({ x: cx, y: cy });
    }
    return out;
  }

  private drawTelegraphs(
    ctx: CanvasRenderingContext2D,
    raid: Raid,
    time: number,
    glow: boolean,
  ) {
    const l = raid.layout;
    for (const t of raid.traps) {
      if (t.disabled) continue;
      const o = t.obj;
      if (t.kind === "flame" && (t.warn || t.active)) {
        const lane = this.laneTiles(l, o.x, o.y, o.dir, 3);
        for (const [i, tile] of lane.entries()) {
          if (t.active && glow) {
            for (let k = 0; k < 2; k++)
              this.fx.emit({
                x: tile.x + 0.2 + Math.random() * 0.6,
                y: tile.y + 0.3 + Math.random() * 0.6,
                vx: DX[o.dir] * 1.5,
                vy: DY[o.dir] * 1.5,
                vz: 1 + Math.random(),
                max: 0.35,
                size: 0.14,
                size1: 0.02,
                color: Math.random() < 0.5 ? "#ffcf5a" : "#ff6a2a",
                add: true,
              });
            ctx.globalAlpha = 0.5;
            ctx.drawImage(
              this.lightSprite("#ff8a3a"),
              tile.x - 0.3,
              tile.y - 0.3,
              1.6,
              1.6,
            );
            ctx.globalAlpha = 1;
          } else if (!glow && t.warn) {
            const pulse = 0.25 + 0.2 * Math.sin(time * 18 + i);
            ctx.fillStyle = `rgba(255,90,40,${pulse})`;
            ctx.fillRect(tile.x + 0.05, tile.y + 0.05, 0.9, 0.9);
          }
        }
      }
      if (t.kind === "gas" && t.active && glow) {
        if (Math.random() < 0.6)
          this.fx.emit({
            x: o.x + 0.5 + (Math.random() - 0.5) * 2.4,
            y: o.y + 0.5 + (Math.random() - 0.5) * 2.4,
            vz: 0.15,
            max: 1.2,
            size: 0.25,
            size1: 0.6,
            color: "rgba(140,220,90,0.55)",
            kind: "smoke",
          });
      }
    }
    if (!glow) {
      for (const [k, left] of raid.tarFire) {
        const x = k % l.w;
        const y = Math.floor(k / l.w);
        void left;
        if (Math.random() < 0.7)
          this.fx.emit({
            x: x + 0.15 + Math.random() * 0.7,
            y: y + 0.3 + Math.random() * 0.6,
            vz: 1.2 + Math.random(),
            max: 0.5,
            size: 0.12,
            size1: 0.01,
            color: Math.random() < 0.5 ? "#ffb03a" : "#ff5a1a",
            add: true,
          });
      }
    }
  }

  private drawTelegraphOutlines(
    ctx: CanvasRenderingContext2D,
    raid: Raid,
    time: number,
  ) {
    const l = raid.layout;
    for (const t of raid.traps) {
      if (t.disabled) continue;
      const o = t.obj;
      if (t.kind === "flame" && t.warn) {
        for (const tile of this.laneTiles(l, o.x, o.y, o.dir, 3))
          this.hatch(ctx, tile.x, tile.y, "rgba(255,120,60,0.8)", time);
      }
      if (t.kind === "pylon" && t.warn) {
        ctx.beginPath();
        ctx.arc(o.x + 0.5, o.y + 0.5, 2.6, 0, Math.PI * 2);
        ctx.setLineDash([0.12, 0.12]);
        ctx.lineDashOffset = -time * 2;
        ctx.strokeStyle = "rgba(160,200,255,0.75)";
        ctx.lineWidth = 0.045;
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (t.kind === "gas" && t.warn) {
        ctx.beginPath();
        ctx.arc(o.x + 0.5, o.y + 0.5, 1.6, 0, Math.PI * 2);
        ctx.setLineDash([0.15, 0.1]);
        ctx.lineDashOffset = -time;
        ctx.strokeStyle = "rgba(170,255,120,0.8)";
        ctx.lineWidth = 0.05;
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (t.kind === "boulder" && t.armT > 0) {
        for (const tile of this.laneTiles(l, o.x, o.y, o.dir, 12))
          this.hatch(ctx, tile.x, tile.y, "rgba(255,70,60,0.85)", time);
      }
      if (t.kind === "keg" && t.fuse > 0) {
        ctx.beginPath();
        ctx.arc(o.x + 0.5, o.y + 0.5, 1.7, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,80,60,${0.5 + 0.5 * Math.sin(time * 30)})`;
        ctx.lineWidth = 0.06;
        ctx.stroke();
      }
    }
  }

  private hatch(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    color: string,
    time: number,
  ) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + 0.04, y + 0.04, 0.92, 0.92);
    ctx.clip();
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.06;
    const off = (time * 0.8) % 0.3;
    ctx.beginPath();
    for (let i = -1; i < 7; i++) {
      ctx.moveTo(x + i * 0.3 + off - 0.3, y);
      ctx.lineTo(x + i * 0.3 + off + 0.7, y + 1);
    }
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.04;
    ctx.strokeRect(x + 0.04, y + 0.04, 0.92, 0.92);
  }

  private drawPowerWarn(
    ctx: CanvasRenderingContext2D,
    p: { power: string; x: number; y: number; t: number },
    time: number,
  ) {
    if (p.power === "rockfall") {
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          this.hatch(ctx, p.x + dx, p.y + dy, "rgba(255,70,60,0.9)", time);
    }
  }

  private drawPath(
    ctx: CanvasRenderingContext2D,
    path: { x: number; y: number }[],
    time: number,
  ) {
    if (path.length < 2) return;
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(path[0].x + 0.5, path[0].y + 0.5);
    for (const p of path.slice(1)) ctx.lineTo(p.x + 0.5, p.y + 0.55);
    ctx.strokeStyle = "rgba(10,6,14,0.5)";
    ctx.lineWidth = 0.16;
    ctx.stroke();
    ctx.setLineDash([0.14, 0.18]);
    ctx.lineDashOffset = -time * 0.9;
    ctx.strokeStyle = "rgba(160,235,255,0.85)";
    ctx.lineWidth = 0.07;
    ctx.stroke();
    ctx.setLineDash([]);
    // Chevrons every few tiles.
    for (let i = 2; i < path.length - 1; i += 3) {
      const a = path[i];
      const b = path[i + 1];
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      ctx.save();
      ctx.translate(
        a.x + 0.5 + (b.x - a.x) * 0.5,
        a.y + 0.55 + (b.y - a.y) * 0.5,
      );
      ctx.rotate(ang);
      ctx.fillStyle = "rgba(160,235,255,0.9)";
      ctx.beginPath();
      ctx.moveTo(0.1, 0);
      ctx.lineTo(-0.06, -0.09);
      ctx.lineTo(-0.06, 0.09);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  private tileOutline(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    color: string,
    time: number,
  ) {
    const p = 0.04 + Math.sin(time * 6) * 0.02;
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.06;
    ctx.beginPath();
    ctx.roundRect(x + p, y + p, 1 - p * 2, 1 - p * 2, 0.12);
    ctx.stroke();
  }

  drawRange(
    ctx: CanvasRenderingContext2D,
    l: Layout,
    kind: PieceId,
    x: number,
    y: number,
    dir: number,
    time: number,
    strong: boolean,
  ) {
    const a = strong ? 0.85 : 0.6;
    const laneFor: Partial<Record<PieceId, number>> = {
      darts: 6,
      flame: 3,
      boulder: 8,
      spring: 3,
    };
    if (kind in laneFor) {
      const lane = this.laneTiles(l, x, y, dir, laneFor[kind]!);
      for (const [i, t] of lane.entries()) {
        ctx.fillStyle = `rgba(255,140,90,${0.18 + 0.08 * Math.sin(time * 5 - i)})`;
        ctx.fillRect(t.x + 0.08, t.y + 0.08, 0.84, 0.84);
      }
      const end = lane[lane.length - 1];
      if (end) {
        ctx.strokeStyle = `rgba(255,170,120,${a})`;
        ctx.lineWidth = 0.06;
        ctx.beginPath();
        ctx.moveTo(x + 0.5, y + 0.5);
        ctx.lineTo(end.x + 0.5, end.y + 0.5);
        ctx.stroke();
        ctx.save();
        ctx.translate(end.x + 0.5, end.y + 0.5);
        ctx.rotate((dir * Math.PI) / 2);
        ctx.fillStyle = `rgba(255,170,120,${a})`;
        ctx.beginPath();
        ctx.moveTo(0, -0.2);
        ctx.lineTo(-0.14, 0);
        ctx.lineTo(0.14, 0);
        ctx.fill();
        ctx.restore();
      }
    }
    if (kind === "saw") {
      const horizontal = dir % 2 === 1;
      const ax = horizontal ? 1 : 0;
      const ay = horizontal ? 0 : 1;
      for (const s of [-1, 1]) {
        let i = 0;
        while (
          walkable(l, x + ax * s * (i + 1), y + ay * s * (i + 1)) &&
          i < 12
        ) {
          i++;
          ctx.fillStyle = "rgba(255,140,90,0.2)";
          ctx.fillRect(x + ax * s * i + 0.1, y + ay * s * i + 0.1, 0.8, 0.8);
        }
      }
    }
    const radius: Partial<Record<PieceId, number>> = {
      gas: 1.6,
      keg: 1.7,
      pylon: 2.6,
      lure: 0,
    };
    if (PIECES[kind].kind === "monster") {
      const st = MONSTERS[kind as keyof typeof MONSTERS];
      radius[kind] = Math.max(st.range > 1.5 ? st.range : st.aggro, 1);
    }
    const r = radius[kind];
    if (r) {
      ctx.beginPath();
      ctx.arc(x + 0.5, y + 0.5, r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,140,90,0.08)";
      ctx.fill();
      ctx.setLineDash([0.18, 0.12]);
      ctx.lineDashOffset = -time * 0.5;
      ctx.strokeStyle = `rgba(255,170,120,${a})`;
      ctx.lineWidth = 0.05;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  private drawGhost(
    ctx: CanvasRenderingContext2D,
    l: Layout,
    g: Ghost,
    time: number,
    raid: Raid | null,
  ) {
    const color = g.ok ? "#7ef0a0" : "#ff5a5a";
    if (g.kind === "dig" || g.kind === "fill" || g.kind === "sell") {
      this.tileOutline(
        ctx,
        g.x,
        g.y,
        g.kind === "sell" ? "#ffd166" : color,
        time,
      );
      if (g.kind === "dig" && g.ok) {
        ctx.fillStyle = "rgba(126,240,160,0.18)";
        ctx.fillRect(g.x, g.y, 1, 1);
      }
      return;
    }
    if (g.ok && !raid)
      this.drawRange(ctx, l, g.kind, g.x, g.y, g.dir, time, false);
    ctx.save();
    ctx.globalAlpha = 0.72;
    const def = PIECES[g.kind];
    if (def.kind === "trap") {
      ctx.translate(g.x, g.y + 0.08);
      drawTrap(ctx, g.kind as TrapId, {
        t: time,
        dir: g.dir,
        active: false,
        warn: false,
        cooling: false,
        disabled: false,
        used: false,
      });
    } else {
      ctx.translate(g.x + 0.5, g.y + 0.62);
      ctx.scale(0.8, 0.8);
      drawMonster(
        ctx,
        g.kind as never,
        { t: time, walk: -1, atk: -1, flash: false, face: 1 },
        false,
      );
    }
    ctx.restore();
    this.tileOutline(ctx, g.x, g.y, color, time);
  }
}

function shade(color: string, amt: number) {
  let r: number, g: number, b: number;
  if (color.startsWith("#")) {
    const n = parseInt(color.slice(1), 16);
    r = (n >> 16) & 255;
    g = (n >> 8) & 255;
    b = n & 255;
  } else {
    [r, g, b] = (color.match(/\d+/g) ?? ["0", "0", "0"]).map(Number);
  }
  if (amt >= 0) {
    r += (255 - r) * amt;
    g += (255 - g) * amt;
    b += (255 - b) * amt;
  } else {
    r *= 1 + amt;
    g *= 1 + amt;
    b *= 1 + amt;
  }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
function withAlpha(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
