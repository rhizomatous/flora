import { test, expect } from "../fixtures.ts";
import { logIn, pageErrors } from "../helpers.ts";

test.use({ scenario: "credential-setup" });

test("model setup stays focused on connections and resumes without saved secrets", async ({ page, backend }, testInfo) => {
  const errors = pageErrors(page);
  let catalogRequests = 0;
  page.on("request", (request) => { if (new URL(request.url()).pathname === "/api/models") catalogRequests++; });
  await page.goto(`${backend.url}/#setup/fixture-installer-setup-secret-000000000000`);
  await page.getByLabel("Password", { exact: true }).fill("browser test password");
  await page.getByRole("button", { name: "Create administrator", exact: true }).click();
  await page.getByRole("button", { name: "Finish later", exact: true }).click();
  await page.getByLabel("Password", { exact: true }).fill("browser test password");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Connect a model", exact: true })).toBeFocused();
  const icons = await page.locator('[data-slot="model-icon"]').evaluateAll(async (elements) => {
    return Promise.all(elements.map(async (element) => {
      const mask = getComputedStyle(element).maskImage;
      const source = mask.slice(5, -2);
      const image = new Image();
      image.src = source;
      await image.decode();
      return { width: image.naturalWidth, source };
    }));
  });
  expect(icons).toHaveLength(3);
  for (const [index, title] of ["Claude", "OpenAI", "Google"].entries()) {
    const icon = icons[index];
    expect(icon?.width).toBeGreaterThan(0);
    const source = icon?.source ?? "";
    const svg = source.startsWith("data:")
      ? decodeURIComponent(source.slice(source.indexOf(",") + 1))
      : await (await page.request.get(source)).text();
    expect(svg).toContain(`<title>${title}</title>`);
  }
  await page.getByRole("button", { name: "Connect Anthropic", exact: true }).click();
  const connection = page.getByRole("dialog", { name: "Connect Anthropic", exact: true });
  await connection.getByLabel("API key", { exact: true }).fill("invalid-fixture-key");
  await expect(connection.getByLabel("Model ID (optional)", { exact: true })).toHaveCount(0);
  await connection.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(connection.getByRole("alert")).toContainText("rejected the credential");
  await expect(connection.getByLabel("API key", { exact: true })).toHaveValue("invalid-fixture-key");
  await connection.getByLabel("API key", { exact: true }).fill("valid-fixture-key");
  await connection.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(connection).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Update Anthropic key", exact: true })).toBeFocused();
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeEnabled();
  await expect(page.getByText("Models updated", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Metadata access", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Enter model ID", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry discovery", exact: true })).toHaveCount(0);
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 812 });
    for (const dark of [true, false]) {
      await page.evaluate((value) => document.documentElement.classList.toggle("dark", value), dark);
      await page.screenshot({ path: testInfo.outputPath(`connected-${width}-${dark}.png`), fullPage: true, animations: "disabled" });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
  await page.getByRole("button", { name: "Update Anthropic key", exact: true }).click();
  const update = page.getByRole("dialog", { name: "Update Anthropic key", exact: true });
  await expect(update.getByLabel("API key", { exact: true })).toHaveValue("");
  await update.getByLabel("API key", { exact: true }).fill("rotated-fixture-key");
  let release: (() => void) | undefined;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/settings", async (route) => {
    if (route.request().method() === "PUT") await waiting;
    await route.continue();
  });
  await update.getByRole("button", { name: "Update key", exact: true }).click();
  await expect(update.getByRole("button", { name: "Checking access…", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Continue", exact: true, includeHidden: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "3. Connect GitHub", exact: true, includeHidden: true })).toBeDisabled();
  release?.();
  await expect(update).toHaveCount(0);
  await page.unroute("**/api/settings");
  await page.reload();
  await expect(page.getByRole("button", { name: "Update Anthropic key", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/#onboarding\/github$/);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Connect GitHub", exact: true })).toBeFocused();
  const settings = await (await page.request.get("/api/settings")).json();
  expect(settings).toMatchObject({ provider: "anthropic", model: "fixture-model", providerConfigured: true });
  expect(JSON.stringify(settings)).not.toContain("rotated-fixture-key");
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain("rotated-fixture-key");
  expect(catalogRequests).toBe(0);
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
    await dialog.getByLabel("Model ID", { exact: true }).fill("denied-model");
    await page.route("**/api/settings", async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "Anthropic could not find this model. Check the model ID and account access." }) });
    });
    await dialog.getByRole("button", { name: "Save default", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("Check the model ID and account access");
    await expect(dialog.getByLabel("Model ID", { exact: true })).toHaveValue("denied-model");
    await page.unroute("**/api/settings");
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
