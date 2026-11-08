import assert from "node:assert/strict";

import { chromium, expect } from "@playwright/test";

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const base = process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5199";
  await page.request.post(`${base}/__preview/control?action=restart`);
  await page.request.post(`${base}/__preview/control?action=pause`);
  await page.goto(`${base}/#chats/working`);
  const draft = page.getByLabel("Follow-up", { exact: true });
  await expect(draft).toBeEnabled();
  await draft.fill("Keep this draft");
  await draft.press("Enter");
  await expect(draft).toHaveValue("Keep this draft");
  await draft.press("Shift+Enter");
  await expect(draft).toHaveValue("Keep this draft\n");
  await page.reload();
  await expect(draft).toHaveValue("Keep this draft\n");
  const menu = await page.getByRole("button", { name: "Menu", exact: true }).boundingBox();
  const heading = await page
    .getByRole("heading", { name: "Check the project setup", exact: true })
    .boundingBox();
  assert.ok(
    menu && heading && Math.abs(menu.y + menu.height / 2 - heading.y - heading.height / 2) < 2,
  );
  const composer = await page.locator("form").filter({ has: draft }).boundingBox();
  assert.ok(composer && composer.height < 110);
  await page.request.post(`${base}/__preview/control?action=play`);
  await expect(
    page
      .getByLabel("Current activity")
      .getByRole("button", { name: /Check workspace|Running command/ }),
  ).toBeVisible();
  await page.request.post(`${base}/__preview/control?action=pause`);
  await page.reload();
  await expect(page.getByLabel("Current activity")).toBeVisible();
  await expect(draft).toHaveValue("Keep this draft\n");
  await page.request.post(`${base}/__preview/control?action=play`);
  await expect(page.getByLabel("Current activity")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Worked for/ }).first()).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await page.goto(`${base}/#chats/completed`);
  await expect(draft).toHaveValue("");
  await page.locator('[data-slot="markdown"]').waitFor();
  const summary = page.getByRole("button", { name: /Worked for/ }).first();
  await summary.scrollIntoViewIfNeeded();
  await expect(summary).toHaveAttribute("aria-expanded", "false");
  await summary.click();
  await page.getByRole("button", { name: /Check workspace.*bash/ }).click();
  await expect(page.getByText("Checks passed", { exact: false }).first()).toBeVisible();
  await page.route("**/api/chats/completed/messages", (route) =>
    route.fulfill({ status: 500, json: { error: "Try again" } }),
  );
  await draft.fill("Retain on failure");
  await draft.press("Enter");
  await expect(page.getByRole("alert")).toContainText("Try again");
  await expect(draft).toHaveValue("Retain on failure");
  await page.unroute("**/api/chats/completed/messages");
  await page.route("**/api/chats/completed/messages", (route) => route.fulfill({ json: {} }));
  await draft.press("Enter");
  await expect(draft).toHaveValue("");
  await page.reload();
  await expect(draft).toHaveValue("");
  await page.goto(`${base}/#chats/working`);
  await expect(draft).toHaveValue("Keep this draft\n");
  await page.goto(`${base}/#chats/recovery`);
  await expect(page.getByRole("button", { name: /1 failed/ })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await page.goto(`${base}/#chats/long`);
  await page.locator('[data-slot="markdown"]').first().waitFor();
  const viewport = page.getByLabel("Conversation");
  await viewport.hover();
  await page.mouse.wheel(0, -10_000);
  await expect(page.getByRole("button", { name: "Jump to latest" })).toHaveAttribute(
    "data-active",
    "true",
  );
  const before = await draft.boundingBox();
  await page.getByRole("button", { name: "Jump to latest" }).click();
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  assert.deepEqual(await draft.boundingBox(), before);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/#chats/waiting`);
  await expect(page.getByRole("form", { name: "Questions", exact: true })).toBeVisible();
  await expect(draft).toBeEnabled();
  const bounds = await draft.boundingBox();
  assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 844);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  assert.equal(await page.evaluate(() => document.documentElement.scrollHeight), 844);
  assert.deepEqual(errors, []);
  console.log(
    "Chat ergonomics: drafts, keyboard behavior, send failure/retry, collapsed failures, scrolling, and mobile questions passed.",
  );
} finally {
  await browser.close();
}
