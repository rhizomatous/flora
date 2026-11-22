import { test, expect } from "../fixtures.ts";
import { assertFitsPhone, logIn, pageErrors } from "../helpers.ts";

test.use({ scenario: "model-summary" });

test("saved main-session identity agrees across title and sidebar after reload", async ({ page, backend }) => {
  const errors = pageErrors(page);
  await logIn(page);
  await page.goto(`/#chats/${backend.chatID}`);
  const title = page.getByRole("button", { name: "Review keyboard navigation", exact: true });
  const label = "Latest main-session model: anthropic / claude-haiku-4-5. Main session used 2 reported models";
  await title.focus();
  await expect(page.getByRole("img", { name: label, exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: label, exact: true })).toHaveText("claude-haiku-4-5 · 2 models");
  await page.keyboard.press("Escape");
  const link = page.getByRole("link", { name: /Review keyboard navigation/ });
  await link.focus();
  await expect(page.locator(".sidebar-chat-preview").getByRole("img", { name: label, exact: true })).toBeVisible();
  await expect(page.locator(".sidebar-chat-preview")).toContainText("Check keyboard focus");
  await page.reload();
  await title.focus();
  await expect(page.getByRole("img", { name: label, exact: true })).toBeVisible();
  await assertFitsPhone(page);
  await expect(page.getByRole("img", { name: label, exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.goto(`/#chats/${backend.otherChatID}`);
  await page.getByRole("button", { name: "Plan the next task", exact: true }).focus();
  await expect(page.getByRole("img", { name: "No completed main-session model calls", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
