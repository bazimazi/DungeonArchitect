const paths: Record<string, string> = {
  decor: '<path d="M5 22V2m0 1h14l-3 5 3 5H5"/>',
  castle:
    '<path d="M3 21V7h4V3h3v4h4V3h3v4h4v14M3 12h18M9 21v-5a3 3 0 0 1 6 0v5"/>',
  rooms:
    '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h7v7h-7zM10 6h4M6 10v4M10 18h4"/>',
  room: '<path d="M3 3h18v18H3zM3 10h3v4H3M18 10h3v4h-3"/>',
  floor: '<path d="M2 8h20v8H2zM7 8v8M12 8v8M17 8v8"/>',
  wall: '<path d="M3 4h18v16H3zM3 9h18M3 15h18M9 4v5M16 4v5M7 9v6M14 9v6M10 15v5M17 15v5"/>',
  traps:
    '<path d="m3 20 4-14 5 14 5-14 4 14H3Z"/><path d="m12 2 1 4M3 3l2 3M21 3l-2 3"/>',
  spikes: '<path d="M2 20 6 7l4 13 3-16 4 16 3-11 2 11H2Z"/>',
  fire: '<path d="M13 2c1 6-5 6-3 11 2-1 3-3 3-5 7 5 8 14-1 14S1 13 6 8c-1 5 1 6 2 6-1-5 4-7 5-12Z"/>',
  monsters:
    '<path d="M6 17c-7-8-2-14 6-14s13 6 6 14v4H6v-4Z"/><path d="M8 10h1M15 10h1M9 17v4M15 17v4m-5-6 2-3 2 3"/>',
  skeleton:
    '<path d="M6 12C-1 1 25 1 18 12l-3 1v4H9v-4l-3-1ZM8 8h1m6 0h1M12 17v5M5 19l14 3M19 19 5 22"/>',
  archer: '<path d="M7 3c14 3 14 15 0 18l3-9-3-9Zm-4 9h18m-3-3 3 3-3 3"/>',
  slime:
    '<path d="M3 18c0-8 4-14 9-14s9 6 9 14c0 4-18 4-18 0Z"/><path d="M8 12h1m6 0h1m-6 4h4"/>',
  guardian: '<path d="m12 2 9 5v9l-9 6-9-6V7l9-5ZM7 9h3m4 0h3M8 15h8M12 3v4"/>',
  objects: '<path d="m12 2 9 5v10l-9 5-9-5V7l9-5ZM3 7l9 5 9-5M12 12v10"/>',
  entrance:
    '<path d="M4 21V9a8 8 0 0 1 16 0v12M8 21V9a4 4 0 0 1 8 0v12M2 21h20m-10-8 3 3-3 3m-5-3h8"/>',
  treasure:
    '<path d="M3 11V8a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v3M3 11h18v10H3V11Zm4-7v17M17 4v17M10 10h4v5h-4z"/>',
  key: '<circle cx="8" cy="8" r="5"/><path d="m12 12 9 9m-6-6 3-3m0 6 3-3"/>',
  door: '<path d="M4 22V3h16v19M7 21V6h10v15M12 14h2M2 22h20"/>',
  potion:
    '<path d="M9 2h6v6l5 8a4 4 0 0 1-3 6H7a4 4 0 0 1-3-6l5-8V2ZM7 2h10M6 15h12"/>',
  select: '<path d="m5 3 15 10-7 2-4 7L5 3Z"/>',
  erase: '<path d="m3 14 10-11 9 8-9 11H8l-5-4v-4Zm5-6 9 8M12 22h10"/>',
  play: '<path d="m8 4 13 8-13 8V4Z"/>',
  pause: '<path d="M7 4h3v16H7zM15 4h3v16h-3z"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  undo: '<path d="M8 4 3 9l5 5M3 9h11a7 7 0 0 1 0 14"/>',
  redo: '<path d="m16 4 5 5-5 5M21 9H10a7 7 0 0 0 0 14"/>',
  grid: '<path d="M3 3h18v18H3zM9 3v18M15 3v18M3 9h18M3 15h18"/>',
  sound:
    '<path d="m3 9 5 0 6-5v16l-6-5H3V9Zm15-2a8 8 0 0 1 0 10m2-13a12 12 0 0 1 0 16"/>',
  mute: '<path d="m3 9 5 0 6-5v16l-6-5H3V9Zm15 0 5 6m0-6-5 6"/>',
  zoomIn: '<circle cx="10" cy="10" r="7"/><path d="m15 15 7 7M10 6v8M6 10h8"/>',
  zoomOut: '<circle cx="10" cy="10" r="7"/><path d="m15 15 7 7M6 10h8"/>',
  fit: '<path d="M3 9V3h6m6 0h6v6M3 15v6h6m6 0h6v-6"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12Z"/><circle cx="12" cy="12" r="3"/>',
  flag: '<path d="M5 22V3c6-5 8 5 15 0v12c-7 5-9-5-15 0"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  back: '<path d="M20 12H4m6-6-6 6 6 6"/>',
  up: '<path d="m5 15 7-7 7 7"/>',
  down: '<path d="m5 9 7 7 7-7"/>',
  left: '<path d="m15 5-7 7 7 7"/>',
  right: '<path d="m9 5 7 7-7 7"/>',
  heart: '<path d="M12 21 3 12C-3 3 8-1 12 6c4-7 15-3 9 6l-9 9Z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  rotate: '<path d="M20 7V2l-5 5h5a9 9 0 1 0 1 9"/>',
  move: '<path d="M12 2v20M2 12h20m-14-6 4-4 4 4m-8 12 4 4 4-4M6 8l-4 4 4 4m12-8 4 4-4 4"/>',
  duplicate:
    '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  delete: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  close: '<path d="m5 5 14 14M19 5 5 19"/>',
  book: '<path d="M12 5c-4-4-9-2-9-2v17s5-2 9 2c4-4 9-2 9-2V3s-5-2-9 2v17"/>',
  download: '<path d="M12 2v14m-5-5 5 5 5-5M3 17v5h18v-5"/>',
  upload: '<path d="M12 16V2m-5 5 5-5 5 5M3 17v5h18v-5"/>',
  leaf: '<path d="M3 21C3 3 15 2 21 3c1 13-5 18-14 14M3 21 16 8"/>',
};
export function icon(name: string, className = ""): string {
  return `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.objects}</svg>`;
}
