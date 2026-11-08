import assert from "node:assert/strict";

import { chromium, expect } from "@playwright/test";

import { openWorkspaceMenu, assertFitsPhone, logIn, pageErrors } from "./browser.ts";

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const errors = pageErrors(page);
  await logIn(page);
  const sidebar = page.locator('[data-slot="sidebar"]');
  await expect(sidebar).toHaveAttribute("data-state", "expanded");
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await expect(sidebar).toHaveAttribute("data-state", "collapsed");
  await page.keyboard.press("ControlOrMeta+b");
  await expect(sidebar).toHaveAttribute("data-state", "expanded");
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "All chats", exact: true })
    .click();
  await page.getByRole("link", { name: "New chat", exact: true }).click();
  await page.getByRole("button", { name: /^Project:/ }).click();
  await page.getByRole("menuitemradio", { name: "Browser project", exact: true }).click();
  await assertFitsPhone(page);
  const message = page.getByLabel("Message", { exact: true });
  const compactHeight = await message.evaluate((element) => element.getBoundingClientRect().height);
  await message.fill("A longer task description.\n".repeat(12));
  assert.ok(
    (await message.evaluate((element) => element.getBoundingClientRect().height)) > compactHeight,
  );
  await message.fill("First browser prompt 🌸");
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole("button", { name: "Start chat", exact: true }).click();
  await page.waitForURL(/#chats\/(?!new)/);
  const chatURL = page.url();
  await page.getByRole("heading", { name: "First browser prompt 🌸", exact: true }).waitFor();
  // Reload during execution. The browser request ending must not cancel work.
  await page.reload();
  await page.getByRole("heading", { name: "Flora needs your answer", exact: true }).waitFor();
  await page.getByRole("radio", { name: /^Yes/ }).check();
  await page.getByRole("button", { name: "Answer and continue", exact: true }).click();
  await page.getByText("Saved response 1", { exact: true }).waitFor();
  await expect(page.locator('[data-slot="message"]').first()).toBeVisible();
  await expect(page.locator('[data-slot="trace"]').first()).toBeVisible();
  await expect(page.locator('[data-slot="markdown"]').first()).toBeVisible();
  assert.equal(
    await page
      .getByLabel("Conversation")
      .getByText("First browser prompt 🌸", { exact: true })
      .count(),
    1,
  );
  await page
    .getByRole("button", { name: /Work details|Worked for/ })
    .first()
    .click();
  await page
    .getByRole("button", { name: /.*bash.*completed/ })
    .first()
    .click();
  assert.match(await page.getByLabel("Conversation").innerText(), /\/workspace/);
  assert.doesNotMatch(await page.locator("body").innerText(), /provider-test-secret/);
  await page.getByLabel("Follow-up", { exact: true }).fill("Continue in this workspace");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.getByText("Saved response 2", { exact: true }).waitFor();
  await page.getByRole("link", { name: "All chats", exact: true }).click();
  await page.getByRole("heading", { name: "Browser project", exact: true }).waitFor();
  await page
    .getByRole("list")
    .getByRole("link", { name: "First browser prompt 🌸", exact: true })
    .click();
  await page.getByText("Saved response 2", { exact: true }).waitFor();
  // Exercise a genuine EventSource reconnect without replacing app API routes.
  await context.setOffline(true);
  await page.waitForTimeout(300);
  await context.setOffline(false);
  await expect(page.getByText("Disconnected. Reconnecting…", { exact: true })).toHaveCount(0);
  await page.reload();
  await page.getByText("Saved response 2", { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel("Conversation").getByText("Saved response 2", { exact: true }).count(),
    1,
  );
  await page.getByRole("note").filter({ hasText: "transient output may be missing" }).waitFor();
  await page.getByLabel("Follow-up", { exact: true }).fill("interrupt control work");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page
    .getByLabel("Conversation")
    .getByText("interrupt control work", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Interrupt", exact: true }).click();
  await page
    .getByText("Current work interrupted; send a new message to continue with saved context", {
      exact: false,
    })
    .waitFor();
  await page.getByLabel("Follow-up", { exact: true }).fill("New explicit work after interruption");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.getByText("Saved response 4", { exact: true }).waitFor();
  await page.getByLabel("Follow-up", { exact: true }).fill("stop control work");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.getByLabel("Conversation").getByText("stop control work", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Chat actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Stop container", exact: true }).click();
  await page.getByRole("button", { name: "Resume", exact: true }).waitFor();
  await page.reload();
  await page.getByLabel("Follow-up", { exact: true }).fill("New explicit work after stop");
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await page.getByText("Saved response 6", { exact: true }).waitFor();
  assert.equal(
    await page
      .getByLabel("Conversation")
      .getByText("First browser prompt 🌸", { exact: true })
      .count(),
    1,
  );
  await assertFitsPhone(page);
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Sidebar", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "All chats", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Sidebar", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Missing container", exact: true }).click();
  await page.getByRole("button", { name: "Continuation unavailable", exact: true }).waitFor();
  assert.equal(await page.getByLabel("Follow-up", { exact: true }).isDisabled(), true);
  assert.equal(
    await page.getByRole("button", { name: "Continuation unavailable", exact: true }).isDisabled(),
    true,
  );
  assert.equal(await page.getByRole("button", { name: "Stop container", exact: true }).count(), 0);
  await page
    .getByLabel("Conversation")
    .getByText("Saved input from the missing container", { exact: true })
    .waitFor();
  assert.doesNotMatch(
    await page.locator("body").innerText(),
    /Send a new message to restart|Send new input to continue/,
  );
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await openWorkspaceMenu(page);
  await page.getByRole("menuitem", { name: "Log out", exact: true }).click();
  await page.goto(chatURL);
  await page.getByRole("heading", { name: "Log in", exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Chromium: login, create, reload during work, question/answer, full tool output, interrupt, stop, explicit resume, saved context, grouped list, reconnect, mobile width, logout protection passed.",
  );
} finally {
  await browser.close();
}
