import { publicChatID, test, expect } from "./fixtures.ts";

test("turn navigation previews replies and jumps without losing the draft", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const base = process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5199";
  await page.goto(`${base}/#chats/${await publicChatID(page, "pagination")}`);
  await page.getByRole("button", { name: "Hide controls", exact: true }).click();
  const nav = page.getByRole("navigation", { name: "Conversation turns" });
  await expect(nav.getByRole("button")).toHaveCount(4);
  const first = nav.getByRole("button", { name: /^Turn 1:/ });
  const second = nav.getByRole("button", { name: /^Turn 2:/ });
  const draft = page.getByLabel("Follow-up", { exact: true });
  await draft.fill("Keep my draft");
  await second.hover();
  const preview = page.locator(".chat-turn-preview[data-open]");
  await expect(preview).toContainText("Old timestamp-only cursors still work.");
  await first.click();
  await expect(first).toHaveAttribute("data-visible", "true");
  const viewport = page.getByRole("region", { name: "Conversation", exact: true });
  await expect.poll(() => viewport.evaluate((el) => el.scrollTop)).toBeLessThan(60);
  await expect(draft).toHaveValue("Keep my draft");
  await first.press("Tab");
  await expect(second).toBeFocused();
  await expect(preview).toContainText("Old timestamp-only cursors still work.");
  await second.press("Enter");
  await expect(second).toHaveAttribute("data-visible", "true");
  await expect(nav.getByRole("button", { name: /^Turn 3:/ })).toHaveAttribute(
    "data-visible",
    "true",
  );
  await second.press("Escape");
  await expect(preview).not.toBeVisible();
  await draft.focus();
  await page.mouse.move(700, 30);
  await expect
    .poll(() => second.locator("span").evaluate((el) => el.getBoundingClientRect().width))
    .toBe(8);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(nav).toBeHidden();
  await expect(preview).not.toBeVisible();
  await expect(draft).toHaveValue("Keep my draft");
});
