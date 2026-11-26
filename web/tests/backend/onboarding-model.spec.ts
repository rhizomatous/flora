import { test, expect } from "../fixtures.ts";
import { logIn, pageErrors } from "../helpers.ts";

test.use({ scenario: "credential-setup" });

test("model setup retries, checks a manual default, and resumes without saved secrets", async ({ page, backend }, testInfo) => {
  const errors = pageErrors(page);
  await page.goto(`${backend.url}/#setup/fixture-installer-setup-secret-000000000000`);
  await page.getByLabel("Password", { exact: true }).fill("browser test password");
  await page.getByRole("button", { name: "Create administrator", exact: true }).click();
  await page.getByRole("button", { name: "Finish later", exact: true }).click();
  await page.getByLabel("Password", { exact: true }).fill("browser test password");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Connect a model", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Connect Anthropic", exact: true }).click();
  const connection = page.getByRole("dialog", { name: "Connect Anthropic", exact: true });
  await connection.getByLabel("API key", { exact: true }).fill("invalid-fixture-key");
  await connection.getByLabel("Model ID (optional)", { exact: true }).fill("manual-sonnet");
  await connection.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(connection.getByRole("alert")).toContainText("rejected the credential");
  await expect(connection.getByLabel("Model ID (optional)", { exact: true })).toHaveValue("manual-sonnet");
  await expect(page.getByRole("button", { name: "3. Connect GitHub", exact: true, includeHidden: true })).toBeDisabled();
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 812 });
    for (const dark of [true, false]) {
      await page.evaluate((value) => document.documentElement.classList.toggle("dark", value), dark);
      await page.screenshot({ path: testInfo.outputPath(`connection-error-${width}-${dark}.png`), fullPage: true, animations: "disabled" });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
  await connection.getByLabel("API key", { exact: true }).fill("valid-fixture-key");
  await connection.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(connection).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Connect Anthropic", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Default for new chats", exact: true })).toContainText("manual-sonnet");
  await expect(page.getByRole("status").filter({ hasText: /^Checked$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue", exact: true, includeHidden: true })).toBeEnabled();

  await page.getByRole("button", { name: "Enter model ID", exact: true }).click();
  const manual = page.getByRole("dialog", { name: "Set default model", exact: true });
  await expect(manual.getByLabel("API key", { exact: true })).toHaveCount(0);
  await manual.getByLabel("Model ID", { exact: true }).fill("denied-model");
  let rejected = false;
  let release: (() => void) | undefined;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/settings", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    rejected = true;
    await waiting;
    await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "Anthropic could not find this model. Check the model ID and account access." }) });
  });
  await manual.getByRole("button", { name: "Save default", exact: true }).click();
  await expect.poll(() => rejected).toBe(true);
  await expect(manual.getByRole("button", { name: "Checking access…", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Continue", exact: true, includeHidden: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "3. Connect GitHub", exact: true, includeHidden: true })).toBeDisabled();
  release?.();
  await expect(manual.getByRole("alert")).toContainText("Check the model ID and account access");
  await expect(manual.getByLabel("Model ID", { exact: true })).toHaveValue("denied-model");
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 600 });
    await page.screenshot({ path: testInfo.outputPath(`manual-error-${width}.png`), fullPage: true, animations: "disabled" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.unroute("**/api/settings");
  await manual.getByLabel("Model ID", { exact: true }).fill("manual-haiku");
  await manual.getByRole("button", { name: "Save default", exact: true }).click();
  await expect(manual).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Enter model ID", exact: true })).toBeFocused();
  await page.reload();
  await expect(page.getByRole("button", { name: "Default for new chats", exact: true })).toContainText("manual-haiku");
  await page.getByRole("button", { name: "Enter model ID", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(manual).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Enter model ID", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Continue", exact: true, includeHidden: true }).click();
  await expect(page).toHaveURL(/#onboarding\/github$/);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Connect GitHub", exact: true })).toBeFocused();
  const settings = await (await page.request.get("/api/settings")).json();
  expect(settings).toMatchObject({ provider: "anthropic", model: "manual-haiku", providerConfigured: true });
  expect(JSON.stringify(settings)).not.toContain("valid-fixture-key");
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain("valid-fixture-key");
  expect(errors).toEqual([]);
});

test.describe("existing model settings", () => {
  test.use({ scenario: "settings" });

  test("manual default selection works without discovery and keeps existing connections", async ({ page }, testInfo) => {
    await logIn(page);
    const before = await (await page.request.get("/api/settings")).json();
    await page.route("**/api/models", async (route) => {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ default: { provider: before.provider, model: before.model, variant: "" }, models: [], error: "Could not load models. Retry discovery." }) });
    });
    await page.goto("/#models");
    await expect(page.getByRole("button", { name: "New chats", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Enter model ID", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Set default model", exact: true });
    await expect(dialog.getByLabel("API key", { exact: true })).toHaveCount(0);
    const model = `custom-${"model".repeat(35)}`;
    await dialog.getByLabel("Model ID", { exact: true }).fill(model);
    await page.setViewportSize({ width: 375, height: 480 });
    await dialog.getByRole("button", { name: "Save default", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Enter model ID", exact: true })).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath("settings-manual-phone.png"), fullPage: true, animations: "disabled" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const after = await (await page.request.get("/api/settings")).json();
    expect(after).toMatchObject({ provider: before.provider, model, providerConfigured: true, githubConfigured: before.githubConfigured, preferences: before.preferences });
    await page.reload();
    await expect(page.getByRole("button", { name: "New chats", exact: true })).toContainText(model);
  });
});
