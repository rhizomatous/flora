import assert from "node:assert/strict";

import type { Message, Part } from "../../src/chat-schemas.ts";
import { test, expect } from "./fixtures.ts";

function message(id: string, parts: Part[], role = "assistant"): Message {
  return { ID: id, Role: role, Text: "", Provider: "", Model: "", Payload: { parts } };
}

test("live work grouping, disclosure state, and focus", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const base = process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5199";
  let phase = 0;
  let sequence = 0;
  await page.route("**/api/chats/working/events", (route) => {
    sequence++;
    return route.fulfill({
      contentType: "text/event-stream",
      body: `retry: 100\nevent: activity\ndata: ${JSON.stringify({ ChatID: "working", Sequence: sequence, Kind: "message.runtime" })}\n\n`,
    });
  });
  const start = Date.now() - 3000;
  await page.route("**/api/chats/working", (route) => {
    const read: Part = {
      id: "read",
      type: "tool",
      tool: "read",
      state: {
        status: phase === 0 ? "running" : "error",
        title: "Read configuration",
        input: { filePath: "/workspace/config.ts" },
        time: { start, ...(phase > 0 ? { end: start + 500 } : {}) },
        ...(phase > 0 ? { error: "File not found" } : {}),
      },
    };
    const check: Part = {
      id: "check",
      type: "tool",
      tool: "bash",
      state: {
        status: phase < 2 ? "running" : "completed",
        title: "Run project checks",
        input: { command: "npm test" },
        output: phase < 2 ? "" : "Checks passed",
        time: { start: start + 500, ...(phase >= 2 ? { end: start + 2500 } : {}) },
      },
    };
    const messages = [
      message("user", [{ type: "text", text: "Fix the configuration" }], "user"),
      message("a", [read]),
    ];
    if (phase === 3) {
      messages.push(
        message("update", [
          { type: "text", text: "I found a missing file. Checking the project next." },
        ]),
      );
    }
    if (phase > 0) messages.push(message("b", [check]));
    if (phase >= 2) {
      messages.push(message("final", [{ type: "text", text: "The project checks passed." }]));
    }
    return route.fulfill({
      json: {
        chat: {
          ID: "working",
          Title: "Work summaries",
          ProjectID: "preview",
          Status: phase >= 2 ? "idle" : "working",
          StatusReason: "",
          UpdatedAt: "",
          ImageDigest: "",
          HarnessVersion: "",
          StartingCommits: {},
        },
        messages,
      },
    });
  });
  phase = 0;
  await page.goto(`${base}/#chats/working`);
  const groups = page.locator('[data-slot="work-summary"]');
  await expect(groups).toHaveCount(1);
  await expect(
    page.getByLabel("Current activity").getByRole("button", { name: /Read configuration/ }),
  ).toBeVisible();
  await page
    .getByLabel("Current activity")
    .getByRole("button", { name: /Read configuration/ })
    .click();
  await expect(groups.getByRole("button", { name: /Working.*1 step/ })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(page.getByText('"/workspace/config.ts"', { exact: false })).toBeVisible();
  await expect(groups.getByRole("button", { name: /Read configuration/ })).toBeFocused();
  phase = 1;
  await expect(groups.getByRole("button", { name: /Working.*2 steps.*1 failed/ })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(page.getByText("File not found", { exact: true })).toBeVisible();
  await expect(groups).toHaveCount(1);
  phase = 2;
  const completed = groups.getByRole("button", { name: /Worked for 2s.*2 steps.*1 failed/ });
  await expect(completed).toHaveAttribute("aria-expanded", "true");
  await expect(completed.locator('[data-slot="trace-line"]')).not.toHaveAttribute(
    "data-status",
    "error",
  );
  await expect(page.getByText("File not found", { exact: true })).toBeVisible();
  await completed.click();
  await expect(page.getByText("File not found", { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(completed).toHaveAttribute("aria-expanded", "false");
  await expect(groups).toHaveCount(1);
  phase = 3;
  await expect(groups).toHaveCount(2);
  await expect(
    groups.first().getByRole("button", { name: /Worked for less than 1s/ }),
  ).toBeVisible();
  await expect(
    page.getByText("I found a missing file. Checking the project next.", { exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await groups.first().getByRole("button").click();
  await groups
    .first()
    .getByRole("button", { name: /Read configuration/ })
    .click();
  await expect(page.getByText("File not found", { exact: true })).toBeVisible();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  assert.deepEqual(errors, []);
});
