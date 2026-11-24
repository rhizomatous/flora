import { test, expect, savedSettingsURL } from "../fixtures.ts";
import { openSettings, assertFitsPhone } from "../helpers.ts";

test.use({ scenario: "credential-setup" });

for (const first of ["GitHub", "model"] as const) {
  test(`${first} can be saved before the other connection`, async ({ page, backend, request }) => {
    await page.goto(`${backend.url}/#setup/fixture-installer-setup-secret-000000000000`);
    await page.getByLabel("Password", { exact: true }).fill("browser test password");
    await page.getByRole("button", { name: "Create administrator", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Connect your first project", exact: true })).toBeVisible();
    await openSettings(page);
    await page.getByLabel("Hosted provider", { exact: true }).selectOption("anthropic");
    await page.getByLabel("Model ID", { exact: true }).fill("fixture-model");
    await page.getByLabel("Fine-grained personal access token", { exact: true }).fill("github_pat_fixture_only");
    await page.getByLabel("Provider API key", { exact: true }).fill("fixture-provider-only");
    await page.getByRole("button", { name: `Validate and save ${first}`, exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Settings saved" })).toBeVisible();
    const partial = await page.request.get("/api/settings");
    expect(await partial.json()).toMatchObject({ githubConfigured: first === "GitHub", providerConfigured: first === "model" });
    const remaining = first === "GitHub" ? "model" : "GitHub";
    await expect(page.getByLabel(first === "GitHub" ? "Provider API key" : "Fine-grained personal access token", { exact: true })).not.toHaveValue("");
    await page.reload();
    if (first === "model") {
      await expect(page.getByLabel("Hosted provider", { exact: true })).toBeDisabled();
    } else {
      await expect(page.getByLabel("Hosted provider", { exact: true })).toBeEnabled();
    }
    await assertFitsPhone(page);
    if (remaining === "model") {
      await page.getByLabel("Hosted provider", { exact: true }).selectOption("anthropic");
      await page.getByLabel("Model ID", { exact: true }).fill("fixture-model");
      await page.getByLabel("Provider API key", { exact: true }).fill("fixture-provider-only");
    } else {
      await page.getByLabel("Fine-grained personal access token", { exact: true }).fill("github_pat_fixture_only");
    }
    await page.getByRole("button", { name: `Validate and save ${remaining}`, exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Settings saved" })).toBeVisible();
    await expect(page.getByLabel("Provider API key", { exact: true })).toHaveValue("");
    const saved = await request.get(savedSettingsURL(backend));
    expect(await saved.json()).toMatchObject({ providerKey: "fixture-provider-only", githubToken: "github_pat_fixture_only" });
    const publicSettings = await page.request.get("/api/settings");
    const body = await publicSettings.text();
    expect(body).not.toContain("fixture-provider-only");
    expect(body).not.toContain("github_pat_fixture_only");
  });
}
