import { test, expect } from "./fixtures.ts";

const base = process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5199";

for (const width of [1440, 390]) {
  test(`new chat has no empty topbar at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${base}/#chats/new`);
    await page.getByRole("button", { name: "Hide controls", exact: true }).click();
    const main = page.locator("#main-content");
    const composer = main.getByRole("combobox", { name: "Message", exact: true });
    await expect(composer).toBeVisible();
    await expect(main.locator(":scope > header")).toHaveCount(0);
    await expect(main.locator(".chat-header")).toHaveCount(0);
    const toggle = page.locator(".sidebar-floating-toggle");
    await expect(toggle).toBeVisible();
    await toggle.click();
    if (width < 768) await page.keyboard.press("Escape");
    await expect(composer).toBeVisible();
    await composer.fill("Review the workspace");
    await expect(composer).toHaveValue("Review the workspace");
  });
}
