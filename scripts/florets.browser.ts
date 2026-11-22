import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { chromium, expect, type Locator } from "@playwright/test";
import { preview } from "vite";

async function assertSearchStaysVisible(menu: Locator, search: Locator) {
  if ((await menu.getByRole("menuitem").count()) <= 20) return;
  const before = await search.boundingBox();
  await menu.getByRole("menu").evaluate((list) => {
    list.scrollTop = list.scrollHeight;
  });
  const after = await search.boundingBox();
  assert.equal(after?.y, before?.y);
}

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

  await openExample("dropdown-menu-search");
  for (const dark of [true, false]) {
    await page.evaluate(
      (enabled) => document.documentElement.classList.toggle("dark", enabled),
      dark,
    );
    for (const width of [1200, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const menuExamples = await page.locator('[data-slot="example"]').all();
      for (const example of menuExamples.slice(0, 2)) {
        const trigger = example.getByRole("button", { name: "Views", exact: true });
        await trigger.click();
        const menu = page.getByRole("dialog", { name: "Views", exact: true });
        const search = menu.getByRole("searchbox");
        await expect(search).toHaveAccessibleName(/Search/);
        await expect(search).toBeFocused();
        await expect(search).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
        await expect(search).toHaveCSS("border-top-width", "0px");
        await expect(search).toHaveCSS("border-radius", "0px");
        await expect(search).toHaveCSS("box-shadow", "none");
        await expect(search).toHaveCSS("font-size", "14px");
        await expect(menu.locator('[data-slot="dropdown-menu-search"]')).toHaveCSS(
          "border-bottom-width",
          "1px",
        );
        await expect(menu.getByRole("menuitem", { name: "Overview", exact: true })).toHaveAttribute(
          "data-highlighted",
          "",
        );
        await search.press("ArrowDown");
        await expect(
          menu.getByRole("menuitem", { name: "Browser Unavailable", exact: true }),
        ).toHaveAttribute("data-highlighted", "");
        await search.press("Enter");
        await expect(menu).toBeVisible();
        await search.press("ArrowDown");
        await expect(menu.getByRole("menuitem", { name: "Diffs", exact: true })).toHaveAttribute(
          "data-highlighted",
          "",
        );
        await expect(search).toBeFocused();
        await expect(menu.getByRole("menuitem", { name: "Diffs", exact: true })).not.toHaveCSS(
          "background-color",
          "rgba(0, 0, 0, 0)",
        );
        await assertSearchStaysVisible(menu, search);
        const selectedID = await menu
          .getByRole("menuitem", { name: "Diffs", exact: true })
          .getAttribute("id");
        await expect(search).toHaveAttribute("aria-activedescendant", selectedID ?? "");
        await search.fill("no such view");
        await expect(menu.getByRole("status")).toHaveText(/No matching (views|results)\./);
        await search.press("Enter");
        await expect(menu).toBeVisible();
        await search.fill("diffs");
        await search.press("Enter");
        await expect(menu).toHaveCount(0);
        await expect(trigger).toBeFocused();
        await trigger.click();
        await search.fill("browser");
        await expect(menu.getByRole("menuitem", { name: "Browser Unavailable" })).toBeDisabled();
        const bounds = await menu.boundingBox();
        assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width);
        await search.press("Escape");
        await expect(trigger).toBeFocused();
        await expect(menu).toHaveCount(0);
      }
      const actions = page.getByRole("button", { name: "Actions", exact: true });
      await actions.click();
      const actionsMenu = page.getByRole("dialog", { name: "Actions", exact: true });
      const actionsSearch = actionsMenu.getByRole("searchbox", { name: "Search actions" });
      await actionsSearch.fill("Show status");
      await actionsSearch.press("Enter");
      const status = actionsMenu.getByRole("menuitemcheckbox", {
        name: "Show status",
        exact: true,
      });
      await expect(status).toBeChecked();
      await expect(actionsSearch).toBeFocused();
      await actionsSearch.press("Enter");
      await expect(status).not.toBeChecked();
      await actionsSearch.fill("Comfortable");
      await actionsSearch.press("Enter");
      await expect(
        actionsMenu.getByRole("menuitemradio", { name: "Comfortable", exact: true }),
      ).toBeChecked();
      await actionsSearch.fill("More views");
      await actionsSearch.press("ArrowRight");
      const nested = page.getByRole("dialog", { name: "More views", exact: true });
      const nestedSearch = nested.getByRole("searchbox", { name: "Search more views" });
      await expect(nestedSearch).toBeFocused();
      await nestedSearch.fill("History");
      await nestedSearch.press("Escape");
      await expect(nested).toHaveCount(0);
      await expect(actionsSearch).toBeFocused();
      await actionsSearch.press("Escape");
      await expect(actionsMenu).toHaveCount(0);
      await expect(actions).toBeFocused();
    }
  }

  await openExample("settings-group");
  for (const dark of [true, false]) {
    await page.evaluate(
      (enabled) => document.documentElement.classList.toggle("dark", enabled),
      dark,
    );
    for (const width of [1200, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const example of await page.locator('[data-slot="example"]').all()) {
        const project = example.getByLabel("Project", { exact: true });
        await project.selectOption("long");
        await expect(project).toHaveAccessibleDescription("The project this review works in");
        const row = project.locator('xpath=ancestor::*[@data-slot="field"]');
        const controlBox = await project.boundingBox();
        const rowBox = await row.boundingBox();
        assert.ok(controlBox && rowBox);
        assert.ok(
          controlBox.x >= rowBox.x && controlBox.x + controlBox.width <= rowBox.x + rowBox.width,
        );
        const toggle = example.getByRole("switch");
        await toggle.focus();
        const checked = await toggle.isChecked();
        await toggle.press("Space");
        assert.notEqual(await toggle.isChecked(), checked);
        const instructions = example.getByLabel("Instructions", { exact: true });
        await expect(instructions).toHaveAccessibleDescription("What to include in each review");
        await instructions.fill("A keyboard-editable review");
        await instructions.press("Tab");
        await expect(example.getByRole("combobox", { name: "Output format" })).toBeFocused();
      }
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      );
    }
  }

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
    await expect(title).toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");
    await expect(title).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(title).toHaveCSS("font-weight", "500");
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
    await expect(textarea).toHaveCSS("border-top-color", border);
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
