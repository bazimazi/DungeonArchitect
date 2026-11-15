import { expect, test, type Page } from "@playwright/test";
import { generateLayout } from "../../src/game/grid";
import { encodeDungeon } from "../../src/game/share";

type G = {
  path: { x: number; y: number }[];
  renderer: { toScreen(x: number, y: number): [number, number] };
  run: { layout: { objects: unknown[] } };
  raid: { finished: boolean; step(): void; events: unknown[] } | null;
};
const game = (page: Page) =>
  page.evaluateHandle(() => (window as unknown as { game: G }).game);

const fresh = async (page: Page, path = "/") => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.goto(path);
  return errors;
};
const finishRaid = (page: Page) =>
  page.evaluate(() => {
    const g = (window as unknown as { game: G }).game;
    for (let i = 0; i < 6000 && g.raid && !g.raid.finished; i++) {
      g.raid.step();
      g.raid.events.length = 0;
    }
  });

test("title, first night, results and a boon", async ({ page }) => {
  const errors = await fresh(page);
  await page.getByText("New Descent").click();
  await expect(page.locator(".start-btn")).toBeVisible();
  await page.locator('[data-piece="skeleton"]').click();
  const g = await game(page);
  const pt = await g.evaluate((x) => {
    const t = x.path[6];
    return x.renderer.toScreen(t.x + 0.5, t.y + 0.5);
  });
  await page.mouse.click(pt[0], pt[1]);
  await expect
    .poll(() => g.evaluate((x) => x.run.layout.objects.length))
    .toBe(2);
  await page.locator(".start-btn").click();
  await expect(page.locator(".hud")).toHaveAttribute("data-mode", "raid");
  await finishRaid(page);
  await expect(page.locator(".results")).toBeVisible({ timeout: 10_000 });
  await page.locator(".results .btn.primary").click();
  await page.locator(".card-btn").first().click();
  await expect(page.locator(".hud")).toHaveAttribute("data-mode", "build");
  await expect(page.locator(".night-num")).toHaveText("2");
  expect(errors).toEqual([]);
});

test("a run survives a reload", async ({ page }) => {
  await fresh(page);
  await page.getByText("New Descent").click();
  await expect(page.locator(".start-btn")).toBeVisible();
  await page.waitForTimeout(800);
  await page.reload();
  await page.getByText("Continue").click();
  await expect(page.locator(".hud")).toHaveAttribute("data-mode", "build");
});

test("a shared dungeon link opens straight into a raid", async ({ page }) => {
  const layout = generateLayout(9, "crypt");
  layout.objects = [{ id: 1, kind: "skeleton", x: 5, y: 2, dir: 2 }];
  const code = encodeDungeon({
    name: "Testing Pit",
    biome: "crypt",
    layout,
    tiers: {},
    budget: 10,
    rules: 1,
  });
  const errors = await fresh(page, `/#raid=${code}`);
  await expect(page.getByText("Testing Pit's dungeon")).toBeVisible();
  await page.locator(".class-pick").first().click();
  await page.getByText("Raid!").click();
  await expect(page.locator(".hud")).toHaveAttribute("data-mode", "raid");
  await finishRaid(page);
  await expect(page.getByText("Raid again")).toBeVisible({ timeout: 10_000 });
  expect(errors).toEqual([]);
});

test("workshop test raids return to building", async ({ page }) => {
  const errors = await fresh(page);
  await page.getByText("Workshop").click();
  await expect(page.locator(".ws-night")).toBeVisible();
  await page.locator(".start-btn").click();
  await expect(page.locator(".hud")).toHaveAttribute("data-mode", "raid");
  await finishRaid(page);
  await expect(page.locator(".hud")).toHaveAttribute("data-mode", "build", {
    timeout: 10_000,
  });
  expect(errors).toEqual([]);
});

test("reloading on the results screen never replays the night", async ({
  page,
}) => {
  await fresh(page);
  await page.getByText("New Descent").click();
  await page.locator(".start-btn").click();
  await finishRaid(page);
  await expect(page.locator(".results")).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await page.getByText("Continue").click();
  await expect(page.locator(".card-btn").first()).toBeVisible();
  await page.locator(".card-btn").first().click();
  await expect(page.locator(".night-num")).toHaveText("2");
});
