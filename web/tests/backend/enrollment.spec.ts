import assert from "node:assert/strict";

import { test, expect } from "../fixtures.ts";

import { openWorkspaceMenu, assertFitsPhone, pageErrors } from "../helpers.ts";

test.use({ scenario: "enrollment" });

test("installer setup, interrupted account creation, and logout", async ({ page, backend }) => {
  const errors = pageErrors(page);
  page.on("request", (request) => {
    assert.equal(request.url().includes("fixture-installer-setup-secret-000000000000"), false);
  });
  await page.goto(backend.url);
  await expect(page.getByRole("heading", { name: "Open your setup link" })).toBeVisible();
  const code = page.getByLabel("Enrollment code", { exact: false });
  await expect(code).toHaveCount(0);
  await page.goto(`${backend.url}/#setup/fixture-installer-setup-secret-000000000000`);
  await expect(page.getByRole("heading", { name: "Create administrator" })).toBeVisible();
  await expect(page).toHaveURL(`${backend.url}/#chats/new`);
  await assertFitsPhone(page);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Create administrator" })).toBeVisible();
  await page.getByLabel("Password", { exact: true }).fill("browser test password");
  await page.getByRole("button", { name: "Create administrator", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Connect your first project", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Start chat", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await openWorkspaceMenu(page);
  await expect(page.getByRole("menuitem", { name: "Log out", exact: true })).toBeVisible();
  const menuBounds = await page
    .getByRole("menu", { name: "Workspace menu", exact: true })
    .boundingBox();
  assert.ok(
    menuBounds &&
      menuBounds.x >= 0 &&
      menuBounds.y >= 0 &&
      menuBounds.x + menuBounds.width <= 375 &&
      menuBounds.y + menuBounds.height <= 812,
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Sidebar", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Workspace menu", exact: true })).toBeFocused();
  await expect(code).toHaveCount(0);
  await openWorkspaceMenu(page);
  await page.getByRole("menuitem", { name: "Log out", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Log in", exact: true })).toBeVisible();
  await expect(code).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Log in", exact: true })).toBeVisible();
  assert.deepEqual(errors, []);
});

test("setup links reopen in another browser until account creation", async ({ page, backend, browser }) => {
  const secret = "fixture-installer-setup-secret-000000000000";
  const link = `${backend.url}/#setup/${secret}`;
  let exchanges = 0;
  page.on("request", (request) => {
    assert.equal(request.url().includes(secret), false);
    assert.equal(request.headers().referer?.includes(secret) ?? false, false);
    if (request.url().endsWith("/api/auth/setup")) exchanges++;
  });
  await page.goto(link);
  await expect(page.getByRole("heading", { name: "Create administrator" })).toBeVisible();
  assert.equal(exchanges, 1);
  const other = await browser.newContext({ ignoreHTTPSErrors: true, colorScheme: "light" });
  try {
    const replay = await other.newPage();
    await replay.goto(link);
    await replay.evaluate(() => document.documentElement.classList.remove("dark"));
    await expect(replay.getByRole("heading", { name: "Create administrator" })).toBeVisible();
    await expect(replay.getByRole("alert")).toHaveCount(0);
    await expect(replay).toHaveURL(`${backend.url}/#chats/new`);
    await assertFitsPhone(replay);
    await expect(replay.getByLabel("Password", { exact: true })).toBeVisible();
  } finally {
    await other.close();
  }
  await page.reload();
  await expect(page.getByRole("heading", { name: "Create administrator" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Create administrator" })).toBeFocused();
  await page.getByLabel("Password", { exact: true }).fill("short");
  await page.getByRole("button", { name: "Create administrator", exact: true }).click();
  assert.equal(
    await page.getByLabel("Password", { exact: true }).evaluate((input: HTMLInputElement) => input.validity.tooShort),
    true,
  );
  await expect(page.getByRole("heading", { name: "Create administrator" })).toBeVisible();
});
