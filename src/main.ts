import "./ui/styles.css";
import { Game } from "./app";
import { Capacitor } from "@capacitor/core";
import { App as NativeApp } from "@capacitor/app";

const root = document.querySelector<HTMLDivElement>("#app")!;
const game = new Game(root);
(window as unknown as { game: Game }).game = game;

if (Capacitor.isNativePlatform()) {
  // Dungeon links opened from other apps arrive as deep links.
  const open = (url: string) => {
    const hash = url.split("#")[1];
    if (hash) location.hash = hash;
  };
  void NativeApp.addListener("appUrlOpen", ({ url }) => open(url));
  void NativeApp.getLaunchUrl().then((link) => link && open(link.url));
}

if (
  import.meta.env.PROD &&
  !Capacitor.isNativePlatform() &&
  "serviceWorker" in navigator
) {
  void navigator.serviceWorker.register("./sw.js").catch(() => {
    // The game still works online when offline caching is unavailable.
  });
}
