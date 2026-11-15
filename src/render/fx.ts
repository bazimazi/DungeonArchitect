/** Pooled particle effects and floating text. Presentation only. */
import { ease } from "../engine/math";

export interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  g: number;
  drag: number;
  life: number;
  max: number;
  size: number;
  size1: number;
  color: string;
  kind:
    | "dot"
    | "spark"
    | "smoke"
    | "ring"
    | "shard"
    | "soul"
    | "flame"
    | "coin"
    | "bubble"
    | "star";
  add: boolean;
  rot: number;
  vr: number;
}
export interface Floater {
  x: number;
  y: number;
  text: string;
  color: string;
  size: number;
  t: number;
  life: number;
  jitter: number;
  uid: number;
  amount: number;
}
export interface Flight {
  sx: number;
  sy: number;
  mx: number;
  my: number;
  tx: number;
  ty: number;
  t: number;
  dur: number;
  delay: number;
  color: string;
  kind: "coin" | "soul" | "gem";
  done: () => void;
}

const MAX_PARTICLES = 450;

export class Fx {
  particles: Particle[] = [];
  floaters: Floater[] = [];
  flights: Flight[] = [];
  reduce = false;

  emit(p: Partial<Particle> & { x: number; y: number }) {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    const max = p.max ?? 0.5;
    this.particles.push({
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      g: 0,
      drag: 0,
      life: max,
      max,
      size: 0.06,
      size1: 0,
      color: "#fff",
      kind: "dot",
      add: false,
      rot: 0,
      vr: 0,
      ...p,
    });
  }

