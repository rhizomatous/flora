import { test, expect, publicChatID } from "./fixtures.ts";

test("selected PR overview matches the compact chat and flat checks layout", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const screenshotDir = process.env.FLORA_SCREENSHOT_DIR;
  const base = process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5199";
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto(`${base}/#chats/${await publicChatID(page, "pagination")}`);
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
  await expect(overview.getByText("No review requests", { exact: true })).toBeVisible();
  await expect(overview.getByText("No labels", { exact: true })).toBeVisible();
  await expect(overview.getByText("No issues", { exact: true })).toBeVisible();
  const github = overview.getByRole("link", { name: "Open PR #19 on GitHub", exact: true });
  await expect(github).toHaveAttribute("href", "https://github.com/example/fieldnotes/pull/19");
  await expect(github).toHaveAttribute("target", "_blank");
  await expect(overview.getByRole("button", { name: "PR actions" })).toHaveCount(0);
  const tabBox = await side.getByRole("tab", { name: "PR #19", exact: true }).boundingBox();
  const githubBox = await github.boundingBox();
  expect(githubBox?.height).toBe(tabBox?.height);
  const centers = await overview.locator("header").evaluate((header) => {
    const author = header.querySelector('a[href="https://github.com/octocat"]');
    const elements = [
      author?.querySelector('[data-slot="avatar"]'),
      author?.querySelector("span.truncate"),
      header.querySelector("a[title]"),
      header.querySelector("time"),
    ];
    return elements.map((element) => {
      const box = element?.getBoundingClientRect();
      return box === undefined ? Number.NaN : box.y + box.height / 2;
    });
  });
  expect(centers.every((center) => Number.isFinite(center))).toBe(true);
  expect(Math.max(...centers) - Math.min(...centers)).toBeLessThan(1);
  const avatar = overview.locator('header [data-slot="avatar"]');
  await expect(avatar).toHaveAttribute("data-shape", "squircle");
  await expect(avatar).toHaveCSS("width", "20px");

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
  await page.goto(`${base}/#chats/${await publicChatID(page, "pagination")}`);
  await page.getByRole("button", { name: "Hide controls", exact: true }).click();
  const inline = page.locator(
    '[data-inline-pr][href="https://github.com/example/fieldnotes/pull/19"]',
  );
  const row = page.locator(
    `.florets-navigation-link[href='#chats/${await publicChatID(page, "pagination")}']`,
  );
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
  await page.goto(`${base}/#chats/${await publicChatID(page, "pagination")}`);
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
  await expect(page).toHaveURL(`${base}/#chats/${await publicChatID(page, "pagination")}`);
  const side = page.getByRole("complementary", { name: "Side panel" });
  await expect(side.getByRole("tab", { name: "PR #19", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(side.getByRole("heading", { name: "Stabilize notes pagination" })).toBeVisible();
});

test("PR descriptions render Markdown headings, lists, links, code, and tables", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const base = process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5199";
  const markdown = [
    "## Summary",
    "Keep **notes** stable using `cursor`.",
    "",
    "- Preserve existing cursors",
    "- [Read the documentation](https://example.com/docs)",
    "",
    "```go",
    "func nextCursor(id string) string { return id }",
    "```",
    "",
    "| Check | Result |",
    "| --- | --- |",
    "| Pagination | Passed |",
  ].join("\n");
  await page.route("**/api/notifications*", async (route) => {
    const response = await route.fetch();
    const text = await response.text();
    const body = text.replaceAll(
      /"body":"(?:[^"\\]|\\.)*"/g,
      () => `"body":${JSON.stringify(markdown)}`,
    );
    await route.fulfill({ response, body });
  });
  await page.goto(`${base}/#chats/${await publicChatID(page, "pagination")}`);
  await page.getByRole("button", { name: "Hide controls", exact: true }).click();
  await page.locator('[data-inline-pr="open"]').click();
  const description = page.locator(
    '[data-pull-overview="https://github.com/example/fieldnotes/pull/19"] [data-pull-description]',
  );
  await expect(description.getByRole("heading", { name: "Summary", exact: true })).toBeVisible();
  await expect(description.locator('[data-streamdown="strong"]')).toHaveText("notes");
  await expect(description.locator("code").first()).toHaveText("cursor");
  await expect(description.getByRole("listitem")).toHaveCount(2);
  await description.getByRole("button", { name: "Read the documentation" }).click();
  const linkPrompt = page.locator('[data-streamdown="link-safety-modal"]');
  await expect(linkPrompt).toContainText("https://example.com/docs");
  await page.context().route("https://example.com/docs", async (route) => {
    await route.fulfill({ contentType: "text/html", body: "Documentation" });
  });
  const popupPromise = page.waitForEvent("popup");
  await linkPrompt.getByRole("button", { name: "Open link", exact: true }).click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL("https://example.com/docs");
  await popup.close();
  await expect(description.getByRole("table")).toContainText("Pagination");
  await expect(description.locator('[data-slot="code-block"]')).toContainText("func nextCursor");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await description.scrollIntoViewIfNeeded();
  const screenshotDir = process.env.FLORA_SCREENSHOT_DIR;
  if (screenshotDir !== undefined) {
    await page.screenshot({ path: `${screenshotDir}/checks-markdown.png` });
  }
});

test("author metadata stays aligned when the avatar replaces its fallback", async ({ page }) => {
  const { promise: avatarReady, resolve: releaseAvatar } = Promise.withResolvers<null>();
  await page.route("https://avatars.githubusercontent.com/**", async (route) => {
    await avatarReady;
    await route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="12" fill="#ddd"/></svg>',
    });
  });
  try {
    const base = process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5199";
    await page.goto(`${base}/#chats/${await publicChatID(page, "pagination")}`);
    await page.getByRole("button", { name: "Hide controls", exact: true }).click();
    await page.locator('[data-inline-pr="open"]').click();
    const header = page.locator(
      '[data-pull-overview="https://github.com/example/fieldnotes/pull/19"] header',
    );
    await page.evaluate(() => document.fonts.ready);
    await expect(header.locator('[data-slot="avatar-fallback"]')).toBeVisible();
    const avatarRadius = await header
      .locator('[data-slot="avatar"]')
      .evaluate((element) => getComputedStyle(element).borderTopLeftRadius);
    await expect(header.locator('[data-slot="avatar-fallback"]')).toHaveCSS(
      "border-top-left-radius",
      avatarRadius,
    );
    releaseAvatar(null);
    await expect(header.locator('[data-slot="avatar-image"]')).toBeVisible();
    await expect(header.locator('[data-slot="avatar-image"]')).toHaveCSS(
      "border-top-left-radius",
      avatarRadius,
    );
    const centers = await header.evaluate((element) => {
      const author = element.querySelector('a[href="https://github.com/octocat"]');
      const items = [
        author,
        author?.querySelector('[data-slot="avatar-image"]'),
        author?.querySelector("span.truncate"),
        element.querySelector("a[title]"),
        element.querySelector("time"),
      ];
      return items.map((item) => {
        const box = item?.getBoundingClientRect();
        return box === undefined ? Number.NaN : box.y + box.height / 2;
      });
    });
    expect(centers.every((center) => Number.isFinite(center))).toBe(true);
    expect(Math.max(...centers) - Math.min(...centers)).toBeLessThan(1);
  } finally {
    releaseAvatar(null);
  }
});
