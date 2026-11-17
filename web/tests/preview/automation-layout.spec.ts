import { test, expect } from "./fixtures.ts";

const base = process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5199";

for (const width of [1440, 390]) {
  for (const route of ["new", "accessibility"]) {
    test(`automation ${route} scrolls inside its canvas at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 640 });
      await page.goto(`${base}/#automations/${route}`);
      await page.getByRole("button", { name: "Hide controls", exact: true }).click();
      await expect(page.getByRole("textbox", { name: "Name", exact: true })).toBeVisible();
      const main = page.locator("#main-content");
      const header = main.locator(":scope > header");
      const viewport = main.locator(":scope > div");
      const headerBounds = await header.boundingBox();
      await expect(main).toHaveCSS("overflow", "hidden");
      if (width >= 768) await expect(main).toHaveCSS("border-top-left-radius", "14px");
      await viewport.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      expect(await viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      expect(await header.boundingBox()).toEqual(headerBounds);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(640);
      const bounds = await main.boundingBox();
      if (!bounds) throw new Error("Missing automation canvas");
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(640);
      await expect(
        page.getByRole("button", {
          name: route === "new" ? "Create automation" : "Save",
          exact: true,
        }),
      ).toBeVisible();
      if (route === "accessibility") {
        await expect(page.getByRole("heading", { name: "Run history" })).toBeInViewport();
      }
    });
  }
}
