import { expect, test } from "@playwright/test";

test("pinch and two-finger pan do not paint; long press opens object actions", async ({
  page,
  context,
}, info) => {
  test.skip(
    info.project.name !== "mobile",
    "Touch gestures require mobile input.",
  );
  await page.goto("/");
  const canvas = page.locator("canvas"),
    bounds = (await canvas.boundingBox())!,
    session = await context.newCDPSession(page);
  const point = (x: number, y: number, id: number) => ({
    x: bounds.x + ((24 + x * 48 + 24) / 768) * bounds.width,
    y: bounds.y + ((24 + y * 48 + 24) / 672) * bounds.height,
    id,
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [point(5, 5, 1), point(9, 5, 2)],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [point(4, 6, 1), point(11, 6, 2)],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(page.locator(".budget-box strong")).toHaveText("135 / 160");
  await page.getByRole("button", { name: "Fit dungeon", exact: true }).tap();
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [point(4, 3, 1)],
  });
  await expect(page.locator(".context-wheel")).toBeVisible();
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await page
    .locator(".context-wheel")
    .getByRole("button", { name: "Copy", exact: true })
    .tap();
  await page.getByRole("button", { name: "Paste", exact: true }).tap();
  await canvas.scrollIntoViewIfNeeded();
  const destination = (await canvas.boundingBox())!;
  await page.touchscreen.tap(
    destination.x + ((24 + 4 * 48 + 24) / 768) * destination.width,
    destination.y + ((24 + 4 * 48 + 24) / 672) * destination.height,
  );
  await expect(page.locator(".budget-box strong")).toHaveText("138 / 160");
});

test("a touch stroke paints every corridor tile without losing pointer capture", async ({
  page,
  context,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "mobile",
    "Requires the touch-enabled browser project.",
  );
  await page.goto("/");
  await page.getByRole("button", { name: "New dungeon", exact: true }).tap();
  await page.getByRole("button", { name: "Create blank dungeon" }).tap();
  await page.getByRole("button", { name: /Corridor/ }).tap();
  const bounds = (await page.locator("canvas").boundingBox())!;
  const touch = (x: number) => ({
    x: bounds.x + ((24 + x * 48 + 24) / 768) * bounds.width,
    y: bounds.y + ((24 + 6 * 48 + 24) / 672) * bounds.height,
    id: 1,
  });
  const session = await context.newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [touch(6)],
  });
  for (let x = 7; x <= 10; x++)
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [touch(x)],
    });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(page.locator(".budget-box strong")).toHaveText("5 / 160");
});
