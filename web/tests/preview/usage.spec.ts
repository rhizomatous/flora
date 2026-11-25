import { publicChatID, test, expect } from "./fixtures.ts";

test("chat cost distinguishes no usage, reported zero, and refresh failures", async ({ page }) => {
  const base = process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5199";
  const usage = {
    costUSD: 0.035 as number | null,
    steps: 3,
    input: 123,
    output: 45,
    reasoning: 6,
    cacheRead: 78,
    cacheWrite: 9,
    collection: "complete",
    checkedAt: "2026-01-01T00:00:00Z",
  };
  await page.route("**/api/chats/completed", async (route) => {
    const response = await route.fetch();
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) throw new Error("Missing chat detail");
    await route.fulfill({ response, json: { ...body, usage } });
  });
  await page.goto(`${base}/#chats/${await publicChatID(page, "completed")}`);
  const cost = page.getByRole("button", { name: "Estimated chat cost", exact: true });
  await expect(cost).toHaveText("$0.04");
  await page.getByRole("button", { name: "Hide controls", exact: true }).click();
  await cost.click();
  await expect(page.getByText("Input tokens", { exact: true })).toBeVisible();
  await expect(page.locator("dl").filter({ hasText: "Input tokens" })).toContainText("123");
  await expect(page.getByText("Calls without pricing", { exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");

  usage.collection = "history_unavailable";
  await page.reload();
  await expect(cost).toHaveText("$0.04");
  await page.getByRole("button", { name: "Hide controls", exact: true }).click();
  await cost.click();
  await expect(
    page.getByText("Showing saved usage. Couldn’t refresh.", { exact: false }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  usage.costUSD = null;
  usage.steps = 0;
  usage.collection = "pending";
  await page.reload();
  await expect(cost).toHaveText("Usage");
  await page.getByRole("button", { name: "Hide controls", exact: true }).click();
  await cost.click();
  await expect(page.getByText("No usage yet.")).toBeVisible();
  await page.keyboard.press("Escape");

  usage.collection = "complete";
  usage.costUSD = 0;
  await page.reload();
  await expect(cost).toHaveText("$0.00");
  usage.costUSD = 0.001;
  await page.reload();
  await expect(cost).toHaveText("<$0.01");
});
