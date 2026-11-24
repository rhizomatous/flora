import assert from "node:assert/strict";

import { test, expect } from "../fixtures.ts";
import { logIn, openSettings, assertFitsPhone, pageErrors } from "../helpers.ts";

test.use({ scenario: "settings" });

test("GitHub manifest submission and callback retry", async ({ page, backend }) => {
  const errors = pageErrors(page);
  await logIn(page);
  await openSettings(page);
  await expect(page.getByRole("button", { name: "Connect GitHub", exact: true })).toBeEnabled();
  await page.route("https://github.com/**", async route => {
    await route.fulfill({ contentType: "text/html", body: "<h1>GitHub App approval</h1>" });
  });
  const submitted = page.waitForRequest(request => request.url().startsWith("https://github.com/settings/apps/new"));
  await page.getByRole("button", { name: "Connect GitHub", exact: true }).click();
  const outgoing = await submitted;
  assert.equal(outgoing.method(), "POST");
 await expect(page.getByRole("heading",{name:"GitHub App approval",exact:true})).toBeVisible();
  const payload = new URLSearchParams(outgoing.postData() ?? "");
  const manifest: unknown = JSON.parse(payload.get("manifest") ?? "{}");
  assert.ok(typeof manifest === "object" && manifest !== null);
  assert.ok("redirect_url" in manifest);
  assert.equal(manifest.redirect_url, `${backend.url}/github/callback`);
  assert.ok("request_oauth_on_install" in manifest);
  assert.equal(manifest.request_oauth_on_install, false);
  const state = new URL(outgoing.url()).searchParams.get("state");
  assert.ok(state);
  let callbacks = 0;
  await page.route("**/api/github/complete", async route => {
    callbacks++;
    assert.deepEqual(route.request().postDataJSON(), { state, code: "fixture-code", installationID: 0, action: "" });
    await route.fulfill({ status: callbacks === 1 ? 502 : 200, json: callbacks === 1 ? { error: "GitHub temporarily unavailable. Retry setup." } : { ok: true } });
  });
  await page.goto(`${backend.url}/github/callback?code=fixture-code&state=${state}`);
  await expect(page.getByRole("alert")).toContainText("GitHub temporarily unavailable");
  await expect(page.getByRole("button", { name: "Retry GitHub setup" })).toBeEnabled();
  await page.getByRole("button", { name: "Retry GitHub setup" }).click();
  await expect(page.getByRole("button", { name: "Retry GitHub setup" })).toHaveCount(0);
  await expect(page).toHaveURL(`${backend.url}/#settings`);
  assert.equal(callbacks, 2);
  assert.deepEqual(errors, []);
});

test("GitHub approvals, repository discovery and settings fit narrow and wide layouts", async ({ page }, testInfo) => {
  const errors = pageErrors(page);
  const account = "a-long-organization-name-for-flora";
  let connected = false;
  await page.route("**/api/github/connection", async route => {
    await route.fulfill({ json: {
      state: connected ? "connected" : "pending", slug: "flora-fixture", account: connected ? account : "",
      installationID: connected ? 40 : 0, pat: true, active: connected ? "app" : "pat",
      installations: [
        { id: 40, account: { login: account }, suspended_at: null },
        { id: 41, account: { login: "suspended-organization" }, suspended_at: "2026-11-24T10:00:00Z" },
      ],
    } });
  });
  await page.route("**/api/github/installation", async route => {
    assert.deepEqual(route.request().postDataJSON(), { id: 40 });
    connected = true;
    await route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/github/repositories*", async route => {
    await route.fulfill({ json: { repositories: [{ full_name: `${account}/a-long-repository-name-for-testing`, html_url: `https://github.com/${account}/a-long-repository-name-for-testing`, default_branch: "main" }], nextPage: 0 } });
  });
  await logIn(page);
  await openSettings(page);
  await expect(page.getByText(/Organization approval requested/)).toBeVisible();
  const choices = page.getByRole("button", { name: "Use installation", exact: true });
  await expect(choices.nth(1)).toBeDisabled();
  await choices.first().focus();
  await page.keyboard.press("Enter");
  await expect(choices.first()).toBeDisabled();
  await expect(page.getByText(`${account}/a-long-repository-name-for-testing`, { exact: true })).toBeVisible();
  for (const theme of ["dark", "light"]) {
    await page.evaluate(value => { document.documentElement.classList.toggle("dark", value === "dark"); }, theme);
    await assertFitsPhone(page);
    await page.getByRole("button", { name: "Install GitHub App", exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByRole("button", { name: "Install GitHub App", exact: true })).toBeInViewport();
    await page.screenshot({path:testInfo.outputPath(`github-${theme}-phone.png`)});
 await page.setViewportSize({ width: 1280, height: 900 });
 await page.screenshot({path:testInfo.outputPath(`github-${theme}-wide.png`)});
  }
  await page.getByRole("link", { name: "Connect project", exact: true }).click();
  const select = page.getByLabel("Choose a repository", { exact: true });
  await expect(select).toBeVisible();
  await select.selectOption(`https://github.com/${account}/a-long-repository-name-for-testing`);
  await expect(page.getByRole("textbox", { name: "GitHub repository", exact: true })).toHaveValue(`https://github.com/${account}/a-long-repository-name-for-testing`);
  await assertFitsPhone(page);
  assert.deepEqual(errors, []);
});
