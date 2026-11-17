import { detailSchema, feedSchema, type Message, type Subagent } from "../../src/chat-schemas";
import { test, expect } from "./fixtures.ts";

const message = (ID: string, Role: string, text: string): Message => ({
  ID,
  Role,
  Text: text,
  Provider: "",
  Model: "",
  Payload: { parts: [{ type: "text", text }] },
});

test("subagent links, menus, and restored tabs share a saved conversation", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  const base = process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5199";
  const agent: Subagent = {
    id: "child",
    number: 1,
    parentID: "root",
    title: "Review agent reliability",
    status: "idle",
    collection: "complete",
    created: 1,
    updatedAt: "2026-01-01",
  };
  await page.route("**/api/chats/completed", async (route) => {
    const response = await route.fetch();
    const detail = detailSchema.parse(await response.json());
    detail.subagents = [agent];
    detail.messages.push({
      ...message("task", "assistant", ""),
      Payload: {
        parts: [
          {
            id: "task",
            type: "tool",
            tool: "task",
            state: {
              status: "completed",
              title: "Review agent reliability",
              metadata: { sessionId: "child" },
              time: { start: 1000, end: 3000 },
              output: "Reviewed",
            },
          },
        ],
      },
    });
    await route.fulfill({ json: detail });
  });
  await page.route("**/api/chats/completed/subagents/child", (route) =>
    route.fulfill({
      json: {
        messages: [
          message("prompt", "user", "Inspect the agent runtime."),
          message("result", "assistant", "The saved result is available."),
        ],
      },
    }),
  );
  await page.goto(`${base}/#chats/completed`);
  await page.getByRole("button", { name: "Hide controls", exact: true }).click();
  const draft = page.getByLabel("Follow-up", { exact: true });
  await draft.fill("Keep my draft");
  await page.getByRole("button", { name: "Chat views", exact: true }).click();
  await page.getByRole("menuitem", { name: /Subagent 1/ }).click();
  const main = page.locator(".chat-main-pane");
  await expect(page.getByRole("complementary", { name: "Side panel" })).toHaveCount(0);
  await expect(main.getByRole("tab", { name: "Subagent 1", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(main.getByText("Inspect the agent runtime.", { exact: true })).toBeVisible();
  await expect(main.getByText("The saved result is available.", { exact: true })).toBeVisible();
  await expect(draft).toHaveValue("Keep my draft");
  await page.reload();
  await page.getByRole("button", { name: "Hide controls", exact: true }).click();
  await expect(main.getByText("The saved result is available.", { exact: true })).toBeVisible();
  await main.getByRole("button", { name: "Close Subagent 1", exact: true }).click();
  await page.getByRole("button", { name: /Worked for 2s.*Subagent activity/ }).click();
  const link = page
    .locator(".chat-main-pane")
    .getByRole("button", { name: "Subagent 1", exact: true });
  await link.hover();
  await expect(page.getByText("Finished · 2s", { exact: true })).toBeVisible();
  await page.mouse.move(0, 0);
  await expect(page.getByText("Finished · 2s", { exact: true })).toBeHidden();
  await link.focus();
  await expect(page.getByText("Finished · 2s", { exact: true })).toBeVisible();
  await link.click();
  await expect(page.getByText("Finished · 2s", { exact: true })).toBeHidden();
  await expect(main.getByText("The saved result is available.", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(main).toBeVisible();
  await expect
    .poll(async () => {
      const bounds = await main.boundingBox();
      return bounds?.width ?? 0;
    })
    .toBeGreaterThan(350);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect(errors).toEqual([]);
});

test("chat hover cards show saved subagent names and tasks", async ({ page }) => {
  await page.route("**/api/notifications*", async (route) => {
    const response = await route.fetch();
    const feed = feedSchema.parse(await response.json());
    const chat = feed.chats.find((item) => item.ID === "completed");
    if (!chat) throw new Error("Missing completed chat");
    chat.subagents = [
      { id: "review-ui", number: 2, title: "Review UI and product experience" },
      { id: "review-agent", number: 1, title: "Review agent reliability" },
    ];
    await route.fulfill({ json: feed });
  });
  const base = process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5199";
  await page.goto(`${base}/#chats/new`);
  await page.getByRole("button", { name: "Hide controls", exact: true }).click();
  const nav = page.getByRole("navigation", { name: "Main", exact: true });
  await nav.getByRole("link", { name: /Review the workspace changes/ }).hover();
  const preview = page.locator(".sidebar-chat-preview");
  await expect(preview.getByRole("region", { name: "Subagents" })).toBeVisible();
  await expect(preview.getByText("Subagent 2", { exact: true })).toBeVisible();
  await expect(
    preview.getByText("Review UI and product experience", { exact: true }),
  ).toBeVisible();
  await expect(preview.getByText("Subagent 1", { exact: true })).toBeVisible();
  await expect(preview.getByText("Review agent reliability", { exact: true })).toBeVisible();
  await nav.getByRole("link", { name: /Check the project setup/ }).hover();
  await expect(preview.getByText("Check the project setup", { exact: true })).toBeVisible();
  await expect(preview.getByRole("region", { name: "Subagents" })).toHaveCount(0);
});

test("subagent tabs follow their pane and close like Diffs", async ({ page }) => {
  const base = process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5199";
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`${base}/#chats/subagents`);
  await page.getByRole("button", { name: "Hide controls", exact: true }).click();
  const main = page.locator(".chat-main-pane");
  await main.getByRole("button", { name: "Chat views", exact: true }).click();
  await page.getByRole("menuitem", { name: /Subagent 1/ }).click();
  await expect(page.getByRole("complementary", { name: "Side panel" })).toHaveCount(0);
  await expect(main.getByText(/Review the agent runtime and transcript persistence/)).toBeVisible();
  await main.getByRole("button", { name: "Chat views", exact: true }).click();
  await page.getByRole("menuitem", { name: "Diffs", exact: true }).click();
  await expect(main.getByRole("tab", { name: "Diffs", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await main.getByRole("tab", { name: "Diffs", exact: true }).hover();
  await main.getByRole("button", { name: "Close Diffs", exact: true }).click();
  await main.getByRole("tab", { name: "Subagent 1", exact: true }).click();
  await expect(main.getByRole("button", { name: "Close Subagent 1", exact: true })).toHaveCSS(
    "opacity",
    "1",
  );
  await main.getByRole("button", { name: "Close Subagent 1", exact: true }).click();
  await expect(main.getByRole("tab", { name: "Subagent 1", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Follow-up", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Open side panel", exact: true }).click();
  const side = page.getByRole("complementary", { name: "Side panel" });
  await side.getByRole("button", { name: "Side panel views", exact: true }).click();
  await page.getByRole("menuitem", { name: /Subagent 2/ }).click();
  await expect(side.getByText(/Review the chat UI and subagent navigation/)).toBeVisible();
  await expect(main.getByRole("tab", { name: "Subagent 2", exact: true })).toHaveCount(0);
  await side.getByRole("button", { name: "Side panel views", exact: true }).click();
  await page.getByRole("menuitem", { name: /Subagent 1/ }).click();
  await side.getByRole("tab", { name: "Subagent 2", exact: true }).click();
  await side.getByRole("button", { name: "Close Subagent 2", exact: true }).click();
  await expect(side.getByRole("tab", { name: "Subagent 2", exact: true })).toHaveCount(0);
  await side.getByRole("tab", { name: "Subagent 1", exact: true }).click();
  await side.getByRole("button", { name: "Close Subagent 1", exact: true }).click();
  await expect(side.getByRole("tab", { name: "Overview", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(side.getByRole("tablist")).toHaveCSS("scrollbar-width", "none");
});
