import { test, expect } from "./fixtures.ts";

test("shared PR checks, previous revisions, keyboard access, and draft preservation", async ({
  page,
}) => {
  const screenshotDir = process.env.FLORA_SCREENSHOT_DIR;
  const base = process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5199";
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto(`${base}/#chats/pagination`);
  await page.getByRole("button", { name: "Hide controls", exact: true }).click();
  const draft = page.getByLabel("Follow-up", { exact: true });
  await draft.fill("Keep my draft while checking CI");
  const trigger = page.getByRole("button", { name: "Linked pull requests (2)", exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("1 failed · 2 passed", { exact: true })).toBeVisible();
  await expect(dialog.locator("[data-pull-checks]")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(draft).toHaveValue("Keep my draft while checking CI");
  const transcript = page.getByRole("region", { name: "Conversation", exact: true });
  await expect(transcript.getByLabel("Pull request details").last()).toBeVisible();
  const row = page.locator(".florets-navigation-link[href='#chats/pagination']");
  await row.hover();
  await expect(
    page.locator(".sidebar-chat-preview").getByText("1 failed · 2 passed", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Open side panel", exact: true }).click();
  const side = page.getByRole("complementary", { name: "Side panel" });
  const details = side.locator("[data-pull-checks]");
  await details.first().locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(side.getByText(/Saved checks for previous head/)).toBeVisible();
  await expect(side.getByText(/GitHub rate limit reached/)).toBeVisible();
  await details.last().locator("summary").click();
  await expect(
    side.getByRole("link", { name: "Browser tests", exact: true }).last(),
  ).toHaveAttribute("href", "https://github.com/rhizomatous/flora/actions");
  await expect(transcript.locator("[data-pull-checks]")).toHaveCount(0);
  if (screenshotDir !== undefined) {
    await page.screenshot({ path: `${screenshotDir}/checks-desktop.png` });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(side.getByText(/GitHub rate limit reached/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  if (screenshotDir !== undefined) {
    await page.screenshot({ path: `${screenshotDir}/checks-mobile.png` });
  }
  await side.getByRole("button", { name: "Close side panel", exact: true }).click();
  await expect(draft).toHaveValue("Keep my draft while checking CI");
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
