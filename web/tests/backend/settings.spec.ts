import assert from "node:assert/strict";

import { test, expect } from "@playwright/test";

import { openWorkspaceMenu, openSettings, assertFitsPhone, logIn, pageErrors } from "../helpers.ts";

test("settings persistence, credential rotation, and completion sounds", async ({ page }) => {
  const errors = pageErrors(page);
  await page.addInitScript(() => {
    window.tones = 0;
    class FakeAudioContext {
      state: AudioContextState = "running";
      currentTime = 0;
      destination = {};
      resume() {
        return Promise.resolve();
      }
      close() {
        return Promise.resolve();
      }
      createOscillator() {
        return {
          frequency: {},
          connect() {},
          disconnect() {},
          addEventListener() {},
          start() {
            window.tones++;
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
  await logIn(page);
  const workspaceMenu = page.getByRole("button", { name: "Workspace menu", exact: true });
  await workspaceMenu.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "Settings", exact: true })).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.getByRole("menuitem", { name: "Log out", exact: true })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(page.getByRole("menuitem", { name: "Settings", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(workspaceMenu).toBeFocused();
  await openWorkspaceMenu(page);
  await page.getByLabel("Message", { exact: true }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await openWorkspaceMenu(page);
  await page.getByRole("menuitem", { name: "Enable notification sound", exact: true }).click();
  await page.getByRole("link", { name: "New chat", exact: true }).click();
  await page.getByRole("button", { name: /^Project:/ }).click();
  await page.getByRole("button", { name: "Browser project", exact: true }).click();
  await page.getByLabel("Message", { exact: true }).fill("Sound enabled");
  await page.getByRole("button", { name: "Start chat", exact: true }).click();
  await page.getByRole("form", { name: "Questions", exact: true }).waitFor();
  await page.waitForTimeout(1200);
  assert.equal(await page.evaluate(() => window.tones), 0);
  await page.getByRole("radio", { name: /^Yes/ }).check();
  await page.getByRole("button", { name: "Answer and continue", exact: true }).click();
  await page.waitForFunction(() => window.tones === 1);
  await page.getByLabel("Follow-up", { exact: true }).fill("interrupt control work");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page
    .getByLabel("Conversation")
    .getByText("interrupt control work", { exact: true })
    .waitFor();
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Interrupt", exact: true }).click();
  await page
    .getByText("Current work interrupted; send a new message to continue with saved context", {
      exact: true,
    })
    .waitFor();
  await page.waitForTimeout(1200);
  assert.equal(await page.evaluate(() => window.tones), 1);
  const chatURL = page.url();
  await openSettings(page);
  await expect(
    page.getByRole("heading", { name: "Installation settings", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("heading", { name: "Installation settings", exact: true })
    .waitFor()
    .catch(async (error: unknown) => {
      console.error(page.url(), errors, await page.locator("body").innerText());
      throw error;
    });
  assert.equal(await page.getByLabel("Hosted provider", { exact: true }).isDisabled(), true);
  assert.equal(await page.getByLabel("Model ID", { exact: true }).inputValue(), "model");
  assert.equal(
    await page.getByLabel("Fine-grained personal access token", { exact: true }).inputValue(),
    "",
  );
  assert.equal(await page.getByLabel("CPUs per chat", { exact: true }).inputValue(), "2");
  await page.getByText(/startup flag -max-running overrides the saved cap with 4/).waitFor();
  await page.getByLabel("CPUs per chat", { exact: true }).fill("3");
  await page.getByLabel("Maximum message text (UTF-8 bytes)", { exact: true }).fill("1024");
  await page.getByLabel("Git author name", { exact: true }).fill("Browser Author");
  await page.getByLabel("Git author email", { exact: true }).fill("browser@example.test");
  await page.getByLabel("Play a sound when a chat finishes work", { exact: true }).uncheck();
  await page.getByLabel("Provider API key", { exact: true }).fill("invalid-fixture-key");
  await page.getByRole("button", { name: "Validate and save", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Anthropic rejected the credential" }).waitFor();
  assert.equal(await page.getByLabel("CPUs per chat", { exact: true }).inputValue(), "3");
  await page.getByLabel("Provider API key", { exact: true }).fill("rotated-fixture-key");
  await page.getByRole("button", { name: "Validate and save", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Settings saved" }).waitFor();
  assert.equal(await page.getByLabel("Provider API key", { exact: true }).inputValue(), "");
  await page.getByRole("button", { name: "Check dependencies", exact: true }).click();
  await page.getByText(/Cannot reach Docker/).waitFor();
  await page.getByText(/Image pull failed/).waitFor();
  assert.doesNotMatch(
    await page.locator("body").innerText(),
    /rotated-fixture-key|github_pat_test-secret|provider-test-secret/,
  );
  await page.goto(chatURL);
  await page.getByLabel("Follow-up", { exact: true }).fill("x".repeat(1025));
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "1,024 UTF-8 bytes" }).waitFor();
  await page.getByLabel("Follow-up", { exact: true }).fill("Sound disabled");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.getByText("Saved response 3", { exact: true }).waitFor();
  await page.waitForTimeout(1200);
  assert.equal(await page.evaluate(() => window.tones), 1);
  await openSettings(page);
  await page.reload();
  await page.getByRole("heading", { name: "Installation settings", exact: true }).waitFor();
  assert.equal(await page.getByLabel("CPUs per chat", { exact: true }).inputValue(), "3");
  assert.equal(
    await page.getByLabel("Git author name", { exact: true }).inputValue(),
    "Browser Author",
  );
  assert.equal(
    await page.getByLabel("Play a sound when a chat finishes work", { exact: true }).isChecked(),
    false,
  );
  await assertFitsPhone(page);
  await page.goto(chatURL);
  await page.getByLabel("Follow-up", { exact: true }).waitFor();
  const navigation = page.getByRole("button", { name: "Menu", exact: true });
  await navigation.click();
  await page.keyboard.press("Escape");
  await expect(navigation).toBeFocused();
  await navigation.click();
  await openSettings(page);
  await expect(page.getByRole("dialog", { name: "Sidebar", exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Installation settings", exact: true }),
  ).toBeFocused();
  assert.deepEqual(errors, []);
});