  burst(
    x: number,
    y: number,
    n: number,
    opt: Partial<Particle> & { speed?: number; up?: number; spread?: number },
  ) {
    const count = this.reduce ? Math.ceil(n / 2) : n;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (opt.speed ?? 2) * (0.4 + Math.random() * 0.8);
      this.emit({
        ...opt,
        x: x + (Math.random() - 0.5) * (opt.spread ?? 0.1),
        y: y + (Math.random() - 0.5) * (opt.spread ?? 0.1),
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp * 0.6,
        vz: (opt.up ?? 2) * (0.5 + Math.random()),
        max: (opt.max ?? 0.5) * (0.7 + Math.random() * 0.6),
        rot: Math.random() * 6,
        vr: (Math.random() - 0.5) * 12,
      });
    }
  }

  text(
    x: number,
    y: number,
    text: string,
    color: string,
    size = 1,
    uid = -1,
    amount = 0,
  ) {
    // Merge rapid hits on the same target into one rising number.
    if (uid >= 0 && amount > 0) {
      const f = this.floaters.find(
        (q) => q.uid === uid && q.t < 0.15 && q.color === color,
      );
      if (f) {
        f.amount += amount;
        f.text = String(f.amount);
        f.t = 0;
        f.size = Math.min(1.8, size + f.amount / 120);
        return;
      }
    }
    this.floaters.push({
      x,
      y,
      text,
      color,
      size,
      t: 0,
      life: 0.85,
      jitter: (Math.random() - 0.5) * 0.25,
      uid,
      amount,
    });
  }

  fly(f: Omit<Flight, "t" | "mx" | "my">) {
    const mx = (f.sx + f.tx) / 2 + (Math.random() - 0.5) * 120;
    const my = Math.min(f.sy, f.ty) - 60 - Math.random() * 80;
    this.flights.push({ ...f, t: 0, mx, my });
  }

  update(dt: number) {
    const keep: Particle[] = [];
    for (const p of this.particles) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vx *= 1 - p.drag * dt;
      p.vy *= 1 - p.drag * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vz -= p.g * dt;
      p.z += p.vz * dt;
      if (p.z < 0 && p.g > 0) {
        p.z = 0;
        p.vz *= -0.4;
        p.vx *= 0.6;
        p.vy *= 0.6;
      }
      p.rot += p.vr * dt;
      keep.push(p);
    }
    this.particles = keep;
    this.floaters = this.floaters.filter((f) => (f.t += dt) < f.life);
    const flights: Flight[] = [];
    for (const f of this.flights) {
      if (f.delay > 0) {
        f.delay -= dt;
        flights.push(f);
        continue;
      }
      f.t += dt;
      if (f.t >= f.dur) f.done();
      else flights.push(f);
    }
    this.flights = flights;
  }

  /** World-space particles. ctx is already in tile units. */
  drawWorld(ctx: CanvasRenderingContext2D, additive: boolean) {
    for (const p of this.particles) {
      if (p.add !== additive) continue;
      const k = 1 - p.life / p.max;
      const size = p.size + (p.size1 - p.size) * k;
      const alpha =
        p.kind === "smoke" ? (1 - k) * 0.5 : Math.min(1, (p.life / p.max) * 2);
      ctx.globalAlpha = alpha;
      const x = p.x;
      const y = p.y - p.z;
      switch (p.kind) {
        case "ring":
          ctx.beginPath();
          ctx.ellipse(x, y, size, size * 0.6, 0, 0, Math.PI * 2);
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 0.06 * (1 - k) + 0.01;
          ctx.stroke();
          break;
        case "shard":
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          ctx.fillRect(-size, -size / 2, size * 2, size);
          ctx.restore();
          break;
        case "spark":
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x - p.vx * 0.04, y - p.vy * 0.04 + p.vz * 0.04);
          ctx.strokeStyle = p.color;
          ctx.lineWidth = size;
          ctx.lineCap = "round";
          ctx.stroke();
          break;
        case "coin":
          ctx.save();
          ctx.translate(x, y);
          ctx.scale(Math.abs(Math.cos(p.rot)) + 0.15, 1);
          ctx.beginPath();
          ctx.arc(0, 0, size, 0, Math.PI * 2);
          ctx.fillStyle = "#ffd166";
          ctx.fill();
          ctx.strokeStyle = "#8a5a10";
          ctx.lineWidth = 0.02;
          ctx.stroke();
          ctx.restore();
          break;
        case "star":
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          ctx.beginPath();
          for (let i = 0; i < 8; i++) {
            const r = i % 2 ? size * 0.35 : size;
            const a = (i / 8) * Math.PI * 2;
            ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
          }
          ctx.fill();
          ctx.restore();
          break;
        case "bubble":
          ctx.beginPath();
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 0.02;
          ctx.stroke();
          break;
        default:
          ctx.beginPath();
          ctx.arc(x, y, Math.max(0.005, size), 0, Math.PI * 2);
          ctx.fillStyle = p.color;
          ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Screen-space floating text. `toScreen` converts tile coords to pixels. */
  drawText(
    ctx: CanvasRenderingContext2D,
    toScreen: (x: number, y: number) => [number, number],
    px: number,
  ) {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const f of this.floaters) {
      const k = f.t / f.life;
      const pop =
        f.t < 0.1
          ? ease.outBack(f.t / 0.1) * 1.25
          : 1.25 - Math.min(0.25, (f.t - 0.1) * 2);
      const rise = ease.outCubic(Math.min(1, k * 1.4)) * 0.75;
      const [sx, sy] = toScreen(f.x + f.jitter, f.y - 0.7 - rise);
      const size = Math.max(13, px * 0.32) * f.size * pop;
      ctx.globalAlpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      ctx.font = `900 ${size}px Nunito, system-ui, sans-serif`;
      ctx.lineWidth = Math.max(3, size * 0.2);
      ctx.strokeStyle = "rgba(10,6,14,0.9)";
      ctx.lineJoin = "round";
      ctx.strokeText(f.text, sx, sy);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, sx, sy);
    }
    ctx.globalAlpha = 1;
  }

  drawFlights(ctx: CanvasRenderingContext2D) {
    for (const f of this.flights) {
      if (f.delay > 0) continue;
      const k = ease.inCubic(Math.min(1, f.t / f.dur));
      const u = 1 - k;
      const x = u * u * f.sx + 2 * u * k * f.mx + k * k * f.tx;
      const y = u * u * f.sy + 2 * u * k * f.my + k * k * f.ty;
      const r = 7 * (1 - k * 0.4);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      if (f.kind === "coin") {
        ctx.fillStyle = "#ffd166";
        ctx.fill();
        ctx.strokeStyle = "#7a4a10";
        ctx.lineWidth = 2;
        ctx.stroke();
      } else {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2);
        g.addColorStop(0, "#ffffff");
        g.addColorStop(0.4, f.color);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.arc(x, y, r * 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
