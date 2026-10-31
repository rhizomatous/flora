import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(process.env.FLORA_BROWSER_URL);
  await page.getByLabel("Password", { exact: true }).fill("browser test password");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.goto(`${process.env.FLORA_BROWSER_URL}/#chats/${process.env.FLORA_BROWSER_CHAT}`);
  const review = page.getByRole("region", { name: "Changes", exact: true });
  await review.getByText(/Saved review, possibly out of date/).waitFor();
  await review.locator("summary").filter({ hasText: "first/app" }).filter({ hasText: "src/hello.ts" }).click();
  await review.getByText(/hello review/).waitFor();
  await review.locator("summary").filter({ hasText: "second/app" }).filter({ hasText: "src/hello.ts" }).click();
  await review.getByText(/second repository review/).waitFor();
  assert.equal(await review.getByRole("list", { name: "Repository bases" }).getByRole("listitem").count(), 2);
  await review.locator("summary").filter({ hasText: "big.txt" }).click();
  await review.getByText(/exceeds the 1 MiB inline limit/).waitFor();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    review.getByRole("link", { name: "Download full diff" }).click(),
  ]);
  let bytes = 0;
  for await (const chunk of await download.createReadStream()) bytes += chunk.length;
  assert.equal(bytes, 1200000);
  await review.getByText(/picture.png · Binary/).waitFor();
  await review.getByText(/removed.txt/).waitFor();
  await page.reload();
  await review.getByText(/Saved review, possibly out of date/).waitFor();
  await page.setViewportSize({ width: 375, height: 812 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  console.log("Chromium: saved review after reload, stale label, text diff, binary/deletion list, full large-diff download, and mobile width passed.");
} finally {
  await browser.close();
}
