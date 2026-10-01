import "./ui/styles.css";
import { App } from "./ui/app";
import { Capacitor } from "@capacitor/core";
import { App as NativeApp } from "@capacitor/app";

const game = new App(document.querySelector<HTMLDivElement>("#app")!);
if (Capacitor.isNativePlatform()) {
  void NativeApp.addListener("appUrlOpen", ({ url }) => game.openInvite(url));
  void NativeApp.getLaunchUrl().then((link) => {
    if (link) game.openInvite(link.url);
  });
}

if (
  import.meta.env.PROD &&
  !Capacitor.isNativePlatform() &&
  "serviceWorker" in navigator
) {
  void navigator.serviceWorker.register("./sw.js").catch(() => {
    // The game remains playable when a browser disallows offline caching.
  });
}
