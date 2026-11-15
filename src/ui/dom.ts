/** Tiny DOM helpers and an inline SVG icon set (no external assets). */
import {
  HEROES,
  PIECES,
  type HeroClass,
  type PieceId,
  type TrapId,
} from "../game/defs";
import { drawHero, drawMonster, drawTrap, portrait } from "../render/sprites";

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<
    string,
    string | number | boolean | undefined | ((e: Event) => void)
  > = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === "function")
      el.addEventListener(k.replace(/^on/, ""), v as EventListener);
    else if (k === "class") el.className = String(v);
    else if (k === "html") el.innerHTML = String(v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children)
    if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

const P: Record<string, string> = {
  coin: '<circle cx="12" cy="12" r="8.5" fill="#ffd166" stroke="#7a4a10" stroke-width="2"/><path d="M12 7.5v9M9.5 9.5h4a1.6 1.6 0 0 1 0 3.2h-3a1.6 1.6 0 0 0 0 3.2h4" fill="none" stroke="#7a4a10" stroke-width="1.8" stroke-linecap="round"/>',
  hoard:
    '<path d="M4 11h16v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z" fill="#a8672e" stroke="#2a1606" stroke-width="1.6"/><path d="M4 11c0-4 3.5-6 8-6s8 2 8 6" fill="#c98a3a" stroke="#2a1606" stroke-width="1.6"/><rect x="10.5" y="10" width="3" height="4" rx=".6" fill="#ffd166" stroke="#2a1606" stroke-width="1.2"/>',
  dread:
    '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" fill="#3b1f5a" stroke="#c79bff" stroke-width="1.6"/><circle cx="12" cy="12" r="3.3" fill="#e2c8ff"/><circle cx="12" cy="12" r="1.4" fill="#1a0b2a"/>',
  pick: '<path d="M5 19 14.5 9.5" stroke="#c8a070" stroke-width="2.6" stroke-linecap="round"/><path d="M8.5 5.5C12 3 17 3.5 20 7c-3-1-6-.6-8.5 1.2z" fill="#cfd6df" stroke="#1a1620" stroke-width="1.5" stroke-linejoin="round"/>',
  undo: '<path d="M9 7 4.5 11.5 9 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 11.5h9a5 5 0 0 1 0 10h-3" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>',
  pause:
    '<rect x="6.5" y="5.5" width="4" height="13" rx="1" fill="currentColor"/><rect x="13.5" y="5.5" width="4" height="13" rx="1" fill="currentColor"/>',
  menu: '<path d="M5 7h14M5 12h14M5 17h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  sound:
    '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  mute: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="m16 9.5 5 5m0-5-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" fill="currentColor"/>',
  share:
    '<circle cx="6" cy="12" r="2.6" fill="currentColor"/><circle cx="17.5" cy="6" r="2.6" fill="currentColor"/><circle cx="17.5" cy="18" r="2.6" fill="currentColor"/><path d="m8 11 7.5-4M8 13l7.5 4" stroke="currentColor" stroke-width="2"/>',
  book: '<path d="M4 5.5c3-1 6-1 8 1 2-2 5-2 8-1v13c-3-1-6-1-8 1-2-2-5-2-8-1z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 6.5v13" stroke="currentColor" stroke-width="2"/>',
  close:
    '<path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>',
  rotate:
    '<path d="M19 12a7 7 0 1 1-2.1-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M18 3.5v4.5h-4.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  sell: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M8 12h8" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  fast: '<path d="M4 6v12l8-6zM12 6v12l8-6z" fill="currentColor"/>',
  skull:
    '<path d="M12 3.5c-4.7 0-8 3.2-8 7.6 0 2.6 1.3 4.3 3 5.3v3.1h10v-3.1c1.7-1 3-2.7 3-5.3 0-4.4-3.3-7.6-8-7.6z" fill="#e8dcc4" stroke="#1a1620" stroke-width="1.5"/><circle cx="9" cy="11.5" r="2" fill="#1a1620"/><circle cx="15" cy="11.5" r="2" fill="#1a1620"/><path d="M10 19.5v-2M14 19.5v-2M12 19.5v-2" stroke="#1a1620" stroke-width="1.3"/>',
  rock: '<path d="M4 17 7 8l5-3 6 2.5 2.5 8-4 3.5H8z" fill="#8f877c" stroke="#1a1620" stroke-width="1.5" stroke-linejoin="round"/><path d="m4 20 2-2M9 21l1-2M15 21l-1-2M20 20l-2-2" stroke="#ff8a6a" stroke-width="1.6" stroke-linecap="round"/>',
  shriek:
    '<path d="M12 4c-4 0-6.5 3-6.5 7 0 5 3 9 6.5 9s6.5-4 6.5-9c0-4-2.5-7-6.5-7z" fill="#cfeaff" stroke="#1a2a3a" stroke-width="1.5"/><ellipse cx="9.5" cy="10.5" rx="1.4" ry="1.8" fill="#1a2a3a"/><ellipse cx="14.5" cy="10.5" rx="1.4" ry="1.8" fill="#1a2a3a"/><ellipse cx="12" cy="15.5" rx="1.8" ry="2.6" fill="#1a2a3a"/>',
  crown:
    '<path d="M3.5 17.5 5 7.5l4.5 4L12 5l2.5 6.5L19 7.5l1.5 10z" fill="#ffd166" stroke="#5a3a10" stroke-width="1.5" stroke-linejoin="round"/>',
  daily:
    '<rect x="4" y="5" width="16" height="15" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 10h16M8.5 3v4M15.5 3v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="m12 12.3 1.1 2.2 2.4.3-1.8 1.7.5 2.4L12 17.7l-2.2 1.2.5-2.4-1.8-1.7 2.4-.3z" fill="currentColor"/>',
  hammer:
    '<path d="m13 10-8 8.5a1.6 1.6 0 0 0 2.3 2.3L15.5 13" fill="#c8a070" stroke="#1a1620" stroke-width="1.4"/><path d="m11.5 6.5 4-3 6 6-3 4z" fill="#cfd6df" stroke="#1a1620" stroke-width="1.4" stroke-linejoin="round"/>',
  sword:
    '<path d="M19.5 4.5 10 14l-2-2 9.5-9.5h2z" fill="#dfe7f2" stroke="#1a1620" stroke-width="1.4"/><path d="m6 12 6 6M7.5 16.5 4 20" stroke="#c8a070" stroke-width="2.4" stroke-linecap="round"/>',
  relic:
    '<path d="M12 3 20 8v8l-8 5-8-5V8z" fill="#7a4bc0" stroke="#e2c8ff" stroke-width="1.5"/><path d="M12 7v10M7.5 9.5l9 5M16.5 9.5l-9 5" stroke="#e2c8ff" stroke-width="1.1" opacity=".7"/>',
  up: '<path d="m6 14 6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>',
};

