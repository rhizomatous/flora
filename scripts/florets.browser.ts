import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { chromium, expect, type Browser } from "@playwright/test";
import { preview } from "vite";

const server = await preview({
  root: fileURLToPath(new URL("../florets/docs", import.meta.url)),
  configFile: fileURLToPath(new URL("../florets/docs/vite.config.ts", import.meta.url)),
  preview: { host: "127.0.0.1", port: 0, open: false },
});
let browser: Browser | undefined;
try {
  const address = server.httpServer.address();
  if (address === null || typeof address === "string") {
    throw new Error("Preview did not bind a port.");
  }
  browser = await chromium.launch();
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });
  await page.goto(`http://127.0.0.1:${address.port}`);
  await expect(page.getByRole("heading", { name: "Component guide", exact: true })).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to components" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();

  const theme = page.getByRole("button", { name: "Light theme", exact: true });
  const background = await page
    .locator("body")
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  await theme.click();
  await expect(theme).toHaveAttribute("aria-pressed", "true");
  assert.notEqual(
    await page.locator("body").evaluate((el) => getComputedStyle(el).backgroundColor),
    background,
  );
  await theme.click();
  await expect(theme).toHaveAttribute("aria-pressed", "false");

  const navigation = page.getByRole("navigation", { name: "Components" });
  for (const name of [
    "Typography",
    "Buttons & links",
    "Form controls",
    "Feedback",
    "Identity",
    "Colors",
  ]) {
    await navigation.getByRole("link", { name, exact: true }).click();
    await expect(page.getByRole("heading", { name, exact: true })).toBeInViewport();
  }
  await page.getByRole("button", { name: "Primary", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Primary button clicked." }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Disabled", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Save preview", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Preview saved" })).toHaveCount(0);
  await page.getByRole("textbox", { name: "Project name", exact: true }).fill("Example project");
  await page.getByRole("combobox", { name: "Repository role" }).selectOption("extra");
  await page.getByRole("textbox", { name: "Notes" }).fill("Local preview only.");
  await page.getByRole("button", { name: "Save preview", exact: true }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Preview saved for Example project. No data was sent." }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Disabled", exact: true })).toBeDisabled();
  await expect(page.getByRole("textbox", { name: "Invalid", exact: true })).toHaveAttribute(
    "aria-invalid",
    "true",
  );

  for (const summary of await page.locator("summary").all()) await summary.click();
  await expect(page.locator("details[open]")).toHaveCount(8);
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      true,
    );
  }
  await page.reload();
  await expect(page.getByRole("heading", { name: "Colors", exact: true })).toBeInViewport();
  assert.deepEqual(errors, []);
  console.log(
    "Florets guide: navigation, themes, examples, forms, keyboard access, and responsive layout passed.",
  );
} finally {
  await browser?.close();
  server.httpServer.close();
}
