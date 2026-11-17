import { expect, test } from "./fixtures.ts";

test("side panel keeps chat drafts, resizes, and hosts independent diff tabs", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5199"}/#chats/pagination`);
  await page.getByRole("button", { name: "Hide controls", exact: true }).click();
  const draft = page.getByLabel("Follow-up", { exact: true });
  await draft.fill("Keep this split-view draft");
  const toggle = page.getByRole("button", { name: "Open side panel", exact: true });
  const toggleBounds = await toggle.boundingBox();
  const toggleIcon = await toggle.locator("svg").getAttribute("class");
  await page.getByRole("button", { name: "Open side panel", exact: true }).click();
  await expect(page.getByRole("button", { name: "Close side panel", exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Open side panel", exact: true })).toHaveCount(0);
  const closeToggle = page.getByRole("button", { name: "Close side panel", exact: true });
  expect(await closeToggle.boundingBox()).toEqual(toggleBounds);
  expect(await closeToggle.locator("svg").getAttribute("class")).toBe(toggleIcon);
  await expect(page.getByRole("button", { name: "Expand side panel", exact: true })).toHaveCount(0);
  const side = page.getByRole("complementary", { name: "Side panel" });
  await expect(side.getByRole("tab", { name: "Overview", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(side.getByRole("list", { name: "Linked pull requests" })).toBeVisible();
  const section = side.locator("summary");
  await section.click();
  await expect(side.getByRole("list", { name: "Linked pull requests" })).toBeHidden();
  await section.click();
  await expect(side.getByRole("list", { name: "Linked pull requests" })).toBeVisible();
  await expect(draft).toBeVisible();
  const handle = page.getByRole("separator", { name: "Resize side panel" });
  const before = await side.boundingBox();
  const bounds = await handle.boundingBox();
  expect(bounds).not.toBeNull();
  if (bounds) {
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 100);
    await page.mouse.down();
    await page.mouse.move(bounds.x - 100, bounds.y + 100, { steps: 8 });
    await page.mouse.up();
  }
  await expect
    .poll(async () => {
      const box = await side.boundingBox();
      return box?.width ?? 0;
    })
    .toBeGreaterThan((before?.width ?? 0) + 50);
  await handle.focus();
  await page.keyboard.press("ArrowLeft");
  await side.getByRole("button", { name: "Side panel views" }).click();
  await page.getByRole("menuitem", { name: "Diffs", exact: true }).click();
  await expect(side.getByRole("region", { name: "Workspace changes" })).toBeVisible();
  await expect(draft).toHaveValue("Keep this split-view draft");
  await page.getByRole("button", { name: "Chat views", exact: true }).click();
  await page.getByRole("menuitem", { name: "Diffs", exact: true }).click();
  await expect(page.getByRole("region", { name: "Workspace changes", exact: true })).toHaveCount(2);
  await side.getByRole("tab", { name: "Overview", exact: true }).click();
  await expect(
    page.locator(".chat-main-pane").getByRole("region", { name: "Workspace changes" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Fix duplicate notes between pages", exact: true }).click();
  await side.getByRole("tab", { name: "Diffs", exact: true }).click();
  await side.getByRole("tab", { name: "Diffs", exact: true }).hover();
  await side.getByRole("button", { name: "Close side panel Diffs" }).click();
  await expect(side.getByRole("tab", { name: "Overview" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(side).toBeVisible();
  await expect(draft).toBeHidden();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await side.getByRole("button", { name: "Close side panel", exact: true }).click();
  await expect(draft).toBeVisible();
  await expect(draft).toHaveValue("Keep this split-view draft");
});

test("panel preferences survive closing, chat navigation, and reload", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const base = process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5199";
  await page.goto(`${base}/#chats/pagination`);
  await page.getByRole("button", { name: "Hide controls", exact: true }).click();
  const rail = page.getByRole("navigation", { name: "Conversation turns" });
  await expect(rail).toBeVisible();
  await page.getByRole("button", { name: "Open side panel" }).click();
  await expect(rail).toBeHidden();
  const side = page.getByRole("complementary", { name: "Side panel" });
  await side.locator("summary").click();
  const handle = page.getByRole("separator", { name: "Resize side panel" });
  await handle.focus();
  await page.keyboard.press("ArrowLeft");
  const resized = await side.boundingBox();
  await side.getByRole("button", { name: "Side panel views" }).click();
  await page.getByRole("menuitem", { name: "Diffs", exact: true }).click();
  await side.getByRole("button", { name: "Close side panel", exact: true }).click();
  await expect(rail).toBeVisible();
  await page.getByRole("button", { name: "Open side panel" }).click();
  await expect(side.getByRole("tab", { name: "Diffs", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect
    .poll(async () => {
      const box = await side.boundingBox();
      return box?.width;
    })
    .toBe(resized?.width);
  await page.getByRole("link", { name: /Keep the cart after signing in/ }).click();
  await expect(side).toBeHidden();
  await page.getByRole("link", { name: /Fix duplicate notes between pages/ }).click();
  await expect(side.getByRole("tab", { name: "Diffs", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.reload();
  await expect(side.getByRole("tab", { name: "Diffs", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await side.getByRole("tab", { name: "Overview", exact: true }).click();
  await expect(side.getByRole("list", { name: "Linked pull requests" })).toBeHidden();
  await expect(side.locator("details:visible")).not.toHaveAttribute("open");
});
