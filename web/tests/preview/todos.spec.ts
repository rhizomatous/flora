import type { Message, Part } from "../../src/chat-schemas.ts";
import { test, expect, publicChatID } from "./fixtures.ts";

const labels = [
  "Inspect existing visual tokens and deployment setup",
  "Update site styling to a bright green visual direction",
  "Run checks and review the rendered build",
  "Commit changes, push branch, and open pull request",
] as const;

function message(id: string, parts: Part[], role = "assistant"): Message {
  return { ID: id, Role: role, Text: "", Provider: "", Model: "", Payload: { parts } };
}

function snapshot(id: string, completed: number): Part {
  const todos = labels.map((content, index) => {
    const remaining = index === completed ? "in_progress" : "pending";
    return { content, status: index < completed ? "completed" : remaining, priority: "high" };
  });
  return {
    id,
    type: "tool",
    tool: "todowrite",
    state: {
      status: "completed",
      title: "4 todos",
      input: { todos },
      output: JSON.stringify(todos),
    },
  };
}

test("todo snapshots stay readable through live updates, history, completion, and failed writes", async ({
  page,
}, testInfo) => {
  const base = process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5199";
  const canonical = await publicChatID(page, "working", base);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let phase = 0;
  let sequence = 0;
  await page.route("**/api/chats/working/events", (route) => {
    sequence++;
    return route.fulfill({
      contentType: "text/event-stream",
      body: `retry: 100\nevent: activity\ndata: ${JSON.stringify({ ChatID: "working", Sequence: sequence, Kind: "message.runtime" })}\n\n`,
    });
  });
  await page.route("**/api/chats/working", (route) => {
    const messages = [
      message("user", [{ type: "text", text: "Update the site styling" }], "user"),
      message("plan", [snapshot("initial", 0)]),
    ];
    if (phase >= 1) {
      messages.push(
        message("update", [{ type: "text", text: "The styling is ready. Checking the build." }]),
        message("progress", [snapshot("halfway", 2)]),
      );
    }
    if (phase >= 2) messages.push(message("finished", [snapshot("complete", 4)]));
    if (phase >= 3) {
      messages.push(
        message("failed", [
          {
            type: "tool",
            tool: "todowrite",
            state: { status: "error", input: { todos: [] }, error: "Could not save todos" },
          },
        ]),
      );
    }
    if (phase >= 4) {
      messages.push(
        message("cleared", [
          {
            type: "tool",
            tool: "todowrite",
            state: { status: "completed", input: { todos: [] }, output: "[]" },
          },
        ]),
      );
    }
    const finishedStatus = phase === 3 ? "failed" : "idle";
    return route.fulfill({
      json: {
        chat: {
          ID: "working",
          PublicID: canonical,
          Title: "Update site styling",
          ProjectID: "preview",
          Status: phase < 2 ? "working" : finishedStatus,
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
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/#chats/${canonical}`);
  await page.getByRole("button", { name: "Hide controls", exact: true }).click();
  const checklists = page.locator('[data-slot="todo-checklist"]');
  const initial = checklists.getByRole("button", { name: "Todos 0 of 4 done", exact: true });
  await expect(initial).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.getByRole("list", { name: "Todos", exact: true }).getByRole("listitem"),
  ).toHaveCount(4);
  await expect(checklists.locator("pre")).toHaveCount(0);
  await expect(checklists).not.toContainText("high");
  await expect(checklists).not.toContainText("less than");
  await initial.click();
  await expect(initial).toBeFocused();
  await expect(initial).toHaveAttribute("aria-expanded", "false");
  await initial.press("Enter");
  await expect(initial).toHaveAttribute("aria-expanded", "true");
  await checklists.getByRole("button", { name: "Details", exact: true }).click();
  await expect(checklists.locator("pre")).toHaveCount(2);
  await expect(checklists.locator("pre").first()).toContainText('"priority": "high"');
  await checklists.getByRole("button", { name: "Details", exact: true }).click();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ["dark", "light"]) {
      await page.evaluate(
        (appearance) => document.documentElement.classList.toggle("dark", appearance === "dark"),
        theme,
      );
      await expect(page.getByText(labels[0], { exact: false }).first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      const wrapped = await checklists
        .getByRole("listitem")
        .evaluateAll((items) => items.every((item) => item.scrollWidth <= item.clientWidth));
      expect(wrapped).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`todos-${width}-${theme}.png`),
        animations: "disabled",
      });
    }
  }
  phase = 1;
  const progress = checklists.getByRole("button", { name: "Todos 2 of 4 done", exact: true });
  await expect(progress).toHaveAttribute("aria-expanded", "true");
  await expect(checklists).toHaveCount(1);
  const history = page
    .locator('[data-slot="work-summary"]')
    .first()
    .getByRole("button", { name: /Work details/ });
  await history.click();
  await expect(initial).toHaveAttribute("aria-expanded", "false");
  await initial.click();
  await expect(initial).toHaveAttribute("aria-expanded", "true");
  await history.click();
  await expect(checklists).toHaveCount(1);
  phase = 2;
  const complete = checklists.getByRole("button", { name: "Todos 4 of 4 done", exact: true });
  await expect(complete).toHaveAttribute("aria-expanded", "false");
  await complete.click();
  await expect(checklists.getByRole("listitem").filter({ hasText: "Completed:" })).toHaveCount(4);
  phase = 3;
  await expect(page.getByRole("button", { name: /Work details.*failed/ })).toBeVisible();
  await expect(complete).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: /Work details.*failed/ }).click();
  await page.getByRole("button", { name: "todowrite Failed", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Could not save todos" })).toBeVisible();
  phase = 4;
  const empty = checklists.getByRole("button", { name: "No todos", exact: true });
  await expect(empty).toHaveAttribute("aria-expanded", "false");
  await empty.click();
  const emptyList = checklists.filter({
    has: page.getByRole("button", { name: "No todos", exact: true }),
  });
  await expect(emptyList.getByRole("list")).toHaveCount(0);
  expect(errors).toEqual([]);
});
