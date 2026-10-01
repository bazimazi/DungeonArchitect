import "./ui/styles.css";
import { App } from "./ui/app";

new App(document.querySelector<HTMLDivElement>("#app")!);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  void navigator.serviceWorker.register("./sw.js").catch(() => {
    // The game remains playable when a browser disallows offline caching.
  });
}
