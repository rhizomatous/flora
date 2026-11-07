import assert from "node:assert/strict";

import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";

import manifest from "../florets/src/ai/upstream.json" with { type: "json" };

const server = await createServer({
  root: "florets/docs",
  configFile: "florets/docs/vite.config.ts",
  server: { host: "127.0.0.1", port: 0 },
});
await server.listen();
const address = server.httpServer?.address();
assert.ok(address !== undefined && address !== null && typeof address !== "string");
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") console.error(message.text());
  });
  page.on("requestfailed", (request) => {
    console.error(request.url(), request.failure());
  });
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.error(error.message);
  });
  await page.goto(`http://127.0.0.1:${address.port}/ai.html`);
  for (const pattern of manifest.patterns) {
    console.log(`Checking ${pattern}`);
    await page.getByLabel("Pattern", { exact: true }).selectOption(pattern);
    await expect(page.locator("section")).toBeVisible();
    const rendered = await page.locator("section").innerText();
    assert.ok(rendered.length > 0, pattern);
  }
  await page.getByLabel("Pattern", { exact: true }).selectOption("chain-of-thought");
  const summary = page.getByRole("button", { name: "Researched in 3 steps", exact: true });
  await summary.click();
  await expect(page.getByText(/install\s+41s/)).toBeVisible();
  assert.equal(await page.locator("[data-slot=trace-icon] svg").count(), 8);
  const content = page.locator("[data-slot=trace-collapsible-content-inner]").first();
  const styles = await content.evaluate((element) => {
    const style = getComputedStyle(element);
    return { border: style.borderLeftWidth, padding: style.paddingLeft, margin: style.marginLeft };
  });
  assert.deepEqual(styles, { border: "1px", padding: "16px", margin: "7px" });
  await page
    .getByRole("button", { name: "Searched the web for next.js image cache key", exact: true })
    .click();
  await expect(page.getByRole("link", { name: /Image component/ })).toBeVisible();
  await page.getByRole("button", { name: "Replay", exact: true }).click();
  await expect(page.getByRole("button", { name: /Researching/ })).toBeVisible();
  await expect(summary).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Light theme", exact: true }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  await server.close();
}
