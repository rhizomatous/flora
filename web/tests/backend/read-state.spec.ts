import { test, expect } from "../fixtures.ts";
import { logIn, pageErrors } from "../helpers.ts";
import { chatSchema, detailSchema } from "../../src/chat-schemas";

test.use({ scenario: "notifications" });

test("read positions sync across tabs and sessions while a bounded bulk action leaves new activity unread", async ({ page, context, browser, backend }, testInfo) => {
  const errors = pageErrors(page);
  await logIn(page);
  await page.goto(`${backend.url}/#chats`);
  const main = page.getByRole("main");
  const otherRow = main.getByRole("link", { name: "Open chat: Other conversation", exact: true });
  await expect(otherRow.getByRole("img", { name: "Unread activity" })).toBeVisible();
  const second = await context.newPage();
  await second.goto(`${backend.url}/#chats`);
  const secondRow = second.getByRole("main").getByRole("link", { name: "Open chat: Other conversation", exact: true });
  await expect(secondRow.getByRole("img", { name: "Unread activity" })).toBeVisible();
  await page.bringToFront();
  await otherRow.click();
  await expect(page.getByRole("heading", { name: "Other conversation", exact: true })).toBeVisible();
  await expect(secondRow.getByRole("img", { name: "Unread activity" })).toHaveCount(0);
  await page.goto(`${backend.url}/#chats`);
  await page.reload();
  await expect(otherRow.getByRole("img", { name: "Unread activity" })).toHaveCount(0);

  const independent = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: backend.url });
  const third = await independent.newPage();
  await logIn(third);
  await third.goto(`${backend.url}/#chats`);
  await expect(third.getByRole("main").getByRole("link", { name: "Open chat: Other conversation", exact: true }).getByRole("img", { name: "Unread activity" })).toHaveCount(0);
  await independent.close();

  const detail = detailSchema.parse(await (await context.request.get(`${backend.url}/api/chats/${backend.otherChatID}`)).json());
  async function create(title: string) {
    const result = await context.request.post(`${backend.url}/api/projects/${detail.chat.ProjectID}/chats`, { headers: { Origin: backend.url }, data: { title, requestID: title, text: title } });
    expect(result.status()).toBe(202);
    return chatSchema.parse(await result.json());
  }
  const waiting = await create("Review release plan");
  const waitingRow = main.getByRole("link", { name: "Open chat: Review release plan", exact: true });
  await expect(waitingRow).toContainText("Needs you");
  await expect(waitingRow.getByRole("img", { name: "Unread activity" })).toBeVisible();
  await page.bringToFront();
  await page.getByRole("button", { name: "Chat list options", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("read-menu-desktop.png"), animations: "disabled" });
  const received = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  await page.route("**/api/chats/read", async (route) => {
    received.resolve();
    await release.promise;
    await route.continue();
  });
  await page.getByRole("menuitem", { name: "Mark all as read", exact: true }).click();
  await received.promise;
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Complete the turn after the direct action captured its observed revisions.
  const reply = await context.request.post(`${backend.url}/api/chats/${waiting.ID}/questions/que_browser/reply`, { headers: { Origin: backend.url }, data: { answers: [["Yes"]] } });
  expect(reply.status()).toBe(200);
  await expect(second.getByRole("main").getByRole("link", { name: "Open chat: Review release plan", exact: true })).toContainText("Idle");
  release.resolve();
  await expect.poll(async () => detailSchema.parse(await (await context.request.get(`${backend.url}/api/chats/${waiting.ID}`)).json()).chat.LastViewedRevision).toBeGreaterThan(0);
  await page.unroute("**/api/chats/read");
  await expect(page.getByRole("button", { name: "Chat list options", exact: true })).toBeFocused();
  await expect(waitingRow.getByRole("img", { name: "Unread activity" })).toBeVisible();
  await expect(second.getByRole("main").getByRole("link", { name: "Open chat: Review release plan", exact: true }).getByRole("img", { name: "Unread activity" })).toBeVisible();
  const saved = detailSchema.parse(await (await context.request.get(`${backend.url}/api/chats/${waiting.ID}`)).json());
  expect(saved.chat.LastViewedRevision).toBeGreaterThan(0);
  expect(saved.chat.LastViewedRevision).toBeLessThan(saved.chat.ActivityRevision ?? 0);
  await expect(page.getByRole("region", { name: "Completion notifications", exact: true }).getByRole("link", { name: "Review release plan", exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("new-activity-unread-desktop.png"), animations: "disabled" });

  const archived = await create("Archived investigation");
  const archive = await context.request.patch(`${backend.url}/api/chats/${archived.ID}`, { headers: { Origin: backend.url }, data: { archived: true, revision: 0 } });
  expect(archive.status()).toBe(200);
  await expect.poll(async () => detailSchema.parse(await (await context.request.get(`${backend.url}/api/chats/${archived.ID}`)).json()).chat.Status).toBe("idle");
  const archivedDetail = detailSchema.parse(await (await context.request.get(`${backend.url}/api/chats/${archived.ID}`)).json());
  expect(archivedDetail.chat.LastViewedRevision).toBe(0);

  const unmatched = await create("Keep this update unread");
  await expect(main.getByRole("link", { name: "Open chat: Keep this update unread", exact: true })).toBeVisible();
  await main.getByRole("button", { name: "Search chats", exact: true }).click();
  await main.getByRole("textbox", { name: "Search chats", exact: true }).fill("Review release plan");
  await expect(main.getByRole("link", { name: "Open chat: Keep this update unread", exact: true })).toHaveCount(0);

  // Retry uses the same observed revisions as the failed direct action.
  await page.route("**/api/chats/read", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Read state unavailable. Try again." }) }));
  await main.getByRole("button", { name: "Mark all as read", exact: true }).click();
  await expect(page.getByText("Read state unavailable. Try again.", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(main.getByRole("button", { name: "Mark all as read", exact: true })).toBeEnabled();
  await page.unroute("**/api/chats/read");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(waitingRow.getByRole("img", { name: "Unread activity" })).toHaveCount(0);
  await expect(second.getByRole("main").getByRole("link", { name: "Open chat: Review release plan", exact: true }).getByRole("img", { name: "Unread activity" })).toHaveCount(0);
  await expect(waitingRow).toContainText("Idle");
  await second.screenshot({ path: testInfo.outputPath("second-tab-read.png"), animations: "disabled" });
  const untouched = detailSchema.parse(await (await context.request.get(`${backend.url}/api/chats/${unmatched.ID}`)).json());
  expect(untouched.chat.LastViewedRevision).toBe(0);
  await main.getByRole("textbox", { name: "Search chats", exact: true }).press("Escape");
  await main.getByRole("combobox", { name: "Chat collection" }).selectOption("archived");
  const archivedRow = main.getByRole("link", { name: "Open chat: Archived investigation", exact: true });
  await expect(archivedRow.getByRole("img", { name: "Unread activity" })).toBeVisible();
  await expect.poll(async () => detailSchema.parse(await (await context.request.get(`${backend.url}/api/chats/${unmatched.ID}`)).json()).chat.Status).toBe("idle");
  await expect(page.getByRole("region", { name: "Completion notifications", exact: true }).getByRole("link", { name: "Archived investigation", exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Completion notifications", exact: true }).getByRole("link", { name: "Keep this update unread", exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath("read-action-mobile.png"), animations: "disabled" });
  await main.getByRole("button", { name: "Mark all as read", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(archivedRow.getByRole("img", { name: "Unread activity" })).toHaveCount(0);
  await expect(archivedRow).toContainText("Idle");
  await expect(main.getByRole("button", { name: "Mark all as read", exact: true })).toBeDisabled();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  expect(errors).toEqual([]);
  await second.close();
});

test.describe("failed attention", () => {
  test.use({ scenario: "chat" });
  test("reading a failed chat keeps its failure indicator", async ({ page, backend }) => {
    await logIn(page);
    await page.goto(`${backend.url}/#chats`);
    const row = page.getByRole("main").getByRole("link", { name: "Open chat: Missing container", exact: true });
    await expect(row.getByRole("img", { name: "Unread activity" })).toBeVisible();
    await page.getByRole("main").getByRole("button", { name: "Mark all as read", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(row.getByRole("img", { name: "Unread activity" })).toHaveCount(0);
    await expect(row).toContainText("Failed");
    await expect(row.locator(".sidebar-status")).toHaveAttribute("data-tone", "failed");
    await expect(row.locator(".sidebar-status")).toHaveAttribute("data-filled");
  });
});


test("reading a waiting chat preserves its attention indicator", async ({ page, backend }, testInfo) => {
  await logIn(page);
  await page.getByRole("link", { name: "New chat", exact: true }).click();
  await page.getByLabel("Message", { exact: true }).fill("Waiting for a release decision");
  await page.getByRole("button", { name: "Start chat", exact: true }).click();
  await expect(page.getByRole("form", { name: "Questions", exact: true })).toBeVisible();
  await page.goto(`${backend.url}/#chats`);
  const row = page.getByRole("main").getByRole("link", { name: "Open chat: Waiting for a release decision", exact: true });
  await expect(row.getByRole("img", { name: "Unread activity" })).toHaveCount(0);
  await expect(row).toContainText("Needs you");
  await expect(row.locator(".sidebar-status")).toHaveAttribute("data-tone", "attention");
  await expect(row.locator(".sidebar-status")).toHaveAttribute("data-filled");
  await page.screenshot({ path: testInfo.outputPath("waiting-read-desktop.png"), animations: "disabled" });
});
