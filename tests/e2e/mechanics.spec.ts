import { expect, test } from "@playwright/test";
import { createDungeon } from "../../src/core/dungeon";

test("wire a pressure plate through visual logic, test it, and preserve the configuration on reload", async ({
  page,
}, info) => {
  const d = createDungeon("browser-circuit", "The responsive gate");
  d.schemaVersion = 2;
  d.rules = [];
  d.build = "warrior";
  for (let x = 1; x <= 6; x++) d.tiles[2 * 15 + x] = 1;
  d.objects = [
    { id: "entrance", type: "entrance", x: 1, y: 2, rotation: 0 },
    { id: "plate", type: "plate", x: 2, y: 2, rotation: 0 },
    { id: "gate", type: "gate", x: 3, y: 2, rotation: 0 },
    { id: "treasure", type: "treasure", x: 6, y: 2, rotation: 0 },
  ];
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "Import", exact: true })
    .first()
    .click();
  await (
    await chooser
  ).setFiles({
    name: "circuit.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(d)),
  });
  await page
    .locator(".dialog")
    .getByRole("button", { name: "Import", exact: true })
    .click();
  await page.getByRole("button", { name: "Visual logic", exact: true }).click();
  const editor = page.locator(".mechanics-dialog");
  await editor
    .getByRole("combobox", { name: "Source", exact: true })
    .selectOption("plate");
  await editor
    .getByRole("combobox", { name: "When", exact: true })
    .selectOption("OnEnter");
  await editor
    .getByRole("combobox", { name: "Target", exact: true })
    .selectOption("gate");
  await editor
    .getByRole("combobox", { name: "Then", exact: true })
    .selectOption("open");
  await editor.getByRole("button", { name: "Connect rule" }).click();
  await expect(editor.locator(".logic-rule")).toHaveCount(1);
  await page.screenshot({
    path: `test-results/${info.project.name}-visual-logic.png`,
  });
  await editor.getByRole("button", { name: "Back to building" }).click();
  await page.getByRole("button", { name: "Test dungeon", exact: true }).click();
  for (let i = 0; i < 5; i++)
    await page.getByRole("button", { name: "Move right", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A worthy adventure." }),
  ).toBeVisible();
  await page
    .locator(".result-card")
    .getByRole("button", { name: "Back to building" })
    .click();
  await page.reload();
  await page.getByRole("button", { name: "Visual logic", exact: true }).click();
  await expect(editor.locator(".logic-rule")).toHaveCount(1);
  await editor
    .getByRole("button", { name: "World & build", exact: true })
    .click();
  await editor.getByRole("button", { name: "Add floor", exact: true }).click();
  await editor.getByRole("button", { name: "Back to building" }).click();
  await page.getByRole("combobox", { name: "Edit floor" }).selectOption("1");
  await expect(page.getByRole("combobox", { name: "Edit floor" })).toHaveValue(
    "1",
  );
  await page.reload();
  await expect(
    page.getByRole("combobox", { name: "Edit floor" }).locator("option"),
  ).toHaveCount(2);
});
