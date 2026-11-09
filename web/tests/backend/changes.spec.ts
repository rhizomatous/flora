import assert from "node:assert/strict";

import { test, expect } from "@playwright/test";

import { assertFitsPhone, logIn, origin, pageErrors, requiredEnv } from "../helpers.ts";

test("chat omits saved review data and requests", async ({ page }) => {
  const errors = pageErrors(page);
  const reviewRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/chats\/[^/]+\/(changes|pulls)/.test(request.url())) reviewRequests.push(request.url());
  });
  await logIn(page);
  await page.goto(`${origin}/#chats/${requiredEnv("FLORA_BROWSER_CHAT")}`);
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
