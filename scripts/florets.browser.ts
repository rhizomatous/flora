import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { chromium, expect } from "@playwright/test";
import { preview } from "vite";

const server = await preview({
  root: fileURLToPath(new URL("../florets/docs", import.meta.url)),
  configFile: fileURLToPath(new URL("../florets/docs/vite.config.ts", import.meta.url)),
  preview: { host: "127.0.0.1", port: 0, open: false },
});
const browser = await chromium.launch();
try {
  const base = server.resolvedUrls?.local[0];
  assert.ok(base !== undefined && base !== "");
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const openExample = async (name: string) => {
    await page.goto(`${base}example.html?component=${name}`, { waitUntil: "domcontentloaded" });
    await expect(
      page.locator(name.startsWith("sidebar") ? "main" : '[data-slot="example"]').first(),
      name,
    ).toBeVisible({ timeout: 15_000 });
    assert.deepEqual(errors, [], name);
  };

  await page.goto(`${base}#theming`, { waitUntil: "domcontentloaded" });
  for (const dark of [true, false]) {
    await page.evaluate(
      (enabled) => document.documentElement.classList.toggle("dark", enabled),
      dark,
    );
    const standalone = page.getByRole("textbox", { name: "Standalone input", exact: true });
    const nested = page.locator("#surface-panel-name");
    const panel = nested.locator('xpath=ancestor::*[@data-slot="card"]');
    await expect(nested).toBeVisible();
    const panelColor = await panel.evaluate((element) => getComputedStyle(element).backgroundColor);
    assert.notEqual(panelColor, "rgba(0, 0, 0, 0)");
    await expect(standalone).toHaveCSS("background-color", panelColor);
    await expect(nested).toHaveCSS("background-color", panelColor);
    const borderColor = await standalone.evaluate(
      (element) => getComputedStyle(element).borderTopColor,
    );
    await expect(nested).toHaveCSS("border-top-color", borderColor);
    await expect(panel).toHaveCSS("border-top-color", borderColor);
    await expect(panel).toHaveCSS("border-top-width", "1px");
    await expect(panel).toHaveCSS("box-shadow", "none");
    await expect(panel).toHaveCSS("background-clip", "border-box");
    await expect(standalone).toHaveCSS("background-clip", "border-box");
    await expect(panel).toHaveCSS("padding-top", "0px");
    await expect(panel).toHaveCSS("row-gap", "0px");
    if (dark) assert.equal(panelColor, "rgb(25, 25, 25)");
    await page.getByRole("button", { name: "Open overlay", exact: true }).click();
    const overlay = page.locator('[data-slot="popover-content"]');
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveCSS("border-top-color", borderColor);
    if (dark) await expect(overlay).toHaveCSS("background-color", "rgb(32, 32, 32)");
    await page.keyboard.press("Escape");
  }

  for (const theme of ["dark", "light"]) {
    await page.goto(`${base}example.html?component=editable-text&theme=${theme}`, {
      waitUntil: "domcontentloaded",
    });
    const title = page.getByRole("textbox", { name: "Title", exact: true });
    await expect(title).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await title.focus();
    await expect(title).not.toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");
    await title.fill("A new title");
    await title.press("Tab");
    const description = page.getByRole("textbox", { name: "Description", exact: true });
    await expect(description).toBeFocused();
    await description.fill("First line\nSecond line");
    await expect(description).toHaveValue("First line\nSecond line");
    await expect(page.getByRole("textbox", { name: "Disabled title", exact: true })).toBeDisabled();
    await page.goto(`${base}example.html?component=textarea&theme=${theme}`, {
      waitUntil: "domcontentloaded",
    });
    const textarea = page.getByRole("region", { name: "Basic", exact: true }).getByRole("textbox");
    await textarea.waitFor({ state: "visible" });
    const border = await textarea.evaluate((element) => getComputedStyle(element).borderTopColor);
    await textarea.focus();
    await expect(textarea).not.toHaveCSS("border-top-color", border);
    await expect(textarea).toHaveCSS("box-shadow", "none");
    await expect(textarea).toHaveCSS("padding-top", "16px");
    await page.goto(`${base}example.html?component=input-group&theme=${theme}`, {
      waitUntil: "domcontentloaded",
    });
    const group = page
      .locator('[data-slot="input-group"]')
      .filter({ has: page.locator("textarea") })
      .first();
    await group.locator("textarea").focus();
    await expect(group).toHaveCSS("box-shadow", "none");
  }

  const files = await readdir(new URL("../florets/docs/src/examples/upstream/", import.meta.url));
  for (const file of files.filter((name) => name.endsWith(".tsx"))) {
    await openExample(file.slice(0, -4));
  }

  console.log(`Florets: ${files.length} component collections rendered.`);

  await openExample("button");
  const panelToggle = page.getByRole("button", { name: "Expanded panel", exact: true });
  await expect(panelToggle).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(panelToggle).toHaveCSS("height", "28px");
    await expect(panelToggle.locator("svg")).toHaveCSS("width", "14px");
  }
  await panelToggle.focus();
  await expect(panelToggle).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");

  await openExample("dropdown-menu");
  const menuTrigger = page
    .getByRole("region", { name: "Basic", exact: true })
    .getByRole("button", { name: "Open", exact: true });
  await menuTrigger.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Profile", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Billing", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menuTrigger).toBeFocused();
  await expect(page.getByRole("menu")).toHaveCount(0);

  await openExample("dialog");
  const dialogTrigger = page.getByRole("button", { name: "Edit Profile", exact: true });
  await dialogTrigger.click();
  const dialog = page.getByRole("dialog", { name: "Edit profile", exact: true });
  await expect(dialog.getByRole("textbox", { name: "Name", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(dialogTrigger).toBeFocused();

  await openExample("select");
  const select = page.getByRole("region", { name: "Basic", exact: true }).getByRole("combobox");
  await select.click();
  await page.getByRole("option", { name: "Banana", exact: true }).click();
  await expect(select.locator('[data-slot="select-value"]')).toHaveText("Banana");
  await expect(select).toBeFocused();

  await openExample("checkbox");
  const checkbox = page.getByRole("region", { name: "Basic", exact: true }).getByRole("checkbox");
  await checkbox.press("Space");
  await expect(checkbox).toBeChecked();
  await checkbox.press("Space");
  await expect(checkbox).not.toBeChecked();

  await openExample("tabs");
  const tabs = page.getByRole("region", { name: "Basic", exact: true });
  await tabs.getByRole("tab", { name: "Home", exact: true }).press("ArrowRight");
  await expect(tabs.getByRole("tab", { name: "Settings", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(tabs.getByRole("tab", { name: "Settings", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  await openExample("sheet");
  await page.setViewportSize({ width: 390, height: 844 });
  const sheetTrigger = page
    .getByRole("region", { name: "With Form", exact: true })
    .getByRole("button", { name: "Open", exact: true });
  await sheetTrigger.click();
  await expect(page.getByRole("dialog", { name: "Edit profile", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheetTrigger).toBeFocused();

  await openExample("drawer");
  await page.getByRole("button", { name: "Header and Footer", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Edit profile", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  assert.deepEqual(errors, []);
  console.log(
    "Florets: all component collections render; menu, dialog, select, checkbox, tabs, sheet, and drawer interactions passed.",
  );
} finally {
  await browser.close();
  await server.close();
}
