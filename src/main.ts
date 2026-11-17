import "./ui/styles.css";
import { Game } from "./app";
import { Capacitor } from "@capacitor/core";
import { App as NativeApp } from "@capacitor/app";
import { installWebBack } from "./ui/back";

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
  // Android back button: close the top screen or pause; on the title screen
  // send the app to the background like any other root screen. Listening
  // replaces the WebView's default (history back, else exit from anywhere).
  void NativeApp.addListener("backButton", () => {
    if (!game.back()) void NativeApp.minimizeApp();
  });
} else installWebBack(() => game.back());

if (
  import.meta.env.PROD &&
  !Capacitor.isNativePlatform() &&
  "serviceWorker" in navigator
) {
  void navigator.serviceWorker.register("./sw.js").catch(() => {
    // The game still works online when offline caching is unavailable.
  });
}
