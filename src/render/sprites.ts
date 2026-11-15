/**
 * Procedural sprites. Every function draws in tile units (1 = one tile) with
 * the origin at the actor's feet (actors) or the tile's top-left (traps).
 * `flash` turns every fill white for hit feedback.
 */
import type { HeroClass, MonsterId, TrapId } from "../game/defs";

const OUT = "#0b0910";
type C = CanvasRenderingContext2D;

export interface Look {
  t: number; // seconds, for idle animation
  walk: number; // walk phase (radians) or -1 when idle
  atk: number; // 0..1 attack swing progress, -1 none
  flash: boolean;
  face: number;
  alpha?: number;
}

let FLASH = false;
const col = (c: string) => (FLASH ? "#ffffff" : c);

function shape(ctx: C, fill: string, stroke = true) {
  ctx.fillStyle = col(fill);
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = OUT;
    ctx.stroke();
  }
}
function circle(
  ctx: C,
  x: number,
  y: number,
  r: number,
  fill: string,
  stroke = true,
) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  shape(ctx, fill, stroke);
}
function ellipse(
  ctx: C,
  x: number,
  y: number,
  rx: number,
  ry: number,
  fill: string,
  stroke = true,
  rot = 0,
) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  shape(ctx, fill, stroke);
}
function rrect(
  ctx: C,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string,
  stroke = true,
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  shape(ctx, fill, stroke);
}
function poly(ctx: C, pts: number[], fill: string, stroke = true) {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.closePath();
  shape(ctx, fill, stroke);
}
function line(
  ctx: C,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
  w: number,
) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.lineWidth = w + 0.05;
  ctx.strokeStyle = OUT;
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.lineWidth = w;
  ctx.strokeStyle = col(color);
  ctx.stroke();
  ctx.lineWidth = 0.04;
}

const SKIN = "#f0c9a0";

