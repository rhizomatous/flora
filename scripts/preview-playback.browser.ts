import assert from "node:assert/strict";

import { chromium, expect } from "@playwright/test";

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const base = process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5202";
  await page.goto(`${base}/#chats/recovery`);
  await page.getByRole("button", { name: "Replay chat", exact: true }).click();
  await expect(page).toHaveURL(`${base}/#chats/recovery`);
  await expect(
    page.getByRole("heading", { name: "Fix the workspace checks", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Current activity")).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.waitForTimeout(900);
  await expect(page.getByLabel("Current activity")).toBeVisible();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(
    page
      .locator('[data-slot="work-summary"]')
      .getByRole("button", { name: /Worked for.*2 steps.*1 failed/ }),
  ).toBeVisible();
  assert.equal(new URL(page.url()).hash, "#chats/recovery");
  await page.goto(`${base}/#chats/waiting`);
  await page.getByRole("button", { name: "Replay chat", exact: true }).click();
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
