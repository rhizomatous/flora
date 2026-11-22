import { test, expect } from "./fixtures.ts";

test("context displays the reported snapshot and handles an unknown limit", async ({ page }) => {
  const base = process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5199";
  const usage = {
    tokens: 79_600 as number | null,
    limit: 200_000 as number | null,
    provider: "anthropic",
    model: "claude-sonnet-4-6",
  };
  await page.route("**/api/chats/completed", async (route) => {
    const response = await route.fetch();
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) throw new Error("Missing detail");
    await route.fulfill({ response, json: { ...body, contextUsage: usage } });
  });
  await page.goto(`${base}/#chats/completed`);
  const trigger = page.getByRole("button", { name: "Context usage", exact: true });
  await trigger.click();
  await expect(page.getByText("79.6K / 200K (40%)", { exact: true })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Context window used" })).toHaveAttribute(
    "aria-valuenow",
    "40",
  );
  await expect(page.getByText("System prompt", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Compact at", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  usage.tokens = 10_000;
  await page.reload();
  await trigger.click();
  await expect(page.getByText("10K / 200K (5%)", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  usage.limit = null;
  await page.reload();
  await trigger.click();
  await expect(page.getByText("10K / —", { exact: true })).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await page.keyboard.press("Escape");
  usage.tokens = null;
  await page.reload();
  await trigger.click();
  await expect(page.getByText("No usage yet", { exact: true })).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveCount(0);
});