export function shadow(ctx: C, r = 0.26) {
  ctx.beginPath();
  ctx.ellipse(0, 0, r, r * 0.38, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fill();
}

/** Swing angle for weapons: wind back, then strike forward. */
function swing(atk: number) {
  if (atk < 0) return 0;
  if (atk < 0.35) return -0.9 * (atk / 0.35);
  const k = (atk - 0.35) / 0.65;
  return (
    -0.9 + 2.2 * Math.sin(Math.min(1, k * 1.6) * (Math.PI / 2)) * (1 - k * 0.4)
  );
}

export function drawHero(
  ctx: C,
  cls: HeroClass,
  look: Look,
  elite: boolean,
  loot: boolean,
) {
  FLASH = look.flash;
  ctx.save();
  ctx.lineWidth = 0.04;
  ctx.lineJoin = "round";
  const big = cls === "paladin" ? 1.28 : cls === "dwarf" ? 0.92 : 1;
  ctx.scale(big * look.face, big);
  const walking = look.walk >= 0;
  const bob = walking
    ? Math.abs(Math.sin(look.walk)) * 0.05
    : Math.sin(look.t * 2.2) * 0.012;
  const leg = walking ? Math.sin(look.walk) * 0.07 : 0;
  const sw = swing(look.atk);
  const lean = look.atk >= 0.35 ? 0.05 : walking ? 0.03 : 0;
  // Legs.
  rrect(ctx, -0.12 + leg, -0.2, 0.09, 0.2, 0.03, "#3b3140");
  rrect(ctx, 0.03 - leg, -0.2, 0.09, 0.2, 0.03, "#3b3140");
  ctx.translate(lean, -bob);
  const short = cls === "dwarf" ? 0.08 : 0;
  // Cape / back items.
  if (cls === "paladin")
    poly(ctx, [-0.18, -0.55, 0.12, -0.55, 0.05, -0.12, -0.28, -0.1], "#b02a3a");
  if (cls === "ranger" || cls === "rogue")
    poly(
      ctx,
      [-0.16, -0.56, 0.1, -0.56, 0.02, -0.18, -0.24, -0.16],
      cls === "rogue" ? "#2f4a33" : "#4a6b2f",
    );
  if (loot) {
    circle(ctx, -0.2, -0.36, 0.13, "#c8a050");
    circle(ctx, -0.2, -0.36, 0.04, "#ffd166", false);
  }
  // Body.
  const tunic: Record<HeroClass, string> = {
    knight: "#9fb0c8",
    rogue: "#4f7a4a",
    cleric: "#f4ecd2",
    mage: "#6d4bb3",
    ranger: "#6c8a3c",
    dwarf: "#b0703a",
    berserker: "#c9503c",
    paladin: "#e8c25a",
  };
  if (cls === "mage" || cls === "cleric") {
    poly(
      ctx,
      [-0.17, -0.52, 0.17, -0.52, 0.23, -0.12, -0.23, -0.12],
      tunic[cls],
    );
    if (cls === "cleric") {
      rrect(ctx, -0.035, -0.46, 0.07, 0.24, 0.01, "#d9a93a", false);
      rrect(ctx, -0.09, -0.4, 0.18, 0.06, 0.01, "#d9a93a", false);
    } else {
      line(ctx, -0.18, -0.2, 0.18, -0.2, "#c7a2ff", 0.03);
    }
  } else {
    rrect(
      ctx,
      -0.17 - short / 2,
      -0.53 + short,
      0.34 + short,
      0.36 - short,
      0.08,
      tunic[cls],
    );
    if (cls === "knight" || cls === "paladin") {
      rrect(ctx, -0.17, -0.3, 0.34, 0.06, 0.02, "#5a4632");
      ellipse(
        ctx,
        0,
        -0.43,
        0.1,
        0.06,
        cls === "paladin" ? "#fff2b0" : "#c9d6ea",
        false,
      );
    }
    if (cls === "berserker") {
      line(ctx, -0.12, -0.5, 0.12, -0.24, "#5a2a22", 0.05);
    }
  }
  // Off-hand: shield for knights/paladins.
  if (cls === "knight" || cls === "paladin") {
    ctx.save();
    ctx.translate(-0.17, -0.34);
    poly(
      ctx,
      [-0.1, -0.12, 0.1, -0.12, 0.1, 0.02, 0, 0.14, -0.1, 0.02],
      cls === "paladin" ? "#f5d76e" : "#5577aa",
    );
    poly(
      ctx,
      [-0.03, -0.08, 0.03, -0.08, 0.03, 0.06, -0.03, 0.06],
      cls === "paladin" ? "#b02a3a" : "#e8dcc4",
      false,
    );
    ctx.restore();
  }
  // Head.
  const hy = -0.66 + short;
  circle(ctx, 0, hy, 0.15, SKIN);
  // Headgear.
  switch (cls) {
    case "knight":
      ctx.beginPath();
      ctx.arc(0, hy, 0.16, Math.PI * 0.95, Math.PI * 2.05);
      ctx.lineTo(0.16, hy + 0.06);
      ctx.lineTo(-0.16, hy + 0.06);
      ctx.closePath();
      shape(ctx, "#b8c4d6");
      line(ctx, 0.02, hy - 0.01, 0.14, hy - 0.01, "#1c1c24", 0.03);
      ellipse(ctx, -0.05, hy - 0.2, 0.05, 0.1, "#d0413a", true, -0.4);
      break;
    case "paladin":
      ctx.beginPath();
      ctx.arc(0, hy, 0.16, Math.PI * 0.95, Math.PI * 2.05);
      ctx.lineTo(0.16, hy + 0.07);
      ctx.lineTo(-0.16, hy + 0.07);
      ctx.closePath();
      shape(ctx, "#f2d06b");
      line(ctx, 0.02, hy, 0.14, hy, "#3a2a10", 0.03);
      if (!FLASH) {
        ctx.beginPath();
        ctx.ellipse(0, hy - 0.24, 0.16, 0.05, 0, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,240,160,0.9)";
        ctx.lineWidth = 0.035;
        ctx.stroke();
        ctx.lineWidth = 0.04;
      }
      break;
    case "rogue":
      poly(
        ctx,
        [
          -0.17,
          hy + 0.04,
          -0.1,
          hy - 0.18,
          0.12,
          hy - 0.16,
          0.17,
          hy + 0.02,
          0.05,
          hy - 0.06,
          -0.08,
          hy - 0.02,
        ],
        "#2f4a33",
      );
      line(ctx, 0.0, hy + 0.02, 0.15, hy + 0.02, "#1c1c24", 0.05);
      break;
    case "cleric":
      poly(
        ctx,
        [
          -0.16,
          hy + 0.04,
          -0.12,
          hy - 0.14,
          0,
          hy - 0.2,
          0.12,
          hy - 0.14,
          0.16,
          hy + 0.04,
          0.08,
          hy - 0.06,
          -0.08,
          hy - 0.06,
        ],
        "#f4ecd2",
      );
      break;
    case "mage":
      ellipse(ctx, 0, hy - 0.08, 0.24, 0.05, "#4f3390");
      poly(
        ctx,
        [-0.13, hy - 0.09, 0.13, hy - 0.09, -0.06, hy - 0.46],
        "#6d4bb3",
      );
      circle(ctx, -0.06, hy - 0.46, 0.035, "#ffe680", false);
      break;
    case "ranger":
      poly(ctx, [-0.16, hy - 0.04, 0, hy - 0.2, 0.17, hy - 0.04], "#4a6b2f");
      line(ctx, -0.04, hy - 0.14, -0.22, hy - 0.3, "#e85a4f", 0.03);
      break;
    case "dwarf":
      ctx.beginPath();
      ctx.arc(0, hy - 0.02, 0.16, Math.PI, 0);
      ctx.closePath();
      shape(ctx, "#a7adb8");
      poly(
        ctx,
        [-0.14, hy - 0.08, -0.26, hy - 0.22, -0.18, hy - 0.04],
        "#efe6d0",
      );
      poly(ctx, [0.14, hy - 0.08, 0.26, hy - 0.22, 0.18, hy - 0.04], "#efe6d0");
      poly(
        ctx,
        [
          -0.13,
          hy + 0.02,
          0.15,
          hy + 0.02,
          0.1,
          hy + 0.24,
          0.0,
          hy + 0.3,
          -0.08,
          hy + 0.22,
        ],
        "#e07b2c",
      );
      break;
    case "berserker":
      poly(ctx, [-0.04, hy - 0.12, 0.02, hy - 0.3, 0.07, hy - 0.12], "#d4442e");
      poly(
        ctx,
        [-0.12, hy - 0.08, -0.06, hy - 0.26, 0.0, hy - 0.12],
        "#d4442e",
      );
      break;
  }
  // Eye.
  if (cls !== "knight" && cls !== "paladin" && cls !== "rogue")
    circle(ctx, 0.07, hy - 0.01, 0.022, "#1c1c24", false);
  // Weapon arm.
  ctx.save();
  ctx.translate(0.12, -0.36);
  ctx.rotate(sw);
  switch (cls) {
    case "knight":
      line(ctx, 0, 0, 0.1, -0.04, "#c9d6ea", 0.06);
      line(ctx, 0.08, -0.04, 0.38, -0.22, "#dfe7f2", 0.055);
      line(ctx, 0.06, 0.02, 0.12, -0.1, "#8a6a3a", 0.04);
      break;
    case "paladin":
      line(ctx, 0, 0, 0.3, -0.2, "#8a6a3a", 0.05);
      rrect(ctx, 0.24, -0.34, 0.16, 0.12, 0.02, "#f2d06b");
      break;
    case "rogue":
      line(ctx, 0.02, 0, 0.24, -0.1, "#dfe7f2", 0.045);
      break;
    case "cleric":
      line(ctx, 0, 0, 0.24, -0.14, "#8a6a3a", 0.045);
      circle(ctx, 0.26, -0.16, 0.06, "#d9a93a");
      break;
    case "mage":
      line(ctx, 0, 0.14, 0.12, -0.36, "#6b4a2a", 0.045);
      circle(ctx, 0.13, -0.4, 0.06, "#ff9b4a");
      break;
    case "ranger":
      ctx.beginPath();
      ctx.arc(0.1, -0.05, 0.22, -1.3, 1.3);
      ctx.lineWidth = 0.05;
      ctx.strokeStyle = OUT;
      ctx.stroke();
      ctx.lineWidth = 0.035;
      ctx.strokeStyle = col("#8a5a2a");
      ctx.stroke();
      line(ctx, 0.15, -0.26, 0.15, 0.16, "#e8dcc4", 0.012);
      ctx.lineWidth = 0.04;
      break;
    case "dwarf":
      line(ctx, 0, 0, 0.26, -0.16, "#6b4a2a", 0.045);
      poly(ctx, [0.16, -0.26, 0.34, -0.2, 0.4, -0.04, 0.3, -0.12], "#a7adb8");
      break;
    case "berserker":
      line(ctx, 0, 0, 0.3, -0.2, "#6b4a2a", 0.05);
      poly(ctx, [0.22, -0.32, 0.4, -0.3, 0.38, -0.08, 0.26, -0.16], "#cfd6df");
      break;
  }
  ctx.restore();
  if (elite && !FLASH) {
    poly(
      ctx,
      [
        -0.1,
        hy - 0.2,
        -0.1,
        hy - 0.32,
        -0.05,
        hy - 0.26,
        0,
        hy - 0.34,
        0.05,
        hy - 0.26,
        0.1,
        hy - 0.32,
        0.1,
        hy - 0.2,
      ],
      "#ffd166",
    );
  }
  ctx.restore();
  FLASH = false;
}

export function drawMonster(
  ctx: C,
  kind: MonsterId | "minislime" | "risen",
  look: Look,
  hidden = false,
) {
  FLASH = look.flash;
  ctx.save();
  ctx.lineWidth = 0.04;
  ctx.lineJoin = "round";
  if (look.alpha !== undefined) ctx.globalAlpha *= look.alpha;
  ctx.scale(look.face, 1);
  const t = look.t;
  const walking = look.walk >= 0;
  const bob = walking ? Math.abs(Math.sin(look.walk)) * 0.05 : 0;
  const sw = swing(look.atk);
  switch (kind) {
    case "skeleton":
    case "risen": {
      const leg = walking ? Math.sin(look.walk) * 0.07 : 0;
      line(ctx, -0.06 + leg, -0.22, -0.07 + leg, 0, "#e8e0cc", 0.05);
      line(ctx, 0.06 - leg, -0.22, 0.07 - leg, 0, "#e8e0cc", 0.05);
      ctx.translate(0, -bob);
      rrect(
        ctx,
        -0.13,
        -0.5,
        0.26,
        0.3,
        0.06,
        kind === "risen" ? "#b9c4d0" : "#e8e0cc",
      );
      for (let i = 0; i < 3; i++)
        line(
          ctx,
          -0.09,
          -0.44 + i * 0.07,
          0.09,
          -0.44 + i * 0.07,
          "#8f8778",
          0.02,
        );
      circle(ctx, 0, -0.64, 0.16, kind === "risen" ? "#c9d2dc" : "#f1ead8");
      circle(ctx, 0.06, -0.65, 0.045, "#1a1420", false);
      if (!FLASH)
        circle(
          ctx,
          0.06,
          -0.65,
          0.018,
          kind === "risen" ? "#7af0ff" : "#ff5a3c",
          false,
        );
      rrect(ctx, -0.04, -0.54, 0.14, 0.05, 0.01, "#cfc6b0");
      ctx.save();
      ctx.translate(0.12, -0.38);
      ctx.rotate(sw);
      line(ctx, 0, 0, 0.32, -0.16, "#b8b0a0", 0.045);
      ctx.restore();
      break;
    }
    case "archer": {
      ctx.translate(0, -bob);
      const leg = walking ? Math.sin(look.walk) * 0.06 : 0;
      rrect(ctx, -0.1 + leg, -0.16, 0.08, 0.16, 0.03, "#3b4a2a");
      rrect(ctx, 0.02 - leg, -0.16, 0.08, 0.16, 0.03, "#3b4a2a");
      rrect(ctx, -0.14, -0.42, 0.28, 0.28, 0.08, "#6e5236");
      circle(ctx, 0, -0.54, 0.15, "#7fb069");
      poly(ctx, [-0.12, -0.56, -0.32, -0.66, -0.13, -0.5], "#7fb069");
      poly(ctx, [0.12, -0.56, 0.3, -0.64, 0.13, -0.5], "#7fb069");
      circle(ctx, 0.07, -0.56, 0.03, "#ffe14a", false);
      ctx.save();
      ctx.translate(0.14, -0.34);
      ctx.beginPath();
      ctx.arc(0.04, 0, 0.2, -1.3, 1.3);
      ctx.lineWidth = 0.045;
      ctx.strokeStyle = OUT;
      ctx.stroke();
      ctx.lineWidth = 0.03;
      ctx.strokeStyle = col("#8a5a2a");
      ctx.stroke();
      ctx.restore();
      break;
    }
    case "slime":
    case "minislime": {
      const k = kind === "minislime" ? 0.6 : 1;
      const sq = 1 + Math.sin(t * 5 + (walking ? look.walk : 0)) * 0.08;
      ctx.scale(k, k);
      ctx.beginPath();
      ctx.moveTo(-0.3 * sq, 0);
      ctx.quadraticCurveTo(-0.32 * sq, -0.5 / sq, 0, -0.52 / sq);
      ctx.quadraticCurveTo(0.32 * sq, -0.5 / sq, 0.3 * sq, 0);
      ctx.closePath();
      ctx.globalAlpha *= FLASH ? 1 : 0.92;
      shape(ctx, "#4fc796");
      ctx.globalAlpha /= FLASH ? 1 : 0.92;
      if (!FLASH)
        ellipse(
          ctx,
          -0.1,
          -0.36 / sq,
          0.06,
          0.1,
          "rgba(255,255,255,0.45)",
          false,
          -0.5,
        );
      circle(ctx, 0.04, -0.28 / sq, 0.05, "#fff");
      circle(ctx, 0.15, -0.28 / sq, 0.05, "#fff");
      circle(ctx, 0.06, -0.28 / sq, 0.022, "#123", false);
      circle(ctx, 0.17, -0.28 / sq, 0.022, "#123", false);
      break;
    }
    case "ogre": {
      ctx.scale(1.35, 1.35);
      const leg = walking ? Math.sin(look.walk) * 0.05 : 0;
      rrect(ctx, -0.16 + leg, -0.18, 0.12, 0.18, 0.04, "#6b4a32");
      rrect(ctx, 0.04 - leg, -0.18, 0.12, 0.18, 0.04, "#6b4a32");
      ctx.translate(0, -bob);
      ellipse(ctx, 0, -0.4, 0.26, 0.26, "#b57b5a");
      rrect(ctx, -0.22, -0.32, 0.44, 0.12, 0.04, "#6b4a32");
      circle(ctx, 0.04, -0.68, 0.14, "#c08a68");
      circle(ctx, 0.1, -0.7, 0.025, "#1a1420", false);
      poly(ctx, [0.02, -0.6, 0.05, -0.66, 0.08, -0.6], "#f4ecd2", false);
      poly(ctx, [0.12, -0.6, 0.15, -0.66, 0.17, -0.6], "#f4ecd2", false);
      ctx.save();
      ctx.translate(0.2, -0.44);
      ctx.rotate(sw);
      line(ctx, 0, 0, 0.28, -0.18, "#6b4a2a", 0.07);
      circle(ctx, 0.3, -0.2, 0.1, "#5a3a22");
      ctx.restore();
      break;
    }
    case "bat": {
      const flap = Math.sin(t * 22) * 0.6;
      ctx.translate(0, -0.45 + Math.sin(t * 4) * 0.05);
      for (const s of [-1, 1]) {
        ctx.save();
        ctx.scale(s, 1);
        ctx.rotate(flap * 0.5);
        poly(
          ctx,
          [0.05, 0, 0.36, -0.14, 0.3, 0.02, 0.22, -0.02, 0.16, 0.06],
          "#5a4675",
        );
        ctx.restore();
      }
      ellipse(ctx, 0, 0, 0.11, 0.13, "#6e5a8a");
      poly(ctx, [-0.08, -0.1, -0.05, -0.2, -0.01, -0.1], "#6e5a8a");
      poly(ctx, [0.08, -0.1, 0.05, -0.2, 0.01, -0.1], "#6e5a8a");
      circle(ctx, 0.04, -0.02, 0.022, "#ff4a5a", false);
      break;
    }
    case "necro": {
      ctx.translate(0, -bob - Math.sin(t * 2) * 0.02);
      poly(ctx, [-0.2, 0, -0.14, -0.5, 0.14, -0.5, 0.2, 0], "#3b2a5a");
      poly(ctx, [-0.16, -0.48, 0, -0.82, 0.16, -0.48], "#2a1d42");
      circle(ctx, 0.04, -0.58, 0.03, "#b48cff", false);
      line(ctx, 0.2, 0, 0.24, -0.78, "#4a3a2a", 0.04);
      circle(
        ctx,
        0.24,
        -0.82,
        0.07,
        FLASH ? "#fff" : `hsl(${270 + Math.sin(t * 3) * 20},90%,70%)`,
      );
      break;
    }
    case "mimic": {
      const open = hidden
        ? 0
        : 0.3 + Math.abs(Math.sin(t * 6)) * 0.25 + (look.atk >= 0 ? 0.3 : 0);
      ctx.translate(0, -bob);
      rrect(ctx, -0.28, -0.3, 0.56, 0.3, 0.04, "#8a5a2a");
      ctx.save();
      ctx.translate(-0.28, -0.3);
      ctx.rotate(-open);
      rrect(ctx, 0, -0.16, 0.56, 0.16, 0.06, "#a06a32");
      rrect(ctx, 0.24, -0.08, 0.08, 0.1, 0.02, "#ffd166");
      if (!hidden)
        for (let i = 0; i < 5; i++)
          poly(
            ctx,
            [0.05 + i * 0.1, 0, 0.1 + i * 0.1, 0.07, 0.15 + i * 0.1, 0],
            "#f4ecd2",
          );
      ctx.restore();
      if (!hidden) {
        for (let i = 0; i < 5; i++)
          poly(
            ctx,
            [
              -0.23 + i * 0.1,
              -0.3,
              -0.18 + i * 0.1,
              -0.37,
              -0.13 + i * 0.1,
              -0.3,
            ],
            "#f4ecd2",
          );
        circle(ctx, 0.1, -0.38 - open * 0.2, 0.04, "#ff3a3a", false);
      }
      line(ctx, -0.28, -0.15, 0.28, -0.15, "#5a3a1a", 0.03);
      break;
    }
    case "imp": {
      ctx.translate(0, -0.12 - Math.abs(Math.sin(t * 9)) * 0.06);
      const flap = Math.sin(t * 16) * 0.5;
      for (const s of [-1, 1]) {
        ctx.save();
        ctx.scale(s, 1);
        ctx.rotate(flap * 0.4);
        poly(ctx, [0.05, -0.35, 0.3, -0.5, 0.26, -0.3, 0.12, -0.25], "#a5302a");
        ctx.restore();
      }
      ellipse(ctx, 0, -0.28, 0.13, 0.16, "#ff5a3c");
      circle(ctx, 0.02, -0.5, 0.12, "#ff6a48");
      poly(ctx, [-0.08, -0.58, -0.12, -0.72, -0.02, -0.6], "#3a1a1a");
      poly(ctx, [0.08, -0.58, 0.12, -0.72, 0.02, -0.6], "#3a1a1a");
      circle(ctx, 0.07, -0.51, 0.025, "#ffe14a", false);
      line(ctx, -0.08, -0.16, -0.24, -0.04, "#a5302a", 0.03);
      break;
    }
    case "ghost": {
      ctx.globalAlpha *= FLASH ? 1 : 0.8;
      ctx.translate(0, -0.2 + Math.sin(t * 2.5) * 0.06);
      ctx.beginPath();
      ctx.moveTo(-0.22, 0);
      ctx.quadraticCurveTo(-0.26, -0.62, 0, -0.62);
      ctx.quadraticCurveTo(0.26, -0.62, 0.22, 0);
      for (let i = 0; i < 4; i++) {
        const x0 = 0.22 - i * 0.11;
        ctx.quadraticCurveTo(
          x0 - 0.055,
          0.08 + Math.sin(t * 6 + i) * 0.04,
          x0 - 0.11,
          0,
        );
      }
      ctx.closePath();
      shape(ctx, "#cfeaff");
      circle(ctx, 0.0, -0.4, 0.04, "#1a2a3a", false);
      circle(ctx, 0.12, -0.4, 0.04, "#1a2a3a", false);
      ellipse(ctx, 0.06, -0.26, 0.04, 0.06, "#1a2a3a", false);
      break;
    }
  }
  ctx.restore();
  FLASH = false;
}

export interface TrapLook {
  t: number;
  dir: number;
  active: boolean;
  warn: boolean;
  cooling: boolean;
  disabled: boolean;
  used: boolean;
  fresh?: number; // 0..1 spike extension, door open, etc.
  burning?: boolean;
}

/** Traps draw inside a 1x1 tile with origin at its top-left. */
export function drawTrap(ctx: C, kind: TrapId, look: TrapLook) {
  ctx.save();
  ctx.lineWidth = 0.04;
  ctx.lineJoin = "round";
  if (look.disabled) ctx.globalAlpha *= 0.45;
  const dirRot = (look.dir * Math.PI) / 2; // 0 = up
  const center = () => ctx.translate(0.5, 0.5);
  switch (kind) {
    case "spikes": {
      rrect(ctx, 0.12, 0.12, 0.76, 0.76, 0.08, "#4a4452");
      const ext = look.fresh ?? 0;
      for (let i = 0; i < 3; i++)
        for (let j = 0; j < 3; j++) {
          const x = 0.26 + i * 0.24;
          const y = 0.26 + j * 0.24;
          circle(ctx, x, y, 0.045, "#1a1620", false);
          if (ext > 0)
            poly(
              ctx,
              [x - 0.05, y + 0.02, x, y - 0.26 * ext, x + 0.05, y + 0.02],
              "#d8d2c8",
            );
        }
      break;
    }
    case "darts": {
      center();
      ctx.rotate(dirRot);
      rrect(ctx, -0.3, -0.22, 0.6, 0.5, 0.12, "#7a6a58");
      rrect(ctx, -0.22, -0.34, 0.44, 0.24, 0.08, "#8f7d68");
      circle(ctx, -0.1, -0.06, 0.05, look.cooling ? "#2a2028" : "#ffb347");
      circle(ctx, 0.1, -0.06, 0.05, look.cooling ? "#2a2028" : "#ffb347");
      for (const x of [-0.12, 0, 0.12])
        circle(ctx, x, -0.32, 0.03, "#1a1620", false);
      break;
    }
    case "flame": {
      center();
      ctx.rotate(dirRot);
      rrect(ctx, -0.28, -0.28, 0.56, 0.56, 0.1, "#4a3a36");
      poly(ctx, [-0.16, -0.2, 0.16, -0.2, 0.1, -0.42, -0.1, -0.42], "#6b5650");
      circle(
        ctx,
        0,
        -0.02,
        0.12,
        look.active ? "#ffcc55" : look.warn ? "#ff7a2f" : "#2a1a18",
      );
      break;
    }
    case "boulder": {
      center();
      ctx.save();
      ctx.rotate(dirRot);
      poly(ctx, [-0.3, 0.3, 0.3, 0.3, 0.2, -0.36, -0.2, -0.36], "#3e3830");
      ctx.restore();
      if (!look.used) {
        circle(ctx, 0, 0, 0.3, "#8f877c");
        ctx.beginPath();
        ctx.arc(-0.06, -0.08, 0.12, Math.PI, Math.PI * 1.8);
        ctx.strokeStyle = "rgba(255,255,255,0.25)";
        ctx.stroke();
        line(ctx, -0.1, 0.1, 0.12, 0.04, "#6a6258", 0.02);
      }
      break;
    }
    case "trapdoor": {
      const open = look.fresh ?? 0;
      rrect(ctx, 0.08, 0.08, 0.84, 0.84, 0.04, "#120e14");
      if (open < 0.95) {
        ctx.save();
        ctx.translate(0.1, 0.5);
        ctx.scale(1 - open * 0.9, 1);
        rrect(ctx, 0, -0.4, 0.8, 0.8, 0.04, "#6b4f35");
        for (let i = 1; i < 4; i++)
          line(ctx, i * 0.2, -0.38, i * 0.2, 0.38, "#4a3422", 0.02);
        line(ctx, 0.05, -0.2, 0.75, -0.2, "#3a3a3a", 0.05);
        line(ctx, 0.05, 0.2, 0.75, 0.2, "#3a3a3a", 0.05);
        ctx.restore();
      }
      break;
    }
    case "tar": {
      ctx.beginPath();
      ctx.ellipse(0.5, 0.52, 0.42, 0.36, 0, 0, Math.PI * 2);
      shape(ctx, look.burning ? "#3a1a10" : "#241c2e");
      if (!look.burning) {
        ellipse(
          ctx,
          0.36,
          0.42,
          0.1,
          0.04,
          "rgba(160,140,200,0.35)",
          false,
          -0.3,
        );
        const b = (look.t * 0.7) % 1;
        ctx.globalAlpha *= 1 - b;
        circle(ctx, 0.62, 0.6, 0.03 + b * 0.05, "#3a2f4a", true);
      }
      break;
    }
    case "frost": {
      center();
      const glow = look.cooling ? 0.3 : 0.75 + Math.sin(look.t * 3) * 0.2;
      ctx.globalAlpha *= glow;
      ctx.beginPath();
      ctx.arc(0, 0, 0.32, 0, Math.PI * 2);
      ctx.strokeStyle = "#8fd8ff";
      ctx.lineWidth = 0.05;
      ctx.stroke();
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3 + look.t * 0.3;
        line(
          ctx,
          Math.cos(a) * 0.08,
          Math.sin(a) * 0.08,
          Math.cos(a) * 0.26,
          Math.sin(a) * 0.26,
          "#c8f0ff",
          0.035,
        );
      }
      break;
    }
    case "spring": {
      center();
      ctx.rotate(dirRot);
      const k = look.fresh ?? 0;
      rrect(ctx, -0.3, -0.3, 0.6, 0.6, 0.08, "#5a4a3a");
      for (let i = 0; i < 3; i++)
        line(
          ctx,
          -0.16,
          0.14 - i * 0.1 - k * 0.1 * i,
          0.16,
          0.1 - i * 0.1 - k * 0.1 * i,
          "#d6b04a",
          0.035,
        );
      rrect(ctx, -0.22, -0.26 - k * 0.2, 0.44, 0.12, 0.03, "#b08a3a");
      poly(
        ctx,
        [0, -0.42 - k * 0.2, -0.1, -0.3 - k * 0.2, 0.1, -0.3 - k * 0.2],
        "#ffd166",
      );
      break;
    }
    case "saw": {
      // The track groove; the blade itself is drawn live by the renderer.
      center();
      ctx.rotate(look.dir % 2 === 1 ? Math.PI / 2 : 0);
      rrect(ctx, -0.07, -0.5, 0.14, 1, 0.05, "#1a1620", false);
      break;
    }
    case "gas": {
      center();
      rrect(ctx, -0.3, -0.3, 0.6, 0.6, 0.12, "#3a4a36");
      for (let i = 0; i < 3; i++)
        line(
          ctx,
          -0.2,
          -0.14 + i * 0.14,
          0.2,
          -0.14 + i * 0.14,
          look.warn || look.active ? "#b5ff8a" : "#1a2418",
          0.05,
        );
      break;
    }
    case "lure": {
      center();
      ctx.translate(0, 0.18);
      if (look.used) {
        rrect(ctx, -0.26, -0.28, 0.52, 0.28, 0.04, "#5a3a1a");
        rrect(ctx, -0.26, -0.44, 0.52, 0.12, 0.04, "#6a4a22");
      } else {
        rrect(ctx, -0.26, -0.28, 0.52, 0.28, 0.04, "#8a5a2a");
        rrect(ctx, -0.26, -0.42, 0.52, 0.16, 0.06, "#a06a32");
        line(ctx, -0.26, -0.26, 0.26, -0.26, "#5a3a1a", 0.03);
        rrect(ctx, -0.05, -0.32, 0.1, 0.1, 0.02, "#ffd166");
        const tw = Math.max(0, Math.sin(look.t * 3));
        if (tw > 0.85) {
          ctx.globalAlpha *= (tw - 0.85) / 0.15;
          poly(
            ctx,
            [
              0.16, -0.5, 0.18, -0.44, 0.24, -0.42, 0.18, -0.4, 0.16, -0.34,
              0.14, -0.4, 0.08, -0.42, 0.14, -0.44,
            ],
            "#fff6c0",
            false,
          );
        }
      }
      break;
    }
    case "keg": {
      center();
      if (look.used) {
        ellipse(ctx, 0, 0.1, 0.3, 0.16, "#2a1a12", false);
        break;
      }
      ctx.translate(0, 0.12);
      rrect(ctx, -0.22, -0.5, 0.44, 0.52, 0.12, "#a05a2c");
      line(ctx, -0.22, -0.38, 0.22, -0.38, "#4a3a2a", 0.04);
      line(ctx, -0.22, -0.1, 0.22, -0.1, "#4a3a2a", 0.04);
      ellipse(ctx, 0, -0.5, 0.2, 0.06, "#7a4220");
      line(ctx, 0.04, -0.52, 0.12, -0.66, "#ddd", 0.025);
      if (look.active)
        circle(ctx, 0.12, -0.68, 0.05 + Math.random() * 0.03, "#ffd166", false);
      line(ctx, -0.07, -0.3, 0.07, -0.18, "#f4ecd2", 0.03);
      line(ctx, 0.07, -0.3, -0.07, -0.18, "#f4ecd2", 0.03);
      break;
    }
  }
  ctx.restore();
}

export function drawSawBlade(ctx: C, t: number) {
  ctx.save();
  ctx.lineWidth = 0.04;
  ctx.rotate(t * 14);
  ctx.beginPath();
  const teeth = 10;
  for (let i = 0; i < teeth * 2; i++) {
    const a = (i / (teeth * 2)) * Math.PI * 2;
    const r = i % 2 ? 0.26 : 0.34;
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  shape(ctx, "#d9dde3");
  circle(ctx, 0, 0, 0.08, "#6a6e76");
  ctx.restore();
}

/** Small portrait drawer used for UI cards and roster icons. */
export function portrait(
  canvas: HTMLCanvasElement,
  draw: (ctx: C) => void,
  size = 64,
  scale = 0.8,
  oy = 0.85,
) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.translate((size * dpr) / 2, size * dpr * oy);
  ctx.scale(size * dpr * scale, size * dpr * scale);
  draw(ctx);
}
