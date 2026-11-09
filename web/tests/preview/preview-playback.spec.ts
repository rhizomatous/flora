import assert from "node:assert/strict";

import { test, expect } from "./fixtures.ts";

test("preview navigation and pauseable chat replay", async ({ page }) => {
  const base = process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5199";
  for (const [id, name] of [
    ["preview", "Flora"],
    ["garden", "Garden storefront"],
    ["fieldnotes", "Fieldnotes API"],
  ] as const) {
    await page.goto(`${base}/#projects`);
    await page.locator("#main-content").getByRole("link", { name, exact: true }).click();
    await expect(page).toHaveURL(`${base}/#projects/${id}`);
    await expect(page.getByRole("textbox", { name: "Project name", exact: true })).toHaveValue(
      name,
    );
    await expect(
      page.getByRole("textbox", { name: "Setup command (optional)", exact: true }),
    ).not.toBeEmpty();
    await expect(page.getByRole("alert")).toHaveCount(0);
  }
  for (const [id, title, pull] of [
    ["checkout", "Keep the cart after signing in", "draft PR #42"],
    ["pagination", "Fix duplicate notes between pages", "PR #18"],
    ["focus", "Restore focus after removing a repository", "PR #73"],
  ] as const) {
    await page.goto(`${base}/#chats/${id}`);
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: pull, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Replay chat", exact: true })).toBeEnabled();
  }
  await page.goto(`${base}/#chats/recovery`);
  await Promise.all([
    page.waitForEvent("load"),
    page.getByRole("button", { name: "Replay chat", exact: true }).click(),
  ]);
  await expect(page).toHaveURL(`${base}/#chats/recovery`);
  await expect(
    page.getByRole("heading", { name: "Fix the workspace checks", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Current activity")).toBeVisible();
  await expect(page.getByLabel("Current activity")).toContainText("pending");
  await expect(page.locator('[data-slot="work-summary"]')).not.toContainText("1 failed");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.waitForTimeout(900);
  await expect(page.getByLabel("Current activity")).toBeVisible();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByLabel("Current activity")).toContainText("Check workspace", {
    timeout: 10_000,
  });
  await expect(page.getByLabel("Current activity")).toContainText("running");
  await expect(page.getByLabel("Current activity")).not.toContainText(/\d+m/);
  await expect(
    page
      .locator('[data-slot="work-summary"]')
      .getByRole("button", { name: /Worked for.*2 steps.*1 failed/ }),
  ).toBeVisible({ timeout: 15_000 });
  assert.equal(new URL(page.url()).hash, "#chats/recovery");
  await page.goto(`${base}/#chats/waiting`);
  await Promise.all([
    page.waitForEvent("load"),
    page.getByRole("button", { name: "Replay chat", exact: true }).click(),
  ]);
  await expect(page.getByRole("form", { name: "Questions", exact: true })).toBeVisible();
  assert.equal(new URL(page.url()).hash, "#chats/waiting");
  await page.goto(`${base}/#chats/new`);
  await expect(page.getByRole("button", { name: "Replay chat", exact: true })).toBeDisabled();
});
