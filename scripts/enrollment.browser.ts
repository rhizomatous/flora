import assert from "node:assert/strict";

import { chromium, expect } from "@playwright/test";

import { openWorkspaceMenu, assertFitsPhone, origin, pageErrors } from "./browser.ts";

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ ignoreHTTPSErrors: true });
  const errors = pageErrors(page);
  page.on("request", (request) => {
    assert.equal(request.url().includes("fixture-installer-enrollment-code"), false);
  });
  await page.goto(origin);
  await expect(page.getByRole("heading", { name: "Create administrator" })).toBeVisible();
  await assertFitsPhone(page);
  await page.getByLabel("Password", { exact: true }).fill("browser test password");
  const code = page.getByLabel("Enrollment code", { exact: false });
  await code.fill("wrong");
  await page.getByRole("button", { name: "Create administrator", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Enrollment code is incorrect.");
  await code.fill("fixture-installer-enrollment-code");
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
  await expect(code).toHaveCount(0);
  await openWorkspaceMenu(page);
  await page.getByRole("menuitem", { name: "Log out", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Log in", exact: true })).toBeVisible();
  await expect(code).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Log in", exact: true })).toBeVisible();
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
