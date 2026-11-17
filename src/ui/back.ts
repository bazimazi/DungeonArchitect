/**
 * Browser back (button, gesture, Alt+Left) for the web build.
 *
 * The game is a single page, so without help the back button would leave
 * it from any screen. A "guard" history entry sits on top of the page's own
 * entry: pressing back pops the guard, the game handles the back action and
 * the guard is put back. When the game has nothing left to close (the title
 * screen), the guard stays down and the browser goes back for real.
 *
 * Entries are tagged in `history.state.da`: 0 for the page, 1 for the guard.
 * Untagged entries come from hash navigation (shared dungeon links) and are
 * left alone; they sit above the guard, so back from them lands on it.
 *
 * Native apps use the platform back button instead (see main.ts).
 */
type Tag = { da?: number } | null;

const tag = (): number | undefined => (history.state as Tag)?.da;

export function installWebBack(handle: () => boolean) {
  // Tag the page's own entry (a reload keeps the tags we already set).
  if (tag() === undefined)
    history.replaceState({ ...(history.state ?? {}), da: 0 }, "");

  const arm = () => {
    if (tag() === 0) history.pushState({ da: 1 }, "");
  };
  // Browsers ignore history entries added before the user interacts with the
  // page, so the guard goes up on the first interaction (and again on later
  // ones, should it ever be missing).
  window.addEventListener("pointerdown", arm, true);
  window.addEventListener("keydown", arm, true);

  window.addEventListener("popstate", () => {
    const at = tag();
    // A hash entry (forward to a shared link): nothing to do.
    if (at === undefined) return;
    if (handle()) {
      arm();
      return;
    }
    // Nothing left to close: leave the game, skipping our own entries.
    history.go(-(at + 1));
  });
}
