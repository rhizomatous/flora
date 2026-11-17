import { test, expect } from "./fixtures.ts";

test("plus menu opens a full-width diff tab and preserves both views", async ({ page }) => {
  await page.route("**/api/chats/pagination/changes", (route) =>
    route.fulfill({
      json: {
        snapshot: {
          id: "review-1",
          capturedAt: "2026-01-01T00:00:00Z",
          base: "a".repeat(40),
          files: [
            {
              path: "notes.ts",
              status: "M",
              binary: false,
              undisplayable: false,
              truncated: false,
              bytes: 80,
              additions: 1,
              deletions: 1,
              diff: "@@ -2 +2 @@\n-const limit = 10;\n+const limit = 20;\n",
            },
            {
              path: "logo.png",
              status: "A",
              binary: true,
              undisplayable: false,
              truncated: false,
              bytes: 0,
              diff: "",
            },
            {
              path: "large.ts",
              status: "M",
              binary: false,
              undisplayable: false,
              truncated: true,
              bytes: 2_000_000,
              diff: "",
            },
          ],
        },
        stale: true,
        error: "",
        pulls: { items: [], error: "", checkedAt: "" },
      },
    }),
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5199"}/#chats/pagination`);
  await page.getByRole("button", { name: "Hide controls", exact: true }).click();
  const originalTitle = page.getByRole("button", {
    name: "Fix duplicate notes between pages",
    exact: true,
  });
  const originalBounds = await originalTitle.boundingBox();
  const originalFont = await originalTitle.evaluate(
    (element) => getComputedStyle(element).fontSize,
  );
  await page.getByLabel("Follow-up", { exact: true }).fill("Keep this draft");
  await page.getByRole("button", { name: "Chat views", exact: true }).click();
  await page.getByRole("menuitem", { name: "Diffs", exact: true }).click();
  const review = page.getByRole("region", { name: "Workspace changes", exact: true });
  const diffTab = page.getByRole("tab", { name: "Diffs", exact: true });
  const chatTab = page.getByRole("tab", { name: "Fix duplicate notes between pages", exact: true });
  await expect(diffTab).toHaveAttribute("aria-selected", "true");
  const chatBounds = await chatTab.boundingBox();
  const diffBounds = await diffTab.boundingBox();
  expect(chatBounds?.height).toBe(originalBounds?.height);
  expect(chatBounds?.width).toBe(originalBounds?.width);
  expect(diffBounds?.height).toBe(originalBounds?.height);
  expect(diffBounds?.width).toBeLessThan(100);
  expect(await chatTab.evaluate((element) => getComputedStyle(element).fontSize)).toBe(
    originalFont,
  );
  expect(await diffTab.evaluate((element) => getComputedStyle(element).fontSize)).toBe(
    originalFont,
  );
  await chatTab.hover();
  await expect(page.getByLabel("Chat summary", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  const closeDiffs = page.getByRole("button", { name: "Close Diffs", exact: true });
  await review.getByLabel("Change summary").hover();
  await expect(closeDiffs).toHaveCSS("opacity", "0");
  await diffTab.hover();
  await expect(closeDiffs).toHaveCSS("opacity", "1");
  const revealedBackground = await closeDiffs.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  await closeDiffs.hover();
  await expect
    .poll(() => closeDiffs.evaluate((element) => getComputedStyle(element).backgroundColor))
    .not.toBe(revealedBackground);
  const hoveredBounds = await diffTab.boundingBox();
  expect(hoveredBounds?.width).toBe(diffBounds?.width);
  await review.getByLabel("Change summary").hover();
  await diffTab.focus();
  await expect(closeDiffs).toHaveCSS("opacity", "1");
  await diffTab.press("Tab");
  await expect(closeDiffs).toBeFocused();
  await expect(chatTab).toHaveAttribute("data-variant", "ghost");
  const desktopBounds = await review.boundingBox();
  expect(desktopBounds?.width).toBeGreaterThan(900);
  await expect(review.getByText("const limit = 20;", { exact: true })).toBeVisible();
  await expect(review.locator('[data-inline-change="add"]')).toHaveText(["20"]);
  await expect(review.locator('[data-inline-change="remove"]')).toHaveText(["10"]);
  await expect(
    review.getByText("Saved changes may be out of date.", { exact: true }),
  ).toBeVisible();
  await expect(review.getByRole("button", { name: "Diff details", exact: true })).toHaveCount(0);
  await expect(review.getByRole("list", { name: "Linked pull requests" })).toHaveCount(0);
  await expect(review.getByText(/logo.png.*Binary/)).toBeVisible();
  await expect(review.getByRole("link", { name: "Download full diff" })).toHaveAttribute(
    "href",
    /snapshot=review-1/,
  );
  await review.getByRole("button", { name: "Collapse all", exact: true }).click();
  await expect(review.getByText("const limit = 20;", { exact: true })).not.toBeVisible();
  await expect(review.getByRole("button", { name: "Expand all", exact: true })).toBeVisible();
  await expect(review.getByRole("button", { name: "Collapse all", exact: true })).toHaveCount(0);
  await review.getByRole("button", { name: "Expand all", exact: true }).click();
  await expect(review.getByText("const limit = 20;", { exact: true })).toBeVisible();
  await review.getByRole("button", { name: "Collapse all", exact: true }).click();
  await review.getByRole("button", { name: "Files", exact: true }).click();
  await page.getByRole("combobox", { name: "Search changed files" }).fill("no-such-file");
  await expect(page.getByText("No matching files.", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Search changed files" }).fill("notes");
  await page.getByRole("combobox", { name: "Search changed files" }).press("Enter");
  await expect(review.locator("summary").first()).toBeFocused();
  await expect(review.getByRole("button", { name: "Collapse all", exact: true })).toBeVisible();
  await expect(review.getByText("const limit = 20;", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Conversation", exact: true })).not.toBeVisible();
  await chatTab.click();
  await expect(page.getByRole("region", { name: "Conversation", exact: true })).toBeVisible();
  await expect(page.getByLabel("Follow-up", { exact: true })).toHaveValue("Keep this draft");
  await chatTab.press("ArrowRight");
  await expect(diffTab).toBeFocused();
  await diffTab.press("Enter");
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Chat summary", { exact: true })).toBeHidden();
  await expect(review.getByText("const limit = 20;", { exact: true })).toBeVisible();
  await expect(review.getByRole("link", { name: "Download full diff" })).not.toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(review).toBeVisible();
  const reviewBounds = await review.boundingBox();
  expect(reviewBounds?.width).toBeGreaterThan(340);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await chatTab.click();
  await expect(chatTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Follow-up", { exact: true })).toHaveValue("Keep this draft");
  await diffTab.hover();
  await page.getByRole("button", { name: "Close Diffs", exact: true }).click();
  await expect(diffTab).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Chat views", exact: true })).toBeFocused();
  await expect(page.getByLabel("Follow-up", { exact: true })).toHaveValue("Keep this draft");
  await page.getByRole("button", { name: "Chat views", exact: true }).click();
  await page.getByRole("menuitem", { name: "Diffs", exact: true }).click();
  await expect(diffTab).toHaveAttribute("aria-selected", "true");
  await diffTab.hover();
  await page.getByRole("button", { name: "Close Diffs", exact: true }).click();
  await expect(diffTab).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Conversation", exact: true })).toBeVisible();
  await expect(page.getByLabel("Follow-up", { exact: true })).toHaveValue("Keep this draft");
});

test("live mock shows multiple languages, inline edits, and separated hunks", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5199"}/#chats/pagination`);
  await page.getByRole("button", { name: "Hide controls", exact: true }).click();
  await page.getByRole("button", { name: "Chat views", exact: true }).click();
  await page.getByRole("menuitem", { name: "Diffs", exact: true }).click();
  const review = page.getByRole("region", { name: "Workspace changes", exact: true });
  await expect(
    review.getByLabel("Change summary").getByLabel("36 additions, 17 deletions"),
  ).toBeVisible();
  await expect(review.getByRole("link")).toHaveCount(0);
  const toolbarBounds = await review.locator(".diff-toolbar").boundingBox();
  const headerBounds = await review.locator("summary").first().boundingBox();
  expect(toolbarBounds?.height).toBeLessThanOrEqual(38);
  expect(headerBounds?.height).toBeLessThanOrEqual(34);
  const topbar = page.locator(".chat-header");
  const controls = review.locator(".diff-toolbar");
  const scroll = review.locator(".diff-scroll");
  const topbarBounds = await topbar.boundingBox();
  const scrollBounds = await scroll.boundingBox();
  expect(toolbarBounds?.x).toBe(topbarBounds?.x);
  expect(toolbarBounds?.width).toBe(topbarBounds?.width);
  expect(scrollBounds?.x).toBe(toolbarBounds?.x);
  expect(scrollBounds?.width).toBe(toolbarBounds?.width);
  expect(await controls.evaluate((el) => getComputedStyle(el).paddingInline)).toBe(
    await topbar.evaluate((el) => getComputedStyle(el).paddingInline),
  );
  await scroll.evaluate((el) => {
    el.scrollTop = 500;
  });
  expect(await controls.boundingBox()).toEqual(toolbarBounds);
  await scroll.evaluate((el) => {
    el.scrollTop = 0;
  });
  await expect(review.getByText("Modified", { exact: true })).toHaveCount(0);
  const fileIcon = review.locator("summary img:visible").first();
  await expect
    .poll(() => fileIcon.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  await expect(fileIcon).toHaveAttribute("src", /\/go[^/]*\.svg/);
  const go = page.getByRole("region", { name: "Diff for internal/notes/list.go", exact: true });
  await expect(go.locator('span[style*="--shiki-light"]').first()).toBeVisible();
  await expect(go.locator('[data-inline-change="add"]').filter({ hasText: "50" })).toBeVisible();
  await expect(go.locator('[data-inline-change="remove"]').filter({ hasText: "10" })).toBeVisible();
  const css = page.getByRole("region", { name: "Diff for web/src/feed.css", exact: true });
  await expect(
    css.locator('[data-inline-change="add"]').filter({ hasText: "a3a3a3" }),
  ).toBeVisible();
  const tsx = page.getByRole("region", {
    name: "Diff for web/src/components/NotesFeed.tsx",
    exact: true,
  });
  await expect(tsx.locator('span[style*="--shiki-light"]').first()).toBeAttached();
  await expect(tsx.getByText("68 unchanged lines", { exact: true })).toBeAttached();
  await expect(
    tsx.locator('[data-inline-change="add"]').filter({ hasText: "id" }).first(),
  ).toBeAttached();
  const html = page.getByRole("region", { name: "Diff for web/index.html", exact: true });
  await expect(html.locator('span[style*="--shiki-light"]').first()).toBeAttached();
  await expect(html.getByText("58 unchanged lines", { exact: true })).toBeAttached();
  await expect(page.getByText("feed.css", { exact: true })).toBeVisible();
  await review.getByRole("button", { name: "Files", exact: true }).click();
  await expect(page.getByText("internal / notes", { exact: true })).toBeVisible();
  await expect(page.getByRole("option")).toHaveCount(6);
  const search = page.getByRole("combobox", { name: "Search changed files" });
  await search.fill("internal cursor");
  await expect(page.getByRole("option")).toHaveCount(1);
  await expect(page.getByText("web / src", { exact: true })).toHaveCount(0);
  await search.press("Enter");
  await expect(review.locator("summary").filter({ hasText: "cursor.go" })).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await review.getByRole("button", { name: "Files", exact: true }).click();
  await expect(search).toHaveValue("");
  await expect(page.getByRole("option")).toHaveCount(6);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});
