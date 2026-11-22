import assert from "node:assert/strict";
import { test, expect } from "../fixtures.ts";
import { logIn, openSettings, pageErrors } from "../helpers.ts";

test.use({ scenario: "projects" });

test("environment precedence, explicit secrets and chat drafts", async ({ page, request }) => {
  const errors = pageErrors(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await logIn(page);
  await expect(page.getByLabel("Message", { exact: true })).toBeVisible();
  const projectsResponse = await page.request.get("/api/projects");
  const projects: unknown = await projectsResponse.json();
  assert.ok(Array.isArray(projects));
  const project: unknown = projects[0];
  assert.ok(typeof project === "object" && project !== null && "id" in project && typeof project.id === "string");
  const origin = new URL(page.url()).origin;
  const patch = async (path: string, body: unknown) => {
    const result = await page.request.patch(`/api/${path}`, { headers: { Origin: origin }, data: body });
    expect(result.status()).toBe(200);
    return result;
  };
  const fixtureSecret = "fixture_browser_service_token_124";
  const saved = await patch("settings/environment", [
    { name: "TASK_REGION", action: "set", value: "installation", secret: false },
    { name: "SERVICE_TOKEN", action: "replace", value: fixtureSecret, secret: true },
  ]);
  expect(await saved.text()).not.toContain(fixtureSecret);
  await patch(`projects/${project.id}/environment`, [{ name: "TASK_REGION", action: "set", value: "project", secret: false }]);
  await page.goto(`/#chats/new?project=${project.id}`);
  await page.getByLabel("Message", { exact: true }).fill("Check environment delivery");
  const open = async () => {
    await page.getByRole("button", { name: "Chat settings", exact: true }).click();
    await page.getByRole("menuitem", { name: "Environment variables", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("button",{name:"Apply",exact:true})).toBeVisible();
  };
  await open();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Value for TASK_REGION", { exact: true })).toHaveValue("project");
  await expect(dialog.getByLabel("Secret action for SERVICE_TOKEN")).toHaveValue("keep");
  await expect(dialog.getByLabel("Value for SERVICE_TOKEN", { exact: true })).toHaveCount(0);
  await dialog.getByLabel("Value for TASK_REGION", { exact: true }).fill("chat");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("button", { name: "Chat settings", exact: true })).toBeFocused();
  await open();
  await expect(dialog.getByLabel("Value for TASK_REGION", { exact: true })).toHaveValue("chat");
  await dialog.getByLabel("Secret action for SERVICE_TOKEN").selectOption("replace");
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("nonempty replacement secret");
  await dialog.getByLabel("Secret action for SERVICE_TOKEN").selectOption("keep");
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await open();
  await page.screenshot({ animations: "disabled", path: test.info().outputPath("environment-desktop.png") });
  await page.setViewportSize({width:375,height:812});
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(dialog.getByRole("button", { name: "Apply", exact: true })).toBeInViewport();
  await page.screenshot({ animations: "disabled", path: test.info().outputPath("environment-narrow.png") });
  await page.evaluate(() => { document.documentElement.classList.remove("dark"); });
  await page.screenshot({animations:"disabled",path:test.info().outputPath("environment-narrow-light.png")});
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({animations:"disabled",path:test.info().outputPath("environment-desktop-light.png")});
  await page.evaluate(() => { document.documentElement.classList.add("dark"); });
  await page.setViewportSize({width:375,height:812});
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Chat settings", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Start chat", exact: true }).click();
  await expect(page).toHaveURL(/#chats\/[^/?]+$/);
  const chatID = page.url().split("#chats/")[1];
  const snapshot = await page.request.get(`/api/chats/${chatID}/environment`);
  expect(await snapshot.text()).not.toContain(fixtureSecret);
  expect(await snapshot.json()).toContainEqual({ name: "TASK_REGION", value: "chat", secret: false });
  await patch("settings/environment", [{ name: "SERVICE_TOKEN", action: "remove", secret: true }]);
  const snapshotAgain = await page.request.get(`/api/chats/${chatID}/environment`);
  expect(await snapshotAgain.json()).toContainEqual({ name: "SERVICE_TOKEN", secret: true });
  expect(errors).toEqual([]);
  expect((await request.get("/api/settings/environment")).status()).toBe(401);
});


test("installation editor saves secrets and reports invalid drafts", async ({page}) => {
  await logIn(page);
  await openSettings(page);
  await page.getByRole("button",{name:"Add variable",exact:true}).click();
  const name=page.getByLabel("Name",{exact:true});
  await expect(name).toBeFocused();
  await name.fill("INVALID-NAME");
  await page.getByLabel("Value for INVALID-NAME",{exact:true}).fill("draft-value");
  await page.getByRole("button",{name:"Save environment variables",exact:true}).click();
  await expect(page.getByRole("alert")).toContainText("variable name");
  await expect(name).toHaveAttribute("aria-invalid","true");
  await expect(page.getByLabel("Value for INVALID-NAME",{exact:true})).toHaveValue("draft-value");
  await name.fill("SERVICE_TOKEN");
  await page.getByLabel("Value",{exact:true}).selectOption("secret");
  await page.getByLabel("Value for SERVICE_TOKEN",{exact:true}).fill("fixture_ui_secret_124");
  await page.getByRole("button",{name:"Save environment variables",exact:true}).click();
  await expect(page.getByLabel("Secret action for SERVICE_TOKEN")).toHaveValue("keep");
  await expect(page.getByLabel("Value for SERVICE_TOKEN",{exact:true})).toHaveCount(0);
  await page.getByRole("button",{name:"Remove SERVICE_TOKEN",exact:true}).click();
  await expect(page.getByText("Marked for removal",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Undo",exact:true}).click();
  await expect(page.getByLabel("Secret action for SERVICE_TOKEN")).toHaveValue("keep");
  await page.getByLabel("Secret action for SERVICE_TOKEN").selectOption("replace");
  await page.getByRole("button",{name:"Save environment variables",exact:true}).click();
  await expect(page.getByRole("alert")).toContainText("nonempty replacement secret");
  await page.getByRole("heading",{name:"Environment variables",exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({animations:"disabled",path:test.info().outputPath("environment-validation.png")});
  await page.getByLabel("Secret action for SERVICE_TOKEN").selectOption("keep");
  await page.getByRole("button",{name:"Save environment variables",exact:true}).click();
  await expect(page.getByText("Environment variables saved",{exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Secret action for SERVICE_TOKEN")).toHaveValue("keep");
});
