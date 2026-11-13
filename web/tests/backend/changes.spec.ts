import assert from "node:assert/strict";

import { test, expect } from "../fixtures.ts";

import { assertFitsPhone, logIn, pageErrors } from "../helpers.ts";

test.use({ scenario: "changes" });

test("chat shows saved PRs without requesting full diffs", async ({ page, backend }) => {
  const errors = pageErrors(page);
  const reviewRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/chats\/[^/]+\/(changes|pulls)/.test(request.url())) reviewRequests.push(request.url());
  });
  await logIn(page);
  await page.goto(`${backend.url}/#chats/${backend.chatID}`);
  await expect(page.getByLabel("Follow-up", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Changes", exact: true })).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Pull requests" })).toHaveCount(0);
  await page.getByRole("button", { name: "Linked pull requests (5)", exact: true }).click();
  const pulls = page.getByRole("list", { name: "Linked pull requests" });
  await expect(pulls.getByRole("link")).toHaveCount(5);
  await expect(pulls.getByRole("link", { name: "first/app #7 Draft", exact: true })).toHaveAttribute("href", "https://github.com/first/app/pull/7");
  await expect(pulls.getByRole("link", { name: "second/app #7 Merged", exact: true })).toHaveAttribute("href", "https://github.com/second/app/pull/7");
  await expect(pulls.getByRole("link", { name: "third/private #10 Unknown", exact: true })).toBeVisible();
  await expect(page.getByText("Pull request verification unavailable. Saved statuses may be out of date.", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.getByLabel("Follow-up", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Changes", exact: true })).toHaveCount(0);
  await assertFitsPhone(page);
  assert.deepEqual(reviewRequests, []);
  assert.deepEqual(errors, []);
});
