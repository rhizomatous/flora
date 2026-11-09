import assert from "node:assert/strict";

import { test } from "../fixtures.ts";

import { assertFitsPhone, logIn, pageErrors } from "../helpers.ts";

test.use({ scenario: "projects" });

test("project repositories, validation, and keyboard focus", async ({ page, backend }) => {
  const errors = pageErrors(page);
  await logIn(page);
  await page.goto(`${backend.url}/#projects/new`);
  await page.getByLabel("Project name", { exact: true }).fill("Collection");
  await page.getByLabel("GitHub repository", { exact: true }).fill("first/app");
  await page.getByRole("button", { name: "Add repository", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () => document.activeElement === document.querySelectorAll('input[name="repository"]')[1],
  );
  await page.getByLabel("GitHub repository", { exact: true }).nth(1).fill("second/app");
  await page.getByLabel("Base branch", { exact: true }).nth(1).fill("release");
  // Observe focus when the new input enters the DOM, before another interaction
  // can begin. A later animation-frame callback must not steal typing focus.
  await page.evaluate(() => {
    const form = document.querySelector("form");
    if (form === null) throw new Error("project form not found");
    window.repositoryFocusAtInsert = new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        const inputs = document.querySelectorAll('input[name="repository"]');
        const inserted = inputs[2];
        if (inputs.length !== 3 || inserted === undefined) return;
        observer.disconnect();
        const insertedFocused = document.activeElement === inserted;
        const branch =
          inserted
            .closest("fieldset")
            ?.querySelector<HTMLInputElement>('input[name="baseBranch"]') ?? null;
        branch?.focus();
        requestAnimationFrame(() => {
          resolve({
            insertedFocused,
            branchRetained: branch !== null && document.activeElement === branch,
          });
        });
      });
      observer.observe(form, { childList: true, subtree: true });
    });
  });
  await page.getByRole("button", { name: "Add repository", exact: true }).click();
  const focus = await page.evaluate(() => window.repositoryFocusAtInsert);
  assert.equal(
    focus.branchRetained,
    true,
    "a pending focus callback must not redirect typing from the base branch",
  );
  assert.equal(
    focus.insertedFocused,
    true,
    "new repository must receive focus as its row is committed",
  );
  await page.getByLabel("GitHub repository", { exact: true }).nth(2).fill("third/extra");
  await page.getByLabel("Base branch", { exact: true }).nth(2).fill("missing");
  await page.getByLabel("Repository role", { exact: true }).nth(2).selectOption("extra");
  await page.getByLabel("Setup command (optional)", { exact: true }).fill("printf ready");
  await page.getByRole("button", { name: "Validate and connect", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Base branch was not found" }).waitFor();
  await page.getByLabel("Base branch", { exact: true }).nth(2).fill("next");
  await page.getByRole("button", { name: "Validate and connect", exact: true }).click();
  await page.getByRole("heading", { name: "Collection", exact: true }).waitFor();
  await page.reload();
  await page.getByRole("heading", { name: "Collection", exact: true }).waitFor();
  assert.deepEqual(
    await page
      .getByLabel("GitHub repository", { exact: true })
      .evaluateAll((inputs: HTMLInputElement[]) => inputs.map((input) => input.value)),
    [
      "https://github.com/first/app.git",
      "https://github.com/second/app.git",
      "https://github.com/third/extra.git",
    ],
  );
  assert.deepEqual(
    await page
      .getByLabel("Base branch", { exact: true })
      .evaluateAll((inputs: HTMLInputElement[]) => inputs.map((input) => input.value)),
    ["main", "release", "next"],
  );
  await page.getByRole("button", { name: "Remove repository 2", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () => document.activeElement?.matches("[data-add-repository]") === true,
  );
  await page.getByRole("button", { name: "Add repository", exact: true }).click();
  await page.getByLabel("GitHub repository", { exact: true }).nth(2).fill("fourth/tools");
  await page.getByRole("button", { name: "Validate and save", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "Existing chats keep their original settings" })
    .waitFor();
  await page.reload();
  await page.getByRole("heading", { name: "Collection", exact: true }).waitFor();
  assert.equal(
    await page.getByLabel("GitHub repository", { exact: true }).nth(1).inputValue(),
    "https://github.com/third/extra.git",
  );
  assert.equal(
    await page.getByLabel("Repository role", { exact: true }).nth(1).inputValue(),
    "extra",
  );
  await assertFitsPhone(page);
  await page.getByRole("link", { name: "All projects", exact: true }).click();
  await page
    .getByText("first/app.git · Branch: main · Available at startup", { exact: true })
    .waitFor();
  await page
    .getByText("third/extra.git · Branch: next · Fetched on demand", { exact: true })
    .waitFor();
  assert.deepEqual(errors, []);
});
