import { expect, test } from "@playwright/test";
import { createStarter } from "../../src/core/dungeon";
import { simulateAdventurer } from "../../src/core/adventurers";

test("a rejected offline submission can be retained as a local replay before removing its retry", async ({
  page,
}) => {
  const replay = simulateAdventurer(createStarter(), "expired-version", 31, 0);
  await page.goto("/");
  await page.evaluate(
    (replay) =>
      localStorage.setItem(
        "da.online-outbox",
        JSON.stringify([
          {
            id: "expired-ticket",
            playerId: "original-player",
            actions: replay.actions,
            abandon: false,
            replay,
            expiresAt: "2020-01-01T00:00:00Z",
            lastError: "This attempt ticket expired.",
          },
        ]),
      ),
    replay,
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Sync pending runs", exact: true })
    .click();
  await expect(
    page.getByText("This attempt ticket expired.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Keep local replay", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Replay theatre" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Sync pending runs", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Remove queued run", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Remove this queued run?" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Remove queued run", exact: true })
    .click();
  await expect(
    page.getByText("No pending adventures.", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("da.online-outbox")!),
    ),
  ).toEqual([]);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Sync pending runs", exact: true }),
  ).toHaveCount(0);
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("dungeon-architect.v1")!),
  );
  expect(saved.practice.some((r: { id: string }) => r.id === replay.id)).toBe(
    true,
  );
});
