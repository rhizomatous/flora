import { test, expect } from "../fixtures.ts";
import { assertFitsPhone, logIn, pageErrors } from "../helpers.ts";

test.use({ scenario: "models" });

test("model choices persist with accepted turns and reasoning follows the model", async ({ page }) => {
  const errors = pageErrors(page);
  await logIn(page);
  await page.goto("/#chats/new");
  await page.getByLabel("Message", { exact: true }).fill("Review keyboard navigation");
  await page.getByRole("button", { name: /^Model:/ }).click();
  const search = page.getByRole("combobox", { name: "Search models", exact: true });
  await search.fill("missing model");
  await expect(page.getByText("No models found.", { exact: true })).toBeVisible();
  await search.fill("sonnet");
  await expect(page.getByRole("option")).toHaveCount(1);
  await search.press("Enter");
  await page.getByRole("button", { name: /^Reasoning effort:/ }).click();
  await page.getByRole("menuitem", { name: "High", exact: true }).click();
  await page.reload();
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue("Review keyboard navigation");
  await expect(page.getByRole("button", { name: "Model: Claude Sonnet 4.6", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reasoning effort: High", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Start chat", exact: true }).click();
  await page.waitForURL(/#chats\/(?!new)/);
  await expect(page.getByRole("button", { name: "Model: Claude Sonnet 4.6", exact: true })).toBeDisabled();
  await page.getByText("Saved response 1", { exact: true }).waitFor();
  await expect(page.getByRole("button", { name: "Model: Claude Sonnet 4.6", exact: true })).toBeEnabled();
  const detail = await page.evaluate(async () => {
    const id = window.location.hash.slice("#chats/".length);
    const response = await fetch(`/api/chats/${id}`);
    return await response.json() as { chat: { Execution: { model: string; variant: string } }; messages: { Role: string; Model: string; Payload: { execution?: { model: string; variant: string } } }[] };
  });
  expect(detail.chat.Execution).toMatchObject({ model: "claude-sonnet-4-6", variant: "high" });
  expect(detail.messages[0]?.Payload.execution).toMatchObject({ model: "claude-sonnet-4-6", variant: "high" });
  expect(detail.messages[1]?.Model).toBe("claude-sonnet-4-6");
  await page.getByRole("button", { name: /^Model:/ }).click();
  await page.getByRole("option", { name: "Claude Haiku 4.5", exact: true }).click();
  await expect(page.getByRole("button", { name: "Reasoning effort: Default", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reasoning effort: Default", exact: true })).toBeDisabled();
  await page.getByLabel("Follow-up", { exact: true }).fill("Summarize the findings");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.getByText("Saved response 2", { exact: true }).waitFor();
  await assertFitsPhone(page);
  await page.getByRole("button", { name: /^Model:/ }).click();
  await expect(page.getByRole("combobox", { name: "Search models", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Search models", exact: true }).press("Escape");
  await expect(page.getByRole("combobox", { name: "Search models", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Model:/ })).toBeFocused();
  expect(errors).toEqual([]);
});

test("discovery failure leaves the default usable and keeps the draft", async ({ page }) => {
  await page.route("**/api/models", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ default: { provider: "anthropic", model: "model", variant: "" }, models: [{ provider: "anthropic", id: "model", name: "Installation default", variants: [], image: false, pdf: false }], error: "Model discovery is unavailable. You can use the installation default or retry." }) });
  });
  await logIn(page);
  await page.goto("/#chats/new");
  await page.getByLabel("Message", { exact: true }).fill("Keep my draft");
  await page.getByRole("button", { name: /^Model:/ }).click();
  await expect(page.getByText("Model discovery is unavailable. You can use the installation default or retry.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Retry discovery", exact: true }).click();
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue("Keep my draft");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Start chat", exact: true }).click();
  await page.getByText("Saved response 1", { exact: true }).waitFor();
});

test("search matches model IDs and providers, and grouping preserves the query", async ({ page }) => {
  await logIn(page);
  await page.goto("/#chats/new");
  await page.getByRole("button", { name: /^Model:/ }).click();
  const search = page.getByRole("combobox", { name: "Search models", exact: true });
  await expect(search).toBeFocused();
  await expect(page.getByText("Anthropic", { exact: true })).toBeVisible();
  await search.fill("anthropic");
  await expect(page.getByRole("option")).toHaveCount(3);
  await search.fill("anthropic sonnet");
  await expect(page.getByRole("option")).toHaveCount(1);
  await search.fill("claude-sonnet-4-6");
  const sonnet = page.getByRole("option", { name: "Claude Sonnet 4.6", exact: true });
  await expect(page.getByRole("option")).toHaveCount(1);
  await expect(sonnet).toContainText("$3 / $15");
  await expect(sonnet).toHaveAttribute("aria-description", "Input $3, output $15 per million tokens, USD.");
  await expect(page.getByText("Input / output · USD per 1M tokens", { exact: true })).toBeVisible();
  const grouping = page.getByRole("button", { name: "Group models by provider", exact: true });
  await grouping.click();
  await expect(grouping).toHaveAttribute("aria-pressed", "false");
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("claude-sonnet-4-6");
  await expect(sonnet).toBeVisible();
  await search.press("Escape");
  await expect(search).toHaveCount(0);
  await page.getByRole("button", { name: /^Model:/ }).click();
  await expect(grouping).toHaveAttribute("aria-pressed", "false");
  await expect(search).toHaveValue("");
  await search.fill("missing model");
  await expect(page.getByText("No models found.", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  await expect.poll(async () => await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("provider sections search across groups", async ({ page }) => {
  await page.route("**/api/models", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      default: { provider: "anthropic", model: "claude-sonnet-4-6", variant: "" },
      models: [
        { provider: "anthropic", id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", variants: ["high"], image: true, pdf: true, inputPrice: 3, outputPrice: 15 },
        { provider: "openai", id: "gpt-5", name: "GPT-5", variants: ["low", "high"], image: true, pdf: true, inputPrice: 1.25, outputPrice: 10 },
      ], error: "",
    }) });
  });
  await logIn(page);
  await page.goto("/#chats/new");
  await page.getByRole("button", { name: /^Model:/ }).click();
  await expect(page.getByText("Anthropic", { exact: true })).toBeVisible();
  await expect(page.getByText("OpenAI", { exact: true })).toBeVisible();
  const search = page.getByRole("combobox", { name: "Search models", exact: true });
  await search.fill("openai");
  await expect(page.getByRole("option")).toHaveCount(1);
  await expect(page.getByRole("option", { name: "GPT-5", exact: true })).toBeVisible();
  await expect(page.getByText("Anthropic", { exact: true })).toBeHidden();
  await search.fill("sonnet");
  await expect(page.getByRole("option", { name: "Claude Sonnet 4.6", exact: true })).toBeVisible();
  await expect(page.getByText("OpenAI", { exact: true })).toBeHidden();
});
