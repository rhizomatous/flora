import assert from "node:assert/strict";

import { expect, type Page } from "@playwright/test";

/** Reads an environment variable that the Go browser test sets before launching the script. */
export function requiredEnv(name: string) {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} must be set`);
  return value;
}

/** HTTPS origin of the Go test server. */
export const origin = requiredEnv("FLORA_BROWSER_URL");

/** Collects uncaught page errors so a script can assert that none occurred. */
export function pageErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });
  return errors;
}

/** Opens Flora and logs in with the fixture password, submitting with the button or Enter. */
export async function logIn(page: Page, submit: "button" | "enter" = "button") {
  await page.goto(origin);
  const password = page.getByLabel("Password", { exact: true });
  await password.fill("browser test password");
  await (submit === "enter"
    ? password.press("Enter")
    : page.getByRole("button", { name: "Log in", exact: true }).click());
}

/** Resizes to a phone viewport and checks that the page does not scroll horizontally. */
export async function assertFitsPhone(page: Page) {
  await page.setViewportSize({ width: 375, height: 812 });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
  );
}

/** Opens installation actions without toggling an already-open menu closed. */
export async function openWorkspaceMenu(page: Page) {
  const trigger = page.getByRole("button", { name: "Workspace menu", exact: true });
  const menu = page.getByRole("menu", { name: "Workspace menu", exact: true });
  if ((await trigger.getAttribute("aria-expanded")) !== "true") {
    // Wait for the exiting menu to release focus before opening it again.
    await expect(menu).toHaveCount(0);
    await trigger.click();
  }
  await expect(menu).toHaveAttribute("data-state", "open");
}

/** Opens settings through the workspace menu. */
export async function openSettings(page: Page) {
  await openWorkspaceMenu(page);
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
}
