import { detailSchema, feedSchema } from "../../src/chat-schemas";
import { test, expect } from "./fixtures.ts";

const base = process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5199";

test("chats can be filtered, searched, collapsed, and opened on a narrow screen", async ({
  page,
}) => {
  await page.goto(`${base}/#chats`);
  const region = page.locator("#main-content").getByRole("region", { name: "Chats", exact: true });
  const states = region.getByRole("group", { name: "Chat state" });
  await expect(region.getByRole("heading", { name: "Chats", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Hide controls", exact: true }).click();
  await expect(region.getByRole("list", { name: "Flora chats", exact: true })).toBeVisible();
  await states.getByRole("button", { name: /^Needs you / }).click();
  await expect(
    region.getByRole("link", {
      name: "Open chat: Move project settings into the menu",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    region.getByRole("link", { name: "Open chat: Review the workspace changes", exact: true }),
  ).toHaveCount(0);
  await states.getByRole("button", { name: /^All chats / }).click();
  await region.getByRole("button", { name: "Search chats", exact: true }).click();
  const search = region.getByRole("textbox", { name: "Search chats" });
  await expect(search).toBeFocused();
  await search.fill("Review the workspace changes");
  await expect(region.getByRole("listitem")).toHaveCount(1);
  await search.fill("no matching chat");
  await expect(region.getByText("No chats match these filters.")).toBeVisible();
  await region.getByRole("button", { name: "Show all chats" }).click();
  await search.press("Escape");
  await expect(region.getByRole("button", { name: "Search chats", exact: true })).toBeFocused();
  const projects = region.getByRole("combobox", { name: "Project", exact: true });
  await projects.selectOption({ label: "Flora" });
  await expect(region.getByRole("list")).toHaveCount(1);
  await region.locator("summary").click();
  await expect(region.getByRole("list")).toBeHidden();
  await region.locator("summary").click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await projects.selectOption("");
  await region
    .getByRole("link", { name: "Open chat: Review the workspace changes", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Review the workspace changes", exact: true }),
  ).toBeVisible();
});

test("automatic retries appear as Working in the list, filters, sidebar, and summary", async ({
  page,
}) => {
  const reason = "Waiting for the model provider to retry";
  await page.route("**/api/notifications*", async (route) => {
    const response = await route.fetch();
    const feed = feedSchema.parse(await response.json());
    const chat = feed.chats.find((item) => item.ID === "completed");
    if (!chat) throw new Error("Missing completed chat");
    chat.Status = "waiting";
    chat.StatusReason = reason;
    await route.fulfill({ response, json: feed });
  });
  await page.route("**/api/chats/completed", async (route) => {
    const response = await route.fetch();
    const detail = detailSchema.parse(await response.json());
    detail.chat.Status = "waiting";
    detail.chat.StatusReason = reason;
    await route.fulfill({ response, json: detail });
  });
  await page.goto(`${base}/#chats`);
  await page.getByRole("button", { name: "Hide controls", exact: true }).click();
  const region = page.locator("#main-content").getByRole("region", { name: "Chats", exact: true });
  const row = region.getByRole("link", {
    name: "Open chat: Review the workspace changes",
    exact: true,
  });
  await expect(row).toContainText("Working");
  await expect(
    page
      .getByRole("navigation", { name: "Main", exact: true })
      .getByRole("link", { name: /Review the workspace changes/ }),
  ).toContainText("Working");
  await region.getByRole("button", { name: /^Needs you / }).click();
  await expect(row).toHaveCount(0);
  await region.getByRole("button", { name: /^Working / }).click();
  await expect(row).toBeVisible();
  await row.click();
  await page.getByRole("button", { name: "Review the workspace changes", exact: true }).hover();
  const summary = page.getByLabel("Chat summary", { exact: true });
  await expect(summary.getByText("Working", { exact: true })).toHaveAttribute("title", reason);
});
