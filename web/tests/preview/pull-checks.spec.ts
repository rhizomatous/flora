import { test, expect } from "./fixtures.ts";

test("selected PR overview matches the compact chat and flat checks layout", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const screenshotDir = process.env.FLORA_SCREENSHOT_DIR;
  const base = process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5199";
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto(`${base}/#chats/pagination`);
  await page.getByRole("combobox", { name: "Preview checks", exact: true }).selectOption("success");
  const inline = page.locator(
    '[data-inline-pr][href="https://github.com/example/fieldnotes/pull/19"]',
  );
  await expect(inline).toHaveAttribute("data-pr-tone", "success");
  await page.getByRole("button", { name: "Hide controls", exact: true }).click();
  const draft = page.getByLabel("Follow-up", { exact: true });
  await draft.fill("Keep my draft while checking CI");
  const transcript = page.getByRole("region", { name: "Conversation", exact: true });
  await expect(transcript.locator("[data-pull-event]")).toHaveCount(2);
  await expect(transcript.locator("[data-pull-checks]")).toHaveCount(0);
  await inline.focus();
  await page.keyboard.press("Enter");
  const side = page.getByRole("complementary", { name: "Side panel" });
  const overview = side.locator(
    '[data-pull-overview="https://github.com/example/fieldnotes/pull/19"]',
  );
  await expect(side.getByRole("tab", { name: "PR #19", exact: true })).toBeFocused();
  await expect(overview.getByRole("heading", { name: "Stabilize notes pagination" })).toBeVisible();
  await expect(side.getByRole("tablist").getByRole("tabpanel")).toHaveCount(0);
  const sideBox = await side.boundingBox();
  const overviewBox = await overview.boundingBox();
  expect(overviewBox?.width).toBeGreaterThan((sideBox?.width ?? 0) - 4);
  await expect(overview.getByText("fix/pagination-release", { exact: true })).toBeVisible();
  await expect(overview.getByText("3 passed", { exact: true })).toBeVisible();
  await expect(overview.getByRole("link", { name: "Browser tests Passed" })).toHaveAttribute(
    "href",
    "https://github.com/rhizomatous/flora/actions",
  );
  await expect(overview.getByRole("status")).toHaveCount(0);
  await expect(overview.locator("time")).toHaveText(/\d+m ago/);
  await expect(overview.getByRole("link", { name: "Add reviewers on GitHub" })).toHaveAttribute(
    "href",
    "https://github.com/example/fieldnotes/pull/19",
  );
  await expect(overview.getByRole("link", { name: "Add labels on GitHub" })).toBeVisible();
  await expect(overview.getByText("No issues", { exact: true })).toBeVisible();
  await expect(overview.getByRole("link", { name: "View PR diff on GitHub" })).toHaveAttribute(
    "href",
    "https://github.com/example/fieldnotes/pull/19/files",
  );
  await expect(overview.getByRole("link", { name: "Merge on GitHub" })).toHaveAttribute(
    "target",
    "_blank",
  );

  await overview.getByRole("button", { name: "PR actions", exact: true }).click();
  const menu = page.getByRole("menu");
  await expect(
    menu.getByRole("menuitem", { name: "Edit reviewers on GitHub", exact: true }),
  ).toHaveAttribute("href", "https://github.com/example/fieldnotes/pull/19");
  await menu.getByRole("menuitem", { name: "Copy PR link", exact: true }).click();
  await expect(menu.getByRole("menuitem", { name: "PR link copied", exact: true })).toBeVisible();
  if (screenshotDir !== undefined) {
    await page.screenshot({ path: `${screenshotDir}/checks-actions.png` });
  }
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-slot="dropdown-menu-content"]')).toHaveCount(0);
  if (screenshotDir !== undefined) {
    await page.screenshot({ path: `${screenshotDir}/checks-desktop.png` });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(overview.getByRole("heading")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  if (screenshotDir !== undefined) {
    await page.screenshot({ path: `${screenshotDir}/checks-mobile.png` });
  }
  await overview.getByRole("list", { name: "Checks for PR #19" }).scrollIntoViewIfNeeded();
  if (screenshotDir !== undefined) {
    await page.screenshot({ path: `${screenshotDir}/checks-mobile-list.png` });
  }
  await side.getByRole("button", { name: "Close side panel", exact: true }).click();
  await expect(draft).toHaveValue("Keep my draft while checking CI");
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.getByRole("button", { name: "Linked pull requests (2)", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("link", { name: /example\/fieldnotes #18 Closed/ })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const previous = side.locator(
    '[data-pull-overview="https://github.com/example/fieldnotes/pull/18"]',
  );
  await expect(previous.getByText(/Saved checks for previous head/)).toBeVisible();
  await expect(previous.getByText(/GitHub rate limit reached/)).toBeVisible();
  await expect(previous.getByText("bug", { exact: true })).toBeVisible();
  await expect(previous.getByRole("link", { name: /#115 Show GitHub PR checks/ })).toHaveAttribute(
    "href",
    "https://github.com/rhizomatous/flora/issues/115",
  );
  await expect(previous.getByRole("link", { name: "Merge on GitHub" })).toHaveCount(0);

  await expect(side.getByRole("tab", { name: "PR #19", exact: true })).toBeVisible();
  if (screenshotDir !== undefined) {
    await page.screenshot({ path: `${screenshotDir}/checks-stale.png` });
  }
  await page.reload();
  await page.getByRole("button", { name: "Hide controls", exact: true }).click();
  await expect(side.getByRole("tab", { name: "PR #18", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await side.getByRole("tab", { name: "PR #19", exact: true }).click();
  await expect(overview.getByRole("status")).toHaveCount(0);
  await side.getByRole("button", { name: "Close PR #19", exact: true }).click();
  await expect(side.getByRole("tab", { name: "Overview", exact: true })).toBeFocused();
  await side.getByRole("button", { name: "Close side panel", exact: true }).click();
  await expect(draft).toHaveValue("Keep my draft while checking CI");
  // Restore the default fixture for the other preview scenarios.
  await page.request.post(`${base}/__preview/checks?chat=pagination&state=saved`);
});

test("PR icons follow checks across the feed, sidebar, inline links, and controls", async ({
  page,
}) => {
  const base = process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5199";
  let mode = "failure";
  await page.route("**/api/notifications*", async (route) => {
    const response = await route.fetch();
    let body = await response.text();
    if (mode === "pending" || mode === "success") {
      body = body.replaceAll('"state":"failure"', `"state":"${mode}"`);
    }
    if (mode === "mixed") body = body.replaceAll('"state":"success"', '"state":"pending"');
    if (mode === "stale") body = body.replaceAll('"sha":"b7e29d4', '"sha":"oldhead');
    if (mode === "skipped") {
      body = body
        .replaceAll('"state":"success"', '"state":"neutral"')
        .replaceAll('"state":"failure"', '"state":"neutral"');
    }
    if (mode === "draft") body = body.replaceAll('"draft":false', '"draft":true');
    await route.fulfill({ response, body });
  });
  await page.goto(`${base}/#chats/pagination`);
  await page.getByRole("button", { name: "Hide controls", exact: true }).click();
  const inline = page.locator(
    '[data-inline-pr][href="https://github.com/example/fieldnotes/pull/19"]',
  );
  const row = page.locator(".florets-navigation-link[href='#chats/pagination']");
  for (const [next, tone] of [
    ["failure", "failure"],
    ["pending", "pending"],
    ["success", "success"],
    ["mixed", "failure"],
    ["stale", "neutral"],
    ["skipped", "neutral"],
    ["draft", "neutral"],
  ] as const) {
    mode = next;
    await expect(inline).toHaveAttribute("data-pr-tone", tone);
    const label = next === "draft" ? "1 draft pull request" : "1 open pull request";
    await expect(row.getByLabel(label, { exact: true })).toHaveAttribute("data-pr-tone", tone);
    await page.getByRole("button", { name: "Linked pull requests (2)", exact: true }).click();
    await expect(
      page.getByRole("dialog").locator('a[href="https://github.com/example/fieldnotes/pull/19"]'),
    ).toHaveAttribute("data-pr-tone", tone);
    await page.keyboard.press("Escape");
  }
});

test("preview controls let reviewers try yellow and green PR icons", async ({ page }) => {
  const screenshotDir = process.env.FLORA_SCREENSHOT_DIR;
  const base = process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5199";
  await page.goto(`${base}/#chats/pagination`);
  const select = page.getByRole("combobox", { name: "Preview checks", exact: true });
  const trigger = page.getByRole("button", { name: "Linked pull requests (2)", exact: true });
  for (const state of ["pending", "success"]) {
    await select.selectOption(state);
    await trigger.click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.locator('a[href="https://github.com/example/fieldnotes/pull/19"]'),
    ).toHaveAttribute("data-pr-tone", state);
    if (screenshotDir !== undefined) {
      await dialog.screenshot({ path: `${screenshotDir}/checks-${state}.png` });
    }
    await page.keyboard.press("Escape");
  }
  await select.selectOption("saved");
  await expect(page.locator('[data-inline-pr="open"]')).toHaveAttribute("data-pr-tone", "failure");
});

test("PR collection rows open the selected PR beside its chat", async ({ page }) => {
  const base = process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5199";
  await page.goto(`${base}/#pulls`);
  await page.getByRole("button", { name: "Hide controls", exact: true }).click();
  await page.getByRole("link", { name: /example\/fieldnotes #19:/ }).click();
  await expect(page).toHaveURL(/#chats\/pagination$/);
  const side = page.getByRole("complementary", { name: "Side panel" });
  await expect(side.getByRole("tab", { name: "PR #19", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(side.getByRole("heading", { name: "Stabilize notes pagination" })).toBeVisible();
});
