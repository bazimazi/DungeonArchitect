import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

async function completeStarter(page: Page, touch: boolean) {
  await page.getByRole("button", { name: "Test dungeon", exact: true }).click();
  const move = async (direction: string, times: number) => {
    for (let i = 0; i < times; i++) {
      if (touch)
        await page
          .getByRole("button", { name: `Move ${direction}`, exact: true })
          .tap();
      else
        await page.keyboard.press(
          `Arrow${direction[0].toUpperCase()}${direction.slice(1)}`,
        );
    }
  };
  await move("down", 1);
  await move("right", 11);
  await move("down", 7);
  await move("right", 1);
  await expect(
    page.getByRole("heading", { name: "A worthy adventure." }),
  ).toBeVisible();
  await page
    .locator(".result-card")
    .getByRole("button", { name: "Back to building" })
    .click();
}

test("complete, publish, simulate, replay, edit, retest, republish, and reload", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Publish dungeon", exact: true }),
  ).toBeDisabled();
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-workshop.png`,
    fullPage: testInfo.project.name !== "mobile",
  });
  if (testInfo.project.name === "mobile") {
    const board = (await page.locator("canvas").boundingBox())!;
    const tray = (await page.locator(".palette").boundingBox())!;
    expect(board.y + board.height).toBeLessThan(tray.y);
  }
  await completeStarter(page, testInfo.project.name === "mobile");
  await expect(
    page.getByRole("button", { name: "Publish dungeon", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Publish dungeon", exact: true })
    .click();
  await page.getByRole("button", { name: "Invite 6 adventurers" }).click();
  await expect(page.locator(".attempt-card")).toHaveCount(6);
  await expect(page.locator(".stat-grid")).toContainText("100%");
  await page.locator(".attempt-card").first().click();
  await expect(
    page.getByRole("heading", { name: "Replay theatre" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("slider", { name: "Replay position" }).fill("10");
  await expect(
    page.getByRole("slider", { name: "Replay position" }),
  ).toHaveValue("10");
  await page
    .getByRole("combobox", { name: "Playback speed" })
    .selectOption("4");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeVisible({ timeout: 10_000 });
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-replay.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Workshop", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Dungeon name" })
    .fill("Mossveil Reimagined");
  await page.getByRole("textbox", { name: "Dungeon name" }).press("Tab");
  await expect(
    page.getByRole("button", { name: "Publish new version" }),
  ).toBeDisabled();
  await completeStarter(page, testInfo.project.name === "mobile");
  await page.getByRole("button", { name: "Publish new version" }).click();
  await page.getByRole("button", { name: "Invite 6 adventurers" }).click();
  await expect(page.locator(".version-comparison")).toContainText("v1");
  await expect(page.locator(".version-comparison")).toContainText("v2");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Dungeon name" })).toHaveValue(
    "Mossveil Reimagined",
  );
  await page.getByRole("button", { name: /^Attempts/ }).click();
  await expect(page.locator("#version-select option")).toHaveCount(2);
  await expect(page.locator(".attempt-card")).toHaveCount(6);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  expect(overflow).toBe(false);
  expect(errors).toEqual([]);
});

test("a failed personal test can be replayed, inspected at death, and restored after reload", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Test dungeon", exact: true }).click();
  // Walk next to the upper skeleton and hesitate until its attacks prove fatal.
  await page.keyboard.press("ArrowDown");
  for (let i = 0; i < 7; i++) await page.keyboard.press("ArrowRight");
  for (let i = 0; i < 26; i++) await page.keyboard.press("e");
  await expect(
    page.getByRole("heading", { name: "The dungeon wins." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Replay last test" }).click();
  await page.getByRole("button", { name: "Jump to death" }).click();
  await expect(page.locator("#replay-health")).toHaveText("0 / 100");
  await page.reload();
  await page.getByRole("button", { name: "Replay last test" }).click();
  await page.getByRole("button", { name: "Jump to death" }).click();
  await expect(page.locator("#replay-health")).toHaveText("0 / 100");
});

test("production build reloads and plays with the network offline", async ({
  page,
  context,
}) => {
  await page.goto("http://127.0.0.1:5189/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener(
          "controllerchange",
          () => resolve(),
          { once: true },
        ),
      );
  });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Dungeon name" })).toHaveValue(
    "Mossveil Crypt",
  );
  await page.getByRole("button", { name: "Test dungeon", exact: true }).click();
  await page.getByRole("button", { name: "Move down" }).click();
  await expect(page.locator(".health-value")).toContainText("100");
  await context.setOffline(false);
});

test("blank dungeon editor supports placement, undo, validation, and error feedback", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New dungeon", exact: true }).click();
  await page.getByRole("button", { name: "Create blank dungeon" }).click();
  const tile = async (x: number, y: number) => {
    await page.locator("canvas").scrollIntoViewIfNeeded();
    const bounds = (await page.locator("canvas").boundingBox())!;
    await page.mouse.click(
      bounds.x + ((24 + x * 48 + 24) / 768) * bounds.width,
      bounds.y + ((24 + y * 48 + 24) / 672) * bounds.height,
    );
  };
  await tile(2, 2);
  await expect(page.locator(".budget-box strong")).toHaveText("9 / 160");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".budget-box strong")).toHaveText("0 / 160");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await page.getByRole("button", { name: "Objects", exact: true }).click();
  await page.getByRole("button", { name: /Entrance/ }).click();
  await tile(2, 2);
  await page.getByRole("button", { name: /Treasure/ }).click();
  await tile(3, 2);
  await page
    .getByRole("button", { name: "Validate dungeon", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Layout checks passed");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .last()
    .click();
  await tile(8, 8);
  await expect(page.locator(".toast")).toContainText(
    "Place a room or corridor here first",
  );
  await page.getByRole("button", { name: "Test dungeon", exact: true }).click();
  await page.getByRole("button", { name: "Move right", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A worthy adventure." }),
  ).toBeVisible();
});
