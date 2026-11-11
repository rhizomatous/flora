import { test, expect } from "./fixtures.ts";

test("sidebar searches, collapses projects, and preserves navigation on narrow screens", async ({
  page,
}) => {
  const base = process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5199";
  await page.goto(`${base}/#chats/pagination`);
  await page.getByRole("button", { name: "Hide controls", exact: true }).click();
  const nav = page.getByRole("navigation", { name: "Main", exact: true });
  const target = nav.getByRole("link", { name: /Fix duplicate notes between pages/ });
  await expect(target).toHaveAttribute("aria-current", "page");
  await nav.getByRole("button", { name: "Search chats", exact: true }).click();
  const search = nav.getByRole("textbox", { name: "Search chats", exact: true });
  await expect(search).toBeFocused();
  await search.fill("duplicate");
  await expect(target).toBeVisible();
  await expect(nav.getByRole("link", { name: /Keep the cart/ })).toHaveCount(0);
  await search.fill("no-matching-chat");
  await expect(nav.getByText("No chats found.")).toBeVisible();
  await search.press("Escape");
  await nav.getByRole("button", { name: "Collapse Fieldnotes API", exact: true }).click();
  await expect(target).toHaveCount(0);
  await nav.getByRole("button", { name: "Expand Fieldnotes API", exact: true }).click();
  await target.hover();
  await expect(page.locator(".sidebar-chat-preview")).toContainText(
    "Fix duplicate notes between pages",
  );
  await nav
    .getByRole("button", { name: "Actions for Fix duplicate notes between pages", exact: true })
    .click();
  await expect(page.getByRole("menuitem", { name: "Archive", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await nav.getByRole("button", { name: "Chat list options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Sort: Updated", exact: true }).click();
  const fieldnotes = nav.getByRole("region", { name: "Fieldnotes API", exact: true });
  await expect(fieldnotes.locator(".sidebar-chat-link").first()).toContainText("Fix duplicate");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await expect(nav).toBeVisible();
  await nav.getByRole("link", { name: /Keep the cart after signing in/ }).click();
  await expect(page).toHaveURL(`${base}/#chats/checkout`);
  await expect(nav).not.toBeVisible();
  const heading = page.getByRole("heading", {
    name: "Keep the cart after signing in",
    exact: true,
  });
  await expect
    .poll(() => heading.evaluate((node) => node.contains(document.activeElement)))
    .toBe(true);
});
