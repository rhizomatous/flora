import { publicChatID, openWorkspaceMenu, openSettings, assertFitsPhone, logIn, pageErrors,  } from "../helpers.ts";

import assert from "node:assert/strict";

import { test, expect } from "../fixtures.ts";

import { chatSchema, detailSchema } from "../../src/chat-schemas";

test.use({ scenario: "notifications" });

test("completion notifications, reconnects, and sound preferences", async ({ page, context, browser, backend }) => {
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
  const errors = pageErrors(page);
  const requests: string[] = [];
  page.on("request", (r) => {
    requests.push(new URL(r.url()).pathname);
  });
  const tones = () => page.evaluate(() => Number(sessionStorage.getItem("tones") ?? 0));
  const toast = page.getByRole("region", { name: "Completion notifications", exact: true });
  const sound = page.getByRole("menuitem", { name: "Enable notification sound", exact: true });
  await logIn(page, "enter");
  await openWorkspaceMenu(page);
  await sound.focus();
  await page.keyboard.press("Enter");
  await page.getByText(/Allow sound or autoplay/).waitFor();
  await page.getByRole("link", { name: "New chat", exact: true }).click();
  await page.getByRole("button", { name: /^Project:/ }).click();
  await page.getByRole("menuitem", { name: "Browser project", exact: true }).click();
  await page.getByLabel("Message", { exact: true }).fill("Complete after I switch conversations");
  await page.getByRole("button", { name: "Start chat", exact: true }).click();
  await page.waitForURL(/#chats\/(?!new)/);
  const chatURL = page.url();
  const chatID = new URL(chatURL).hash.slice("#chats/".length);
  await page.getByRole("form", { name: "Questions", exact: true }).waitFor();
  await page.goto(`${backend.url}/#chats/${await publicChatID(page, backend.otherChatID)}`);
  await page.getByRole("heading", { name: "Other conversation", exact: true }).waitFor();
  const reply = await context.request.post(
    `${backend.url}/api/chats/${chatID}/questions/que_browser/reply`,
    {
      headers: { Origin: backend.url },
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
  await expect(toast.getByRole("link")).toHaveCount(0);
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
  await page.getByRole("button", { name: "Save preferences", exact: true }).click();
  await page.getByText("Settings saved. Credentials are not shown.", { exact: true }).waitFor();
  assert.equal(await sound.count(), 0);
  await page.goto(chatURL);
  await page.getByLabel("Follow-up", { exact: true }).fill("Silent completion");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await toast.getByRole("link").waitFor();
  assert.equal(await tones(), 1, "sound ignored saved preference");
  await page.getByLabel("Follow-up", { exact: true }).focus();
  await toast.getByRole("button", { name: "Dismiss completion", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(toast.getByRole("link")).toHaveCount(0);
  await expect(page.getByLabel("Follow-up", { exact: true })).toBeFocused();
  await page.getByLabel("Follow-up", { exact: true }).fill("interrupt control work");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.getByRole("button", { name: "Interrupt", exact: true }).click();
  await page
    .getByText("Current work interrupted; send a new message to continue with saved context", {
      exact: false,
    })
    .waitFor();
  await page.waitForTimeout(1200);
  assert.equal(await toast.getByRole("link").count(), 0, "interruption was reported as completion");
  assert.equal(requests.includes("/api/chats"), false, "chat list has a duplicate poll");
  await assertFitsPhone(page);
  assert.deepEqual(errors, []);
  const realAudio = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: backend.url });
  const realPage = await realAudio.newPage();
  await logIn(realPage, "enter");
  await openSettings(realPage);
  await realPage.getByLabel("Play a sound when a chat finishes work").check();
  await realPage.getByRole("button", { name: "Save preferences", exact: true }).click();
  await openWorkspaceMenu(realPage);
  await realPage.getByRole("menuitem", { name: "Enable notification sound", exact: true }).focus();
  await realPage.keyboard.press("Enter");
  await realPage
    .getByRole("menuitem", { name: "Sound enabled for this page", exact: true })
    .waitFor();
  await realAudio.close();
});

test.describe("completion toast stack", () => {
  test.use({ scenario: "branches" });

  test("stacks compactly, pauses during interaction, and expires without reading chats or moving focus", async ({ page }, testInfo) => {
    const errors = pageErrors(page);
    await logIn(page);
    await expect(page.getByRole("heading", { name: "New chat", exact: true })).toBeVisible();
    const projects = (await (await page.request.get("/api/projects")).json()) as { id: string }[];
    const titles = [
      "Describe this repo",
      "Review the release checklist",
      "Check the completed implementation and review the remaining release tasks across all of the workspace projects",
    ] as const;
    const notifications = page.getByRole("region", { name: "Completion notifications", exact: true });
    const cards = notifications.getByRole("listitem");
    const chats: string[] = [];
    // The fixture runtime shares a session, so finish each turn before starting the next.
    for (const title of titles) {
      const response = await page.request.post(`/api/projects/${projects[0]!.id}/chats`, {
        headers: { Origin: new URL(page.url()).origin },
        data: { title, requestID: title, text: "Plan the release" },
      });
      expect(response.status()).toBe(202);
      chats.push(chatSchema.parse(await response.json()).ID);
      await expect(notifications.getByRole("link", { name: title, exact: true })).toBeVisible();
      await cards.first().hover();
    }
    await expect(cards).toHaveCount(3);
    await page.mouse.move(0, 0);
    await expect(cards.first()).toHaveAttribute("data-expanded", "false");
    await expect(cards.first()).toHaveAttribute("data-type", "success");
    await expect(cards.first()).toContainText("Work complete");
    await page.screenshot({ path: testInfo.outputPath("completion-stack-desktop.png"), animations: "disabled" });

    await cards.first().hover();
    await expect(cards.last()).toHaveAttribute("data-expanded", "true");
    await page.waitForTimeout(7000);
    await expect(cards).toHaveCount(3);
    await page.screenshot({ path: testInfo.outputPath("completion-stack-expanded.png"), animations: "disabled" });

    await page.mouse.move(0, 0);
    await page.getByLabel("Message", { exact: true }).focus();
    await notifications.getByRole("link", { name: titles[0], exact: true }).focus();
    await expect(cards.first()).toHaveAttribute("data-expanded", "true");
    await page.waitForTimeout(7000);
    await expect(cards).toHaveCount(3);

    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ path: testInfo.outputPath("completion-stack-mobile-dark.png"), animations: "disabled" });
    await page.evaluate(() => document.documentElement.classList.remove("dark"));
    await page.screenshot({ path: testInfo.outputPath("completion-stack-mobile-light.png"), animations: "disabled" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: testInfo.outputPath("completion-stack-desktop-light.png"), animations: "disabled" });
    await assertFitsPhone(page);
    for (const card of await cards.all()) {
      const bounds = await card.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(375);
      expect(bounds!.height).toBeLessThanOrEqual(100);
    }

    const composer = page.getByLabel("Message", { exact: true });
    await composer.focus();
    await composer.fill("Keep this draft and its focus");
    await expect(composer).toBeFocused();
    await expect(cards.first()).toHaveAttribute("data-expanded", "false");
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(7000);
    await expect(cards).toHaveCount(3);
    await page.evaluate(() => {
      Reflect.deleteProperty(document, "hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(5000);
    await expect(cards).toHaveCount(3);
    await page.waitForTimeout(2000);
    await expect(cards).toHaveCount(0);
    await expect(composer).toBeFocused();
    await expect(composer).toHaveValue("Keep this draft and its focus");
    for (const chat of chats) {
      const detail = detailSchema.parse(await (await page.request.get(`/api/chats/${chat}`)).json());
      expect(detail.chat.LastViewedRevision ?? 0).toBe(0);
      expect(detail.chat.ActivityRevision).toBeGreaterThan(0);
    }
    await page.waitForTimeout(2000);
    await expect(cards).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
