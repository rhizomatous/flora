import assert from "node:assert/strict";

import { test, expect } from "../fixtures.ts";

import { assertFitsPhone, logIn, pageErrors } from "../helpers.ts";

test.use({ scenario: "changes" });

test("chat omits saved review data and requests", async ({ page, backend }) => {
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
  await page.reload();
  await expect(page.getByLabel("Follow-up", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Changes", exact: true })).toHaveCount(0);
  await assertFitsPhone(page);
  assert.deepEqual(reviewRequests, []);
  assert.deepEqual(errors, []);
});
