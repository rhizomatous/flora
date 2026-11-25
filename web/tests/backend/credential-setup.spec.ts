import { test, expect, savedSettingsURL } from "../fixtures.ts";
import { assertFitsPhone } from "../helpers.ts";

test.use({ scenario: "credential-setup" });

for (const first of ["GitHub", "model"] as const) {
  test(`${first} can be saved before the other connection`, async ({ page, backend, request }) => {
    await page.goto(`${backend.url}/#setup/fixture-installer-setup-secret-000000000000`);
    await page.getByLabel("Password", { exact: true }).fill("browser test password");
    await page.getByRole("button", { name: "Create administrator", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Connect a model", exact: true })).toBeVisible();
    const headers = { Origin: backend.url };
    async function save(connection: "GitHub" | "model") {
      if (connection === "model") {
        const response = await page.request.put("/api/settings", { headers, data: { provider: "anthropic", providerKey: "fixture-provider-only", makeDefault: false } });
        expect(response.ok()).toBe(true);
      } else {
        for (const data of [{ code: "fixture-code" }, { installationID: 40 }]) {
          const response = await page.request.post("/api/github/connect", { headers, data: {} });
          expect(response.ok()).toBe(true);
          const start = await response.json();
          const state = new URL(start.url).searchParams.get("state");
          const completed = await page.request.post("/api/github/complete", { headers, data: { state, ...data } });
          expect(completed.ok()).toBe(true);
        }
      }
    }
    await save(first);
    expect(await (await page.request.get("/api/settings")).json()).toMatchObject({ githubConfigured: first === "GitHub", providerConfigured: first === "model" });
    await page.reload();
    await assertFitsPhone(page);
    await save(first === "GitHub" ? "model" : "GitHub");
    expect(await (await request.get(savedSettingsURL(backend))).json()).toMatchObject({ providerKey: "fixture-provider-only", githubToken: "" });
    const body = await (await page.request.get("/api/settings")).text();
    expect(body).not.toContain("fixture-provider-only");
    expect(body).not.toContain("fixture-installation-token");
  });
}
