import { test, expect } from "../fixtures.ts";
import { assertFitsPhone, logIn, openWorkspaceMenu } from "../helpers.ts";

test.describe("first run", () => {
  test.use({ scenario: "credential-setup" });

  test("saved setup, drafts, deferral, sign-out, and resume", async ({ page, backend }, testInfo) => {
    async function captureStep(name: string) {
      await expect(page.getByRole("button", { name: "Leave setup", exact: true })).toBeEnabled();
      const closeToasts = page.getByRole("button", { name: "Close toast", exact: true });
      for (const button of await closeToasts.all()) await button.click();
      await expect(closeToasts).toHaveCount(0);
      for (const width of [1280, 375]) {
        await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
        for (const theme of ["dark", "light"]) {
          await page.evaluate((dark) => { document.documentElement.classList.toggle("dark", dark); }, theme === "dark");
          await page.emulateMedia({ reducedMotion: "reduce" });
          await page.screenshot({ path: testInfo.outputPath(`${name}-${width}-${theme}.png`), fullPage: true, animations: "disabled" });
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        }
      }
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.evaluate(() => { document.documentElement.classList.add("dark"); });
    }
    await page.goto(`${backend.url}/#setup/fixture-installer-setup-secret-000000000000`);
    await page.getByLabel("Password", { exact: true }).fill("browser test password");
    await page.getByRole("button", { name: "Create administrator", exact: true }).click();
    const heading = page.getByRole("heading", { name: "Connect a model", exact: true });
    await expect(heading).toBeFocused();
    await captureStep("model");
    await expect(page.getByRole("button", { name: "Continue", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Connect Anthropic", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Connect Anthropic", exact: true });
    await expect(dialog.getByLabel("API key", { exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Connect Anthropic", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await dialog.getByLabel("API key", { exact: true }).fill("draft-secret-never-saved");
    await page.evaluate(() => { window.location.hash = "onboarding/account"; });
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Secure Flora", exact: true })).toBeFocused();
    await captureStep("account");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(heading).toBeFocused();
    await page.getByRole("button", { name: "Connect Anthropic", exact: true }).click();
    await expect(dialog.getByLabel("API key", { exact: true })).toHaveValue("");
    await dialog.getByLabel("API key", { exact: true }).fill("fixture-provider-only");
    await dialog.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page).toHaveURL(/#onboarding\/github$/);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Connect GitHub", exact: true })).toBeFocused();
    await captureStep("github");
    await page.getByRole("button", { name: "Skip", exact: true }).click();
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
    await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByLabel("Project name", { exact: true }).fill("Garden draft");
    await page.getByLabel("GitHub repository", { exact: true }).fill("example/garden");
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Connect GitHub", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByLabel("Project name", { exact: true })).toHaveValue("Garden draft");
    await expect(page.getByLabel("GitHub repository", { exact: true })).toHaveValue("example/garden");
    const repositoryOptions = page.getByRole("button", { name: "Repository options", exact: true });
    await repositoryOptions.focus();
    await page.keyboard.press("Enter");
    await page.getByLabel("Base branch", { exact: true }).fill("main");
    await page.getByRole("button", { name: "Add repository", exact: true }).click();
    await expect(page.getByLabel("GitHub repository", { exact: true }).nth(1)).toBeFocused();
    await page.getByRole("button", { name: "Remove repository 1", exact: true }).click();
    await expect(page.getByLabel("GitHub repository", { exact: true })).toBeFocused();
    await page.getByLabel("GitHub repository", { exact: true }).fill("example/garden");
    await repositoryOptions.click();
    await page.getByLabel("Base branch", { exact: true }).fill("main");
    await repositoryOptions.click();
    const setupCommand = page.getByRole("button", { name: "Setup command", exact: true });
    await setupCommand.click();
    await page.getByLabel("Setup command (optional)", { exact: true }).fill("npm ci");
    await setupCommand.click();

    expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain("fixture-provider-only");
    await expect(page.getByRole("button", { name: "Leave setup", exact: true })).toBeEnabled();
    await captureStep("setup");
    await page.getByRole("button", { name: "Connect project", exact: true }).click();
    await expect(page.getByText("Garden draft", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Review setup", exact: true })).toBeFocused();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Review setup", exact: true })).toBeFocused();
    const savedProjects = await (await page.request.get("/api/projects")).json();
    expect(savedProjects).toHaveLength(1);
    expect(savedProjects[0].configuration).toMatchObject({ setupCommand: "npm ci", repositories: [{ baseBranch: "main" }] });
    await captureStep("review");
    await page.getByRole("button", { name: "Leave setup", exact: true }).click();
    await expect(page.getByRole("heading", { name: "New chat", exact: true })).toBeVisible();
    expect(await (await page.request.get("/api/onboarding")).json()).toMatchObject({ started: true, step: "finish", paused: true });
    await page.request.post("/api/auth/logout", { headers: { Origin: backend.url } });
    await page.reload();
    await expect(page.getByRole("heading", { name: "Log in", exact: true })).toBeVisible();
    await assertFitsPhone(page);
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
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
