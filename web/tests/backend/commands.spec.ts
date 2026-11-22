import assert from "node:assert/strict";
import { test, expect } from "../fixtures.ts";
import { logIn, pageErrors } from "../helpers.ts";

test.use({ scenario: "context" });

test("commands support keyboard selection, cancellation, IME, literal slashes and persisted execution", async ({ page, backend }) => {
  const errors = pageErrors(page);
  await logIn(page);
  await page.goto(`${backend.url}/#chats/${backend.chatID}`);
  const composer = page.getByLabel("Follow-up", { exact: true });
  const options = page.getByRole("listbox", { name: "Commands", exact: true });
  await composer.fill("/");
  await expect(options.getByRole("option")).toHaveCount(2);
  await expect(composer).toBeFocused();
  await expect(composer).toHaveAttribute("aria-expanded", "true");
  await composer.press("ArrowDown");
  await expect(options.getByRole("option", { selected: true })).toContainText("/init");
  await composer.press("ArrowDown");
  await expect(options.getByRole("option", { selected: true })).toContainText("/review");
  await composer.press("ArrowUp");
  await composer.press("Enter");
  await expect(composer).toHaveValue("/init ");
  await expect(options).toHaveCount(0);
  await expect(page.getByLabel("Sent command")).toHaveCount(0);
  await composer.fill("/rev");
  await expect(options.getByRole("option")).toHaveCount(1);
  await composer.press("Escape");
  await expect(options).toHaveCount(0);
  await expect(composer).toHaveValue("/rev");
  await composer.fill("/");
  await expect(options).toBeVisible();
  await composer.press("Tab");
  await expect(options).toHaveCount(0);
  await composer.focus();
  for (const text of ["Read /review", "/workspace/file.go", "//review", "https://example.com"]) {
    await composer.fill(text);
    await expect(options).toHaveCount(0);
  }
  await composer.dispatchEvent("compositionstart");
  await composer.fill("/review");
  await composer.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true });
  await expect(options).toHaveCount(0);
  await expect(page.getByLabel("Sent command")).toHaveCount(0);
  await composer.dispatchEvent("compositionend");
  await expect(options).toBeVisible();
  await composer.dispatchEvent("keydown", { key: "Enter", code: "Enter", keyCode: 229 });
  await expect(page.getByLabel("Sent command")).toHaveCount(0);
  await expect(composer).toHaveValue("/review");
  await composer.press("Escape");
  await composer.fill("/missing");
  await composer.press("Enter");
  await expect(page.getByText("Unknown command /missing.", { exact: false })).toBeVisible();
  await expect(composer).toHaveValue("/missing");
  await composer.fill("/review @Explore");
  const context = page.getByRole("listbox", { name: "Context results" });
  await expect(context.getByRole("option")).toHaveCount(1);
  await composer.press("Enter");
  await expect(composer).toHaveValue("/review ");
  await expect(page.getByLabel("Draft context")).toContainText("Explore workspace files");
  await composer.fill("/review main");
  const accepted = page.waitForResponse((response) => response.url().endsWith("/messages") && response.request().method() === "POST");
  await composer.press("Enter");
  const response = await accepted;
  expect(response.status()).toBe(202);
  const body = await response.json();
  expect(body.Message.Payload.command).toEqual({ name: "review", arguments: "main", version: 1 });
  expect(body.Message.Payload.runtimeText).toContain("Review target: main");
  await expect(page.getByLabel("Sent command")).toHaveText("Command /review");
  await expect(page.getByLabel("Sent context")).toContainText("Explore workspace files");
  await expect(page.getByText("Saved response 1", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Sent command")).toHaveText("Command /review");
  await composer.fill("@Explore");
  await expect(page.getByRole("listbox", { name: "Context results" }).getByRole("option")).toHaveCount(1);
  await composer.press("Escape");
  await composer.fill("/");
  await expect(options.getByRole("option")).toHaveCount(2);
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(options).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  assert.deepEqual(errors, []);
});

test("new chats execute commands and active work cannot admit another command", async ({ page, backend }) => {
  await logIn(page);
  await page.goto(`${backend.url}/#chats/new`);
  const composer = page.getByLabel("Message", { exact: true });
  await composer.fill("/ini");
  await expect(page.getByRole("listbox", { name: "Commands" }).getByRole("option")).toHaveCount(1);
  await composer.press("Enter");
  await expect(composer).toHaveValue("/init ");
  await composer.fill("/init control work");
  await composer.press("Enter");
  await expect(page.getByLabel("Sent command")).toHaveText("Command /init");
  const id = page.url().split("#chats/")[1];
  const status = await page.evaluate(async (chatID) => {
    const response = await fetch(`/api/chats/${chatID}/messages`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestID: "active-command", text: "/review" }),
    });
    return response.status;
  }, id);
  expect(status).toBe(409);
  const registry = await page.request.get(`/api/commands?chat=${id}`);
  const available: unknown = await registry.json();
  assert.deepEqual(available, { items: [
    { name: "review", label: "Review changes", available: false },
    { name: "init", label: "Update repository instructions", available: false },
  ] });
  await page.getByRole("button", { name: "Interrupt", exact: true }).click();
  await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeVisible();
  const followup = page.getByLabel("Follow-up", { exact: true });
  await followup.fill("//review");
  await followup.press("Enter");
  await expect(page.getByText("Saved response 2", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Sent command")).toHaveCount(1);
});
