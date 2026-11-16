import { test, expect } from "./fixtures.ts";

test("usage ranges, breakdowns, metrics and chat links", async ({ page }) => {
  const base = process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5199";
  await page.goto(`${base}/#usage`);
  await expect(page.getByRole("heading", { name: "Usage", exact: true })).toBeVisible();
  const rows = page.locator("tbody tr");
  await expect(rows).toHaveCount(4);
  await page.getByRole("combobox", { name: "Group usage by" }).click();
  await page.getByRole("option", { name: "By model", exact: true }).click();
  await expect(page.getByText("anthropic/claude-sonnet-4-5", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Tokens", exact: true }).click();
  await expect(page.getByRole("button", { name: "Tokens", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("combobox", { name: "Sort chats" }).click();
  await page.getByRole("option", { name: "Most tokens", exact: true }).click();
  await page.getByRole("button", { name: "24h", exact: true }).click();
  await expect(page.getByText("UTC · Hourly", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Custom", exact: true }).click();
  await page.getByLabel("From", { exact: true }).fill("");
  await expect(page.getByRole("alert")).toContainText("Choose a date range");
  await page.getByRole("button", { name: "7d", exact: true }).click();
  await expect(rows).toHaveCount(4);
  await page.getByRole("button", { name: "Custom", exact: true }).click();
  await page.getByLabel("From", { exact: true }).fill("2000-01-01");
  await page.getByLabel("Through", { exact: true }).fill("2000-01-02");
  await expect(page.getByText("No usage in this period.")).toBeVisible();
  await page.getByRole("button", { name: "7d", exact: true }).click();
  await expect(rows).toHaveCount(4);
  await page.getByRole("link", { name: "Review the workspace changes", exact: true }).click();
  await expect(page).toHaveURL(/#chats\/completed$/);
});

test("usage failure can be retried", async ({ page }) => {
  const base = process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5199";
  let failed = true;
  await page.route("**/api/usage?*", async (route) => {
    if (failed) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Could not load usage. Try again." }),
      });
      return;
    }
    await route.continue();
  });
  await page.goto(`${base}/#usage`);
  await expect(page.getByRole("alert")).toContainText("Could not load usage");
  failed = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(4);
});
