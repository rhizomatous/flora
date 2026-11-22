import { test, expect } from "../fixtures.ts";
import { logIn, assertFitsPhone } from "../helpers.ts";

test.use({ scenario: "models" });

test("automation model and reasoning choices save explicitly and can return to inheritance", async ({ page }) => {
  await logIn(page);
  await page.goto("/#automations/new");
  await page.getByLabel("Name", { exact: true }).fill("Model review");
  await page.getByLabel("Instructions", { exact: true }).fill("Review the changes");
  const model = () => page.getByRole("button", { name: /^Model:/ });
  await expect(model()).toHaveAccessibleName("Model: Default model");
  await page.getByLabel("Runs in", { exact: true }).selectOption("same");
  await expect(model()).toHaveAccessibleName("Model: Chat's current model");
  await model().click();
  await expect(page.getByRole("menuitem", { name: "Chat's current model", exact: true })).toBeVisible();
  await page.getByRole("searchbox", { name: "Search models" }).fill("sonnet");
  await page.getByRole("menuitem", { name: "Claude Sonnet 4.6", exact: true }).click();
  await page.getByRole("button", { name: /^Reasoning effort:/ }).click();
  await page.getByRole("menuitem", { name: "High", exact: true }).click();
  await page.getByRole("button", { name: "Create automation", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await page.reload();
  await expect(model()).toHaveAccessibleName("Model: Claude Sonnet 4.6");
  await expect(page.getByRole("button", { name: "Reasoning effort: High", exact: true })).toBeVisible();
  await model().click();
  await page.getByRole("menuitem", { name: "Chat's current model", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Reasoning effort:/ })).toHaveCount(0);
  await page.reload();
  await expect(model()).toHaveAccessibleName("Model: Claude Sonnet 4.6");
  await model().click();
  await page.getByRole("menuitem", { name: "Chat's current model", exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await page.reload();
  await expect(model()).toHaveAccessibleName("Model: Chat's current model");
  await assertFitsPhone(page);
});
