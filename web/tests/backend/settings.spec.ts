import assert from "node:assert/strict";

import { test, expect, savedSettingsURL } from "../fixtures.ts";

import { openWorkspaceMenu, openSettings, assertFitsPhone, logIn, pageErrors } from "../helpers.ts";

test.use({ scenario: "settings" });

test("settings persistence, credential rotation, and completion sounds", async ({ page, backend, request }) => {
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
  await page.getByRole("menuitem", { name: "Browser project", exact: true }).click();
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
  await expect(page.getByLabel("Fine-grained personal access token", {exact:true})).toHaveCount(0);
  await expect(page.getByRole("link",{name:"Connections",exact:true})).toBeVisible();
  await page.getByRole("link", { name: "Models", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Models", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Update Anthropic key", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Update Anthropic key", exact: true });
  await dialog.getByLabel("API key", { exact: true }).fill("invalid-fixture-key");
  await dialog.getByRole("button", { name: "Update key", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Anthropic rejected the credential");
  await expect(dialog.getByLabel("API key", { exact: true })).toHaveValue("invalid-fixture-key");
  await dialog.getByLabel("API key", { exact: true }).fill("rotated-fixture-key");
  await dialog.getByRole("button", { name: "Update key", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Update Anthropic key", exact: true })).toBeFocused();
  await openSettings(page);
  assert.equal(await page.getByLabel("CPUs per chat", { exact: true }).inputValue(), "2");
  await page.getByText(/startup flag -max-running overrides the saved cap with 4/).waitFor();
  await page.getByLabel("CPUs per chat", { exact: true }).fill("3");
  await page.getByLabel("Maximum message text (UTF-8 bytes)", { exact: true }).fill("1024");
  await page.getByLabel("Git author name", { exact: true }).fill("Browser Author");
  await page.getByLabel("Git author email", { exact: true }).fill("browser@example.test");
  await page.getByLabel("Play a sound when a chat finishes work", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Save preferences", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Settings saved" }).waitFor();
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
  const saved = await request.get(savedSettingsURL(backend));
  await expect(saved).toBeOK();
  expect(await saved.json()).toEqual({
    cpus: 3,
    messageBytes: 1024,
    sound: false,
    providerKey: "rotated-fixture-key",
    githubToken: "github_pat_test-secret",
  });
});

test("Models connects providers independently and saves a searchable default", async ({ page }) => {
  const errors = pageErrors(page);
  await logIn(page);
  await openWorkspaceMenu(page);
  await page.getByRole("menuitem", { name: "Models", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Models", exact: true })).toBeFocused();
  const defaultModel = page.getByRole("button", { name: "New chats", exact: true });
  await expect(defaultModel).toContainText("Installation default");
  await page.getByRole("button", { name: "Add connection", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Anthropic", exact: true })).toBeDisabled();
  await page.getByRole("menuitem", { name: "OpenAI", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Connect OpenAI", exact: true });
  await expect(dialog.getByLabel("API key", { exact: true })).toBeFocused();
  await dialog.getByLabel("API key", { exact: true }).fill("openai-fixture-key");
  await dialog.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add connection", exact: true })).toBeFocused();
  await expect(page.getByRole("button", { name: "Update OpenAI key", exact: true })).toBeVisible();
  await expect(defaultModel).toContainText("Installation default");
  await defaultModel.click();
  const search = page.getByRole("searchbox", { name: "Search default models", exact: true });
  await search.fill("unavailable-model");
  await expect(page.getByText("No matching results.", { exact: true })).toBeVisible();
  await search.fill("openai");
  await expect(page.getByRole("menuitem")).toHaveCount(1);
  await search.press("Enter");
  await expect(defaultModel).toContainText("GPT-5");
  await expect(defaultModel).toBeFocused();
  await page.reload();
  await expect(defaultModel).toContainText("GPT-5");
  await page.getByLabel("Search available models", { exact: true }).fill("sonnet");
  await expect(page.getByRole("row")).toHaveCount(2);
  await page.getByRole("button", { name: "Claude Sonnet 4.6 actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Use as default", exact: true }).click();
  await expect(defaultModel).toContainText("Claude Sonnet 4.6");
  await assertFitsPhone(page);
  await defaultModel.click();
  await expect(search).toBeVisible();
  await search.press("Escape");
  await expect(defaultModel).toBeFocused();
  await page.getByRole("button", { name: "Update OpenAI key", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("button", { name: "Update OpenAI key", exact: true })).toBeFocused();
  await page.goto("/#chats/new");
  await expect(page.getByRole("button", { name: "Model: Claude Sonnet 4.6", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Model:/ }).click();
  await page.getByRole("searchbox", { name: "Search models", exact: true }).fill("openai");
  await page.getByRole("menuitem", { name: "GPT-5", exact: true }).click();
  await expect(page.getByRole("button", { name: "Model: GPT-5", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
