import { test, expect } from "../fixtures.ts";
import { assertFitsPhone, logIn, pageErrors } from "../helpers.ts";

test.use({ scenario: "chat" });

test("attachments survive reload and an uncertain acceptance, and reopen after stopping", async ({ page }, testInfo) => {
  const errors = pageErrors(page);
  await logIn(page);
  await page.getByRole("link", { name: "New chat", exact: true }).click();
  const screenshot = await page.screenshot();
  await page.getByRole("button", { name: "Add attachments and context", exact: true }).click();
  await page.getByRole("menuitem", { name: "Upload attachment", exact: true }).focus();
  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("Enter");
  await (await chooser).setFiles([
    { name: "screenshot.png", mimeType: "image/png", buffer: screenshot },
    { name: "requirements.md", mimeType: "text/markdown", buffer: Buffer.from("# Task\nUse the screenshot to improve the page.") },
  ]);
  await expect(page.getByRole("link", { name: "Open screenshot.png", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start chat", exact: true })).toBeEnabled();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("attachments-desktop.png") });
  await page.locator(".composer-box").screenshot({ path: testInfo.outputPath("attachments-composer-desktop.png") });
  await assertFitsPhone(page);
  await page.screenshot({ path: testInfo.outputPath("attachments-narrow.png") });
  await page.locator(".composer-box").screenshot({ path: testInfo.outputPath("attachments-composer-narrow.png") });
  await page.reload();
  await expect(page.getByRole("link", { name: "Open requirements.md", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start chat", exact: true })).toBeEnabled();
  // The server accepts this turn, but its response never reaches the browser.
  await page.route("**/api/projects/*/chats", async (route) => {
    await route.fetch();
    await route.abort("failed");
  }, { times: 1 });
  await page.getByRole("button", { name: "Start chat", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Start chat", exact: true }).click();
  await page.waitForURL(/#chats\/(?!new)/u);
  await page.getByRole("form", { name: "Questions", exact: true }).waitFor();
  await page.getByRole("radio", { name: /^Yes/u }).check();
  await page.getByRole("button", { name: "Answer and continue", exact: true }).click();
  await expect(page.getByText("Saved response 1", { exact: true })).toBeVisible();
  const conversation = page.getByLabel("Conversation", { exact: true });
  await expect(conversation.getByRole("link", { name: "Open screenshot.png", exact: true })).toHaveCount(1);
  await expect(conversation.getByRole("link", { name: "Open requirements.md", exact: true })).toHaveCount(1);
  await expect(page.getByLabel("Draft attachments", { exact: true })).toHaveCount(0);
  await page.getByLabel("Follow-up", { exact: true }).fill("Use these additional requirements");
  await page.getByLabel("Choose attachments", { exact: true }).setInputFiles({ name: "followup.txt", mimeType: "text/plain", buffer: Buffer.from("Keep keyboard support") });
  await expect(page.getByRole("link", { name: "Open followup.txt", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Follow-up", { exact: true })).toHaveValue("Use these additional requirements");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByText("Saved response 2", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Follow-up", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Draft attachments", { exact: true })).toHaveCount(0);
  const savedURL = await conversation.getByRole("link", { name: "Open screenshot.png", exact: true }).getAttribute("href");
  expect(savedURL).toBeTruthy();
  const chatID = page.url().split("#chats/")[1];
  const origin = new URL(page.url()).origin;
  expect((await page.request.post(`/api/chats/${chatID}/stop`, { headers: { Origin: origin } })).status()).toBe(200);
  await page.reload();
  await expect(conversation.getByRole("link", { name: "Open screenshot.png", exact: true })).toBeVisible();
  expect((await page.request.get(savedURL ?? "")).status()).toBe(200);
  await page.screenshot({ path: testInfo.outputPath("attachments-saved-narrow.png") });
  expect((await page.request.post("/api/auth/logout", { headers: { Origin: origin } })).status()).toBe(200);
  expect((await page.request.get(savedURL ?? "")).status()).toBe(401);
  expect(errors).toEqual([]);
});

test("failed uploads retry, cancellation removes files, and invalid content blocks sending", async ({ page }, testInfo) => {
  await logIn(page);
  await page.getByRole("link", { name: "New chat", exact: true }).click();
  const input = page.getByLabel("Choose attachments", { exact: true });
  await input.setInputFiles({ name: "unsupported.exe", mimeType: "application/octet-stream", buffer: Buffer.from("binary") });
  await expect(page.getByRole("alert")).toContainText("Supported files");
  await page.route("**/api/projects/*/attachments/*", async (route) => { await route.abort(); }, { times: 1 });
  await input.setInputFiles({ name: "retry.txt", mimeType: "text/plain", buffer: Buffer.from("task") });
  await page.getByRole("button", { name: "Retry retry.txt", exact: true }).click();
  await expect(page.getByRole("link", { name: "Open retry.txt", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Remove retry.txt", exact: true }).click();
  await expect(page.getByRole("link", { name: "Open retry.txt", exact: true })).toHaveCount(0);
  let finishUpload: (() => void) | undefined;
  const uploadHold = new Promise<void>((resolve) => { finishUpload = resolve; });
  await page.route("**/api/projects/*/attachments/*", async (route) => { await uploadHold; await route.continue(); }, { times: 1 });
  await input.setInputFiles({ name: "cancel.txt", mimeType: "text/plain", buffer: Buffer.from("cancel") });
  await expect(page.getByText("Uploading…", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel upload of cancel.txt", exact: true }).click();
  finishUpload?.();
  await expect(page.getByLabel("Draft attachments", { exact: true })).toHaveCount(0);
  await input.setInputFiles({ name: "broken.png", mimeType: "image/png", buffer: Buffer.from("not an image") });
  await expect(page.getByRole("alert")).toContainText("Choose a valid PNG");
  await expect(page.getByRole("button", { name: "Start chat", exact: true })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath("attachments-error.png") });
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("Upload unavailable. Remove it and choose the file again.");
  await page.getByRole("button", { name: "Remove broken.png", exact: true }).click();
  await input.setInputFiles({ name: "too-large.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(5 * 1024 * 1024 + 1) });
  await expect(page.getByRole("alert")).toContainText("at most 5 MiB");
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.items.add(new File(["pasted requirements"], "pasted.txt", { type: "text/plain" }));
    document.querySelector("#new-chat-message")?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(page.getByRole("link", { name: "Open pasted.txt", exact: true })).toBeVisible();
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.items.add(new File(["dropped requirements"], "dropped.txt", { type: "text/plain" }));
    document.querySelector("#new-chat-message")?.closest('[data-slot="input-group"]')?.dispatchEvent(new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }));
  });
  await expect(page.getByRole("link", { name: "Open dropped.txt", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start chat", exact: true })).toBeEnabled();
});


test("unsupported model content is reported before submission", async ({ page }) => {
  await logIn(page);
  await page.getByRole("link", { name: "New chat", exact: true }).click();
  await page.route("**/api/attachments/policy", async (route) => {
    await route.fulfill({ json: { image: false, pdf: false, reason: "The configured model does not support images or PDFs." } });
  });
  await page.getByLabel("Choose attachments", { exact: true }).setInputFiles({ name: "spec.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\n") });
  await expect(page.getByRole("alert")).toContainText("The configured model does not support images or PDFs.");
  await page.getByLabel("Message", { exact: true }).fill("Use this document");
  await expect(page.getByRole("button", { name: "Start chat", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Remove spec.pdf", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start chat", exact: true })).toBeEnabled();
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue("Use this document");
});
