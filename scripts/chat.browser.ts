import assert from "node:assert/strict";

import { chromium } from "@playwright/test";

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(process.env.FLORA_BROWSER_URL);
  await page.getByLabel("Password", { exact: true }).fill("browser test password");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Chats", exact: true })
    .click();
  await page.getByRole("link", { name: "New chat", exact: true }).click();
  await page.getByRole("combobox", { name: /^Project/ }).selectOption({ label: "Browser project" });
  await page.getByLabel("Chat title", { exact: true }).fill("Browser persistence");
  await page.getByLabel("Message", { exact: true }).fill("First browser prompt 🌸");
  await page.getByRole("button", { name: "Start chat", exact: true }).click();
  await page.waitForURL(/#chats\/(?!new)/);
  const chatURL = page.url();
  await page.getByRole("heading", { name: "Browser persistence", exact: true }).waitFor();
  // Reload during execution. The browser request ending must not cancel work.
  await page.reload();
  await page.getByRole("heading", { name: "Flora needs your answer", exact: true }).waitFor();
  await page.getByRole("radio", { name: /^Yes/ }).check();
  await page.getByRole("button", { name: "Answer and continue", exact: true }).click();
  await page.getByText("Saved response 1", { exact: true }).waitFor();
  await page.getByText("anthropic/model", { exact: true }).waitFor();
  assert.equal(
    await page
      .getByLabel("Conversation")
      .getByText("First browser prompt 🌸", { exact: true })
      .count(),
    1,
  );
  assert.match(await page.getByLabel("Conversation").innerText(), /\/workspace/);
  assert.doesNotMatch(await page.locator("body").innerText(), /provider-test-secret/);
  await page.getByLabel("Follow-up", { exact: true }).fill("Continue in this workspace");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.getByText("Saved response 2", { exact: true }).waitFor();
  await page.getByRole("link", { name: "All chats", exact: true }).click();
  await page.getByRole("heading", { name: "Browser project", exact: true }).waitFor();
  await page
    .getByRole("list")
    .getByRole("link", { name: "Browser persistence", exact: true })
    .click();
  await page.getByText("Saved response 2", { exact: true }).waitFor();
  // Exercise a genuine EventSource reconnect without replacing app API routes.
  await context.setOffline(true);
  await page.waitForTimeout(300);
  await context.setOffline(false);
  await page.getByText(/^Live ·/).waitFor();
  await page.reload();
  await page.getByText("Saved response 2", { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel("Conversation").getByText("Saved response 2", { exact: true }).count(),
    1,
  );
  await page.getByRole("note").filter({ hasText: "Transient output may be missing" }).waitFor();
  await page.getByLabel("Follow-up", { exact: true }).fill("interrupt control work");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page
    .getByLabel("Conversation")
    .getByText("interrupt control work", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Interrupt current work", exact: true }).click();
  await page
    .getByText("Current work interrupted; send a new message to continue with saved context", {
      exact: true,
    })
    .waitFor();
  await page.getByLabel("Follow-up", { exact: true }).fill("New explicit work after interruption");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.getByText("Saved response 4", { exact: true }).waitFor();
  await page.getByLabel("Follow-up", { exact: true }).fill("stop control work");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.getByLabel("Conversation").getByText("stop control work", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Stop container", exact: true }).click();
  await page.getByRole("button", { name: "Resume with new message", exact: true }).waitFor();
  await page.reload();
  await page.getByLabel("Follow-up", { exact: true }).fill("New explicit work after stop");
  await page.getByRole("button", { name: "Resume with new message", exact: true }).click();
  await page.getByText("Saved response 6", { exact: true }).waitFor();
  assert.equal(
    await page
      .getByLabel("Conversation")
      .getByText("First browser prompt 🌸", { exact: true })
      .count(),
    1,
  );
  await page.setViewportSize({ width: 375, height: 812 });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
  );
  await page.getByRole("link", { name: "All chats", exact: true }).click();
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
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await page.goto(chatURL);
  await page.getByRole("heading", { name: "Log in", exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Chromium: login, create, reload during work, question/answer, full tool output/model, interrupt, stop, explicit resume, saved context, grouped list, reconnect, mobile width, logout protection passed.",
  );
} finally {
  await browser.close();
}
