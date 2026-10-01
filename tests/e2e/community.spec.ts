import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

async function createAccount(page: Page, handle: string) {
  const hub = page.locator(".community-dialog:not(.mechanics-dialog)");
  await hub.getByRole("button", { name: "Profile", exact: true }).click();
  const form = hub.locator('form[data-form="register"]');
  await form.getByLabel("Handle", { exact: true }).fill(handle);
  await form.getByLabel("Display name").fill(handle);
  await form.getByLabel("Password").fill("Test-only passphrase 2026");
  await form.getByRole("button", { name: "Create account" }).click();
  await expect(hub.getByRole("button", { name: "Sign out" })).toBeVisible();
}
async function complete(page: Page, mobile: boolean) {
  for (const [direction, times] of [
    ["down", 1],
    ["right", 11],
    ["down", 7],
    ["right", 1],
  ] as const) {
    for (let n = 0; n < times; n++) {
      if (mobile)
        await page
          .getByRole("button", { name: `Move ${direction}`, exact: true })
          .tap();
      else
        await page.keyboard.press(
          `Arrow${direction[0].toUpperCase()}${direction.slice(1)}`,
        );
    }
  }
  await expect(
    page.getByRole("heading", { name: "A worthy adventure." }),
  ).toBeVisible();
}

test("two architects publish, discover, challenge, complete, earn rewards and watch a server replay", async ({
  page,
}, info) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const suffix = `${info.project.name}_${Date.now().toString(36)}`;
  const creator = `a_${suffix}`;
  const adventurer = `b_${suffix}`;
  const title = `Online crypt ${suffix}`;
  const mobile = info.project.name === "mobile";
  await page.goto("/");
  await page.getByRole("textbox", { name: "Dungeon name" }).fill(title);
  await page.getByRole("textbox", { name: "Dungeon name" }).press("Tab");
  await page.getByRole("button", { name: "Test dungeon", exact: true }).click();
  await complete(page, mobile);
  await page
    .locator(".result-card")
    .getByRole("button", { name: "Back to building" })
    .click();
  await page
    .getByRole("button", { name: "Community", exact: true })
    .first()
    .click();
  const hub = page.locator(".community-dialog:not(.mechanics-dialog)");
  await createAccount(page, creator);
  await hub.getByRole("button", { name: "Drafts", exact: true }).click();
  await hub
    .getByRole("button", { name: "Save current draft to cloud" })
    .click();
  await expect(hub.getByText("Revision 1", { exact: false })).toBeVisible();
  await hub.getByRole("button", { name: "Publish", exact: true }).click();
  await hub.getByLabel("Description").fill("A looping cave made for a friend.");
  await hub.getByLabel("Combat", { exact: true }).check();
  await hub
    .getByRole("button", { name: "Publish online", exact: true })
    .click();
  await expect(
    hub.getByText("Published. Your clear was verified by the server."),
  ).toBeVisible();
  const shareCode = await hub
    .locator("p")
    .filter({ hasText: /^Share code:/ })
    .locator("strong")
    .innerText();
  await hub.getByRole("button", { name: "Profile", exact: true }).click();
  await hub.getByRole("button", { name: "Sign out" }).click();
  await createAccount(page, adventurer);
  await hub.getByRole("button", { name: "Discover", exact: true }).click();
  await hub.getByLabel("Find a dungeon or share code").fill(shareCode);
  await hub.getByRole("button", { name: "Explore", exact: true }).click();
  await expect(hub.getByRole("heading", { name: title })).toBeVisible();
  await hub.getByRole("button", { name: "Favorite", exact: true }).click();
  await expect(
    hub.getByRole("button", { name: "Unfavorite", exact: true }),
  ).toBeVisible();
  await hub.getByRole("button", { name: "QR code", exact: true }).click();
  await expect(
    hub.getByRole("img", { name: "Scan to open this dungeon" }),
  ).toBeVisible();
  await hub
    .getByRole("button", { name: "Back to dungeon", exact: true })
    .click();
  await hub
    .getByRole("button", { name: "Follow creator", exact: true })
    .click();
  await expect(
    hub.getByRole("button", { name: "Unfollow creator", exact: true }),
  ).toBeVisible();
  await hub.getByLabel("Friend’s handle").fill(creator);
  await hub.getByRole("button", { name: "Send challenge" }).click();
  await expect(
    hub.getByText("Challenge sent.", { exact: false }),
  ).toBeVisible();
  await page.screenshot({
    path: `test-results/${info.project.name}-community.png`,
  });
  await hub.getByRole("button", { name: "Enter dungeon", exact: true }).click();
  await expect(hub).not.toBeVisible();
  await expect(page.locator("canvas")).toBeFocused();
  await complete(page, mobile);
  await expect(page.locator(".result-card")).toContainText(
    "Verified completed. +25 XP",
  );
  await page
    .getByRole("button", { name: "Back to community", exact: true })
    .click();
  await hub.getByLabel("Find a dungeon or share code").fill(shareCode);
  await hub.getByRole("button", { name: "Explore", exact: true }).click();
  await expect(hub.locator(".community-stats")).toContainText("100%");
  await hub.getByRole("button", { name: "Watch replay", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Replay theatre" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("slider", { name: "Replay position" }).fill("10");
  await expect(
    page.getByRole("slider", { name: "Replay position" }),
  ).toHaveValue("10");
  await page
    .getByRole("button", { name: "Community", exact: true })
    .first()
    .click();
  await hub.getByRole("button", { name: "Profile", exact: true }).click();
  await hub.getByRole("button", { name: "Sign out", exact: true }).click();
  const login = hub.locator('form[data-form="login"]');
  await login.getByLabel("Handle", { exact: true }).fill(creator);
  await login.getByLabel("Password").fill("Test-only passphrase 2026");
  await login.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(hub.getByRole("button", { name: "Sign out" })).toBeVisible();
  await hub.getByRole("button", { name: "Worlds", exact: true }).click();
  await hub
    .getByLabel("Campaign title", { exact: true })
    .fill(`The path ${suffix}`);
  await hub
    .getByLabel("Premise", { exact: true })
    .fill("A journey through the crypt.");
  await hub
    .getByRole("button", { name: "Create campaign", exact: true })
    .click();
  await hub.getByLabel("Chapter title", { exact: true }).fill("The beginning");
  await hub
    .getByLabel("Story before this chapter", { exact: true })
    .fill("Enter the forgotten halls.");
  await hub.getByRole("button", { name: "Add chapter", exact: true }).click();
  await expect(
    hub.getByRole("heading", { name: "The beginning", exact: true }),
  ).toBeVisible();
  await hub.getByRole("button", { name: "Team", exact: true }).click();
  await hub
    .getByRole("button", { name: "Share current workshop", exact: true })
    .click();
  await hub.getByLabel("Co-architect handle", { exact: true }).fill(adventurer);
  await hub
    .getByRole("button", { name: "Invite co-architect", exact: true })
    .click();
  await expect(
    hub.getByText(`@${adventurer} (invited)`, { exact: false }),
  ).toBeVisible();
  await hub.getByLabel("Guild name", { exact: true }).fill(`Guild ${suffix}`);
  await hub
    .getByLabel("Description", { exact: true })
    .fill("Maps and mechanisms.");
  await hub.getByRole("button", { name: "Create guild", exact: true }).click();
  await expect(
    hub.getByRole("heading", { name: `Guild ${suffix}`, exact: true }),
  ).toBeVisible();
  await hub.getByRole("button", { name: "Shop", exact: true }).click();
  await hub
    .getByRole("button", { name: "Unlock banner", exact: true })
    .first()
    .click();
  await expect(hub.locator(".community-message")).toContainText(
    "Earn more currency",
  );
  await hub.getByRole("button", { name: "Challenges", exact: true }).click();
  await hub
    .getByRole("button", { name: "Explore submissions", exact: true })
    .first()
    .click();
  await hub
    .getByLabel("Community category", { exact: true })
    .selectOption("most-favorited");
  await hub.getByRole("button", { name: "Show category", exact: true }).click();
  await expect(
    hub.getByRole("heading", { name: "Challenge submissions", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