export function icon(name: keyof typeof P | string, cls = "ic") {
  const span = document.createElement("span");
  span.className = cls;
  span.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${P[name] ?? ""}</svg>`;
  return span;
}

export function pieceArt(id: PieceId, size = 56) {
  const c = document.createElement("canvas");
  c.className = "art";
  c.style.width = c.style.height = `${size}px`;
  const def = PIECES[id];
  if (def.kind === "trap") {
    portrait(
      c,
      (ctx) => {
        ctx.translate(-0.5, -0.62);
        drawTrap(ctx, id as TrapId, {
          t: 0.4,
          dir: 1,
          active: false,
          warn: false,
          cooling: false,
          disabled: false,
          used: false,
          fresh: id === "spikes" ? 0.8 : 0,
        });
      },
      size,
      0.92,
      0.5,
    );
  } else {
    portrait(
      c,
      (ctx) =>
        drawMonster(
          ctx,
          id as never,
          { t: 0.3, walk: -1, atk: -1, flash: false, face: 1 },
          false,
        ),
      size,
      id === "ogre" ? 0.62 : 0.8,
      0.86,
    );
  }
  return c;
}

export function heroArt(cls: HeroClass, size = 48, elite = false) {
  const c = document.createElement("canvas");
  c.className = "art";
  c.style.width = c.style.height = `${size}px`;
  portrait(
    c,
    (ctx) =>
      drawHero(
        ctx,
        cls,
        { t: 0.2, walk: -1, atk: -1, flash: false, face: 1 },
        elite,
        false,
      ),
    size,
    cls === "paladin" ? 0.62 : 0.78,
    0.9,
  );
  return c;
}

export const heroName = (cls: HeroClass) => HEROES[cls].name;

export function fmt(n: number) {
  return Math.round(n).toLocaleString("en-US");
}

/** Animate a number in an element from its current value to `to`. */
export function countTo(el: HTMLElement, to: number, ms = 600) {
  const from = Number(el.dataset.v ?? to);
  el.dataset.v = String(to);
  if (from === to) {
    el.textContent = fmt(to);
    return;
  }
  const t0 = performance.now();
  const step = (now: number) => {
    const k = Math.min(1, (now - t0) / ms);
    const e = 1 - (1 - k) ** 3;
    el.textContent = fmt(from + (to - from) * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  el.classList.remove("bump");
  void el.offsetWidth;
  el.classList.add("bump");
}
