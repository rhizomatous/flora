import { feedSchema } from "../../src/chat-schemas";
import { test, expect } from "./fixtures.ts";

const base = process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5199";

test("list pages share compact rows and keyboard-accessible filters and details", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/#chats`);
  await page.getByRole("button", { name: "Hide controls", exact: true }).click();
  const main = page.locator("#main-content");
  const chat = main.getByRole("link", {
    name: "Open chat: Review the workspace changes",
    exact: true,
  });
  await page.keyboard.press("Tab");
  await chat.focus();
  await expect(page.locator('[data-slot="tooltip-content"]')).toContainText(
    "Review the workspace changes",
  );
  const chatBounds = await chat.boundingBox();
  expect(chatBounds?.height).toBe(40);
  await page.keyboard.press("Escape");
  const states = main.getByRole("group", { name: "Chat state" });
  const all = states.getByRole("button", { name: /^All chats / });
  await all.click();
  await expect(all).toHaveAttribute("aria-pressed", "true");
  await all.press("ArrowRight");
  const working = states.getByRole("button", { name: /^Working / });
  await expect(working).toBeFocused();
  await working.press("Space");
  await expect(working).toHaveAttribute("aria-pressed", "true");
  await expect(chat).toHaveCount(0);
  await page.getByRole("link", { name: "Pull requests", exact: true }).click();
  const pull = main.getByRole("link", { name: /example\/fieldnotes #19:/ });
  await page.keyboard.press("Tab");
  await pull.focus();
  await expect(page.locator('[data-slot="tooltip-content"]')).toContainText(
    "Stabilize notes pagination",
  );
  const pullBounds = await main.getByRole("listitem").first().boundingBox();
  expect(pullBounds?.height).toBe(40);
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  const mobileBounds = await pull.boundingBox();
  expect(mobileBounds?.height).toBeGreaterThanOrEqual(20);
});

test("additional linked chats are available from the compact PR row", async ({ page }) => {
  await page.route("**/api/notifications*", async (route) => {
    const response = await route.fetch();
    const feed = feedSchema.parse(await response.json());
    const source = feed.chats.find(
      (chat) => chat.pulls?.items.some((pull) => pull.number === 19) === true,
    );
    if (!source) throw new Error("Missing linked PR fixture");
    feed.chats.push({
      ...source,
      ID: "another-chat",
      Title: "Another conversation linked to this pull request",
    });
    await route.fulfill({ response, json: feed });
  });
  await page.goto(`${base}/#pulls`);
  await page.getByRole("button", { name: "Hide controls", exact: true }).click();
  const more = page.locator("#main-content").getByRole("button", { name: "1 more linked chat" });
  await more.focus();
  await more.press("Enter");
  const dialog = page.getByRole("dialog", { name: "More linked chats" });
  await expect(dialog.getByRole("link")).toHaveCount(1);
  await expect(dialog.getByRole("link")).toHaveAttribute("href", /#chats\//);
  await page.keyboard.press("Escape");
  await expect(more).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await more.click();
  await expect(dialog.getByRole("link")).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});
