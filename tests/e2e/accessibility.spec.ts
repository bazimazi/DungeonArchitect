import { expect, test } from "@playwright/test";

test("keyboard cursor and adventures expose current descriptions without stale game state", async ({
  page,
}) => {
  await page.goto("/");
  const canvas = page.locator("#dungeon-canvas");
  const description = page.locator("#dungeon-description");
  await canvas.focus();
  await expect(description).toContainText("Floor 1, row C, column 3");
  await canvas.press("ArrowRight");
  await expect(description).toContainText("Floor 1, row C, column 4");
  await page.getByRole("button", { name: "Test dungeon", exact: true }).click();
  await expect(description).toContainText("Health");
  await canvas.press("ArrowDown");
  await expect(description).toContainText("down:");
  await canvas.press("i");
  await expect(description).not.toContainText("event.");
  await page
    .getByRole("button", { name: "Back to building", exact: true })
    .first()
    .click();
  await canvas.focus();
  await expect(description).not.toContainText("Health");
});

test("static terrain caching preserves pixels and invalidates geometry, floor and heatmap changes", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const rendererPath = "/src/ui/renderer.ts",
      dungeonPath = "/src/core/dungeon.ts";
    const { DungeonRenderer } = await import(rendererPath);
    const { createStarter } = await import(dungeonPath);
    const canvas = document.createElement("canvas"),
      renderer = new DungeonRenderer(canvas);
    const dungeon = createStarter();
    const options = {
      dungeon,
      grid: true,
      reducedMotion: true,
      time: 0,
      hover: null,
      tool: "select",
      selected: [],
    };
    let calls = 0;
    const original = CanvasRenderingContext2D.prototype.fillRect;
    CanvasRenderingContext2D.prototype.fillRect = function (
      ...args: [number, number, number, number]
    ) {
      calls++;
      return original.apply(this, args);
    };
    try {
      renderer.draw(options);
      const initialCalls = calls,
        initial = canvas.toDataURL();
      calls = 0;
      renderer.draw(options);
      const cachedCalls = calls,
        same = initial === canvas.toDataURL();
      const edited = { ...dungeon, tiles: [...dungeon.tiles] };
      edited.tiles[0] = edited.tiles[0] ? 0 : 1;
      renderer.draw({ ...options, dungeon: edited });
      const changed = initial !== canvas.toDataURL();
      renderer.draw(options);
      const restored = initial === canvas.toDataURL();
      renderer.draw({
        ...options,
        heatmap: { deathCells: new Map(), traffic: new Map([["2,2", 1]]) },
      });
      const heatmapChanged = initial !== canvas.toDataURL();
      const multi = {
        ...dungeon,
        height: 26,
        tiles: [...dungeon.tiles, ...Array(195).fill(0)],
      };
      renderer.floor = 1;
      renderer.draw({ ...options, dungeon: multi });
      const floorChanged = initial !== canvas.toDataURL();
      renderer.floor = 0;
      renderer.draw(options);
      return {
        initialCalls,
        cachedCalls,
        same,
        changed,
        restored,
        heatmapChanged,
        floorChanged,
        returned: initial === canvas.toDataURL(),
      };
    } finally {
      CanvasRenderingContext2D.prototype.fillRect = original;
    }
  });
  expect(result).toMatchObject({
    same: true,
    changed: true,
    restored: true,
    heatmapChanged: true,
    floorChanged: true,
    returned: true,
  });
  expect(result.initialCalls - result.cachedCalls).toBeGreaterThan(100);
});
