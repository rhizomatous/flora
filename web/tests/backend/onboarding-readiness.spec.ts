import { test, expect } from "../fixtures.ts";
import { logIn } from "../helpers.ts";

test("readiness failures, recovery, and explicit selected-project handoff", async ({ page, backend }, testInfo) => {
  await logIn(page);
  const baseline = await (await page.request.get("/api/chats")).json();
  const projects = await (await page.request.get("/api/projects")).json();
  const project = projects[0];
  let executions = 0;
  page.on("request", request => {
    if (request.method() === "POST" && /\/api\/(projects\/[^/]+\/chats|chats\/[^/]+\/messages)/.test(request.url())) executions++;
  });
  let mode = "failed";
  let release: (() => void) | undefined;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/onboarding/readiness", async route => {
    if (mode === "loading") await waiting;
    if (mode === "network-error") {
      await route.fulfill({status:502,json:{error:"Readiness service unavailable. Retry checks."}});
      return;
    }
    const response = await route.fetch(mode === "stale" ? { postData: "{}" } : {});
    const body = await response.json();
    if (mode === "failed" || mode === "stale") {
      body.readiness.ready = false;
      body.onboarding.completed = false;
      body.readiness.checks = body.readiness.checks.map((check: {id:string}) => check.id === "docker" ? {...check,ok:false,message:"Cannot reach Docker. Start Docker and check socket permissions."} : check);
    }
    await route.fulfill({response,json:body});
  });
  await page.goto("/#onboarding/finish");
  await expect(page.getByRole("heading",{name:"Review setup",exact:true})).toBeFocused();
  await expect(page.getByText("Setup needs attention",{exact:true})).toBeVisible();
  await expect(page.getByText("Cannot reach Docker.",{exact:false})).toBeVisible();
  await expect(page.getByRole("button",{name:"Open Flora",exact:true})).toBeDisabled();
  expect((await (await page.request.get("/api/onboarding")).json()).completed).toBe(false);
  async function capture(name:string) {
    for (const width of [1280,375]) {
      await page.setViewportSize({width,height:812});
      for (const dark of [true,false]) {
        await page.evaluate(value => document.documentElement.classList.toggle("dark",value),dark);
        await page.screenshot({path:testInfo.outputPath(`${name}-${width}-${dark ? "dark" : "light"}.png`),fullPage:true,animations:"disabled"});
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
    }
  }
  await capture("failure");
  await page.getByRole("link",{name:"Open installation settings",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Installation settings",exact:true})).toBeFocused();
  await page.reload();
  await expect(page.getByRole("heading",{name:"Installation settings",exact:true})).toBeFocused();
  mode = "network-error";
  await page.getByRole("link",{name:"Return to setup",exact:true}).click();
  await expect(page.getByRole("alert")).toContainText("Readiness service unavailable");
  await expect(page.getByRole("button",{name:"Open Flora",exact:true})).toBeDisabled();
  mode = "loading";
  await page.getByRole("button",{name:"Retry checks",exact:true}).click();
  await expect(page.getByText("Checking setup…",{exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Back",exact:true})).toBeDisabled();
  await expect(page.getByRole("button",{name:"Open Flora",exact:true})).toBeDisabled();
  await capture("loading");
  mode = "ready";
  release?.();
  await expect(page.getByText("Setup checks passed",{exact:true})).toBeVisible();
  await expect(page.getByText("GitHub metadata access",{exact:true})).toBeVisible();
  await expect(page.getByText("Model metadata access",{exact:true})).toBeVisible();
  await capture("ready");
  // The finish request must replace an earlier passed result with new failures.
  mode = "stale";
  await page.getByRole("button",{name:"Open Flora",exact:true}).click();
  await expect(page.getByText("Setup needs attention",{exact:true})).toBeVisible();
  await expect(page).toHaveURL(/onboarding\/finish$/);
  await expect(page.getByRole("button",{name:"Open Flora",exact:true})).toBeDisabled();
  mode = "ready";
  await page.getByRole("button",{name:"Retry checks",exact:true}).click();
  await expect(page.getByRole("button",{name:"Open Flora",exact:true})).toBeEnabled();
  await page.getByRole("button",{name:"Open Flora",exact:true}).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`#chats/new\\?project=${project.id}$`));
  await expect(page.getByRole("combobox",{name:"Message",exact:true})).toBeEmpty();
  await expect(page.locator('input[name="project"]')).toHaveValue(project.id);
  expect(executions).toBe(0);
  expect(await (await page.request.get(`${backend.url}/api/chats`)).json()).toEqual(baseline);
  await page.reload();
  await expect(page).toHaveURL(/#chats\/new/);
  await page.route("**/api/projects/*/chats", async route => {
    await route.fulfill({status:503,json:{error:"Agent image is unavailable. Restore the pinned image and retry."}});
  });
  await page.getByRole("combobox",{name:"Message",exact:true}).fill("Review the project");
  await page.getByRole("button",{name:"Start chat",exact:true}).click();
  await expect(page.getByRole("alert")).toContainText("Agent image is unavailable");
  await expect(page.getByRole("combobox",{name:"Message",exact:true})).toHaveValue("Review the project");
  await expect(page.getByRole("link",{name:"Check setup",exact:true})).toBeVisible();
  expect(executions).toBe(1);
});
