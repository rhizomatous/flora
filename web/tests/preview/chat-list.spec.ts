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
  await page.screenshot({ path: "/private/tmp/flora-chats-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await projects.selectOption("");
  await page.screenshot({ path: "/private/tmp/flora-chats-desktop.png" });
  await region
    .getByRole("link", { name: "Open chat: Review the workspace changes", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Review the workspace changes", exact: true }),
  ).toBeVisible();
});
