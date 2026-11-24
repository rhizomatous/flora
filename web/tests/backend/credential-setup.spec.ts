import { test, expect, savedSettingsURL } from "../fixtures.ts";
import { assertFitsPhone } from "../helpers.ts";

test.use({ scenario: "credential-setup" });

for (const first of ["GitHub", "model"] as const) {
  test(`${first} can be saved before the other connection`, async ({ page, backend, request }) => {
    await page.goto(`${backend.url}/#setup/fixture-installer-setup-secret-000000000000`);
    await page.getByLabel("Password", { exact: true }).fill("browser test password");
    await page.getByRole("button", { name: "Create administrator", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Connect your first project", exact: true })).toBeVisible();
    async function save(connection: "GitHub" | "model") {
      await page.goto(connection === "model" ? "/#models" : "/#settings");
      if (connection === "GitHub") {
        await page.getByLabel("Fine-grained personal access token", { exact: true }).fill("github_pat_fixture_only");
        await page.getByRole("button", { name: "Validate and save GitHub", exact: true }).click();
        await expect(page.getByRole("status").filter({ hasText: "Settings saved" })).toBeVisible();
      } else {
        await page.getByRole("button", { name: "Add connection", exact: true }).click();
        await page.getByRole("menuitem", { name: "Anthropic", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "Connect Anthropic", exact: true });
        await dialog.getByLabel("API key", { exact: true }).fill("fixture-provider-only");
        await dialog.getByRole("button", { name: "Connect", exact: true }).click();
        await expect(dialog).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Update Anthropic key", exact: true })).toBeVisible();
      }
    }
    await save(first);
    const partial = await page.request.get("/api/settings");
    expect(await partial.json()).toMatchObject({ githubConfigured: first === "GitHub", providerConfigured: first === "model" });
    await page.reload();
    await assertFitsPhone(page);
    await save(first === "GitHub" ? "model" : "GitHub");
    const saved = await request.get(savedSettingsURL(backend));
    expect(await saved.json()).toMatchObject({ providerKey: "fixture-provider-only", githubToken: "github_pat_fixture_only" });
    const publicSettings = await page.request.get("/api/settings");
    const body = await publicSettings.text();
    expect(body).not.toContain("fixture-provider-only");
    expect(body).not.toContain("github_pat_fixture_only");
  });
}
