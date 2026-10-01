import { ROOM_TOOLS } from "../core/rooms";
import type { RoomTool } from "../core/rooms";
import { CONTENT } from "../core/content";
import { isFloor, objectAt } from "../core/dungeon";
import { pointKey } from "../core/types";
import type { Dungeon, ObjectType, Point, RunState, Tool } from "../core/types";
import type { Category } from "../core/types";
import type { DungeonAnalytics } from "../services/analytics";
import { isAdvancedObject } from "../core/configuration";

export interface RenderOptions {
  hiddenLayers?: ReadonlySet<Category>;
  dungeon: Dungeon;
  state?: RunState;
  grid: boolean;
  reducedMotion: boolean;
  hover: Point | null;
  tool: Tool;
  selected: string[];
  heatmap?: DungeonAnalytics;
  cursor?: Point;
  showCursor?: boolean;
  time: number;
}
const CELL = 48;
const PAD = 24;
const noise = (x: number, y: number): number =>
  ((x * 374761393 + y * 668265263) ^ (x * 1274126177)) >>> 0;

/** Procedural art is presentation only. Simulation owns every gameplay result. */
export class DungeonRenderer {
  floor = 0;
  zoom = 1;
  pan = { x: 0, y: 0 };
  private context: CanvasRenderingContext2D;
  constructor(readonly canvas: HTMLCanvasElement) {
    this.context = canvas.getContext("2d")!;
    canvas.width = 768 * Math.min(devicePixelRatio || 1, 2);
    canvas.height = 672 * Math.min(devicePixelRatio || 1, 2);
  }
  point(clientX: number, clientY: number): Point | null {
    const rect = this.canvas.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * 768;
    const py = ((clientY - rect.top) / rect.height) * 672;
    const x = Math.floor(
      ((px - 384 - this.pan.x) / this.zoom + 384 - PAD) / CELL,
    );
    const y = Math.floor(
      ((py - 336 - this.pan.y) / this.zoom + 336 - PAD) / CELL,
    );
    return x >= 0 && x < 15 && y >= 0 && y < 13
      ? { x, y: y + this.floor * 13 }
      : null;
  }
  fit(): void {
    this.zoom = 1;
    this.pan = { x: 0, y: 0 };
  }
  draw(options: RenderOptions): void {
    const { dungeon, state, grid, reducedMotion, time } = options;
    const c = this.context;
    const hues: Record<string, number> = {
      "forgotten-cave": 90,
      "ancient-ruins": 38,
      castle: 215,
      fortress: 205,
      temple: 280,
      "underground-city": 28,
      hell: 5,
      "alien-facility": 170,
    };
    const hue = hues[dungeon.theme];
    const dpr = this.canvas.width / 768;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = "#111a18";
    c.fillRect(0, 0, 768, 672);
    const background = c.createRadialGradient(380, 310, 50, 380, 310, 480);
    background.addColorStop(0, "#23332b");
    background.addColorStop(1, "#101917");
    c.fillStyle = background;
    c.fillRect(0, 0, 768, 672);
    c.save();
    c.translate(384 + this.pan.x, 336 + this.pan.y);
    c.scale(this.zoom, this.zoom);
    c.translate(-384, -336);
    c.fillStyle = "#66746a";
    c.font = "9px monospace";
    c.textAlign = "center";
    for (let x = 0; x < dungeon.width; x++)
      c.fillText(String(x + 1).padStart(2, "0"), PAD + x * CELL + CELL / 2, 14);
    for (let y = 0; y < 13; y++)
      c.fillText(String.fromCharCode(65 + y), 12, PAD + y * CELL + 28);
    c.translate(PAD, PAD);
    c.beginPath();
    c.rect(0, 0, CELL * 15, CELL * 13);
    c.clip();
    c.translate(0, -this.floor * 13 * CELL);
    // Dirt, scattered roots, and stone fragments keep uncarved space atmospheric.
    for (let y = this.floor * 13; y < (this.floor + 1) * 13; y++)
      for (let x = 0; x < dungeon.width; x++) {
        const n = noise(x + 4, y + 8);
        const px = x * CELL;
        const py = y * CELL;
        if (!isFloor(dungeon, { x, y })) {
          c.fillStyle = n % 3 ? "#1b2822" : "#1d2b24";
          c.beginPath();
          c.ellipse(
            px + 14 + (n % 17),
            py + 12 + (n % 21),
            7 + (n % 10),
            3 + (n % 5),
            n % 4,
            0,
            Math.PI * 2,
          );
          c.fill();
          c.strokeStyle = "#29372c";
          c.lineWidth = 1;
          if (n % 4 === 0) {
            c.beginPath();
            c.moveTo(px + 8, py + 7);
            c.lineTo(px + 18, py + 24);
            c.lineTo(px + 12, py + 33);
            c.stroke();
          }
        }
        if (grid && !state) {
          c.strokeStyle = "rgba(139,161,137,.045)";
          c.lineWidth = 1;
          c.strokeRect(px + 0.5, py + 0.5, CELL, CELL);
        }
      }
    // Draw wall silhouettes first so their depth falls behind the walkable tiles.
    for (let y = this.floor * 13; y < (this.floor + 1) * 13; y++)
      for (let x = 0; x < dungeon.width; x++) {
        if (!isFloor(dungeon, { x, y })) continue;
        const px = x * CELL;
        const py = y * CELL;
        c.shadowColor = "#050907";
        c.shadowBlur = 14;
        c.shadowOffsetY = 9;
        c.fillStyle = "#101710";
        c.fillRect(px - 8, py - 13, CELL + 16, CELL + 22);
        c.shadowBlur = 0;
        c.shadowOffsetY = 0;
      }
    for (let y = this.floor * 13; y < (this.floor + 1) * 13; y++)
      for (let x = 0; x < dungeon.width; x++) {
        if (!isFloor(dungeon, { x, y })) continue;
        const px = x * CELL;
        const py = y * CELL;
        const n = noise(x, y);
        c.fillStyle = `hsl(${hue} 13% ${28 + (n % 4)}%)`;
        c.fillRect(px, py, CELL, CELL);
        c.fillStyle = "#252e25";
        c.fillRect(px + 1, py + 1, CELL - 2, CELL - 2);
        c.fillStyle = `hsl(${hue} 15% ${30 + (n % 4)}%)`;
        c.fillRect(px + 2, py + 2, CELL - 4, CELL - 5);
        c.fillStyle = "rgba(215,217,174,.08)";
        c.fillRect(px + 3, py + 3, CELL - 6, 1);
        if (n % 3 === 0) {
          c.strokeStyle = "#35402f";
          c.lineWidth = 1;
          c.beginPath();
          c.moveTo(px + 7, py + 2);
          c.lineTo(px + 14, py + 12);
          c.lineTo(px + 11, py + 19);
          c.stroke();
        }
        if (n % 5 === 0) {
          c.fillStyle = "#60714b";
          c.fillRect(px + 3, py + 33, 5, 2);
          c.fillRect(px + 5, py + 37, 7, 2);
        }
        if (!isFloor(dungeon, { x, y: y - 1 })) {
          c.fillStyle = "#252d23";
          c.fillRect(px - 2, py - 13, CELL + 4, 14);
          c.fillStyle = "#747963";
          c.fillRect(px - 2, py - 13, CELL + 4, 5);
          c.fillStyle = "#616951";
          c.fillRect(px, py - 7, CELL - 1, 5);
          c.fillStyle = "#303a2b";
          c.fillRect(px + 23, py - 12, 2, 12);
          c.fillStyle = "rgba(0,0,0,.28)";
          c.fillRect(px, py + 1, CELL, 6);
        }
        if (!isFloor(dungeon, { x: x - 1, y })) {
          c.fillStyle = "#69735a";
          c.fillRect(px - 7, py - 5, 7, CELL + 5);
          c.fillStyle = "#8a8d6b";
          c.fillRect(px - 7, py - 5, 2, CELL + 5);
        }
        if (!isFloor(dungeon, { x: x + 1, y })) {
          c.fillStyle = "#505c45";
          c.fillRect(px + CELL, py - 5, 7, CELL + 5);
          c.fillStyle = "#758060";
          c.fillRect(px + CELL + 4, py - 5, 3, CELL + 5);
        }
        if (!isFloor(dungeon, { x, y: y + 1 })) {
          c.fillStyle = "#737b5c";
          c.fillRect(px - 5, py + CELL - 3, CELL + 10, 6);
          c.fillStyle = "#343e2d";
          c.fillRect(px - 5, py + CELL + 3, CELL + 10, 7);
        }
        if (options.heatmap) {
          const key = pointKey({ x, y });
          const deaths = options.heatmap.deathCells.get(key)?.count ?? 0;
          if (options.heatmap.traffic.has(key)) {
            c.fillStyle = deaths
              ? `rgba(221,99,62,${Math.min(0.3 + deaths * 0.12, 0.8)})`
              : "rgba(97,162,120,.28)";
            c.fillRect(px + 2, py + 2, CELL - 4, CELL - 4);
          }
        }
      }
    // A few wall sconces add a warm, flickering pool of light to the cave.
    for (const p of [
      { x: 1, y: 1 },
      { x: 13, y: 1 },
      { x: 1, y: 8 },
      { x: 13, y: 8 },
    ]) {
      if (!isFloor(dungeon, p)) continue;
      const x = p.x * CELL + 24;
      const y = p.y * CELL - 6;
      const flicker = reducedMotion
        ? 1
        : 0.9 + Math.sin(time / 190 + p.x) * 0.1;
      const glow = c.createRadialGradient(x, y, 1, x, y, 100 * flicker);
      glow.addColorStop(0, "rgba(237,172,77,.27)");
      glow.addColorStop(1, "rgba(237,172,77,0)");
      c.fillStyle = glow;
      c.fillRect(x - 110, y - 110, 220, 220);
      c.fillStyle = "#252317";
      c.fillRect(x - 4, y - 2, 8, 16);
      c.fillStyle = "#b88346";
      c.fillRect(x - 3, y, 6, 9);
      c.fillStyle = "#ffc478";
      c.beginPath();
      c.ellipse(x, y - 3, 4 * flicker, 7 * flicker, 0.15, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "#ffe4a4";
      c.fillRect(x - 1, y - 5, 2, 6);
    }
    if (state?.advanced)
      for (const [key, type] of Object.entries(state.advanced.environment)) {
        const [x, y] = key.split(",").map(Number);
        const colors: Record<string, string> = {
          water: "#3a9fd466",
          ice: "#b0eced88",
          fire: "#e9844166",
          poison: "#90b84866",
          electricity: "#e2e77488",
          lava: "#ef592e88",
          oil: "#1e172899",
          darkness: "#030609cc",
          light: "#efda7144",
          smoke: "#a6afb288",
          wind: "#91d2c233",
        };
        c.fillStyle = colors[type];
        c.fillRect(x * CELL, y * CELL, CELL, CELL);
      }
    for (const raw of dungeon.objects) {
      if (options.hiddenLayers?.has(CONTENT[raw.type].category)) continue;
      const position = state?.advanced?.positions[raw.id];
      const o =
        position && (position.x !== raw.x || position.y !== raw.y)
          ? { ...raw, ...position }
          : raw;
      if (
        state?.advanced?.destroyed.includes(o.id) ||
        Math.floor(o.y / 13) !== this.floor
      )
        continue;
      if (state?.collected.includes(o.id)) continue;
      const enemy = state?.enemies.find((e) => e.id === o.id);
      if (enemy && enemy.hp === 0) {
        c.fillStyle = "#77796a";
        c.font = "22px Georgia";
        c.textAlign = "center";
        c.fillText("×", o.x * CELL + 24, o.y * CELL + 31);
        continue;
      }
      c.save();
      c.translate(o.x * CELL + 24, o.y * CELL + 24);
      if (
        state &&
        ["stalker", "mimic"].includes(o.type) &&
        Math.abs(state.player.x - o.x) + Math.abs(state.player.y - o.y) > 2 &&
        !dungeon.objects.some(
          (light) =>
            light.type === "light" &&
            Math.abs(light.x - o.x) + Math.abs(light.y - o.y) <= 3,
        )
      ) {
        if (o.type === "mimic") drawMechanism(c, "gold", 0, 0);
        c.restore();
        continue;
      }
      if (state?.opened.includes(o.id)) c.globalAlpha = 0.3;
      if (state?.advanced && !state.advanced.active[o.id]) c.globalAlpha *= 0.6;
      if (o.type === "boss" && o.config?.body === "serpent") c.scale(1.35, 0.7);
      if (o.type === "boss" && o.config?.body === "sentinel") c.scale(0.8, 1.2);
      drawSprite(c, o.type, o.rotation, reducedMotion ? 0 : time);
      c.restore();
      if (enemy && enemy.hp < (o.config?.hp ?? CONTENT[o.type].hp!)) {
        c.fillStyle = "#1a211b";
        c.fillRect(o.x * CELL + 7, o.y * CELL + 3, 34, 4);
        c.fillStyle = "#de946f";
        c.fillRect(
          o.x * CELL + 7,
          o.y * CELL + 3,
          (34 * enemy.hp) / (o.config?.hp ?? CONTENT[o.type].hp!),
          4,
        );
      }
      if (options.selected.includes(o.id)) {
        c.strokeStyle = "#ecc583";
        c.lineWidth = 2;
        c.setLineDash([5, 3]);
        c.strokeRect(o.x * CELL + 1, o.y * CELL + 1, CELL - 2, CELL - 2);
        c.setLineDash([]);
      }
    }
    if (state) {
      const { player } = state;
      c.save();
      c.translate(player.x * CELL + 24, player.y * CELL + 24);
      const glow = c.createRadialGradient(0, 0, 1, 0, 0, 54);
      glow.addColorStop(0, "rgba(127,218,210,.24)");
      glow.addColorStop(1, "rgba(127,218,210,0)");
      c.fillStyle = glow;
      c.fillRect(-54, -54, 108, 108);
      drawHero(c, state.status === "dead");
      c.restore();
      if (state.status === "dead") {
        c.strokeStyle = "#f19576";
        c.lineWidth = 3;
        c.beginPath();
        c.arc(player.x * CELL + 24, player.y * CELL + 24, 24, 0, Math.PI * 2);
        c.stroke();
      }
    }
    if (options.heatmap)
      for (const cell of options.heatmap.deathCells.values()) {
        c.fillStyle = "#8a342b";
        c.beginPath();
        c.arc(
          cell.point.x * CELL + 36,
          cell.point.y * CELL + 10,
          11,
          0,
          Math.PI * 2,
        );
        c.fill();
        c.fillStyle = "#fff1df";
        c.font = "bold 12px sans-serif";
        c.textAlign = "center";
        c.fillText(
          String(cell.count),
          cell.point.x * CELL + 36,
          cell.point.y * CELL + 14,
        );
      }
    const hover = options.showCursor ? options.cursor : options.hover;
    if (hover && !state && !options.heatmap) {
      const shape = ROOM_TOOLS[options.tool as RoomTool] ?? {
        width: 1,
        height: 1,
      };
      const radiusX = Math.floor(shape.width / 2),
        radiusY = Math.floor(shape.height / 2);
      const valid =
        Object.hasOwn(ROOM_TOOLS, options.tool) ||
        ["floor", "wall", "erase", "select"].includes(options.tool) ||
        (isFloor(dungeon, hover) && !objectAt(dungeon, hover));
      c.fillStyle = valid ? "rgba(237,199,133,.17)" : "rgba(225,116,91,.2)";
      c.strokeStyle = valid ? "#ebc584" : "#ee977e";
      c.lineWidth = 2;
      c.fillRect(
        (hover.x - radiusX) * CELL,
        (hover.y - radiusY) * CELL,
        CELL * shape.width,
        CELL * shape.height,
      );
      c.strokeRect(
        (hover.x - radiusX) * CELL + 1,
        (hover.y - radiusY) * CELL + 1,
        CELL * shape.width - 2,
        CELL * shape.height - 2,
      );
      if (Object.hasOwn(CONTENT, options.tool)) {
        c.save();
        c.globalAlpha = 0.5;
        c.translate(hover.x * CELL + 24, hover.y * CELL + 24);
        drawSprite(c, options.tool as ObjectType, 0, 0);
        c.restore();
      }
    }
    c.restore();
  }
}

function shadow(c: CanvasRenderingContext2D, width = 15): void {
  c.fillStyle = "rgba(9,16,10,.5)";
  c.beginPath();
  c.ellipse(1, 14, width, 6, 0, 0, Math.PI * 2);
  c.fill();
}
function drawSprite(
  c: CanvasRenderingContext2D,
  type: ObjectType,
  rotation: number,
  time: number,
): void {
  shadow(c);
  if (isAdvancedObject(type)) {
    drawMechanism(c, type, rotation, time);
    return;
  }
  if (type === "entrance") {
    c.fillStyle = "#253b36";
    c.fillRect(-15, -15, 30, 29);
    c.strokeStyle = "#b1c2a5";
    c.lineWidth = 5;
    c.beginPath();
    c.moveTo(-14, 16);
    c.lineTo(-14, -8);
    c.arc(0, -8, 14, Math.PI, 0);
    c.lineTo(14, 16);
    c.stroke();
    c.fillStyle = "#609c90";
    c.fillRect(-8, -7, 16, 22);
    c.fillStyle = "#aad7bd";
    c.beginPath();
    c.moveTo(-5, 0);
    c.lineTo(0, 6);
    c.lineTo(5, 0);
    c.lineTo(2, 0);
    c.lineTo(2, -6);
    c.lineTo(-2, -6);
    c.lineTo(-2, 0);
    c.fill();
  } else if (type === "treasure") {
    const glow = c.createRadialGradient(0, 0, 1, 0, 0, 36);
    glow.addColorStop(0, "rgba(252,200,89,.23)");
    glow.addColorStop(1, "rgba(252,200,89,0)");
    c.fillStyle = glow;
    c.fillRect(-36, -36, 72, 72);
    c.fillStyle = "#49301e";
    c.fillRect(-16, -9, 32, 25);
    c.fillStyle = "#b88339";
    c.fillRect(-15, -9, 30, 9);
    c.fillStyle = "#805626";
    c.fillRect(-15, 1, 30, 14);
    c.fillStyle = "#e6bf69";
    c.fillRect(-15, 0, 30, 3);
    c.fillRect(-11, -9, 3, 25);
    c.fillRect(8, -9, 3, 25);
    c.fillRect(-3, 0, 6, 8);
    c.fillStyle = "#4e3820";
    c.fillRect(-1, 2, 2, 3);
    c.strokeStyle = "#f8d984";
    c.lineWidth = 1;
    c.strokeRect(-15, -9, 30, 25);
  } else if (type === "key") {
    c.save();
    c.rotate(-0.6);
    c.strokeStyle = "#edcc79";
    c.lineWidth = 4;
    c.beginPath();
    c.arc(0, -9, 6, 0, Math.PI * 2);
    c.moveTo(0, -3);
    c.lineTo(0, 15);
    c.moveTo(0, 9);
    c.lineTo(6, 9);
    c.moveTo(0, 14);
    c.lineTo(5, 14);
    c.stroke();
    c.restore();
  } else if (type === "door") {
    c.save();
    c.rotate(((rotation % 2) * Math.PI) / 2);
    c.fillStyle = "#252b22";
    c.fillRect(-21, -9, 42, 22);
    c.fillStyle = "#a29068";
    c.fillRect(-21, -13, 6, 31);
    c.fillRect(15, -13, 6, 31);
    c.fillStyle = "#675239";
    c.fillRect(-14, -9, 28, 25);
    c.strokeStyle = "#352d22";
    c.lineWidth = 2;
    for (let x = -10; x <= 10; x += 6) {
      c.beginPath();
      c.moveTo(x, -8);
      c.lineTo(x, 16);
      c.stroke();
    }
    c.fillStyle = "#a4936b";
    c.fillRect(-14, -4, 28, 3);
    c.fillRect(-14, 9, 28, 3);
    c.fillStyle = "#e4c16f";
    c.fillRect(-3, 0, 7, 8);
    c.restore();
  } else if (type === "spikes") {
    c.fillStyle = "#343b32";
    c.fillRect(-18, -14, 36, 31);
    c.strokeStyle = "#717961";
    c.strokeRect(-18, -14, 36, 31);
    for (let y = -5; y <= 10; y += 13)
      for (let x = -11; x <= 11; x += 11) {
        c.fillStyle = "#b8bda8";
        c.beginPath();
        c.moveTo(x - 5, y + 5);
        c.lineTo(x, y - 10);
        c.lineTo(x + 5, y + 5);
        c.fill();
        c.fillStyle = "#747f70";
        c.beginPath();
        c.moveTo(x, y - 10);
        c.lineTo(x + 5, y + 5);
        c.lineTo(x, y + 5);
        c.fill();
      }
  } else if (type === "fire") {
    c.fillStyle = "#2b3027";
    c.beginPath();
    c.ellipse(0, 10, 16, 9, 0, 0, Math.PI * 2);
    c.fill();
    const sway = time ? Math.sin(time / 170) * 2 : 0;
    c.fillStyle = "#d77742";
    c.beginPath();
    c.moveTo(-11, 9);
    c.bezierCurveTo(-20, -4, -2, -6, -3 + sway, -24);
    c.bezierCurveTo(13, -9, 19, 4, 8, 13);
    c.fill();
    c.fillStyle = "#f7c06a";
    c.beginPath();
    c.moveTo(-5, 12);
    c.quadraticCurveTo(-10, 0, 3 + sway, -11);
    c.quadraticCurveTo(2, 0, 8, 9);
    c.quadraticCurveTo(4, 17, -5, 12);
    c.fill();
  } else if (type === "potion") {
    c.fillStyle = "#adbeaa";
    c.fillRect(-5, -18, 10, 8);
    c.fillStyle = "#85704c";
    c.fillRect(-6, -21, 12, 4);
    c.fillStyle = "#689f79";
    c.beginPath();
    c.moveTo(-5, -10);
    c.lineTo(-13, 6);
    c.quadraticCurveTo(-16, 17, 0, 17);
    c.quadraticCurveTo(16, 17, 13, 6);
    c.lineTo(5, -10);
    c.fill();
    c.fillStyle = "#b8d7a0";
    c.fillRect(-2, 0, 4, 11);
    c.fillRect(-6, 4, 12, 3);
  } else if (type === "slime") {
    const bob = time ? Math.sin(time / 370) * 1.5 : 0;
    c.fillStyle = "#6b9054";
    c.beginPath();
    c.moveTo(-17, 12);
    c.bezierCurveTo(-17, -20 + bob, 14, -27 + bob, 18, 12);
    c.quadraticCurveTo(0, 23, -17, 12);
    c.fill();
    c.fillStyle = "#94b970";
    c.beginPath();
    c.ellipse(-3, -3 + bob, 10, 11, 0.3, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#25351e";
    c.fillRect(-6, 0, 3, 5);
    c.fillRect(6, 0, 3, 5);
    c.fillRect(0, 8, 4, 2);
  } else if (type === "guardian") {
    c.fillStyle = "#55605a";
    c.fillRect(-17, -6, 34, 22);
    c.fillStyle = "#7c887b";
    c.fillRect(-12, -20, 24, 22);
    c.fillRect(-22, -5, 9, 19);
    c.fillRect(13, -5, 9, 19);
    c.fillStyle = "#abb09a";
    c.fillRect(-12, -20, 24, 4);
    c.fillStyle = "#d7ad65";
    c.fillRect(-7, -10, 5, 3);
    c.fillRect(3, -10, 5, 3);
    c.fillStyle = "#333d35";
    c.fillRect(-5, -1, 10, 3);
    c.fillRect(-12, 14, 9, 7);
    c.fillRect(4, 14, 9, 7);
  } else {
    c.strokeStyle = "#b7baa2";
    c.lineWidth = 4;
    c.beginPath();
    c.moveTo(0, -2);
    c.lineTo(0, 12);
    c.moveTo(-10, 3);
    c.lineTo(10, 3);
    c.moveTo(0, 12);
    c.lineTo(-7, 20);
    c.moveTo(0, 12);
    c.lineTo(7, 20);
    c.stroke();
    c.fillStyle = type === "archer" ? "#9b91ac" : "#d1cbb1";
    c.beginPath();
    c.roundRect(-10, -19, 20, 19, 6);
    c.fill();
    c.fillStyle = "#364031";
    c.fillRect(-6, -12, 4, 5);
    c.fillRect(3, -12, 4, 5);
    c.fillRect(-3, -3, 6, 4);
    if (type === "archer") {
      c.strokeStyle = "#c49a60";
      c.lineWidth = 2;
      c.beginPath();
      c.arc(11, 2, 15, -1.2, 1.2);
      c.stroke();
      c.beginPath();
      c.moveTo(16, -12);
      c.lineTo(16, 16);
      c.stroke();
    } else {
      c.strokeStyle = "#bac4bd";
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(13, 8);
      c.lineTo(19, -10);
      c.stroke();
      c.strokeStyle = "#927247";
      c.beginPath();
      c.moveTo(9, 3);
      c.lineTo(19, 7);
      c.stroke();
    }
  }
}
function drawMechanism(
  c: CanvasRenderingContext2D,
  type: ObjectType,
  rotation: number,
  time: number,
): void {
  const def = CONTENT[type];
  c.fillStyle = def.color;
  c.strokeStyle = "#21352d";
  c.lineWidth = 2;
  if (def.behavior === "enemy") {
    c.beginPath();
    c.roundRect(-15, -19, 30, 36, type === "boss" ? 4 : 12);
    c.fill();
    c.stroke();
    if (type === "bat") {
      c.beginPath();
      c.moveTo(-9, -8);
      c.lineTo(-24, -18);
      c.lineTo(-22, 6);
      c.lineTo(-10, 2);
      c.moveTo(9, -8);
      c.lineTo(24, -18);
      c.lineTo(22, 6);
      c.lineTo(10, 2);
      c.fill();
    }
    if (type === "boss") {
      c.fillStyle = "#eacb7b";
      c.beginPath();
      c.moveTo(-15, -20);
      c.lineTo(-19, -31);
      c.lineTo(-7, -24);
      c.lineTo(0, -33);
      c.lineTo(7, -24);
      c.lineTo(19, -31);
      c.lineTo(15, -20);
      c.fill();
    }
    c.fillStyle = "#202723";
    c.fillRect(-8, -9, 5, 5);
    c.fillRect(3, -9, 5, 5);
    c.fillRect(-4, 5, 8, 3);
    if (type === "shield") {
      c.fillStyle = "#b3c4ad";
      c.beginPath();
      c.moveTo(1, 0);
      c.lineTo(20, -5);
      c.lineTo(18, 13);
      c.lineTo(10, 21);
      c.lineTo(2, 13);
      c.fill();
      c.stroke();
    }
  } else if (def.behavior === "environment" || type === "lava") {
    c.globalAlpha *= 0.8;
    c.beginPath();
    c.ellipse(0, 3, 21, 15, 0, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    c.strokeStyle = "#d7ece0";
    for (let i = -1; i <= 1; i++) {
      c.beginPath();
      c.moveTo(-14, i * 7);
      c.quadraticCurveTo(0, i * 7 - 7, 14, i * 7);
      c.stroke();
    }
  } else if (
    [
      "stairs",
      "elevator",
      "teleporter",
      "teleport-trap",
      "checkpoint",
    ].includes(type)
  ) {
    c.strokeStyle = def.color;
    c.lineWidth = 3;
    if (type === "stairs" || type === "elevator") {
      for (let i = 0; i < 5; i++) {
        c.fillStyle = i % 2 ? "#748f88" : "#a4bbb0";
        c.fillRect(-18 + i * 3, 17 - i * 7, 33 - i * 3, 5);
      }
    } else {
      c.beginPath();
      c.ellipse(0, 0, 17, 22, 0, 0, Math.PI * 2);
      c.stroke();
      c.beginPath();
      c.ellipse(0, 0, 10, 15, 0, 0, Math.PI * 2);
      c.stroke();
      c.fillStyle = "#b2ddc4";
      c.fillRect(-3, -6, 6, 12);
    }
  } else if (def.behavior === "trap") {
    c.fillStyle = "#3d4540";
    c.fillRect(-20, -16, 40, 34);
    c.strokeStyle = def.color;
    c.strokeRect(-20, -16, 40, 34);
    c.save();
    c.rotate(
      (rotation * Math.PI) / 2 +
        (type === "blade" || type === "saw" ? time / 900 : 0),
    );
    if (["blade", "saw"].includes(type)) {
      for (let i = 0; i < 8; i++) {
        c.rotate(Math.PI / 4);
        c.beginPath();
        c.moveTo(0, 0);
        c.lineTo(5, -19);
        c.lineTo(-5, -10);
        c.closePath();
        c.fillStyle = def.color;
        c.fill();
      }
    } else {
      c.fillStyle = def.color;
      c.beginPath();
      c.moveTo(0, -17);
      c.lineTo(12, 4);
      c.lineTo(4, 4);
      c.lineTo(4, 16);
      c.lineTo(-4, 16);
      c.lineTo(-4, 4);
      c.lineTo(-12, 4);
      c.closePath();
      c.fill();
    }
    c.restore();
  } else if (def.behavior === "loot") {
    c.fillStyle = def.color;
    c.beginPath();
    c.moveTo(0, -18);
    c.lineTo(15, 0);
    c.lineTo(0, 19);
    c.lineTo(-15, 0);
    c.closePath();
    c.fill();
    c.stroke();
    c.strokeStyle = "#fff1b4";
    c.beginPath();
    c.moveTo(-7, 0);
    c.lineTo(7, 0);
    c.moveTo(0, -9);
    c.lineTo(0, 9);
    c.stroke();
  } else {
    c.fillStyle = ["block", "barrel", "pillar", "breakable-wall"].includes(type)
      ? "#9f8662"
      : "#4a6b68";
    c.beginPath();
    c.roundRect(-18, -18, 36, 36, type === "barrel" ? 12 : 4);
    c.fill();
    c.strokeStyle = def.color;
    c.stroke();
    const glyph: Record<string, string> = {
      plate: "↓",
      lever: "╱",
      button: "●",
      gate: "╫",
      mirror: "╱",
      timer: "◷",
      counter: "#",
      "and-gate": "&",
      "or-gate": "∨",
      "not-gate": "!",
      proximity: "◎",
      repeater: "↻",
      conveyor: "→",
      platform: "↔",
      "spawn-zone": "+",
      npc: "?",
      "hidden-passage": "⋮",
      bridge: "═",
      block: "■",
      barrel: "✦",
      pillar: "║",
      "breakable-wall": "▦",
      "color-switch": "◆",
    };
    c.fillStyle = def.color;
    c.font = "bold 23px sans-serif";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(glyph[type] ?? "◇", 0, 1);
  }
  c.textBaseline = "alphabetic";
}
function drawHero(c: CanvasRenderingContext2D, dead: boolean): void {
  shadow(c);
  if (dead) {
    c.rotate(Math.PI / 2);
    c.globalAlpha = 0.65;
  }
  c.fillStyle = "#488f86";
  c.beginPath();
  c.moveTo(-10, -5);
  c.lineTo(-15, 16);
  c.lineTo(12, 16);
  c.lineTo(9, -5);
  c.fill();
  c.fillStyle = "#243c39";
  c.fillRect(-8, 12, 6, 10);
  c.fillRect(3, 12, 6, 10);
  c.fillStyle = "#c7b995";
  c.beginPath();
  c.roundRect(-7, -16, 15, 17, 5);
  c.fill();
  c.fillStyle = "#b5c6ba";
  c.fillRect(-10, -19, 19, 9);
  c.fillStyle = "#405a51";
  c.fillRect(-8, -11, 17, 4);
  c.fillStyle = "#88c6bb";
  c.fillRect(-8, 0, 17, 11);
  c.fillStyle = "#b9a068";
  c.fillRect(-9, 9, 19, 4);
  c.strokeStyle = "#d4ddd0";
  c.lineWidth = 4;
  c.beginPath();
  c.moveTo(13, 9);
  c.lineTo(19, -11);
  c.stroke();
  c.strokeStyle = "#b6a16a";
  c.beginPath();
  c.moveTo(10, 4);
  c.lineTo(21, 7);
  c.stroke();
  c.fillStyle = "#425e59";
  c.beginPath();
  c.ellipse(-13, 6, 7, 10, -0.2, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = "#a6b8a1";
  c.lineWidth = 2;
  c.stroke();
}
