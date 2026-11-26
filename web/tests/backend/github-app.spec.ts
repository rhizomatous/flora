import assert from "node:assert/strict";

import { test, expect } from "../fixtures.ts";
import { logIn, openWorkspaceMenu, assertFitsPhone, pageErrors } from "../helpers.ts";

test.use({ scenario: "settings" });

async function openConnections(page: Parameters<typeof logIn>[0]) {
  await openWorkspaceMenu(page);
  await page.getByRole("menuitem",{name:"Connections",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Connections",exact:true})).toBeFocused();
}

test("Connections opens GitHub setup and retries a failed callback", async ({ page, backend }) => {
  const errors=pageErrors(page);
  await logIn(page);
  await openConnections(page);
  const row=page.getByRole("link",{name:"GitHub connection",exact:true});
  await expect(row).toContainText("Not connected");
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await row.focus();await page.keyboard.press("Enter");
  await expect(page.getByRole("heading",{name:"GitHub",exact:true})).toBeFocused();
  await expect(page.getByRole("button",{name:"Connect GitHub",exact:true})).toBeEnabled();
  await page.route("https://github.com/**",async route => {
    await route.fulfill({contentType:"text/html",body:"<h1>GitHub App approval</h1>"});
  });
  const submitted=page.waitForRequest(request => request.url().startsWith("https://github.com/settings/apps/new"));
  await page.getByRole("button",{name:"Connect GitHub",exact:true}).click();
  const outgoing=await submitted;
  await expect(page.getByRole("heading",{name:"GitHub App approval",exact:true})).toBeVisible();
  assert.equal(outgoing.method(),"POST");
  const payload=new URLSearchParams(outgoing.postData() ?? "");
  const manifest:unknown=JSON.parse(payload.get("manifest") ?? "{}");
  assert.ok(typeof manifest === "object" && manifest !== null);
  assert.ok("redirect_url" in manifest);
  assert.equal(manifest.redirect_url,`${backend.url}/github/callback`);
  const state=new URL(outgoing.url()).searchParams.get("state");assert.ok(state);
  let callbacks=0;
  await page.route("**/api/github/complete",async route => {
    callbacks++;
    assert.deepEqual(route.request().postDataJSON(),{state,code:"fixture-code",installationID:0,action:""});
    await route.fulfill({status:callbacks === 1 ? 502 : 200,json:callbacks === 1 ? {error:"GitHub temporarily unavailable. Retry setup."} : {ok:true}});
  });
  await page.goto(`${backend.url}/github/callback?code=fixture-code&state=${state}`);
  await expect(page.getByText("GitHub temporarily unavailable. Retry setup.",{exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Retry setup",exact:true})).toBeEnabled();
  await page.getByRole("button",{name:"Retry setup",exact:true}).click();
  await expect(page.getByRole("button",{name:"Retry setup",exact:true})).toHaveCount(0);
  await expect(page).toHaveURL(`${backend.url}/#connections/github`);
  assert.equal(callbacks,2);assert.deepEqual(errors,[]);
});

test("Connections and GitHub details support keyboard navigation, search and narrow layouts", async ({ page },testInfo) => {
  const errors=pageErrors(page);
  const account="a-long-organization-name-for-flora";
  let connected=false;
  let stateOverride="";
  await page.route("**/api/github/connection",async route => {
    await route.fulfill({json:{state:stateOverride || (connected ? "connected" : "pending"),slug:"flora-fixture",account:connected ? account : "",installationID:connected ? 40 : 0,pat:false,active:connected ? "app" : "none",installations:[
      {id:40,account:{login:account},suspended_at:null,html_url:`https://github.com/organizations/${account}/settings/installations/40`},
      {id:41,account:{login:"suspended-organization"},suspended_at:"2026-11-24T10:00:00Z"},
    ]}});
  });
  await page.route("**/api/github/installation",async route => {
    assert.deepEqual(route.request().postDataJSON(),{id:40});connected=true;
    await route.fulfill({json:{ok:true}});
  });
  await page.route("**/api/github/disconnect",async route => {
    connected=false;stateOverride="created";
    await route.fulfill({json:{ok:true}});
  });
  await page.route("**/api/github/repositories*",async route => {
    await route.fulfill({json:{repositories:[{full_name:`${account}/a-long-repository-name-for-testing`,html_url:`https://github.com/${account}/a-long-repository-name-for-testing`,default_branch:"main"}],nextPage:0}});
  });
  await logIn(page);await openConnections(page);
  await expect(page.getByRole("link",{name:"GitHub connection",exact:true})).toContainText("Approval pending");
  await page.getByRole("link",{name:"GitHub connection",exact:true}).click();
  await expect(page.getByText(/An organization owner needs to approve/)).toBeVisible();
  await expect(page.getByRole("button",{name:"Use suspended-organization installation",exact:true})).toBeDisabled();
  const choice=page.getByRole("button",{name:`Use ${account} installation`,exact:true});
  await choice.focus();await page.keyboard.press("Enter");
  const repository=page.getByRole("link",{name:`${account}/a-long-repository-name-for-testing`,exact:true});
  await expect(repository).toBeVisible();
  await expect(page.getByRole("link",{name:"Manage access on GitHub",exact:true})).toHaveAttribute("target","_blank");
 await expect(page.getByRole("link",{name:"Manage access on GitHub",exact:true})).toHaveAttribute("href",`https://github.com/organizations/${account}/settings/installations/40`);
  const search=page.getByRole("searchbox",{name:"Search repositories",exact:true});
  await search.fill("missing");await expect(page.getByText("No matching repositories",{exact:true})).toBeVisible();
  await expect(search).toBeFocused();await search.fill("flora");await expect(repository).toBeVisible();
  await search.clear();
 await page.getByRole("heading",{name:"GitHub",exact:true}).click();
  for (const theme of ["dark","light"]) {
    await page.evaluate(value => {document.documentElement.classList.toggle("dark",value === "dark");},theme);
    for (const width of [375,1280]) {
      await page.setViewportSize({width,height:900});
      await expect(page.getByRole("heading",{name:"GitHub",exact:true})).toBeInViewport();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),true);
      assert.equal(await repository.locator('[data-slot="item-title"]').evaluate(node => node.scrollWidth <= node.clientWidth),true);
 await page.screenshot({animations:"disabled",path:testInfo.outputPath(`github-${theme}-${width}.png`)});
    }
  }
  await page.getByRole("link",{name:"Connections",exact:true}).click();
  const row=page.getByRole("link",{name:"GitHub connection",exact:true});
  await expect(row).toBeFocused();await expect(row).toContainText("Connected");
  for (const theme of ["dark","light"]) {
    await page.evaluate(value => {document.documentElement.classList.toggle("dark",value === "dark");},theme);
    for (const width of [375,1280]) {
      await page.setViewportSize({width,height:900});
      await page.screenshot({animations:"disabled",path:testInfo.outputPath(`connections-${theme}-${width}.png`)});
    }
  }
  await row.click();
  await page.getByRole("button",{name:"Unlink",exact:true}).click();
  await expect(page.getByRole("heading",{name:"GitHub",exact:true})).toBeFocused();
  await expect(page.getByRole("heading",{name:"Repositories",exact:true})).toHaveCount(0);
  await expect(page.getByText("Not connected",{exact:true})).toBeVisible();
  stateOverride="";
  await page.getByRole("button",{name:`Use ${account} installation`,exact:true}).click();
  await expect(repository).toBeVisible();
  stateOverride="revoked";
  await page.getByRole("button",{name:"Refresh GitHub connection",exact:true}).click();
  await expect(page.getByText(/Repository access was revoked/)).toBeVisible();
  await expect(page.getByRole("heading",{name:"Repositories",exact:true})).toHaveCount(0);
  stateOverride="";
  await page.getByRole("button",{name:"Refresh GitHub connection",exact:true}).click();
  await page.getByRole("link",{name:"Connect project",exact:true}).click();
  const select=page.getByRole("combobox",{name:"Choose a repository",exact:true});
  await expect(select).toBeVisible();await select.fill("a-long-repository");await page.getByRole("option",{name:`${account}/a-long-repository-name-for-testing`,exact:true}).click();
  await expect(page.getByRole("textbox",{name:"GitHub repository",exact:true})).toHaveValue(`https://github.com/${account}/a-long-repository-name-for-testing`);
  await expect(page.locator('[data-slot="combobox-content"]')).toHaveCount(0);
  await assertFitsPhone(page);
  await select.click();
  await expect(page.getByRole("option",{name:`${account}/a-long-repository-name-for-testing`,exact:true})).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(select).toBeFocused();assert.deepEqual(errors,[]);
});
