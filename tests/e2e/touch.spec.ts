import { expect, test } from "@playwright/test";

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
