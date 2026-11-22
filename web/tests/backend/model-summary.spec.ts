import { test, expect } from "../fixtures.ts";
import { logIn, pageErrors } from "../helpers.ts";

test.use({ scenario: "model-summary" });

test("saved main-session identity agrees across title and sidebar after reload", async ({ page, backend }) => {
  const errors = pageErrors(page);
  await logIn(page);
  await page.goto(`/#chats/${backend.chatID}`);
  const title = page.getByRole("button", { name: "Review keyboard navigation", exact: true });
  const label = "Latest main-session model: anthropic / claude-haiku-4-5. Main session used 2 reported models";
  await title.focus();
  await expect(page.getByRole("img", { name: label, exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: label, exact: true })).toHaveText("Claude Haiku 4.5 · 2 models");
  await page.keyboard.press("Escape");
  const link = page.getByRole("link", { name: /Review keyboard navigation/ });
  await link.focus();
  await expect(page.locator(".sidebar-chat-preview").getByRole("img", { name: label, exact: true })).toBeVisible();
  await expect(page.locator(".sidebar-chat-preview")).toContainText("Check keyboard focus");
  await page.reload();
  await title.focus();
  await expect(page.getByRole("img", { name: label, exact: true })).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  await expect.poll(async () => await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByRole("img", { name: label, exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.goto(`/#chats/${backend.otherChatID}`);
  await page.getByRole("button", { name: "Plan the next task", exact: true }).focus();
  await expect(page.getByRole("img", { name: "No completed main-session model calls", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("long identities and unknown metadata fit summary cards in both themes", async ({ page }, testInfo) => {
  await logIn(page);
  await page.getByRole("link", { name: /Inspect a custom model/ }).click();
  const title = page.getByRole("button", { name: "Inspect a custom model", exact: true });
  for (const dark of [true, false]) {
    await page.evaluate((enabled) => { document.documentElement.classList.toggle("dark", enabled); }, dark);
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 812 });
      await title.focus();
      const summary = page.getByLabel("Chat summary", { exact: true });
      await expect(summary).toBeVisible();
      await expect(summary.getByRole("img", { name: /custom-provider \/ custom-model-with-a-long/ })).toBeVisible();
      await expect.poll(async () => {
        const bounds = await summary.boundingBox();
        return bounds !== null && bounds.x >= 0 && bounds.x + bounds.width <= width;
      }).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`summary-${dark ? "dark" : "light"}-${width}.png`), animations: "disabled" });
      await page.keyboard.press("Escape");
      await title.blur();
      await expect(summary).toHaveCount(0);
    }
  }
  await page.setViewportSize({ width: 1280, height: 812 });
  await page.getByRole("link", { name: /Check an older response/ }).click();
  await page.getByRole("button", { name: "Check an older response", exact: true }).focus();
  await expect(page.getByLabel("Chat summary", { exact: true }).getByRole("img", { name: "Latest main-session model: Model not reported", exact: true })).toBeVisible();
  await expect(page.getByText("No linked pull requests yet.", { exact: true })).toHaveCount(0);
});
