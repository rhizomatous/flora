import { test, expect } from "./fixtures.ts";

test("shared PR checks, previous revisions, keyboard access, and draft preservation", async ({
  page,
}) => {
  const screenshotDir = process.env.FLORA_SCREENSHOT_DIR;
  const base = process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5199";
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto(`${base}/#chats/pagination`);
  await page.getByRole("button", { name: "Hide controls", exact: true }).click();
  const draft = page.getByLabel("Follow-up", { exact: true });
  await draft.fill("Keep my draft while checking CI");
  const trigger = page.getByRole("button", { name: "Linked pull requests (2)", exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("1 failed · 2 passed", { exact: true })).toBeVisible();
  const details = dialog.locator("[data-pull-checks]");
  await details.first().locator("summary").click();
  await expect(dialog.getByText(/Saved checks for previous head/)).toBeVisible();
  await expect(dialog.getByText(/GitHub rate limit reached/)).toBeVisible();
  await details.last().locator("summary").click();
  await expect(dialog.getByRole("link", { name: "Browser tests", exact: true })).toHaveCount(2);
  await expect(
    dialog.getByRole("link", { name: "Browser tests", exact: true }).last(),
  ).toHaveAttribute("href", "https://github.com/rhizomatous/flora/actions");
  if (screenshotDir !== undefined) {
    await page.screenshot({ path: `${screenshotDir}/checks-desktop.png` });
  }
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(draft).toHaveValue("Keep my draft while checking CI");
  const transcript = page.getByRole("region", { name: "Conversation", exact: true });
  await expect(transcript.getByLabel("Pull request details").last()).toBeVisible();
  const row = page.locator(".florets-navigation-link[href='#chats/pagination']");
  await row.hover();
  await expect(
    page.locator(".sidebar-chat-preview").getByText("1 failed · 2 passed", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await trigger.click();
  await dialog.locator("[data-pull-checks]").first().locator("summary").click();
  await expect(dialog.getByText(/GitHub rate limit reached/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  if (screenshotDir !== undefined) {
    await page.screenshot({ path: `${screenshotDir}/checks-mobile.png` });
  }
  await page.keyboard.press("Escape");
  await expect(draft).toHaveValue("Keep my draft while checking CI");
});
