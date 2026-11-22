import { test, expect } from "../fixtures.ts";
import { logIn, pageErrors } from "../helpers.ts";

test.use({ scenario: "model-summary" });

test("a failed model save preserves the choice and unsent message", async ({ page, backend }) => {
  await logIn(page);
  await page.goto(`/#chats/${backend.chatID}`);
  await page.getByLabel("Follow-up", { exact: true }).fill("Keep this message");
  let failSave: (() => void) | undefined;
  const released = new Promise<void>((resolve) => { failSave = resolve; });
  await page.route(`**/api/chats/${backend.chatID}/model`, async (route) => {
    await released;
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Cannot save this model right now." }) });
  });
  await page.getByRole("button", { name: "Model: Claude Haiku 4.5", exact: true }).click();
  await page.getByRole("option", { name: "Claude Sonnet 4.6", exact: true }).click();
  await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Model: Claude Haiku 4.5", exact: true })).toBeDisabled();
  failSave?.();
  await expect(page.getByText("Cannot save this model right now.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Model: Claude Haiku 4.5", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeEnabled();
  await expect(page.getByLabel("Follow-up", { exact: true })).toHaveValue("Keep this message");
});

test("one saved chat model applies before sending and survives a fresh browser session", async ({ page, backend, browser }) => {
  await logIn(page);
  await page.goto(`/#chats/${backend.chatID}`);
  await page.getByRole("button", { name: "Model: Claude Haiku 4.5", exact: true }).click();
  await page.getByRole("option", { name: "Claude Sonnet 4.6", exact: true }).click();
  await expect(page.getByRole("button", { name: "Model: Claude Sonnet 4.6", exact: true })).toBeFocused();
  await page.getByLabel("Follow-up", { exact: true }).fill("Keep this follow-up draft");
  const title = page.getByRole("button", { name: "Review keyboard navigation", exact: true });
  const label = "Chat model: anthropic / claude-sonnet-4-6";
  await title.focus();
  const summary = page.getByLabel("Chat summary", { exact: true });
  await expect(summary.getByRole("img", { name: label, exact: true })).toHaveText("Claude Sonnet 4.6");
  await expect(summary).not.toContainText("2 models");
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: /Review keyboard navigation/ }).focus();
  await expect(page.locator(".sidebar-chat-preview").getByRole("img", { name: label, exact: true })).toHaveText("Claude Sonnet 4.6");
  await page.reload();
  await expect(page.getByRole("button", { name: "Model: Claude Sonnet 4.6", exact: true })).toBeVisible();
  await expect(page.getByLabel("Follow-up", { exact: true })).toHaveValue("Keep this follow-up draft");
  await title.focus();
  await expect(summary.getByRole("img", { name: label, exact: true })).toHaveText("Claude Sonnet 4.6");
  const detail = await (await page.request.get(`/api/chats/${backend.chatID}`)).json();
  expect(detail.chat.Execution.model).toBe("claude-sonnet-4-6");
  expect(detail.messages).toHaveLength(2);
  const otherContext = await browser.newContext({ storageState: await page.context().storageState(), ignoreHTTPSErrors: true });
  try {
    const otherPage = await otherContext.newPage();
    await otherPage.goto(`${backend.url}/#chats/${backend.chatID}`);
    await expect(otherPage.getByRole("button", { name: "Model: Claude Sonnet 4.6", exact: true })).toBeVisible();
  } finally {
    await otherContext.close();
  }
  expect(detail.chat.reportedModel.latest.model).toBe("claude-haiku-4-5");
});

test("saved composer model agrees across title and sidebar after reload", async ({ page, backend }) => {
  const errors = pageErrors(page);
  await logIn(page);
  await page.goto(`/#chats/${backend.chatID}`);
  const title = page.getByRole("button", { name: "Review keyboard navigation", exact: true });
  const label = "Chat model: anthropic / claude-haiku-4-5";
  await title.focus();
  await expect(page.getByRole("img", { name: label, exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: label, exact: true })).toHaveText("Claude Haiku 4.5");
  await page.keyboard.press("Escape");
  const link = page.getByRole("link", { name: /Review keyboard navigation/ });
  await link.focus();
  await expect(page.locator(".sidebar-chat-preview").getByRole("img", { name: label, exact: true })).toBeVisible();
  await expect(page.locator(".sidebar-chat-preview")).toContainText("Check keyboard focus");
  await page.reload();
  await title.focus();
  await expect(page.getByRole("img", { name: label, exact: true })).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  await expect.poll(async () => await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByRole("img", { name: label, exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.goto(`/#chats/${backend.otherChatID}`);
  await page.getByRole("button", { name: "Plan the next task", exact: true }).focus();
  await expect(page.getByRole("img", { name: "Chat model: anthropic / model", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("long identities and unknown metadata fit summary cards in both themes", async ({ page }, testInfo) => {
  await logIn(page);
  await page.getByRole("link", { name: /Inspect a custom model/ }).click();
  const title = page.getByRole("button", { name: "Inspect a custom model", exact: true });
  for (const dark of [true, false]) {
    await page.evaluate((enabled) => { document.documentElement.classList.toggle("dark", enabled); }, dark);
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 812 });
      await title.focus();
      const summary = page.getByLabel("Chat summary", { exact: true });
      await expect(summary).toBeVisible();
      await expect(summary.getByRole("img", { name: /anthropic \/ custom-model-with-a-long/ })).toBeVisible();
      await expect.poll(async () => {
        const bounds = await summary.boundingBox();
        return bounds !== null && bounds.x >= 0 && bounds.x + bounds.width <= width;
      }).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`summary-${dark ? "dark" : "light"}-${width}.png`), animations: "disabled" });
      await page.keyboard.press("Escape");
      await title.blur();
      await expect(summary).toHaveCount(0);
    }
  }
  await page.setViewportSize({ width: 1280, height: 812 });
  await page.getByRole("link", { name: /Check an older response/ }).click();
  await page.getByRole("button", { name: "Check an older response", exact: true }).focus();
  await expect(page.getByLabel("Chat summary", { exact: true }).getByRole("img", { name: "Chat model: anthropic / model", exact: true })).toBeVisible();
  await expect(page.getByText("No linked pull requests yet.", { exact: true })).toHaveCount(0);
});
