import { detailSchema, type Message, type Subagent } from "../../src/chat-schemas";
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
  const side = page.getByRole("complementary", { name: "Side panel" });
  await expect(side.getByRole("tab", { name: "Subagent 1", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(side.getByText("Inspect the agent runtime.", { exact: true })).toBeVisible();
  await expect(side.getByText("The saved result is available.", { exact: true })).toBeVisible();
  await expect(draft).toHaveValue("Keep my draft");
  await page.reload();
  await page.getByRole("button", { name: "Hide controls", exact: true }).click();
  await expect(side.getByText("The saved result is available.", { exact: true })).toBeVisible();
  await side.getByRole("tab", { name: "Subagent 1", exact: true }).hover();
  await side.getByRole("button", { name: "Close Subagent 1", exact: true }).click();
  await side.getByRole("button", { name: "Close side panel", exact: true }).click();
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
  await expect(side.getByText("The saved result is available.", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(side).toBeVisible();
  await expect
    .poll(async () => {
      const bounds = await side.boundingBox();
      return bounds?.width ?? 0;
    })
    .toBeGreaterThan(380);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect(errors).toEqual([]);
});
