import assert from "node:assert/strict";
import { test, expect } from "../fixtures.ts";
import { logIn, openSettings, pageErrors } from "../helpers.ts";

test.use({ scenario: "projects" });

async function openEnvironment(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Chat settings", exact: true }).click();
  await page.getByRole("menuitem", { name: "Environment variables", exact: true }).click();
  const dialog=page.getByRole("dialog");
  await expect(dialog.getByLabel("Key", {exact:true})).toBeVisible();
  return dialog;
}
async function projectID(page: import("@playwright/test").Page) {
  const response=await page.request.get("/api/projects");
  const projects:unknown=await response.json();
  assert.ok(Array.isArray(projects));
  const project:unknown=projects[0];
  assert.ok(typeof project==="object"&&project!==null&&"id" in project&&typeof project.id==="string");
  return project.id;
}

test("chat overrides, project scope, imports and frozen secrets",async({page,request})=>{
  const errors=pageErrors(page);
  await page.setViewportSize({width:1440,height:1000});
  await logIn(page);
  await expect(page.getByLabel("Message",{exact:true})).toBeVisible();
  const project=await projectID(page);
  const origin=new URL(page.url()).origin;
  const patch=async(path:string,body:unknown)=>{
    const response=await page.request.patch(`/api/${path}`,{headers:{Origin:origin},data:body});
    expect(response.status()).toBe(200);return response;
  };
  const fixtureSecret="fixture_browser_service_token_124";
  await patch("settings/environment",[
    {name:"SERVICE_TOKEN",action:"replace",value:fixtureSecret,secret:true,description:"Staging service"},
    {name:"TASK_REGION",action:"set",value:"installation",secret:false},
  ]);
  await patch(`projects/${project}/environment`,[{name:"TASK_REGION",action:"set",value:"project",secret:false}]);
  await page.goto(`/#chats/new?project=${project}`);
  await page.getByLabel("Message",{exact:true}).fill("Check environment delivery");
  let dialog=await openEnvironment(page);
  await expect(dialog.getByRole("radio",{name:"This chat",exact:true})).toBeChecked();
  await dialog.getByRole("button",{name:"Variables",exact:true}).click();
  await dialog.getByRole("button",{name:"Edit TASK_REGION",exact:true}).click();
  await expect(dialog.getByLabel("Value",{exact:true})).toHaveValue("project");
  await dialog.getByLabel("Value",{exact:true}).fill("chat");
  await dialog.getByRole("button",{name:"Save changes",exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel("Message",{exact:true})).toHaveValue("Check environment delivery");
  dialog=await openEnvironment(page);
  await dialog.getByRole("button",{name:"Variables",exact:true}).click();
  await dialog.getByRole("button",{name:"Edit SERVICE_TOKEN",exact:true}).click();
  await expect(dialog.getByLabel("Action",{exact:true})).toHaveValue("keep");
  await expect(dialog.getByLabel("Value",{exact:true})).toHaveCount(0);
  await dialog.getByLabel("Action",{exact:true}).selectOption("replace");
  await dialog.getByRole("button",{name:"Save changes",exact:true}).click();
  await expect(dialog.getByRole("alert")).toContainText("nonempty replacement secret");
  await dialog.getByLabel("Action",{exact:true}).selectOption("keep");
  await dialog.getByRole("button",{name:"Save changes",exact:true}).click();
  dialog=await openEnvironment(page);
  await dialog.getByRole("radio",{name:"Project",exact:true}).check();
  await dialog.getByLabel("Import .env file").setInputFiles({name:".env",mimeType:"text/plain",buffer:Buffer.from('PROJECT_TOKEN=fixture_project_token_124\nPROJECT_REGION="north"')});
  await expect(dialog.getByLabel("Key",{exact:true})).toHaveCount(2);
  const before=await page.request.get(`/api/projects/${project}/environment`);
  expect(await before.text()).not.toContain("PROJECT_TOKEN");
  await page.setViewportSize({width:375,height:812});
  await dialog.getByLabel("Key",{exact:true}).nth(1).scrollIntoViewIfNeeded();
  await expect(dialog.getByRole("button",{name:"Save to project",exact:true})).toBeInViewport();
  await page.screenshot({animations:"disabled",path:test.info().outputPath("environment-import-narrow.png")});
  await dialog.getByRole("button",{name:"Save to project",exact:true}).click();
  await page.setViewportSize({width:1440,height:1000});
  await expect(dialog).toHaveCount(0);
  const durable=await page.request.get(`/api/projects/${project}/environment`);
  const durableText=await durable.text();
  expect(durableText).toContain("PROJECT_TOKEN");expect(durableText).not.toContain("fixture_project_token_124");
  const installation=await page.request.get("/api/settings/environment");expect(await installation.text()).not.toContain("PROJECT_TOKEN");
  dialog=await openEnvironment(page);
  await dialog.getByRole("radio",{name:"This chat",exact:true}).check();
  await dialog.getByLabel("Key",{exact:true}).fill("CHAT_TOKEN");
  await dialog.getByLabel("Value",{exact:true}).fill("fixture_chat_secret_124");
  await dialog.getByLabel("Description Optional",{exact:true}).fill("Preview deployment credentials");
  await expect(dialog.getByLabel("Value",{exact:true})).toHaveAttribute("type","password");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Chat settings",exact:true})).toBeFocused();
  dialog=await openEnvironment(page);
  await expect(dialog.getByLabel("Key",{exact:true})).toHaveValue("CHAT_TOKEN");
  await expect(dialog.getByLabel("Value",{exact:true})).toHaveValue("fixture_chat_secret_124");
  await page.screenshot({animations:"disabled",path:test.info().outputPath("environment-desktop.png")});
  await page.setViewportSize({width:375,height:812});
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect(dialog.getByRole("button",{name:"Use variable",exact:true})).toBeInViewport();
  await page.screenshot({animations:"disabled",path:test.info().outputPath("environment-narrow.png")});
  await page.evaluate(()=>{document.documentElement.classList.remove("dark");});
  await page.screenshot({animations:"disabled",path:test.info().outputPath("environment-narrow-light.png")});
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({animations:"disabled",path:test.info().outputPath("environment-desktop-light.png")});
  await page.evaluate(()=>{document.documentElement.classList.add("dark");});
  await dialog.getByLabel("Value",{exact:true}).press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/#chats\/new/);
  await page.getByRole("button",{name:"Start chat",exact:true}).click();
  await expect(page).toHaveURL(/#chats\/[^/?]+$/);
  const chat=page.url().split("#chats/")[1];
  const snapshot=await page.request.get(`/api/chats/${chat}/environment`);
  const body=await snapshot.text();expect(body).not.toContain(fixtureSecret);expect(body).not.toContain("fixture_chat_secret_124");
  expect(await snapshot.json()).toEqual(expect.arrayContaining([
    {name:"TASK_REGION",value:"chat",secret:false},
    {name:"CHAT_TOKEN",secret:true,description:"Preview deployment credentials"},
    {name:"PROJECT_TOKEN",secret:true},
  ]));
  await patch("settings/environment",[{name:"SERVICE_TOKEN",action:"remove",secret:true}]);
  const again=await page.request.get(`/api/chats/${chat}/environment`);expect(await again.text()).toContain("SERVICE_TOKEN");
  expect(await page.evaluate(()=>JSON.stringify(sessionStorage))).not.toContain("fixture_chat_secret_124");
  expect(errors).toEqual([]);expect((await request.get("/api/settings/environment")).status()).toBe(401);
});

test("compact saved list, secret actions, descriptions and focus restoration",async({page})=>{
  await page.setViewportSize({width:1440,height:1000});
  await logIn(page);await openSettings(page);
  await page.getByRole("button",{name:"Add variable",exact:true}).click();
  let dialog=page.getByRole("dialog");
  await expect(dialog.getByLabel("Key",{exact:true})).toBeFocused();
  await dialog.getByLabel("Key",{exact:true}).fill("INVALID-NAME");
  await dialog.getByLabel("Value",{exact:true}).fill("fixture_ui_secret_124");
  await dialog.getByRole("button",{name:"Add variable",exact:true}).click();
  await expect(dialog.getByRole("alert")).toContainText("variable name");
  await expect(dialog.getByLabel("Value",{exact:true})).toHaveValue("fixture_ui_secret_124");
  await dialog.getByLabel("Key",{exact:true}).fill("SERVICE_TOKEN");
  await dialog.getByLabel("Description Optional",{exact:true}).fill("Service credentials for staging");
  await dialog.getByLabel("Key",{exact:true}).press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("list",{name:"Environment variables",exact:true}).getByRole("listitem")).toHaveCount(1);
  await expect(page.getByRole("list",{name:"Environment variables",exact:true}).getByRole("textbox")).toHaveCount(0);
  await page.getByRole("heading",{name:"Environment variables",exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({animations:"disabled",path:test.info().outputPath("environment-list-desktop.png")});
  await page.setViewportSize({width:375,height:812});
  await page.getByRole("heading",{name:"Environment variables",exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({animations:"disabled",path:test.info().outputPath("environment-list-narrow.png")});
  await page.getByRole("button",{name:"Edit SERVICE_TOKEN",exact:true}).click();
  dialog=page.getByRole("dialog");
  await expect(dialog.getByLabel("Action",{exact:true})).toHaveValue("keep");
  await expect(dialog.getByLabel("Value",{exact:true})).toHaveCount(0);
  await dialog.getByLabel("Action",{exact:true}).selectOption("replace");
  await dialog.getByRole("button",{name:"Save changes",exact:true}).click();
  await expect(dialog.getByRole("alert")).toContainText("nonempty replacement secret");
  await page.screenshot({animations:"disabled",path:test.info().outputPath("environment-validation.png")});
  await dialog.getByLabel("Action",{exact:true}).selectOption("keep");
  await dialog.getByRole("button",{name:"Save changes",exact:true}).click();
  await expect(page.getByRole("button",{name:"Edit SERVICE_TOKEN",exact:true})).toBeFocused();
  await page.reload();
  await page.getByRole("button",{name:"Edit SERVICE_TOKEN",exact:true}).click();
  await page.getByRole("dialog").getByLabel("Action",{exact:true}).selectOption("remove");
  await page.getByRole("dialog").getByRole("button",{name:"Remove variable",exact:true}).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Add variable",exact:true})).toBeFocused();
  await expect(page.getByText("No environment variables",{exact:true})).toBeVisible();
});

test("dotenv paste reviews imports, preserves drafts and supports empty ordinary values",async({page})=>{
  await logIn(page);await openSettings(page);
  await page.getByRole("button",{name:"Add variable",exact:true}).click();
  let dialog=page.getByRole("dialog");
  await dialog.getByRole("button",{name:"Paste .env",exact:true}).click();
  await dialog.getByLabel("Paste .env",{exact:true}).fill('TOKEN=fixture_import_secret\nTOKEN=duplicate');
  await dialog.getByRole("button",{name:"Review variables",exact:true}).click();
  await expect(dialog.getByRole("alert")).toContainText("only once");
  await expect(dialog.getByRole("alert")).not.toContainText("fixture_import_secret");
  await page.keyboard.press("Escape");
  await page.getByRole("button",{name:"Add variable",exact:true}).click();
  dialog=page.getByRole("dialog");
  await dialog.getByRole("button",{name:"Paste .env",exact:true}).click();
  await dialog.getByLabel("Paste .env",{exact:true}).fill('TOKEN=fixture_import_secret\nEMPTY=');
  await dialog.getByRole("button",{name:"Review variables",exact:true}).click();
  await expect(dialog.getByLabel("Key",{exact:true})).toHaveCount(2);
  await dialog.getByRole("button",{name:"Add variables",exact:true}).click();
  await expect(dialog.getByRole("alert")).toContainText("nonempty replacement secret");
  const empty=dialog.getByRole("region",{name:"Variable 2",exact:true});
  await empty.getByText("Options",{exact:true}).click();
  await empty.getByRole("switch",{name:"Secret",exact:true}).uncheck();
  await dialog.getByRole("button",{name:"Add variables",exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Edit EMPTY",exact:true})).toContainText("Empty value");
});

test("project variables remain compact with long names on desktop and phone",async({page})=>{
  await page.setViewportSize({width:1440,height:1000});
  await logIn(page);await expect(page.getByLabel("Message",{exact:true})).toBeVisible();
  const project=await projectID(page);const origin=new URL(page.url()).origin;
  const response=await page.request.patch(`/api/projects/${project}/environment`,{headers:{Origin:origin},data:[
    {name:"DEPLOY_TOKEN",action:"replace",value:"fixture_project_list_secret",secret:true,description:"Staging deployment credentials"},
    {name:"DEPLOY_REGION",action:"set",value:"staging",secret:false},
    {name:`SERVICE_DEPLOYMENT_${"CREDENTIAL_".repeat(9)}`,action:"set",value:`https://staging.example.test/${"service/".repeat(12)}`,secret:false,description:"Repository-specific service endpoint"},
  ]});expect(response.status()).toBe(200);
  await page.goto(`/#projects/${project}`);
  const section=page.locator("section").filter({has:page.getByRole("heading",{name:"Environment variables",exact:true})}).last();
  await expect(section.getByRole("listitem")).toHaveCount(3);
  await section.screenshot({animations:"disabled",path:test.info().outputPath("environment-project-desktop.png")});
  await page.setViewportSize({width:375,height:812});
  await section.getByRole("heading",{name:"Environment variables",exact:true}).scrollIntoViewIfNeeded();
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await section.screenshot({animations:"disabled",path:test.info().outputPath("environment-project-narrow.png")});
});
