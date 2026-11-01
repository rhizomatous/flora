import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  // Control only the browser audio boundary. All chat, event, notification and
  // settings requests use the TLS Go server and its saved runtime fixture.
  await context.addInitScript(() => {
    window.audioDenied = true;
    window.AudioContext = class {
      state = "suspended";
      currentTime = 0;
      destination = {};
      async resume() {
        if (window.audioDenied) throw new DOMException("Autoplay blocked", "NotAllowedError");
        this.state = "running";
      }
      async close() { this.state = "closed"; }
      createOscillator() {
        return { frequency: {}, connect() {}, disconnect() {}, start() {
          sessionStorage.setItem("tones", String(Number(sessionStorage.getItem("tones") || 0) + 1));
        }, stop() {} };
      }
      createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
    };
  });
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("request", r => requests.push(new URL(r.url()).pathname));
  const tones = () => page.evaluate(() => Number(sessionStorage.getItem("tones") || 0));
  const toast = page.getByRole("complementary", { name: "Completion notifications" });
  const sound = page.getByRole("button", { name: "Enable notification sound", exact: true });
  await page.goto(process.env.FLORA_BROWSER_URL);
  await page.getByLabel("Password", { exact: true }).fill("browser test password");
  await page.getByLabel("Password", { exact: true }).press("Enter");
  await sound.focus();
  await page.keyboard.press("Enter");
  await page.getByText(/If sound stays blocked/).waitFor();
  await page.getByRole("link", { name: "New chat", exact: true }).click();
  await page.getByRole("combobox", { name: /^Project/ }).selectOption({ label: "Browser project" });
  await page.getByLabel("Chat title", { exact: true }).fill("Background notification");
  await page.getByLabel("Message", { exact: true }).fill("Complete after I switch conversations");
  await page.getByRole("button", { name: "Start chat", exact: true }).click();
  await page.waitForURL(/#chats\/(?!new)/);
  const chatURL = page.url();
  const chatID = new URL(chatURL).hash.slice("#chats/".length);
  await page.getByRole("heading", { name: "Flora needs your answer", exact: true }).waitFor();
  await page.goto(`${process.env.FLORA_BROWSER_URL}/#chats/${process.env.FLORA_OTHER_CHAT}`);
  await page.getByRole("heading", { name: "Other conversation", exact: true }).waitFor();
  const reply = await context.request.post(`${process.env.FLORA_BROWSER_URL}/api/chats/${chatID}/questions/que_browser/reply`, {
    headers: { Origin: process.env.FLORA_BROWSER_URL }, data: { answers: [["Yes"]] },
  });
  assert.equal(reply.status(), 200);
  await toast.getByRole("link", { name: "Background notification", exact: true }).waitFor();
  assert.equal(await page.getByRole("heading", { name: "Other conversation", exact: true }).count(), 1);
  assert.equal(await tones(), 0);
  await toast.getByRole("link").focus();
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "Background notification", exact: true }).waitFor();
  assert.equal(page.url(), chatURL);
  assert.equal(await page.locator("h1").evaluate(el => el === document.activeElement), true);
  await page.keyboard.press("Tab");
  assert.equal(await page.getByRole("link", { name: "All chats", exact: true }).evaluate(el => el === document.activeElement), true);
  await toast.getByRole("button", { name: /^Dismiss/ }).focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("h1").evaluate(el => el === document.activeElement), true);
  await page.evaluate(() => { window.audioDenied = false; });
  await sound.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Sound enabled for this page", exact: true }).waitFor();
  assert.equal(await tones(), 0, "enabling sound must not replay blocked notifications");

  await page.getByLabel("Follow-up", { exact: true }).fill("Second quick turn");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Installation settings" }).click();
  await context.setOffline(true);
  await page.getByText(/Chat updates and completion notifications disconnected/).waitFor();
  await context.setOffline(false);
  await toast.getByRole("link", { name: "Background notification", exact: true }).waitFor();
  assert.equal(await tones(), 1);
  await context.setOffline(true);
  await page.getByText(/Chat updates and completion notifications disconnected/).waitFor();
  await context.setOffline(false);
  await page.waitForTimeout(2200);
  assert.equal(await tones(), 1, "reconnect replayed audio");
  assert.equal(await toast.getByRole("link").count(), 1);
  await page.reload();
  await sound.waitFor();
  await page.waitForTimeout(1200);
  assert.equal(await toast.getByRole("link").count(), 0, "reload replayed a toast");
  assert.equal(await tones(), 1);
  await page.getByLabel("Play a sound when a chat finishes work").uncheck();
  await page.getByRole("button", { name: "Validate and save", exact: true }).click();
  await page.getByText("Settings saved. Credentials are not shown.", { exact: true }).waitFor();
  assert.equal(await sound.count(), 0);
  await page.goto(chatURL);
  await page.getByLabel("Follow-up", { exact: true }).fill("Silent completion");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await toast.getByRole("link").waitFor();
  assert.equal(await tones(), 1, "sound ignored saved preference");
  await toast.getByRole("button").click();
  await page.getByLabel("Follow-up", { exact: true }).fill("interrupt control work");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.getByRole("button", { name: "Interrupt current work", exact: true }).click();
  await page.getByText("Current work interrupted; send a new message to continue with saved context", { exact: true }).waitFor();
  await page.waitForTimeout(1200);
  assert.equal(await toast.getByRole("link").count(), 0, "interruption was reported as completion");
  assert.equal(requests.includes("/api/chats"), false, "chat list has a duplicate poll");
  await page.setViewportSize({ width: 375, height: 812 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  const realAudio = await browser.newContext({ ignoreHTTPSErrors: true });
  const realPage = await realAudio.newPage();
  await realPage.goto(process.env.FLORA_BROWSER_URL);
  await realPage.getByLabel("Password", { exact: true }).fill("browser test password");
  await realPage.getByLabel("Password", { exact: true }).press("Enter");
  await realPage.getByRole("link", { name: "Installation settings", exact: true }).click();
  await realPage.getByLabel("Play a sound when a chat finishes work").check();
  await realPage.getByRole("button", { name: "Validate and save", exact: true }).click();
  await realPage.getByRole("button", { name: "Enable notification sound", exact: true }).focus();
  await realPage.keyboard.press("Enter");
  await realPage.getByRole("button", { name: "Sound enabled for this page", exact: true }).waitFor();
  await realAudio.close();
  console.log("Chromium: background completion, correct chat keyboard navigation/focus, denied audio guidance, gesture retry, missed completion on reconnect, no replay on reconnect/reload, muted toast, interruption exclusion and shared chat feed passed.");
} finally {
  await browser.close();
}
