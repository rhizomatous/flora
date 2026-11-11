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
  await expect(fieldnotes.locator(".florets-navigation-link").first()).toContainText(
    "Fix duplicate",
  );
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

test("sidebar and page topbars share vertical alignment", async ({ page }) => {
  const base = process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5199";
  for (const route of ["chats/pagination", "settings"]) {
    await page.goto(`${base}/#${route}`);
    const header = await page.locator(".florets-topbar").boundingBox();
    const brand = await page.locator(".sidebar-brand-row").boundingBox();
    if (!header || !brand) throw new Error("Missing topbar");
    expect(header.height).toBe(44);
    expect(brand.y + brand.height / 2).toBe(header.y + header.height / 2);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const header = await page.locator(".florets-topbar").boundingBox();
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  const brand = await page.locator(".sidebar-brand-row").boundingBox();
  if (!header || !brand) throw new Error("Missing mobile topbar");
  expect(brand.y + brand.height / 2).toBe(header.y + header.height / 2);
});

test("selected sidebar links retain the hover foreground", async ({ page }) => {
  const base = process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5199";
  await page.goto(`${base}/#chats/new`);
  const nav = page.getByRole("navigation", { name: "Main", exact: true });
  const selected = nav.getByRole("link", { name: "New chat", exact: true });
  const other = nav.getByRole("link", { name: "All chats", exact: true });
  await expect(selected).toHaveAttribute("aria-current", "page");
  const resting = await selected.evaluate((node) => getComputedStyle(node).color);
  expect(resting).not.toBe(await other.evaluate((node) => getComputedStyle(node).color));
  await selected.hover();
  await expect(selected).toHaveCSS("color", resting);
  await other.click();
  await expect(other).toHaveAttribute("aria-current", "page");
  await page.mouse.move(700, 100);
  await expect(other).toHaveCSS("color", resting);
});

test("mobile sidebar focuses its toggle and keeps the skip link keyboard accessible", async ({
  page,
}) => {
  const base = process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5199";
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/#chats/pagination`);
  await page.getByRole("button", { name: "Hide controls", exact: true }).click();
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  const nav = page.getByRole("navigation", { name: "Main", exact: true });
  await expect(nav.getByRole("button", { name: "Toggle Sidebar", exact: true })).toBeFocused();
  const skip = nav.getByRole("link", { name: "Skip to content", exact: true });
  await expect(skip).not.toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(skip).toBeFocused();
  await skip.press("Enter");
  await expect(nav).not.toBeVisible();
  await expect
    .poll(() =>
      page.locator("#main-content").evaluate((node) => node.contains(document.activeElement)),
    )
    .toBe(true);
});

test("one desktop toggle moves between sidebar and page without losing focus", async ({ page }) => {
  const base = process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5199";
  await page.goto(`${base}/#chats/pagination`);
  await page.getByRole("button", { name: "Hide controls", exact: true }).click();
  const toggle = page.getByRole("button", { name: "Menu", exact: true });
  await expect(page.locator('[data-slot="sidebar-trigger"]')).toHaveCount(1);
  const original = await toggle.elementHandle();
  const opened = await toggle.boundingBox();
  if (!opened) throw new Error("Missing sidebar toggle");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toBeFocused();
  await expect
    .poll(async () => {
      const bounds = await toggle.boundingBox();
      return bounds?.x;
    })
    .toBe(20);
  expect(await original.evaluate((node) => node.isConnected)).toBe(true);
  expect(opened.x).toBeGreaterThan(200);
  await toggle.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect
    .poll(async () => {
      const bounds = await toggle.boundingBox();
      return bounds?.x;
    })
    .toBe(opened.x);
  expect(await original.evaluate((node) => node.isConnected)).toBe(true);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(toggle).toHaveCSS("transition-duration", "0s");
});
