import { test, expect } from "../fixtures.ts";
import { assertFitsPhone, logIn, openWorkspaceMenu } from "../helpers.ts";

test.describe("first run", () => {
  test.use({ scenario: "credential-setup" });

  test("saved setup, drafts, deferral, sign-out, and resume", async ({ page, backend }, testInfo) => {
    await page.goto(`${backend.url}/#setup/fixture-installer-setup-secret-000000000000`);
    await page.getByLabel("Password", { exact: true }).fill("browser test password");
    await page.getByRole("button", { name: "Create administrator", exact: true }).click();
    const heading = page.getByRole("heading", { name: "Connect a model", exact: true });
    await expect(heading).toBeFocused();
    await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Add connection", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add connection", exact: true })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await page.getByRole("menuitem", { name: "Anthropic", exact: true }).press("Enter");
    const dialog = page.getByRole("dialog", { name: "Connect Anthropic", exact: true });
    await dialog.getByLabel("API key", { exact: true }).fill("draft-secret-never-saved");
    await page.evaluate(() => { window.location.hash = "onboarding/account"; });
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Secure Flora", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(heading).toBeFocused();
    await page.getByRole("button", { name: "Add connection", exact: true }).click();
    await page.getByRole("menuitem", { name: "Anthropic", exact: true }).click();
    await expect(dialog.getByLabel("API key", { exact: true })).toHaveValue("");
    await dialog.getByLabel("API key", { exact: true }).fill("fixture-provider-only");
    await dialog.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page).toHaveURL(/#onboarding\/github$/);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Connect GitHub", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Set up later", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Connect a project", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Connect GitHub", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Connect GitHub", exact: true })).toBeFocused();
    await page.route("https://github.com/**", async (route) => {
      const url = new URL(route.request().url());
      const creating = url.pathname === "/settings/apps/new";
      const callback = new URL(`${backend.url}/github/callback`);
      callback.searchParams.set("state", url.searchParams.get("state") ?? "");
      callback.searchParams.set(creating ? "code" : "installation_id", creating ? "fixture-code" : "40");
      await route.fulfill({ contentType: "text/html", body: `<a href="${callback.toString().replaceAll("&", "&amp;")}">Approve GitHub</a>` });
    });
    await page.getByRole("button", { name: "Connect GitHub", exact: true }).click();
    await page.getByRole("link", { name: "Approve GitHub", exact: true }).click();
    await expect(page).toHaveURL(/#onboarding\/github$/);
    await page.getByRole("button", { name: "Install GitHub App", exact: true }).click();
    await page.getByRole("link", { name: "Approve GitHub", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Repositories", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByLabel("Project name", { exact: true }).fill("Garden draft");
    await page.getByLabel("GitHub repository", { exact: true }).fill("example/garden");
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Connect GitHub", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByLabel("Project name", { exact: true })).toHaveValue("Garden draft");
    await expect(page.getByLabel("GitHub repository", { exact: true })).toHaveValue("example/garden");
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain("fixture-provider-only");
    await expect(page.getByRole("button", { name: "Leave setup", exact: true })).toBeEnabled();
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ["dark", "light"]) {
        await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark");
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.screenshot({ path: testInfo.outputPath(`setup-${width}-${theme}.png`), fullPage: true, animations: "disabled" });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
    }
    await page.getByRole("button", { name: "Validate and connect", exact: true }).click();
    await expect(page.getByText("Garden draft", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Review setup", exact: true })).toBeFocused();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Review setup", exact: true })).toBeFocused();
    expect(await (await page.request.get("/api/projects")).json()).toHaveLength(1);
    await page.getByRole("button", { name: "Leave setup", exact: true }).click();
    await expect(page.getByRole("heading", { name: "New chat", exact: true })).toBeVisible();
    expect(await (await page.request.get("/api/onboarding")).json()).toMatchObject({ started: true, step: "finish", paused: true });
    await page.request.post("/api/auth/logout", { headers: { Origin: backend.url } });
    await page.reload();
    await expect(page.getByRole("heading", { name: "Log in", exact: true })).toBeVisible();
    await assertFitsPhone(page);
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ["dark", "light"]) {
        await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark");
        await page.screenshot({ path: testInfo.outputPath(`sign-in-${width}-${theme}.png`), fullPage: true, animations: "disabled" });
      }
    }

    await page.getByLabel("Password", { exact: true }).fill("browser test password");
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await page.setViewportSize({ width: 1280, height: 900 });
    await openWorkspaceMenu(page);
    await page.getByRole("menuitem", { name: "Set up Flora", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Review setup", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "2. Connect a model", exact: true }).click();
    await expect(page.getByRole("button", { name: "Update Anthropic key", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Log out", exact: true }).click();
    await page.getByLabel("Password", { exact: true }).fill("browser test password");
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(heading).toBeFocused();
  });
});

test("configured installations open the app without setup", async ({ page, backend }) => {
  await logIn(page);
  await expect(page.getByRole("button", { name: "Workspace menu", exact: true })).toBeVisible();
  await expect(page).not.toHaveURL(/onboarding/);
  expect(await (await page.request.get(`${backend.url}/api/onboarding`)).json()).toMatchObject({ paused: true });
});
