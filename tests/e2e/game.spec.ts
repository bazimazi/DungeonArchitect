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

const winRaid = (page: Page) =>
  page.evaluate(() => {
    type H = { alive: boolean };
    const g = (
      window as unknown as {
        game: {
          raid: {
            finished: boolean;
            step(): void;
            events: unknown[];
            heroes: H[];
            damage(h: H, n: number, t: string, s: string): void;
          } | null;
        };
      }
    ).game;
    for (let i = 0; i < 6000 && g.raid && !g.raid.finished; i++) {
      for (const h of g.raid.heroes)
        if (h.alive) g.raid.damage(h, 1e9, "magic", "test");
      g.raid.step();
      g.raid.events.length = 0;
    }
  });

test("a veteran descends to a deeper depth with its twists", async ({
  page,
}) => {
  const errors = await fresh(page);
  await page.evaluate(() =>
    localStorage.setItem(
      "da.profile.v1",
      JSON.stringify({
        v: 2,
        renown: 120,
        runs: 4,
        wins: 2,
        maxDepth: 3,
        tutorial: 99,
      }),
    ),
  );
  await page.reload();
  await page.getByText("New Descent").click();
  await expect(page.locator(".depth-num")).toHaveText("3");
  await expect(page.locator(".depth-info .mut").first()).toBeVisible();
  await page.getByText("Descend", { exact: true }).click();
  await expect(page.locator(".hud")).toHaveAttribute("data-mode", "build");
  const depth = await page.evaluate(
    () =>
      (window as unknown as { game: { run: { depth: number } } }).game.run
        .depth,
  );
  expect(depth).toBe(3);
  await expect(page.locator(".res.cap")).toBeVisible();
  expect(errors).toEqual([]);
});

test("winning night ten opens the abyss", async ({ page }) => {
  const errors = await fresh(page);
  await page.getByText("New Descent").click();
  await expect(page.locator(".start-btn")).toBeVisible();
  await page.evaluate(() => {
    const g = (
      window as unknown as {
        game: { run: { night: number }; enterBuild(k: string): void };
      }
    ).game;
    g.run.night = 10;
    g.enterBuild("run");
  });
  await page.locator(".start-btn").click();
  await winRaid(page);
  await expect(page.locator(".results")).toBeVisible({ timeout: 10_000 });
  await page.locator(".results .btn.primary").click();
  await expect(page.locator(".gameover")).toBeVisible();
  await page.getByText("Delve into the Abyss").click();
  await page.locator(".card-btn").first().click();
  await expect(page.locator(".night-num")).toHaveText("11");
  await expect(page.locator(".night-badge")).toHaveClass(/abyss/);
  const maxDepth = await page.evaluate(
    () =>
      (window as unknown as { game: { profile: { maxDepth: number } } }).game
        .profile.maxDepth,
  );
  expect(maxDepth).toBe(2);
  expect(errors).toEqual([]);
});

test("abandoning from the title and backing out returns to the title", async ({
  page,
}) => {
  const errors = await fresh(page);
  await page.getByText("New Descent").click();
  await expect(page.locator(".start-btn")).toBeVisible();
  await page.waitForTimeout(700);
  await page.reload();
  await page.getByText("New Descent").click();
  await page.getByRole("button", { name: "Abandon" }).click();
  await expect(page.locator(".setup")).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.locator(".title-screen")).toBeVisible();
  await expect(page.getByText("Continue")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a trial can be built, raided and mastered", async ({ page }) => {
  const errors = await fresh(page);
  await page.getByText("Trials").click();
  await page.getByText("Fire and Tar").click();
  await page.locator(".trial-brief .btn.primary").click();
  await expect(page.locator(".hud")).toHaveAttribute("data-kind", "trial");
  // The reference solution: flames at the far ends, one more tar pool.
  await page.evaluate(() => {
    const g = (
      window as unknown as {
        game: {
          tool: string | null;
          tryPlace(x: number, y: number): void;
          run: { layout: { objects: { x: number; y: number; dir: number }[] } };
        };
      }
    ).game;
    for (const [id, x, y, dir] of [
      ["flame", 9, 3, 3],
      ["flame", 8, 9, 3],
      ["tar", 6, 9, 2],
    ] as const) {
      g.tool = id;
      g.tryPlace(x, y);
      const o = g.run.layout.objects.find((q) => q.x === x && q.y === y)!;
      o.dir = dir;
    }
    g.tool = null;
  });
  await page.locator(".start-btn").click();
  await finishRaid(page);
  await expect(page.locator(".trial-result")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".trial-result h2")).toHaveText("Mastered");
  const stars = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("da.profile.v1") ?? "{}").trials?.["1-2"],
  );
  expect(stars).toBe(3);
  await page.getByRole("button", { name: "Rebuild" }).click();
  await expect(page.locator(".hud")).toHaveAttribute("data-mode", "build");
  expect(errors).toEqual([]);
});

