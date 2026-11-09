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

  const files = await readdir(new URL("../florets/docs/src/examples/upstream/", import.meta.url));
  for (const file of files.filter((name) => name.endsWith(".tsx"))) {
    await openExample(file.slice(0, -4));
  }

  console.log(`Florets: ${files.length} component collections rendered.`);

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
