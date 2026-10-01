import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
// Forward the app's debug WebView socket with adb first. Runs against the app, not browser emulation.
const browser = await chromium.connectOverCDP(
  process.env.WEBVIEW_URL ?? "http://127.0.0.1:9331",
  { noDefaults: true },
);
try {
  const page = browser
    .contexts()[0]
    .pages()
    .find((p) => p.url().includes("localhost"));
  if (!page)
    throw new Error("The Dungeon Architect debug WebView must be open.");
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.reload();
  await page.getByRole("button", { name: "Test dungeon", exact: true }).click();
  for (const [direction, steps] of [
    ["down", 1],
    ["right", 11],
    ["down", 7],
    ["right", 1],
  ]) {
    for (let i = 0; i < steps; i++)
      await page
        .getByRole("button", { name: `Move ${direction}`, exact: true })
        .click();
  }
  await page.getByRole("heading", { name: "A worthy adventure." }).waitFor();
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/native-completion.png" });
  await page
    .locator(".result-card")
    .getByRole("button", { name: "Back to building" })
    .click();
  await page
    .getByRole("button", {
      name: /^Publish (dungeon|new version)$/,
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Invite 6 adventurers" }).click();
  await page.locator(".attempt-card").first().waitFor();
  const count = await page.locator(".attempt-card").count();
  if (count !== 6)
    throw new Error(
      `Expected six native simulated attempts, received ${count}.`,
    );
  await page.locator(".attempt-card").first().click();
  await page.getByRole("heading", { name: "Replay theatre" }).waitFor();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("slider", { name: "Replay position" }).fill("10");
  await page.screenshot({ path: "test-results/native-replay.png" });
  if (
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    )
  )
    throw new Error("Native viewport overflows horizontally.");
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    "Android WebView: complete, publish, six attempts, replay seek, no overflow or JavaScript errors.",
  );
} finally {
  await browser.close();
}