test("leaving mid-raid settles the night on return", async ({ page }) => {
  await fresh(page);
  await page.getByText("New Descent").click();
  await page.locator(".start-btn").click();
  await expect(page.locator(".hud")).toHaveAttribute("data-mode", "raid");
  await page.reload();
  await page.getByText("Continue").click();
  await expect(page.locator(".results")).toBeVisible({ timeout: 10_000 });
  await page.locator(".results .btn.primary").click();
  await page.locator(".card-btn").first().click();
  await expect(page.locator(".night-num")).toHaveText("2");
});

test("the atlas picks a depth and shows its floorplan", async ({ page }) => {
  const errors = await fresh(page);
  await page.evaluate(() =>
    localStorage.setItem(
      "da.profile.v1",
      JSON.stringify({
        v: 2,
        renown: 120,
        runs: 4,
        wins: 3,
        maxDepth: 4,
        bestDepth: 3,
        tutorial: 99,
      }),
    ),
  );
  await page.reload();
  await page.getByText("Atlas").click();
  await expect(page.locator(".atlas")).toBeVisible();
  // Conquered depths of old saves keep their first crown.
  await expect(page.locator(".atlas-sub")).toContainText("3 crowns");
  await page.locator('.depth-node[aria-label="Depth 2"]').click();
  await expect(page.locator(".atlas-detail .plan-line")).toBeVisible();
  await page.getByText("Descend to depth 2").click();
  await expect(page.locator(".setup .depth-num")).toHaveText("2");
  await page.getByText("Descend", { exact: true }).click();
  await expect(page.locator(".hud")).toHaveAttribute("data-mode", "build");
  const depth = await page.evaluate(
    () =>
      (window as unknown as { game: { run: { depth: number } } }).game.run
        .depth,
  );
  expect(depth).toBe(2);
  expect(errors).toEqual([]);
});

test("a dawn visitor is answered before building, even after a reload", async ({
  page,
}) => {
  const errors = await fresh(page);
  await page.getByText("New Descent").click();
  await page.locator(".start-btn").click();
  await finishRaid(page);
  await expect(page.locator(".results")).toBeVisible({ timeout: 10_000 });
  await page.evaluate(() => {
    const g = (
      window as unknown as {
        game: { run: { encounter: unknown; night: number } };
      }
    ).game;
    g.run.encounter = { id: "cache", night: g.run.night, price: 55 };
  });
  await page.locator(".results .btn.primary").click();
  const gold = await page.evaluate(
    () =>
      (window as unknown as { game: { run: { gold: number } } }).game.run.gold,
  );
  await page.locator(".card-btn").first().click();
  await expect(page.locator(".encounter")).toBeVisible();
  await page.waitForTimeout(400);
  await page.reload();
  await page.getByText("Continue").click();
  await expect(page.locator(".encounter")).toBeVisible();
  await page.locator(".enc-opt").first().click();
  await expect(page.locator(".hud")).toHaveAttribute("data-mode", "build");
  await expect(page.locator(".encounter")).toHaveCount(0);
  const after = await page.evaluate(
    () =>
      (
        window as unknown as {
          game: { run: { gold: number; encounter: unknown } };
        }
      ).game.run,
  );
  expect(after.encounter).toBeNull();
  expect(after.gold).toBeGreaterThanOrEqual(gold + 55);
  expect(errors).toEqual([]);
});

test("browser back closes screens instead of leaving the game", async ({
  page,
}) => {
  const errors = await fresh(page);
  const url = page.url();
  // Menus: back closes the codex and stays on the title.
  await page.getByText("Codex").click();
  await expect(page.locator(".panel.codex")).toBeVisible();
  await page.goBack();
  await expect(page.locator(".panel.codex")).toHaveCount(0);
  await expect(page.locator(".title-screen")).toBeVisible();
  expect(page.url()).toBe(url);
  // In play: back opens the pause menu, then back again resumes.
  await page.getByText("New Descent").click();
  await expect(page.locator(".hud")).toHaveAttribute("data-mode", "build");
  await page.goBack();
  await expect(page.locator(".panel.pause")).toBeVisible();
  await page.goBack();
  await expect(page.locator(".panel.pause")).toHaveCount(0);
  await expect(page.locator(".hud")).toHaveAttribute("data-mode", "build");
  // A screen waiting for an answer keeps its place; the pause menu opens over it.
  await page.locator(".start-btn").click();
  await finishRaid(page);
  await expect(page.locator(".results")).toBeVisible({ timeout: 10_000 });
  await page.goBack();
  await expect(page.locator(".panel.pause")).toBeVisible();
  await expect(page.locator(".results")).toBeVisible();
  await page.goBack();
  await expect(page.locator(".panel.pause")).toHaveCount(0);
  await expect(page.locator(".results")).toBeVisible();
  // Escape behaves the same way as back.
  await page.keyboard.press("Escape");
  await expect(page.locator(".panel.pause")).toBeVisible();
  await page.getByText("Save & quit to menu").click();
  await expect(page.locator(".title-screen")).toBeVisible();
  expect(page.url()).toBe(url);
  expect(errors).toEqual([]);
});
