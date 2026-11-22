import assert from "node:assert/strict";

import { test, expect } from "../fixtures.ts";
import { logIn, pageErrors } from "../helpers.ts";

test.use({ scenario: "context" });

test("context picker adds live references, restores drafts, and supports keyboard selection in both composers", async ({
  page,
  backend,
}) => {
  const errors = pageErrors(page);
  await logIn(page);
  await page.goto(`${backend.url}/#chats/${backend.chatID}`);
  const composer = page.getByLabel("Follow-up", { exact: true });
  await composer.fill("Review ");
  await page.getByRole("button", { name: "Add attachments and context" }).click();
  await page.getByRole("menuitem", { name: "Files", exact: true }).click();
  const search = page.getByRole("combobox", { name: "Search context" });
  await expect(search).toBeFocused();
  await search.fill("README.md");
  await expect(
    page.getByRole("listbox", { name: "Context results" }).getByRole("option"),
  ).toHaveCount(2);
  await search.press("ArrowDown");
  await search.press("Enter");
  await expect(page.getByLabel("Draft context")).toContainText("README.md");
  await expect(composer).toHaveValue("Review ");
  await expect(composer).toBeFocused();
  await page.reload();
  await expect(page.getByLabel("Draft context")).toContainText("README.md");
  await expect(composer).toHaveValue("Review ");
  await composer.fill("Review @Explore");
  await expect(page.getByRole("dialog", { name: "Add context" })).toBeVisible();
  await expect(
    page.getByRole("listbox", { name: "Context results" }).getByRole("option"),
  ).toHaveCount(1);
  await composer.press("Enter");
  await expect(page.getByLabel("Draft context")).toContainText("Explore workspace files");
  await expect(composer).toHaveValue("Review ");
  await composer.fill("Review @literal");
  await composer.press("Escape");
  await expect(page.getByRole("dialog", { name: "Add context" })).toHaveCount(0);
  await expect(composer).toHaveValue("Review @literal");
  await page.getByRole("button", { name: "Remove context README.md" }).click();
  await expect(page.getByLabel("Draft context")).not.toContainText("README.md");
  await composer.dispatchEvent("compositionstart");
  await composer.fill("Review @入力");
  await expect(page.getByRole("dialog", { name: "Add context" })).toHaveCount(0);
  await composer.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true });
  await expect(page.getByLabel("Sent context")).toHaveCount(0);
  await composer.dispatchEvent("compositionend");
  await composer.press("Escape");
  await composer.fill("Review selected context");
  await page.getByRole("button", { name: "Add attachments and context" }).click();
  await page.getByRole("menuitem", { name: "Pull requests", exact: true }).click();
  await expect(
    page.getByRole("listbox", { name: "Context results" }).getByRole("option").first(),
  ).toContainText("#42");
  await search.press("Enter");
  await expect(page.getByLabel("Draft context")).toContainText("#42");
  await expect(page.getByLabel("Draft context").getByRole("img", { name: "open pull request", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByLabel("Sent context")).toContainText("#42");
  await expect(page.getByLabel("Sent context")).not.toContainText("Snapshot");
  await expect(page.getByLabel("Draft context")).toHaveCount(0);
  await expect(page.getByText("Saved response 1",{exact:true})).toBeVisible();
  await page.goto(`${backend.url}/#chats/new`);
  const newComposer = page.getByLabel("Message", { exact: true });
  await newComposer.fill("New draft");
  await page.getByRole("button", { name: "Add attachments and context" }).click();
  await page.getByRole("menuitem", { name: "Files", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Add context" })).toContainText(
    "Workspace files are available after",
  );
  await page.setViewportSize({ width: 375, height: 812 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.getByRole("button", { name: "Chats", exact: true }).click();
  await search.fill("Explore");
  await expect(
    page.getByRole("listbox", { name: "Context results" }).getByRole("option"),
  ).toHaveCount(2);
  await search.press("Enter");
  await expect(page.getByLabel("Draft context")).toContainText("Explore");
  await expect(newComposer).toHaveValue("New draft");
  await page.reload();
  await expect(page.getByLabel("Draft context")).toContainText("Explore");
  await expect(newComposer).toHaveValue("New draft");
  await newComposer.fill("");
  await page.getByRole("button",{name:"Start chat",exact:true}).click();
  await expect(page.getByLabel("Sent context")).toContainText("Explore");
  assert.deepEqual(errors, []);
});

test("file references do not copy large contents and keep the draft", async ({
  page,
  backend,
}) => {
  await logIn(page);
  await page.goto(`${backend.url}/#chats/${backend.chatID}`);
  await page.getByLabel("Follow-up", { exact: true }).fill("Keep this draft");
  await page.getByRole("button", { name: "Add attachments and context" }).click();
  await page.getByRole("menuitem", { name: "Files", exact: true }).click();
  const search = page.getByRole("combobox", { name: "Search context" });
  await search.fill("no-such-file");
  await expect(page.getByText("No files found", { exact: true })).toBeVisible();
  await search.fill("large.log");
  await expect(
    page.getByRole("listbox", { name: "Context results" }).getByRole("option"),
  ).toHaveCount(2);
  await search.press("Enter");
  await expect(page.getByLabel("Draft context")).toContainText("large.log");
  await expect(page.getByRole("dialog",{name:"Add context"})).toHaveCount(0);
  await expect(page.getByLabel("Follow-up", { exact: true })).toHaveValue("Keep this draft");
});
