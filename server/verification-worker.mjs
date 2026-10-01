import { parentPort } from "node:worker_threads";
import { tsImport } from "tsx/esm/api";
const { reconstructReplay } = await tsImport(
  "../src/core/simulation.ts",
  import.meta.url,
);
parentPort.on("message", ({ id, replay }) => {
  try {
    parentPort.postMessage({ id, state: reconstructReplay(replay).state });
  } catch {
    parentPort.postMessage({
      id,
      error: "The recording cannot be reproduced by its simulation version.",
    });
  }
});
