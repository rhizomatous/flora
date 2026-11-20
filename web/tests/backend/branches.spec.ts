import assert from "node:assert/strict";

import { test, expect } from "../fixtures.ts";
import { assertFitsPhone, logIn, pageErrors } from "../helpers.ts";

test.use({ scenario: "branches" });

test("branch overrides keep drafts, defaults, and creation retries", async ({ page, backend }) => {
  const errors = pageErrors(page);
  await logIn(page);
  await page.goto(`${backend.url}/#chats/new`);
  await page.getByRole("button", { name: "Project: Flora workspace", exact: true }).click();
  await page.getByRole("button", { name: "Flora", exact: true }).click();
  const draft = page.getByLabel("Message", { exact: true });
  await draft.fill("Fix the release branch regression");
  const trigger = page.getByRole("button", { name: /^Base branches:/ });
  await trigger.click();
  await expect(page.getByRole("combobox", { name: "Search branches" })).toHaveCount(0);
  await expect(page.getByText("rhizomatous/flora", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("option", { name: "main Default", exact: true })).toHaveCount(1);
  await page.getByRole("option", { name: "deleted", exact: true }).waitFor();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(trigger).toHaveAccessibleName("Base branches: deleted");
  await expect(trigger).toBeFocused();
  await page.getByRole("button", { name: "Start chat", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Base branch was not found" }).waitFor();
  await expect(draft).toHaveValue("Fix the release branch regression");
  await expect(trigger).toHaveAccessibleName("Base branches: deleted");
  await page.reload();
  await expect(draft).toHaveValue("Fix the release branch regression");
  await expect(trigger).toHaveAccessibleName("Base branches: deleted");

  await page.request.post(`${backend.url}/__fixture/github?unavailable=true`);
  await trigger.click();
  await page.getByRole("alert").filter({ hasText: "GitHub validation is unavailable" }).waitFor();
  await expect(page.getByRole("option", { name: "deleted", exact: true })).toBeVisible();
  await page.request.post(`${backend.url}/__fixture/github?unavailable=false`);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await page.getByRole("option", { name: "release/stable", exact: true }).click();
  await trigger.click();
  await page.getByRole("option", { name: "main Default", exact: true }).click();
  await expect(trigger).toHaveAccessibleName("Base branches: main");
  assert.equal(await page.locator('input[name="branches"]').inputValue(), "{}");
  await trigger.click();
  await page.getByRole("option", { name: "release/stable", exact: true }).click();
  await expect(trigger).toHaveAccessibleName("Base branches: release/stable");

  await page.getByRole("button", { name: "Project: Flora", exact: true }).click();
  await page.getByRole("button", { name: "Flora workspace", exact: true }).click();
  await draft.fill("Work across repositories");
  await trigger.click();
  await page.getByRole("option", { name: "rhizomatous/florets develop · Project default", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Search branches" })).toBeFocused();
  await page.getByRole("option", { name: "feature/branch-picker", exact: true }).click();
  await expect(trigger).toHaveAccessibleName("Base branches: 1 override");
  await trigger.click();
  await page.getByRole("option", { name: "rhizomatous/florets feature/branch-picker", exact: true }).click();
  await page.getByRole("button", { name: "All repositories", exact: true }).click();
  await page.getByRole("button", { name: "Use project defaults", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(trigger).toHaveAccessibleName("Base branches: Defaults");
  await page.request.post(`${backend.url}/__fixture/github?unavailable=true`);
  await page.getByRole("button", { name: "Start chat", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "GitHub validation is unavailable" }).waitFor();
  await expect(draft).toHaveValue("Work across repositories");
  await page.request.post(`${backend.url}/__fixture/github?unavailable=false`);

  await page.getByRole("button", { name: "Project: Flora workspace", exact: true }).click();
  await page.getByRole("button", { name: "Flora", exact: true }).click();
  await expect(draft).toHaveValue("Fix the release branch regression");
  await expect(trigger).toHaveAccessibleName("Base branches: release/stable");
  await assertFitsPhone(page);
  await trigger.click();
  await page.getByRole("option", { name: "release/stable", exact: true }).waitFor();
  const popover = page.getByRole("dialog", { name: "Choose base branches" });
  const box = await popover.boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= 375);
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();

  // Lose the successful response, then retry during a GitHub outage. The saved
  // creation identity must return its frozen chat without validating again.
  let requestBody: Record<string, unknown> | undefined;
  await page.route("**/api/projects/*/chats", async (route) => {
    requestBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fetch();
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "Start chat", exact: true }).click();
  await page.getByRole("alert").waitFor();
  await expect(draft).toHaveValue("Fix the release branch regression");
  await page.unroute("**/api/projects/*/chats");
  await page.request.post(`${backend.url}/__fixture/github?unavailable=true`);
  await page.getByRole("button", { name: "Start chat", exact: true }).click();
  await expect(page).not.toHaveURL(/#chats\/new$/);
  assert.ok(requestBody);
  const chats = await page.request.get(`${backend.url}/api/chats`);
  const saved = (await chats.json()) as { Configuration: { repositories: { name: string; baseBranch: string }[] }; ID: string }[];
  assert.equal(saved.length, 1);
  assert.equal(saved[0]?.Configuration.repositories[0]?.baseBranch, "release/stable");
  const projects = await page.request.get(`${backend.url}/api/projects`);
  const defaults = (await projects.json()) as { name: string; configuration: { repositories: { baseBranch: string }[] } }[];
  assert.equal(defaults.find((p) => p.name === "Flora")?.configuration.repositories[0]?.baseBranch, "main");
  assert.deepEqual(errors, []);
});

test("branch pages load and loading failures can retry", async ({ page, backend }) => {
  await logIn(page);
  await page.goto(`${backend.url}/#chats/new`);
  await page.getByRole("button", { name: "Project: Flora workspace", exact: true }).click();
  await page.getByRole("button", { name: "Flora", exact: true }).click();
  let secondPageFails = true;
  let releaseFirstPage: (() => void) | undefined;
  const firstPage = new Promise<void>((resolve) => { releaseFirstPage = resolve; });
  await page.route("**/api/projects/*/branches?**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("page") === "1") {
      await firstPage;
      await route.fulfill({ json: { branches: ["main", "feature/first"], nextPage: 2 } });
    } else if (secondPageFails) {
      await route.fulfill({ status: 503, json: { error: "GitHub is temporarily unavailable. Try again." } });
    } else {
      await route.fulfill({ json: { branches: ["release/second-page"], nextPage: 0 } });
    }
  });
  const trigger = page.getByRole("button", { name: /^Base branches:/ });
  await trigger.click();
  await expect(page.getByText("Loading branches…", { exact: true })).toBeVisible();
  releaseFirstPage?.();
  await page.getByRole("button", { name: "Load more branches", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "GitHub is temporarily unavailable" }).waitFor();
  await expect(page.getByRole("option", { name: "feature/first", exact: true })).toBeVisible();
  secondPageFails = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();

  await page.getByRole("option", { name: "release/second-page", exact: true }).click();
  await expect(trigger).toHaveAccessibleName("Base branches: release/second-page");
});
