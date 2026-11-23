import assert from "node:assert/strict";

import { test, expect } from "../fixtures.ts";
import { logIn, assertFitsPhone, pageErrors } from "../helpers.ts";

test.use({ scenario: "mcps" });

test("MCP connections, failures, secret edits and drafts", async ({ page }) => {
  const errors = pageErrors(page);
  await logIn(page);
  await page.goto("/#mcps");
  await expect(page.getByRole("heading", { name: "MCP servers", exact: true })).toBeFocused();
  const garden = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("link", { name: "garden-fixture", exact: true }) });
  const denied = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("link", { name: "credentials-fixture", exact: true }) });
  await garden.getByRole("button", { name: "Check connection", exact: true }).click();
  await expect(garden.getByRole("status")).toContainText("Connected · 2 tools");
  await garden.getByText("Discovered tools", { exact: true }).click();
  await expect(garden).toContainText("garden-fixture_read_notes");
  await denied.getByRole("button", { name: "Check connection", exact: true }).click();
  await expect(denied.getByRole("status")).toContainText("Credentials rejected");
  const response = await page.request.get("/api/mcps");
  assert.ok(!(await response.text()).includes("fixture-only-token"));
  await page.getByRole("link", { name: "garden-fixture", exact: true }).click();
  await expect(page.getByLabel("Secret value", { exact: true })).toHaveValue("");
  await page.getByLabel("Endpoint URL").fill("http://127.0.0.1:1/unreachable");
  await page.getByRole("button", { name: "Save server", exact: true }).click();
  await garden.getByRole("button", { name: "Check connection", exact: true }).click();
  await expect(garden.getByRole("status")).toContainText("Server unreachable");
  await page.getByRole("link", { name: "Add server", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("draft-fixture");
  await page.getByLabel("Endpoint URL").fill("https://example.com/mcp");
  await page.getByRole("button", { name: "Add header", exact: true }).click();
  await page.getByLabel("Header name", { exact: true }).fill("Authorization");
  await page.getByLabel("Secret value", { exact: true }).fill("fake-draft-secret");
  await page.getByRole("link", { name: "Cancel", exact: true }).click();
  await page.getByRole("link", { name: "Add server", exact: true }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("draft-fixture");
  await expect(page.getByLabel("Secret value", { exact: true })).toHaveValue("");
  assert.ok(
    !(await page.evaluate(() => JSON.stringify(sessionStorage))).includes("fake-draft-secret"),
  );
  await assertFitsPhone(page);
  await page.getByLabel("Secret value", { exact: true }).fill("fake-draft-secret");
  await page.getByLabel("Endpoint URL").fill("https://user:secret@example.com/mcp");
  await page.getByRole("button", { name: "Save server", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("without credentials");
  await expect(page.getByLabel("Secret value", { exact: true })).toHaveValue("fake-draft-secret");
  await page.getByRole("link", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Search MCP servers", exact: true }).click();
  await page.getByRole("textbox", { name: "Search MCP servers", exact: true }).fill("missing");
  await expect(page.getByText("No matching servers.", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Search MCP servers", exact: true })).toBeFocused();
  await page.getByRole("link", { name: "garden-fixture", exact: true }).click();
  await page.getByRole("switch", { name: "Enabled", exact: true }).click();
  await page.getByRole("button", { name: "Save server", exact: true }).click();
  await expect(
    garden.getByRole("button", { name: "Check connection", exact: true }),
  ).toBeDisabled();
  await page.getByRole("link", { name: "garden-fixture", exact: true }).click();
  await page.getByRole("button", { name: "Remove server", exact: true }).click();
  await page.getByRole("alert").getByRole("button", { name: "Remove server", exact: true }).click();
  await expect(page.getByRole("heading", { name: "MCP servers", exact: true })).toBeVisible();
  await expect(garden).toHaveCount(0);
  assert.deepEqual(errors, []);
});
