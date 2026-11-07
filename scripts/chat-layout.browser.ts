import assert from "node:assert/strict";

import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";

const server = await createServer({
  root: "web",
  configFile: "web/vite.config.ts",
  mode: "chat-preview",
  server: { host: "127.0.0.1", port: 0 },
});
await server.listen();
const address = server.httpServer?.address();
assert.ok(address !== null && address !== undefined && typeof address !== "string");
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(`http://127.0.0.1:${address.port}/#chats/long`);
  await page.getByRole("button", { name: "Hide controls", exact: true }).click();
  const history = page.getByLabel("Chat history");
  const composer = page.getByLabel("Follow-up", { exact: true });
  await expect(composer).toBeVisible();
  await expect(history.locator("h2").first()).toBeAttached();
  assert.ok((await history.locator("pre code").count()) > 0);
  await composer.fill("Keep this draft while I review earlier messages.");
  const position = await composer.boundingBox();
  assert.ok(position);
  await history.hover();
  await page.mouse.wheel(0, -10_000);
  const latest = page.getByRole("button", { name: "Jump to latest", exact: true });
  await expect(latest).toBeVisible();
  const scrolledPosition = await composer.boundingBox();
  assert.equal(scrolledPosition?.y, position.y, "composer moved with the transcript");
  await latest.click();
  await expect(latest).toBeHidden();
  await expect(composer).toHaveValue("Keep this draft while I review earlier messages.");
  const changes = page.getByRole("button", { name: "Changes", exact: true });
  await changes.click();
  await expect(page.getByRole("dialog", { name: "Review changes" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(changes).toBeFocused();
  await page.goto(`http://127.0.0.1:${address.port}/#chats/waiting`);
  await page.getByRole("radio", { name: /^Workspace menu/ }).check();
  const answer = page.getByRole("button", { name: "Answer and continue", exact: true });
  await expect(answer).toBeInViewport();
  await expect(composer).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(answer).toBeInViewport();
  await expect(composer).toBeInViewport();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
} finally {
  await browser.close();
  await server.close();
}
