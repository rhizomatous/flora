import { test, expect } from "./fixtures.ts";

test("linked PRs appear in the sidebar, hover cards, and composer", async ({ page }) => {
  const base = process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5199";
  await page.goto(`${base}/#chats/pagination`);
  await page.getByRole("button", { name: "Hide controls", exact: true }).click();
  const row = page.locator(".florets-navigation-link[href='#chats/pagination']");
  await expect(row.getByLabel("1 open pull request", { exact: true })).toBeVisible();
  await expect(row.getByLabel("1 closed pull request", { exact: true })).toBeVisible();
  await row.hover();
  const preview = page.locator(".sidebar-chat-preview");
  await expect(
    preview.getByRole("link", { name: /example\/fieldnotes #18 Closed/ }),
  ).toHaveAttribute("href", "https://github.com/example/fieldnotes/pull/18");
  await expect(preview.getByRole("link", { name: /example\/fieldnotes #19 Open/ })).toBeVisible();
  await expect(preview.getByText("Stabilize notes pagination", { exact: true })).toHaveCount(2);
  await expect(preview.getByLabel("35 additions, 36 deletions", { exact: true })).toHaveCount(2);
  await expect(preview.locator("time")).toHaveCount(0);
  await expect(preview.getByText("Your turn", { exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  const title = page.getByRole("button", {
    name: "Fix duplicate notes between pages",
    exact: true,
  });
  await title.focus();
  const summary = page.getByLabel("Chat summary", { exact: true });
  await expect(
    summary.getByRole("list", { name: "Linked pull requests" }).getByRole("link"),
  ).toHaveCount(2);
  await page.keyboard.press("Escape");
  const draft = page.getByLabel("Follow-up", { exact: true });
  await draft.fill("Keep this draft");
  const trigger = page.getByRole("button", { name: "Linked pull requests (2)", exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("link")).toHaveCount(2);
  await expect(dialog.getByRole("link").first()).toHaveAttribute("target", "_blank");
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(draft).toHaveValue("Keep this draft");
  await page.setViewportSize({ width: 390, height: 844 });
  await trigger.click();
  await expect(dialog.getByRole("link", { name: /example\/fieldnotes #19 Open/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.keyboard.press("Escape");

  for (const [chat, label] of [
    ["checkout", "example/storefront #42 Draft"],
    ["focus", "example/flora #73 Merged"],
  ] as const) {
    await page.goto(`${base}/#chats/${chat}`);
    await page.getByRole("button", { name: "Linked pull requests (1)", exact: true }).click();
    await expect(
      page.getByRole("dialog").getByRole("link", { name: new RegExp(label) }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
  }
});

test("linked PRs refresh from the feed without reloading the chat", async ({ page }) => {
  const base = process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5199";
  let merged = false;
  await page.route("**/api/notifications*", async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    await route.fulfill({
      response,
      body: merged ? body.replaceAll('"state":"open"', '"state":"merged"') : body,
    });
  });
  await page.goto(`${base}/#chats/pagination`);
  await page.getByRole("button", { name: "Hide controls", exact: true }).click();
  await page.getByRole("button", { name: "Linked pull requests (2)", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("link", { name: /example\/fieldnotes #19 Open/ })).toBeVisible();
  merged = true;
  await expect(dialog.getByRole("link", { name: /example\/fieldnotes #19 Merged/ })).toBeVisible();
  const row = page.locator(".florets-navigation-link[href='#chats/pagination']");
  await expect(row.getByLabel("1 merged pull request", { exact: true })).toBeVisible();
});
