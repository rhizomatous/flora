import assert from "node:assert/strict";

import { test, expect } from "./fixtures.ts";

test("questionnaire validation, navigation, and retry", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let accepted = false;
  let attempts = 0;
  const submissions: unknown[] = [];
  await page.route("**/api/chats/waiting/questions", (route) =>
    route.fulfill({
      json: accepted
        ? []
        : [
            {
              id: "questionnaire-test",
              questions: [
                {
                  question: "Choose checks",
                  header: "Checks",
                  multiple: true,
                  options: [
                    { label: "Unit", description: "Run unit tests" },
                    { label: "Browser", description: "Run browser tests" },
                  ],
                },
                {
                  question: "Choose scope",
                  header: "Scope",
                  multiple: false,
                  custom: false,
                  options: [
                    { label: "Frontend", description: "" },
                    { label: "Backend", description: "" },
                  ],
                },
                {
                  question: "Any instructions?",
                  header: "Instructions",
                  multiple: false,
                  options: [],
                },
              ],
            },
          ],
    }),
  );
  await page.route("**/questions/questionnaire-test/reply", (route) => {
    submissions.push(route.request().postDataJSON());
    attempts++;
    accepted = attempts > 1;
    return route.fulfill({
      status: accepted ? 200 : 500,
      json: accepted ? {} : { error: "Retry this answer" },
    });
  });
  const base = process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5199";
  await page.goto(`${base}/#chats/waiting`);
  const form = page.getByRole("form", { name: "Questions", exact: true });
  await expect(form).toHaveAttribute("data-slot", "questionnaire");
  await form.getByRole("button", { name: "Next", exact: true }).click();
  await expect(form.getByRole("alert")).toBeVisible();
  await form.getByRole("checkbox", { name: /^Unit/ }).check();
  await form.getByRole("checkbox", { name: /^Browser/ }).check();
  await form.getByRole("textbox", { name: "Other answer" }).fill("Custom checks");
  await expect(form.getByRole("checkbox", { name: /^Unit/ })).not.toBeChecked();
  await expect(form.getByRole("checkbox", { name: /^Browser/ })).not.toBeChecked();
  await form.getByRole("checkbox", { name: /^Unit/ }).check();
  await expect(form.getByRole("textbox", { name: "Other answer" })).toHaveValue("");
  await form.getByRole("checkbox", { name: /^Browser/ }).check();
  await form.getByRole("button", { name: "Next", exact: true }).click();
  await expect(form.getByText("Choose scope", { exact: true })).toBeVisible();
  await expect(form.getByRole("textbox")).toHaveCount(0);
  await form.getByRole("radio", { name: "Frontend", exact: true }).check();
  await form.getByRole("radio", { name: "Backend", exact: true }).check();
  await expect(form.getByRole("radio", { name: "Frontend", exact: true })).not.toBeChecked();
  await form.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(form.getByRole("checkbox", { name: /^Unit/ })).toBeChecked();
  await expect(form.getByRole("checkbox", { name: /^Browser/ })).toBeChecked();
  await form.getByRole("button", { name: "Next", exact: true }).click();
  await form.getByRole("button", { name: "Next", exact: true }).click();
  await form
    .getByRole("textbox", { name: "Answer", exact: true })
    .fill("  Preserve accessibility  ");
  await form.getByRole("button", { name: "Answer and continue", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Retry this answer");
  await expect(form.getByRole("textbox", { name: "Answer", exact: true })).toHaveValue(
    "  Preserve accessibility  ",
  );
  await form.getByRole("button", { name: "Answer and continue", exact: true }).click();
  await expect(form).toHaveCount(0);
  assert.deepEqual(
    submissions,
    Array.from({ length: 2 }, () => ({
      answers: [["Unit", "Browser"], ["Backend"], ["Preserve accessibility"]],
    })),
  );
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  assert.deepEqual(errors, []);
});
