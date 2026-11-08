import assert from "node:assert/strict";

import { chromium } from "@playwright/test";

import {
  openWorkspaceMenu,
  openSettings,
  assertFitsPhone,
  logIn,
  origin,
  pageErrors,
  requiredEnv,
} from "./browser.ts";

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  // Control only the browser audio boundary. All chat, event, notification and
  // settings requests use the TLS Go server and its saved runtime fixture.
  await context.addInitScript(() => {
    window.audioDenied = true;
    // Tones are counted in sessionStorage so the count survives page reloads.
    class FakeAudioContext {
      state: AudioContextState = "suspended";
      currentTime = 0;
      destination = {};
      resume() {
        if (window.audioDenied) {
          return Promise.reject(new DOMException("Autoplay blocked", "NotAllowedError"));
        }
        this.state = "running";
        return Promise.resolve();
      }
      close() {
        this.state = "closed";
        return Promise.resolve();
      }
      createOscillator() {
        return {
          frequency: {},
          connect() {},
          disconnect() {},
          addEventListener() {},
          start() {
            const count = Number(sessionStorage.getItem("tones") ?? 0);
            sessionStorage.setItem("tones", String(count + 1));
          },
          stop() {},
        };
      }
      createGain() {
        return {
          gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
          connect() {},
          disconnect() {},
        };
      }
    }
    // The fake implements only the members the app's completion sound uses.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Intentional partial fake of a DOM class.
    window.AudioContext = FakeAudioContext as unknown as typeof AudioContext;
  });
  const page = await context.newPage();
  const errors = pageErrors(page);
  const requests: string[] = [];
  page.on("request", (r) => {
    requests.push(new URL(r.url()).pathname);
  });
  const tones = () => page.evaluate(() => Number(sessionStorage.getItem("tones") ?? 0));
  const toast = page.getByRole("complementary", { name: "Completion notifications" });
  const sound = page.getByRole("menuitem", { name: "Enable notification sound", exact: true });
  await logIn(page, "enter");
  await openWorkspaceMenu(page);
  await sound.focus();
  await page.keyboard.press("Enter");
  await page.getByText(/Allow sound or autoplay/).waitFor();
  await page.getByRole("link", { name: "New chat", exact: true }).click();
  await page.getByRole("button", { name: /^Project:/ }).click();
  await page.getByRole("menuitemradio", { name: "Browser project", exact: true }).click();
  await page.getByLabel("Message", { exact: true }).fill("Complete after I switch conversations");
  await page.getByRole("button", { name: "Start chat", exact: true }).click();
  await page.waitForURL(/#chats\/(?!new)/);
  const chatURL = page.url();
  const chatID = new URL(chatURL).hash.slice("#chats/".length);
  await page.getByRole("heading", { name: "Flora needs your answer", exact: true }).waitFor();
  await page.goto(`${origin}/#chats/${requiredEnv("FLORA_OTHER_CHAT")}`);
  await page.getByRole("heading", { name: "Other conversation", exact: true }).waitFor();
  const reply = await context.request.post(
    `${origin}/api/chats/${chatID}/questions/que_browser/reply`,
    {
      headers: { Origin: origin },
      data: { answers: [["Yes"]] },
    },
  );
  assert.equal(reply.status(), 200);
  await toast
    .getByRole("link", { name: "Complete after I switch conversations", exact: true })
    .waitFor();
  assert.equal(
    await page.getByRole("heading", { name: "Other conversation", exact: true }).count(),
    1,
  );
  assert.equal(await tones(), 0);
  await toast.getByRole("link").focus();
  await page.keyboard.press("Enter");
  await page
    .getByRole("heading", { name: "Complete after I switch conversations", exact: true })
    .waitFor();
  assert.equal(page.url(), chatURL);
  assert.equal(await page.locator("h1").evaluate((el) => el === document.activeElement), true);
  await page.keyboard.press("Tab");
  assert.equal(
    await page.locator("main").evaluate((el) => el.contains(document.activeElement)),
    true,
  );
  await toast.getByRole("button", { name: /^Dismiss/ }).focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("h1").evaluate((el) => el === document.activeElement), true);
  await page.evaluate(() => {
    window.audioDenied = false;
  });
  await openWorkspaceMenu(page);
  await sound.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("menuitem", { name: "Sound enabled for this page", exact: true }).waitFor();
  assert.equal(await tones(), 0, "enabling sound must not replay blocked notifications");

  await page.getByLabel("Follow-up", { exact: true }).fill("Second quick turn");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await openSettings(page);
  await context.setOffline(true);
  await page.getByText(/Chat updates and completion notifications disconnected/).waitFor();
  await context.setOffline(false);
  await toast
    .getByRole("link", { name: "Complete after I switch conversations", exact: true })
    .waitFor();
  assert.equal(await tones(), 1);
  await context.setOffline(true);
  await page.getByText(/Chat updates and completion notifications disconnected/).waitFor();
  await context.setOffline(false);
  await page.waitForTimeout(2200);
  assert.equal(await tones(), 1, "reconnect replayed audio");
  assert.equal(await toast.getByRole("link").count(), 1);
  await page.reload();
  await openWorkspaceMenu(page);
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
  await page
    .getByText("Current work interrupted; send a new message to continue with saved context", {
      exact: true,
    })
    .waitFor();
  await page.waitForTimeout(1200);
  assert.equal(await toast.getByRole("link").count(), 0, "interruption was reported as completion");
  assert.equal(requests.includes("/api/chats"), false, "chat list has a duplicate poll");
  await assertFitsPhone(page);
  assert.deepEqual(errors, []);
  const realAudio = await browser.newContext({ ignoreHTTPSErrors: true });
  const realPage = await realAudio.newPage();
  await logIn(realPage, "enter");
  await openSettings(realPage);
  await realPage.getByLabel("Play a sound when a chat finishes work").check();
  await realPage.getByRole("button", { name: "Validate and save", exact: true }).click();
  await openWorkspaceMenu(realPage);
  await realPage.getByRole("menuitem", { name: "Enable notification sound", exact: true }).focus();
  await realPage.keyboard.press("Enter");
  await realPage
    .getByRole("menuitem", { name: "Sound enabled for this page", exact: true })
    .waitFor();
  await realAudio.close();
  console.log(
    "Chromium: background completion, correct chat keyboard navigation/focus, denied audio guidance, gesture retry, missed completion on reconnect, no replay on reconnect/reload, muted toast, interruption exclusion and shared chat feed passed.",
  );
} finally {
  await browser.close();
}
