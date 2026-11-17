import { expect, test } from "./fixtures.ts";

test("linked PR review keeps independent revisions, downloads, drafts and mobile navigation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  let failed = false;
  let revision = "a";
  const calls: string[] = [];
  await page.route("**/api/chats/*/pull-comparison?*", async (route) => {
    const url = new URL(route.request().url());
    const number = url.searchParams.get("number") ?? "";
    calls.push(`${route.request().method()} ${number}`);
    if (failed) {
      await route.fulfill({ status: 503, json: { error: "GitHub unavailable" } });
      return;
    }
    await route.fulfill({
      json: {
        snapshot: {
          id: `pr-${number}-${revision}`,
          capturedAt: "2026-11-16T15:30:00Z",
          base: "b".repeat(40),
          url: `https://github.com/example/fieldnotes/pull/${number}`,
          title: `Comparison for PR ${number}`,
          baseRevision: { repository: "example/fieldnotes", ref: "main", sha: "b".repeat(40) },
          headRevision: {
            repository: "contributor/fieldnotes",
            ref: `fix-${number}`,
            sha: revision.repeat(40),
          },
          files: [
            {
              path: "src/pagination.ts",
              status: "M",
              binary: false,
              undisplayable: false,
              diff: `diff --git a/src/pagination.ts b/src/pagination.ts\n--- a/src/pagination.ts\n+++ b/src/pagination.ts\n@@ -1 +1 @@\n-old\n+PR ${number}\n`,
              bytes: 150,
              additions: 1,
              deletions: 1,
              truncated: false,
            },
            {
              path: "data/large.json",
              status: "A",
              binary: false,
              undisplayable: false,
              diff: "",
              bytes: 2_000_000,
              additions: 10_000,
              deletions: 0,
              truncated: true,
            },
            {
              path: "assets/preview.png",
              status: "A",
              binary: true,
              undisplayable: false,
              diff: "",
              bytes: 90,
              additions: 0,
              deletions: 0,
              truncated: false,
            },
          ],
        },
        error: "",
        stale: false,
      },
    });
  });
  const base = process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5199";
  await page.goto(`${base}/#chats/pagination`);
  await page.getByRole("button", { name: "Hide controls", exact: true }).click();
  const draft = page.getByLabel("Follow-up", { exact: true });
  await draft.fill("Keep my review notes");
  const transcript = page.getByRole("region", { name: "Conversation", exact: true });
  await transcript
    .getByRole("link", { name: "example/fieldnotes #19 Open", exact: true })
    .press("Enter");
  const side = page.getByRole("complementary", { name: "Side panel" });
  const review = side.getByRole("region", { name: "Pull request comparison", exact: true });
  await expect(review.getByText("Comparison for PR 19")).toBeVisible();
  await expect(side.getByRole("tab", { name: "#19", exact: true })).toBeFocused();
  await expect(review.getByText("contributor/fieldnotes:fix-19")).toBeVisible();
  await expect(review.getByText("Binary file. No inline preview.")).toBeVisible();
  await expect(review.getByRole("link", { name: "Download full diff" })).toHaveAttribute(
    "href",
    /number=19&snapshot=pr-19-a/,
  );
  await expect(draft).toHaveValue("Keep my review notes");
  const handle = page.getByRole("separator", { name: "Resize side panel" });
  await handle.focus();
  await page.keyboard.press("ArrowLeft");
  revision = "c";
  await review.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(review.getByText("cccccccccccc")).toBeVisible();
  failed = true;
  await review.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(review.getByRole("alert")).toContainText("Saved comparison retained");
  await expect(review.getByText("cccccccccccc")).toBeVisible();
  await page.screenshot({ path: "/private/tmp/flora-116-desktop.png" });
  failed = false;
  await side.getByRole("tab", { name: "Overview", exact: true }).click();
  await side.getByRole("link", { name: /example\/fieldnotes #18 Closed/ }).click();
  await expect(review.getByText("Comparison for PR 18")).toBeVisible();
  await expect(review.getByText("Comparison for PR 19")).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "Hide controls", exact: true }).click();
  await expect(review.getByText("Comparison for PR 18")).toBeVisible();
  expect(calls).toContain("POST 18");
  expect(calls).toContain("POST 19");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(review).toBeVisible();
  await expect(draft).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await review.getByRole("button", { name: "Files", exact: true }).click();
  await page.getByRole("option", { name: /preview.png/ }).click();
  await expect(page.getByRole("dialog", { name: "Changed files" })).toHaveCount(0);
  await page.screenshot({ path: "/private/tmp/flora-116-mobile.png" });
  await side.getByRole("button", { name: "Close side panel", exact: true }).click();
  await expect(draft).toBeVisible();
  await expect(draft).toHaveValue("Keep my review notes");
});

test("unavailable comparison offers retry and GitHub without showing workspace changes", async ({
  page,
}) => {
  await page.route("**/api/chats/*/pull-comparison?*", async (route) => {
    await route.fulfill({
      json: {
        snapshot: null,
        stale: true,
        error: "Pull request comparison unavailable. Check GitHub access and retry.",
      },
    });
  });
  await page.goto(`${process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5199"}/#chats/pagination`);
  await page.getByRole("button", { name: "Hide controls", exact: true }).click();
  await page.getByRole("button", { name: "Linked pull requests (2)", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("link", { name: /example\/fieldnotes #19 Open/ })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const review = page.getByRole("region", { name: "Pull request comparison", exact: true });
  await expect(review.getByRole("alert")).toContainText("unavailable");
  await expect(review.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
  await expect(
    review.getByRole("link", { name: "example/fieldnotes #19", exact: true }),
  ).toHaveAttribute("href", "https://github.com/example/fieldnotes/pull/19");
  await expect(review.locator("details")).toHaveCount(0);
});
