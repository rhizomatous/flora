import { expect, test } from "@playwright/test";

test("side panel keeps chat drafts, resizes, and hosts independent diff tabs", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5199"}/#chats/pagination`);
  await page.getByRole("button", { name: "Hide controls", exact: true }).click();
  const draft = page.getByLabel("Follow-up", { exact: true });
  await draft.fill("Keep this split-view draft");
  await page.getByRole("button", { name: "Open side panel", exact: true }).click();
  const side = page.getByRole("complementary", { name: "Side panel" });
  await expect(side.getByRole("tab", { name: "Overview", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
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
  await expect(side.getByRole("region", { name: "Chat changes" })).toBeVisible();
  await expect(draft).toHaveValue("Keep this split-view draft");
  await page.getByRole("button", { name: "Chat views", exact: true }).click();
  await page.getByRole("menuitem", { name: "Diffs", exact: true }).click();
  await expect(page.getByRole("region", { name: "Chat changes", exact: true })).toHaveCount(2);
  await side.getByRole("tab", { name: "Overview", exact: true }).click();
  await expect(
    page.locator(".chat-main-pane").getByRole("region", { name: "Chat changes" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Fix duplicate notes between pages", exact: true }).click();
  await side.getByRole("tab", { name: "Diffs", exact: true }).click();
  await side.getByRole("button", { name: "Expand side panel" }).click();
  await expect(draft).toBeHidden();
  await side.getByRole("button", { name: "Restore split view" }).click();
  await expect(draft).toBeVisible();
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
