import assert from "node:assert/strict";

import { chromium, expect } from "@playwright/test";

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const base = process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5202";
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
  console.log(
    "Preview playback: recovery replays in place, pause/resume target the current chat, and waiting stays on its question.",
  );
} finally {
  await browser.close();
}
