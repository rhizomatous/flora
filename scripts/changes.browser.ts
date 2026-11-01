import assert from "node:assert/strict";

import { chromium } from "@playwright/test";

import { assertFitsPhone, logIn, origin, pageErrors, requiredEnv } from "./browser.ts";

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const errors = pageErrors(page);
  await logIn(page);
  await page.goto(`${origin}/#chats/${requiredEnv("FLORA_BROWSER_CHAT")}`);
  const review = page.getByRole("region", { name: "Changes", exact: true });
  await review.getByText(/Saved review, possibly out of date/).waitFor();
  const pulls = review.getByRole("list", { name: "Pull requests" });
  assert.equal(await pulls.getByRole("listitem").count(), 5);
  const expected = [
    ["first/app PR #7", "Draft", "https://github.com/first/app/pull/7"],
    ["second/app PR #7", "Merged", "https://github.com/second/app/pull/7"],
    ["first/app PR #8", "Closed", "https://github.com/first/app/pull/8"],
    ["third/private PR #9", "Open", "https://github.com/third/private/pull/9"],
    ["third/private PR #10", "Unknown", "https://github.com/third/private/pull/10"],
  ] as const;
  for (const [label, state, href] of expected) {
    const link = pulls.getByRole("link", { name: label, exact: true });
    assert.equal(await link.getAttribute("href"), href);
    assert.match((await link.locator("..").textContent()) ?? "", new RegExp(state));
  }
  await review.getByText(/Saved statuses may be out of date/).waitFor();
  await review
    .locator("summary")
    .filter({ hasText: "first/app" })
    .filter({ hasText: "src/hello.ts" })
    .focus();
  await page.keyboard.press("Enter");
  await review.getByText(/hello review/).waitFor();
  await review.getByLabel("Diff for src/hello.ts", { exact: true }).first().focus();
  assert.equal(
    await review
      .getByLabel("Diff for src/hello.ts", { exact: true })
      .first()
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await review
    .locator("summary")
    .filter({ hasText: "second/app" })
    .filter({ hasText: "src/hello.ts" })
    .click();
  await review.getByText(/second repository review/).waitFor();
  assert.equal(
    await review.getByRole("list", { name: "Repository bases" }).getByRole("listitem").count(),
    2,
  );
  await review.locator("summary").filter({ hasText: "big.txt" }).click();
  await review.getByText(/exceeds the configured inline limit/).waitFor();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    review.getByRole("link", { name: "Download full diff" }).click(),
  ]);
  let bytes = 0;
  for await (const chunk of await download.createReadStream()) {
    assert.ok(chunk instanceof Buffer);
    bytes += chunk.length;
  }
  assert.equal(bytes, 1_200_000);
  await review.getByText(/picture.png · Binary/).waitFor();
  await review.getByText(/removed.txt/).waitFor();
  await page.reload();
  await review.getByText(/Saved review, possibly out of date/).waitFor();
  assert.equal(await pulls.getByRole("listitem").count(), 5);
  await review.getByText(/Saved statuses may be out of date/).waitFor();
  await assertFitsPhone(page);
  assert.deepEqual(errors, []);
  console.log(
    "Chromium: multiple saved PRs across repositories, exact links, draft/open/closed/merged statuses and outage warning after reload; saved diffs, download and mobile width passed.",
  );
} finally {
  await browser.close();
}
