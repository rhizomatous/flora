import { test, expect, savedSettingsURL } from "../fixtures.ts";
import { openSettings, assertFitsPhone } from "../helpers.ts";

test.use({ scenario: "credential-setup" });

test("first credential save and blank-field preservation use encrypted storage", async ({ page, backend, request }) => {
  await page.goto(backend.url);
  await page.getByLabel("Password", { exact: true }).fill("browser test password");
  await page.getByLabel("Enrollment code", { exact: false }).fill("fixture-installer-enrollment-code");
  await page.getByRole("button", { name: "Create administrator", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Connect your first project", exact: true })).toBeVisible();
  await openSettings(page);
  await page.getByLabel("Hosted provider", { exact: true }).selectOption("anthropic");
  await page.getByLabel("Model ID", { exact: true }).fill("fixture-model");
  await page.getByLabel("Fine-grained personal access token", { exact: true }).fill("github_pat_fixture_only");
  await page.getByLabel("Provider API key", { exact: true }).fill("fixture-provider-only");
  await page.getByRole("button", { name: "Validate and save", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Settings saved" })).toBeVisible();
  await expect(page.getByLabel("Provider API key", { exact: true })).toHaveValue("");
  await page.reload();
  await expect(page.getByLabel("Hosted provider", { exact: true })).toBeDisabled();
  await assertFitsPhone(page);
  await page.getByRole("button", { name: "Validate and save", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Settings saved" })).toBeVisible();
  const saved = await request.get(savedSettingsURL(backend));
  expect(await saved.json()).toMatchObject({ providerKey: "fixture-provider-only", githubToken: "github_pat_fixture_only" });
  const publicSettings = await page.request.get("/api/settings");
  const body = await publicSettings.text();
  expect(body).not.toContain("fixture-provider-only");
  expect(body).not.toContain("github_pat_fixture_only");
});
