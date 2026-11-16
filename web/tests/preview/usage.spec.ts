import { test, expect } from "./fixtures.ts";

test("chat cost distinguishes estimates, partial totals, and unavailable pricing", async ({
  page,
}) => {
  const base = process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5199";
  const usage = {
    costUSD: 0.035 as number | null,
    steps: 3,
    unpricedSteps: 0,
    input: 123,
    output: 45,
    reasoning: 6,
    cacheRead: 78,
    cacheWrite: 9,
    partial: false,
    checkedAt: "2026-01-01T00:00:00Z",
  };
  await page.route("**/api/chats/completed", async (route) => {
    const response = await route.fetch();
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) throw new Error("Missing chat detail");
    await route.fulfill({ response, json: { ...body, usage } });
  });
  await page.goto(`${base}/#chats/completed`);
  const cost = page.getByRole("button", { name: "Estimated chat cost", exact: true });
  await expect(cost).toHaveText("Est. $0.04");
  await page.getByRole("button", { name: "Hide controls", exact: true }).click();
  await cost.click();
  await expect(page.getByText("Input tokens", { exact: true })).toBeVisible();
  await expect(page.locator("dl").filter({ hasText: "Input tokens" })).toContainText("123");
  await page.keyboard.press("Escape");

  usage.partial = true;
  usage.unpricedSteps = 1;
  await page.reload();
  await expect(cost).toHaveText("Est. $0.04 · Partial");
  await page.getByRole("button", { name: "Hide controls", exact: true }).click();
  await cost.click();
  await expect(
    page.getByText("Some usage or pricing is unavailable.", { exact: false }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  usage.costUSD = null;
  await page.reload();
  await expect(cost).toHaveText("Cost —");
  await page.getByRole("button", { name: "Hide controls", exact: true }).click();
  await cost.click();
  await expect(
    page.getByText("Cost is unavailable until usage and pricing are reported."),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  usage.costUSD = 0;
  usage.partial = false;
  usage.unpricedSteps = 0;
  await page.reload();
  await expect(cost).toHaveText("Est. $0.00");
  usage.costUSD = 0.001;
  await page.reload();
  await expect(cost).toHaveText("Est. <$0.01");
});
