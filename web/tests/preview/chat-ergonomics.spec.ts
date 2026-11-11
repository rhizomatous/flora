import assert from "node:assert/strict";

import { test, expect } from "./fixtures.ts";

test("chat drafts, activity, and responsive layout", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  page.setDefaultTimeout(10_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const base = process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5199";
  await page.request.post(`${base}/__preview/control?action=restart`);
  await page.request.post(`${base}/__preview/control?action=pause`);
  await page.goto(`${base}/#chats/working`);
  const draft = page.getByLabel("Follow-up", { exact: true });
  await expect(draft).toBeEnabled();
  await draft.fill("Keep this draft");
  await draft.press("Enter");
  await expect(draft).toHaveValue("Keep this draft");
  await draft.press("Shift+Enter");
  await expect(draft).toHaveValue("Keep this draft\n");
  await page.reload();
  await expect(draft).toHaveValue("Keep this draft\n");
  const menu = await page.getByRole("button", { name: "Menu", exact: true }).boundingBox();
  const heading = await page
    .getByRole("heading", { name: "Check the project setup", exact: true })
    .boundingBox();
  assert.ok(
    menu && heading && Math.abs(menu.y + menu.height / 2 - heading.y - heading.height / 2) < 2,
  );
  const composer = await page.locator(".composer-box").filter({ has: draft }).boundingBox();
  assert.ok(composer && composer.height < 110);
  await page.request.post(`${base}/__preview/control?action=play`);
  await expect(
    page
      .getByLabel("Current activity")
      .getByRole("button", { name: /Check workspace|Running command/ }),
  ).toBeVisible();
  await page.request.post(`${base}/__preview/control?action=pause`);
  await page.reload();
  await expect(page.getByLabel("Current activity")).toBeVisible();
  await expect(draft).toHaveValue("Keep this draft\n");
  await page.request.post(`${base}/__preview/control?action=play`);
  await expect(page.getByLabel("Current activity")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Worked for/ }).first()).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await page.goto(`${base}/#chats/completed`);
  await expect(draft).toHaveValue("");
  await page.locator('[data-slot="markdown"]').waitFor();
  const summary = page.getByRole("button", { name: /Worked for/ }).first();
  await summary.scrollIntoViewIfNeeded();
  await expect(summary).toHaveAttribute("aria-expanded", "false");
  await summary.click();
  await page.getByRole("button", { name: /Check workspace.*completed/ }).click();
  await expect(page.getByText("Checks passed", { exact: false }).first()).toBeVisible();
  await page.route("**/api/chats/completed/messages", (route) =>
    route.fulfill({ status: 500, json: { error: "Try again" } }),
  );
  await draft.fill("Retain on failure");
  await draft.press("Enter");
  await expect(page.getByRole("alert")).toContainText("Try again");
  await expect(draft).toHaveValue("Retain on failure");
  await page.unroute("**/api/chats/completed/messages");
  await page.route("**/api/chats/completed/messages", (route) => route.fulfill({ json: {} }));
  await draft.press("Enter");
  await expect(draft).toHaveValue("");
  await page.reload();
  await expect(draft).toHaveValue("");
  await page.goto(`${base}/#chats/working`);
  await expect(draft).toHaveValue("Keep this draft\n");
  await page.goto(`${base}/#chats/recovery`);
  await expect(page.getByRole("button", { name: /1 failed/ })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await page.goto(`${base}/#chats/long`);
  await page.locator('[data-slot="markdown"]').first().waitFor();
  const viewport = page.getByLabel("Conversation", { exact: true });
  await viewport.hover();
  await page.mouse.wheel(0, -10_000);
  await expect(page.getByRole("button", { name: "Jump to latest" })).toHaveAttribute(
    "data-active",
    "true",
  );
  const before = await draft.boundingBox();
  await page.getByRole("button", { name: "Jump to latest" }).click();
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  assert.deepEqual(await draft.boundingBox(), before);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/#chats/waiting`);
  await expect(page.getByRole("form", { name: "Questions", exact: true })).toBeVisible();
  await expect(draft).toBeEnabled();
  const bounds = await draft.boundingBox();
  assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 844);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  assert.equal(await page.evaluate(() => document.documentElement.scrollHeight), 844);
  assert.deepEqual(errors, []);
});

test("shared composer stays compact and exposes honest placeholders", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const base = process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5199";
  for (const width of [1512, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`${base}/#chats/new`);
    const message = page.getByLabel("Message", { exact: true });
    await message.fill("Draft a task");
    const start = await page.getByRole("button", { name: "Start chat", exact: true }).boundingBox();
    await page.goto(`${base}/#chats/completed`);
    const followUp = page.getByLabel("Follow-up", { exact: true });
    await followUp.fill("Draft a follow-up");
    const send = await page
      .getByRole("button", { name: "Send message", exact: true })
      .boundingBox();
    for (const name of ["Model", "Reasoning effort", "Chat actions"]) {
      const offsets = await page.getByRole("button", { name, exact: true }).evaluate((button) => {
        const label = button.querySelector(".cn-control-label")?.getBoundingClientRect();
        if (!label) throw new Error("Missing composer label");
        const center = label.y + label.height / 2;
        return [...button.querySelectorAll(":scope > svg, :scope > .composer-model-mark")].map(
          (icon) => {
            const rect = icon.getBoundingClientRect();
            return Math.abs(rect.y + rect.height / 2 - center);
          },
        );
      });
      assert.ok(
        offsets.length > 0 && offsets.every((offset) => offset < 0.1),
        `${name} at ${width}px`,
      );
    }
    assert.ok(start && send && start.width === send.width && start.height === send.height);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    await page.getByRole("button", { name: "Add attachments and context", exact: true }).click();
    await expect(
      page.getByRole("menuitem", { name: "Upload attachment", exact: true }),
    ).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(followUp).toHaveValue("Draft a follow-up");
    await page.getByRole("button", { name: "Context usage", exact: true }).click();
    await expect(page.getByText("Unavailable", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    const review = page.getByRole("button", { name: "Pull requests and terminals", exact: true });
    await review.click();
    await expect(page.getByText("Pull request details unavailable", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Review changes", exact: true })).toBeDisabled();
    await review.click();
    await expect(page.getByText("Pull request details unavailable", { exact: true })).toHaveCount(
      0,
    );
    await expect(followUp).toHaveValue("Draft a follow-up");
  }
  assert.deepEqual(errors, []);
});

test("title summary opens independently of the plus menu", async ({ page }) => {
  const base = process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5199";
  await page.goto(`${base}/#chats/completed`);
  await page.getByRole("button", { name: "Hide controls", exact: true }).click();
  const title = page.getByRole("button", { name: "Review the workspace changes", exact: true });
  const summary = page.getByLabel("Chat summary", { exact: true });
  await title.hover();
  await expect(summary).toBeVisible();
  await expect(summary.getByText("Idle", { exact: true })).toBeVisible();
  await expect(summary.getByText("completed", { exact: true })).toBeVisible();
  await expect(summary.locator("time")).toHaveAttribute("datetime", /.+/);
  await page.keyboard.press("Escape");
  await expect(summary).toBeHidden();
  await title.focus();
  await expect(summary).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Chat views", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "New shell", exact: true })).toBeVisible();
  await expect(summary).toBeHidden();
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await title.click();
  await expect(summary).toBeVisible();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
});
