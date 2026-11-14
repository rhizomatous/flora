import { test, expect } from "./fixtures.ts";

const base = process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5199";

test("pull requests page filters, searches, and links back to chats", async ({ page }) => {
  await page.goto(`${base}/#chats/pagination`);
  await page.getByRole("button", { name: "Hide controls", exact: true }).click();
  await page.getByRole("link", { name: "Pull requests", exact: true }).click();
  const region = page.getByRole("region", { name: "Pull requests", exact: true });
  const states = region.getByRole("group", { name: "Pull request state" });
  await expect(
    region
      .getByRole("list", { name: "Ready for review pull requests" })
      .getByRole("link", { name: /example\/fieldnotes #19:/ }),
  ).toBeVisible();
  await expect(region.getByRole("list", { name: "Draft pull requests" })).toHaveCount(0);
  await expect(
    states.getByRole("button", { name: "Ready for review 1", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await states.getByRole("button", { name: /^Draft / }).click();
  await expect(region.getByRole("list", { name: "Draft pull requests" })).toBeVisible();
  await states.getByRole("button", { name: /^Ready for review / }).click();
  await expect(region.getByLabel("35 additions, 36 deletions")).toBeVisible();
  await states.getByRole("button", { name: /^All / }).click();
  await expect(region.getByRole("list")).toHaveCount(4);
  await states.getByRole("button", { name: /^Merged / }).click();
  await expect(region.getByRole("list")).toHaveCount(1);
  await expect(region.getByRole("link", { name: /example\/flora #73:/ })).toHaveAttribute(
    "href",
    "https://github.com/example/flora/pull/73",
  );
  await states.getByRole("button", { name: /^All / }).click();
  await region.getByRole("combobox", { name: "Repository" }).selectOption("example/fieldnotes");
  await expect(region.getByRole("list")).toHaveCount(2);
  await region.getByRole("button", { name: "Search pull requests", exact: true }).click();
  const search = region.getByRole("textbox", { name: "Search pull requests" });
  await expect(search).toBeFocused();
  await search.fill("#18");
  await expect(region.getByRole("list")).toHaveCount(1);
  await search.fill("no such pull request");
  await expect(region.getByText("No pull requests match these filters.")).toBeVisible();
  await region.getByRole("button", { name: "Show all pull requests" }).click();
  await expect(region.getByRole("list")).toHaveCount(4);
  await search.press("Escape");
  await expect(
    region.getByRole("button", { name: "Search pull requests", exact: true }),
  ).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await region
    .getByRole("list", { name: "Closed pull requests" })
    .getByRole("link", { name: "Open chat: Fix duplicate notes between pages", exact: true })
    .click();
  await expect(page).toHaveURL(/#chats\/pagination$/);
});

test("pull request groups update when saved statuses change", async ({ page }) => {
  let merged = false;
  await page.route("**/api/notifications*", async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    await route.fulfill({
      response,
      body: merged ? body.replaceAll('"state":"open"', '"state":"merged"') : body,
    });
  });
  await page.goto(`${base}/#pulls`);
  await page.getByRole("button", { name: "Hide controls", exact: true }).click();
  const region = page.getByRole("region", { name: "Pull requests", exact: true });
  await expect(region.getByRole("list", { name: "Ready for review pull requests" })).toBeVisible();
  merged = true;
  await expect(region.getByText("No pull requests match these filters.")).toBeVisible();
  await region.getByRole("button", { name: /^Merged / }).click();
  await expect(
    region
      .getByRole("list", { name: "Merged pull requests" })
      .getByRole("link", { name: /example\/fieldnotes #19:/ }),
  ).toBeVisible();
});
