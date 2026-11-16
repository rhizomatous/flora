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
  await page.getByLabel("Follow-up", { exact: true }).fill("Keep this draft");
  await page.getByRole("button", { name: "Chat views", exact: true }).click();
  await page.getByRole("menuitem", { name: "Diffs", exact: true }).click();
  const review = page.getByRole("region", { name: "Chat changes", exact: true });
  const diffTab = page.getByRole("tab", { name: "Diffs", exact: true });
  const chatTab = page.getByRole("tab", { name: "Fix duplicate notes between pages", exact: true });
  await expect(diffTab).toHaveAttribute("aria-selected", "true");
  const desktopBounds = await review.boundingBox();
  expect(desktopBounds?.width).toBeGreaterThan(900);
  await expect(review.getByText("const limit = 20;", { exact: true })).toBeVisible();
  await expect(review.getByText(/Saved review, possibly out of date/)).toBeVisible();
  await expect(review.getByText(/logo.png.*Binary/)).toBeVisible();
  await expect(review.getByRole("link", { name: "Download full diff" })).toHaveAttribute(
    "href",
    /snapshot=review-1/,
  );
  await review.getByRole("button", { name: "Collapse all", exact: true }).click();
  await expect(review.getByText("const limit = 20;", { exact: true })).not.toBeVisible();
  await review.getByLabel("Jump to file").selectOption("0");
  await expect(review.getByText("const limit = 20;", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Conversation", exact: true })).not.toBeVisible();
  await chatTab.click();
  await expect(page.getByRole("region", { name: "Conversation", exact: true })).toBeVisible();
  await expect(page.getByLabel("Follow-up", { exact: true })).toHaveValue("Keep this draft");
  await chatTab.press("ArrowRight");
  await expect(diffTab).toBeFocused();
  await diffTab.press("Enter");
  await expect(review.getByText("const limit = 20;", { exact: true })).toBeVisible();
  await expect(review.getByRole("link", { name: "Download full diff" })).not.toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(review).toBeVisible();
  const reviewBounds = await review.boundingBox();
  expect(reviewBounds?.width).toBeGreaterThan(340);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await chatTab.click();
  await expect(chatTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Follow-up", { exact: true })).toHaveValue("Keep this draft");
});
