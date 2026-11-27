import { test, expect } from "../fixtures.ts";
import { assertFitsPhone, logIn, openWorkspaceMenu } from "../helpers.ts";

test.describe("first run", () => {
  test.use({ scenario: "credential-setup" });

  test("required setup, drafts, sign-out, and resume", async ({ page, backend }, testInfo) => {
    let unintendedRequests = 0;
    page.on("request", request => {
      if (request.method() === "POST" && /\/api\/(settings\/diagnostics|onboarding\/readiness|projects\/[^/]+\/chats|chats\/[^/]+\/messages)/.test(request.url())) unintendedRequests++;
    });
    async function captureStep(name: string) {
      await expect(page.getByRole("button", { name: "Log out", exact: true })).toBeEnabled();
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
    await expect(page.getByRole("button", { name: "Leave setup", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Skip", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "3. Connect GitHub", exact: true })).toBeDisabled();
    await page.goto("/#onboarding/finish");
    await expect(page).toHaveURL(/#onboarding\/model$/);
    await expect(heading).toBeVisible();
    await expect(page.getByRole("button", { name: "Open Flora", exact: true })).toHaveCount(0);
    await page.getByRole("link", { name: "Flora home", exact: true }).click();
    await expect(page).toHaveURL(/#onboarding\/model$/);
    await expect(page.getByRole("button", { name: "Workspace menu", exact: true })).toHaveCount(0);
    const rejected = await page.request.put("/api/onboarding", { headers: { Origin: backend.url }, data: { step: "finish", completed: true, projectID: "" } });
    expect(rejected.status()).toBe(400);
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
    let connectionState = "pending";
    await page.route("**/api/github/connection", async route => {
      await route.fulfill({json:{state:connectionState,slug:"flora-fixture",account:"",installationID:0,active:"none",installations:[]}});
    });
    await page.reload();
    await expect(page.getByText(/An organization owner needs to approve/)).toBeVisible();
    await expect(page.getByRole("button", {name:"Continue",exact:true})).toHaveCount(0);
    await captureStep("github-pending");
    connectionState = "revoked";
    await page.getByRole("button",{name:"Refresh GitHub connection",exact:true}).click();
    await expect(page.getByText(/Repository access was revoked/)).toBeVisible();
    await captureStep("github-revoked");
    await page.unroute("**/api/github/connection");
    await page.getByRole("button",{name:"Refresh GitHub connection",exact:true}).click();
    await captureStep("github");
    await expect(page.getByRole("button", { name: "4. Connect a project", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "5. Review setup", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Log out", exact: true }).click();
    await page.getByLabel("Password", { exact: true }).fill("browser test password");
    await page.getByRole("button", { name: "Log in", exact: true }).click();
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
    await page.getByRole("button", {name:"Finish later",exact:true}).click();
    await page.getByLabel("Password", {exact:true}).fill("browser test password");
    await page.getByRole("button", {name:"Log in",exact:true}).click();
    await expect(page.getByRole("heading", {name:"Connect GitHub",exact:true})).toBeFocused();
    await expect(page.getByRole("button", {name:"Continue",exact:true})).toBeEnabled();
    let discoveryAttempts = 0;
    await page.route("**/api/github/repositories*", async route => {
      discoveryAttempts++;
      if (discoveryAttempts === 1) await route.fulfill({status:403,json:{error:"GitHub denied repository access. Check installation permissions."}});
      else if (discoveryAttempts === 2) await route.fulfill({json:{repositories:[],nextPage:0}});
      else await route.continue();
    });
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("GitHub denied repository access");
    await expect(page.getByRole("link",{name:"Manage GitHub access",exact:true})).toBeVisible();
    await captureStep("project-permission-error");
    await page.getByRole("button",{name:"Retry repository discovery",exact:true}).click();
    await expect(page.getByRole("alert")).toContainText("No repositories available");
    await page.getByRole("button",{name:"Retry repositories",exact:true}).click();
    const repositoryChoice = page.getByRole("combobox", { name: "Choose a repository", exact: true });
    await expect(page.getByLabel("Project name",{exact:true})).toHaveCount(0);
    await captureStep("project-repository-picker");
    await repositoryChoice.fill("missing");
    await expect(page.getByText("No matching repositories", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(repositoryChoice).toBeFocused();
    await repositoryChoice.fill("fixture");
    await expect(page.getByRole("option", { name: "flora/fixture", exact: true })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button",{name:"Change repository",exact:true})).toBeFocused();
    await expect(page.getByLabel("Project name", { exact: true })).toHaveValue("fixture");
    await page.getByRole("button",{name:"Change repository",exact:true}).click();
    await expect(repositoryChoice).toBeFocused();
    await repositoryChoice.fill("missing");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button",{name:"Change repository",exact:true})).toBeFocused();
    await page.getByRole("button", { name: "Repository options", exact: true }).click();
    await expect(page.getByLabel("Base branch", { exact: true })).toHaveValue("main");
    await page.getByRole("button", { name: "Repository options", exact: true }).click();
    await page.getByLabel("Project name", { exact: true }).fill("Garden draft");

    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Connect GitHub", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByLabel("Project name", { exact: true })).toHaveValue("Garden draft");
    await expect(page.getByRole("button",{name:"Change repository",exact:true})).toContainText("flora/fixture");
    const repositoryOptions = page.getByRole("button", { name: "Repository options", exact: true });
    await repositoryOptions.focus();
    await page.keyboard.press("Enter");
    await page.getByLabel("Base branch", { exact: true }).fill("main");
    await page.getByRole("button", { name: "Add repository", exact: true }).click();
    await expect(repositoryChoice).toBeFocused();
    await page.getByRole("button", { name: "Remove repository 1", exact: true }).click();
    await expect(repositoryChoice).toBeFocused();
    await repositoryChoice.fill("fixture");
    await page.getByRole("option",{name:"flora/fixture",exact:true}).click();
    await expect(page.getByLabel("Project name", {exact:true})).toHaveValue("Garden draft");
    await repositoryOptions.click();
    await page.getByLabel("Base branch", { exact: true }).fill("main");
    await repositoryOptions.click();
    const setupCommand = page.getByRole("button", { name: "Setup command", exact: true });
    await setupCommand.click();
    await page.getByLabel("Setup command (optional)", { exact: true }).fill("npm ci");
    await setupCommand.click();

    expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain("fixture-provider-only");
    await expect(page.getByRole("button", { name: "Log out", exact: true })).toBeEnabled();
    await captureStep("setup");
    let saves = 0;
    await page.route("**/api/onboarding/project", async (route) => {
      saves++;
      const response = await route.fetch();
      if (saves === 1) await route.fulfill({ status: 502, json: { error: "Response lost. Try saving again." } });
      else await route.fulfill({ response });
    });
    await page.getByRole("button", { name: "Create project", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Response lost");
    await expect(page.getByLabel("Project name", { exact: true })).toHaveValue("Garden draft");
    await page.getByRole("button", { name: "Create project", exact: true }).click();
    expect(saves).toBe(2);
    await expect(page).toHaveURL(/#chats\/new$/);
    await expect(page.getByRole("heading", { name: "New chat", exact: true })).toBeVisible();
    const savedProjects = await (await page.request.get("/api/projects")).json();
    expect(savedProjects).toHaveLength(1);
    expect(savedProjects[0].configuration).toMatchObject({ setupCommand: "npm ci", repositories: [{ baseBranch: "main" }] });
    expect(await (await page.request.get("/api/onboarding")).json()).toMatchObject({ started: true, step: "project", completed: true });
    await page.reload();
    await expect(page).toHaveURL(/#chats\/new$/);
    await expect(page.getByRole("heading", { name: "New chat", exact: true })).toBeVisible();
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
    await expect(page.getByRole("heading", { name: "Connect a project", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "2. Connect a model", exact: true }).click();
    await expect(page.getByRole("button", { name: "Update Anthropic key", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Log out", exact: true }).click();
    await page.getByLabel("Password", { exact: true }).fill("browser test password");
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(heading).toBeFocused();
    expect(unintendedRequests).toBe(0);
  });
});

test("configured installations open the app without setup", async ({ page, backend }) => {
  await logIn(page);
  await expect(page.getByRole("button", { name: "Workspace menu", exact: true })).toBeVisible();
  await expect(page).not.toHaveURL(/onboarding/);
  expect(await (await page.request.get(`${backend.url}/api/onboarding`)).json()).toMatchObject({ completed: true });
});


test("finishing project setup opens home and retains the selection after a failed save", async ({ page, backend }, testInfo) => {
  await logIn(page);
  let unintendedRequests = 0;
  page.on("request", request => {
    if (request.method() === "POST" && /\/api\/(settings\/diagnostics|onboarding\/readiness|projects\/[^/]+\/chats|chats\/[^/]+\/messages)/.test(request.url())) unintendedRequests++;
  });
  const response = await page.request.post("/api/projects", {headers:{Origin:backend.url}, data:{name:"Existing garden",configuration:{repositories:[{url:"flora/fixture",role:"core"}],setupCommand:""}}});
  expect(response.status()).toBe(201);
  const project = await response.json();
  await page.goto("/#onboarding/project");
  const selected = page.getByRole("combobox",{name:"Project",exact:true});
  await selected.selectOption(project.id);
  await expect(selected).toHaveValue(project.id);
  let failSave = true;
  await page.route("**/api/onboarding", async route => {
    if (route.request().method() === "PUT" && route.request().postDataJSON().completed && failSave) {
      failSave = false;
      await route.fulfill({status:503,json:{error:"Could not save setup progress. Try again."}});
    } else await route.continue();
  });
  await page.getByRole("button",{name:"Open Flora",exact:true}).click();
  await expect(page.getByRole("alert")).toContainText("Could not save setup progress");
  await expect(page).toHaveURL(/#onboarding\/project$/);
  await expect(selected).toHaveValue(project.id);
  expect((await (await page.request.get("/api/onboarding")).json()).completed).toBe(false);
  await page.reload();
  await expect(selected).toHaveValue(project.id);
  for (const width of [1280,375]) {
    await page.setViewportSize({width,height:812});
    for (const dark of [true,false]) {
      await page.evaluate(value => document.documentElement.classList.toggle("dark",value),dark);
      await page.screenshot({path:testInfo.outputPath(`final-project-${width}-${dark ? "dark" : "light"}.png`),fullPage:true,animations:"disabled"});
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
  await page.getByRole("button",{name:"Open Flora",exact:true}).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#chats\/new$/);
  await expect(page.getByRole("combobox",{name:"Message",exact:true})).toBeEmpty();
  expect(await (await page.request.get("/api/onboarding")).json()).toMatchObject({completed:true,step:"project",projectID:project.id});
  await page.reload();
  await expect(page.getByRole("heading",{name:"New chat",exact:true})).toBeVisible();
  expect(unintendedRequests).toBe(0);
});

test("saved finish progress returns to the final project action", async ({ page, backend }) => {
  await logIn(page);
  const progress = await (await page.request.get("/api/onboarding")).json();
  await page.request.put("/api/onboarding",{headers:{Origin:backend.url},data:{...progress,step:"project",completed:false}});
  await page.route("**/api/onboarding", async route => {
    if (route.request().method() !== "GET") { await route.continue(); return; }
    const response = await route.fetch();
    await route.fulfill({response,json:{...await response.json(),step:"finish"}});
  });
  await page.goto("/#onboarding/finish");
  await expect(page).toHaveURL(/#onboarding\/project$/);
  await expect(page.getByRole("heading",{name:"Connect a project",exact:true})).toBeFocused();
  await expect(page.getByRole("navigation",{name:"Setup progress"}).getByRole("button")).toHaveCount(4);
  await expect(page.getByRole("heading",{name:"Review setup",exact:true})).toHaveCount(0);
  await page.getByRole("button",{name:"Open Flora",exact:true}).click();
  await expect(page).toHaveURL(/#chats\/new$/);
});


test("repository-first project picker supports browsing, search, and scrolling", async ({ page }, testInfo) => {
  await logIn(page);
  let many = false;
  const accessURL = "https://github.com/organizations/flora/settings/installations/40";
  await page.route("**/api/github/connection", async route => {
    await route.fulfill({json:{state:"connected",slug:"flora-fixture",account:"flora",installationID:40,active:"app",installations:[{id:40,account:{login:"flora"},suspended_at:null,html_url:accessURL}]}});
  });
  await page.route("**/api/projects", async route => { await route.fulfill({json:[]}); });
  await page.route("**/api/github/repositories*", async route => {
    const names = ["garden", "website", "tendril", ...(many ? Array.from({length:40}, (_,i) => `repository-${i}-with-a-long-name`) : [])];
    await route.fulfill({json:{repositories:names.map(name => ({full_name:`flora/${name}`,html_url:`https://github.com/flora/${name}`,default_branch:"main"})),nextPage:0}});
  });
  await page.goto("/#onboarding/project");
  await expect(page.getByRole("option")).toHaveCount(3);
  const access = page.getByRole("link",{name:"Manage GitHub access",exact:true});
  await expect(access).toHaveAttribute("href",accessURL);
  await expect(access).toHaveAttribute("target","_blank");
  await expect(page.getByRole("button", {name:"Create project",exact:true})).toBeDisabled();
  async function capture(name: string) {
    await page.mouse.move(0,0);
    for (const width of [1280,375]) {
      await page.setViewportSize({width,height:width === 375 ? 812 : 900});
      for (const dark of [true,false]) {
        await page.evaluate(value => document.documentElement.classList.toggle("dark",value),dark);
        await page.screenshot({path:testInfo.outputPath(`${name}-${width}-${dark ? "dark" : "light"}.png`),animations:"disabled",fullPage:true});
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
    }
  }
  await capture("project-picker");
  many = true;
  await page.getByRole("button",{name:"Refresh repositories",exact:true}).click();
  await expect(page.getByRole("option")).toHaveCount(43);
  const list = page.getByRole("listbox");
  await list.hover();
  await page.mouse.wheel(0,600);
  await expect.poll(() => list.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  await page.getByRole("combobox",{name:"Choose a repository",exact:true}).fill("website");
  await expect(page.getByRole("option")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button",{name:"Change repository",exact:true})).toBeFocused();
  await expect(page.getByLabel("Project name",{exact:true})).toHaveValue("website");
  await expect(page.getByRole("button",{name:"Create project",exact:true})).toBeEnabled();
  await capture("project-selected");
});
