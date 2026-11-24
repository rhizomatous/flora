import { publicChatID, test, expect } from "./fixtures.ts";

const base = process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5199";

test("view search supports keyboard selection, empty results, escape, and saved panels", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/#chats/${await publicChatID(page, "subagents")}`);
  await page.getByRole("button", { name: "Hide controls", exact: true }).click();
  const draft = page.getByLabel("Follow-up", { exact: true });
  await draft.fill("Keep this unsent search draft");
  const trigger = page.getByRole("button", { name: "Chat views", exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const search = page.getByRole("searchbox", { name: "Search views", exact: true });
  await expect(search).toBeFocused();
  await search.fill("  DIFFS  ");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Diffs", exact: true })).toHaveAttribute(
    "data-highlighted",
    "",
  );
  await page.keyboard.press("ArrowUp");
  await expect(search).toBeFocused();
  await page.keyboard.press("Enter");
  const main = page.locator(".chat-main-pane");
  await expect(main.getByRole("tab", { name: "Diffs", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(main.getByRole("tab", { name: "Diffs", exact: true })).toBeFocused();
  await trigger.click();
  await expect(search).toHaveValue("");
  await search.fill("Diffs");
  await search.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(main.getByRole("tab", { name: "Diffs", exact: true })).toHaveCount(1);
  await trigger.click();
  await search.fill("Browser");
  await expect(page.getByRole("status").filter({ hasText: "No matching views" })).toBeVisible();
  await search.press("Enter");
  await expect(search).toBeVisible();
  await search.press("Escape");
  await expect(trigger).toBeFocused();
  await page.getByRole("button", { name: "Open side panel", exact: true }).click();
  const side = page.getByRole("complementary", { name: "Side panel" });
  const sideTrigger = side.getByRole("button", { name: "Side panel views", exact: true });
  await sideTrigger.click();
  await search.fill("diffs");
  await search.press("Enter");
  await expect(side.getByRole("tab", { name: "Diffs", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await sideTrigger.click();
  await search.fill("no such destination");
  const bounds = await page.getByRole("dialog").boundingBox();
  if (!bounds) throw new Error("Search menu is missing");
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await search.press("Escape");
  await expect(sideTrigger).toBeFocused();
  await side.getByRole("button", { name: "Close side panel", exact: true }).click();
  await main.getByRole("tab").first().click();
  await expect(draft).toHaveValue("Keep this unsent search draft");
  await page.reload();
  await page.getByRole("button", { name: "Hide controls", exact: true }).click();
  await page.getByRole("button", { name: "Open side panel", exact: true }).click();
  await expect(side.getByRole("tab", { name: "Diffs", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("task searches reuse subagent identities in each pane and expose unavailable saved views", async ({
  page,
}) => {
  await page.addInitScript(() => {
    sessionStorage.setItem(
      "flora-panel:subagents",
      JSON.stringify({ mainSubagentTabs: ["missing-agent"] }),
    );
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/#chats/${await publicChatID(page, "subagents")}`);
  await page.getByRole("button", { name: "Hide controls", exact: true }).click();
  const main = page.locator(".chat-main-pane");
  const search = page.getByRole("searchbox", { name: "Search views", exact: true });
  for (let i = 0; i < 2; i++) {
    await main.getByRole("button", { name: "Chat views", exact: true }).click();
    await search.fill("reliability");
    await expect(page.getByRole("menuitem", { name: /Subagent 1/ })).toBeVisible();
    await search.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(main.getByRole("tab", { name: "Subagent 1", exact: true })).toHaveCount(1);
  }
  await main.getByRole("button", { name: "Chat views", exact: true }).click();
  await search.fill("missing-agent");
  await expect(page.getByRole("menuitem", { name: /Saved subagent.*Unavailable/ })).toBeDisabled();
  await search.press("Escape");
  await expect(main.getByRole("button", { name: "Chat views", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Open side panel", exact: true }).click();
  const side = page.getByRole("complementary", { name: "Side panel" });
  for (let i = 0; i < 2; i++) {
    await side.getByRole("button", { name: "Side panel views", exact: true }).click();
    await search.fill("reliability");
    await search.press("Enter");
    await expect(side.getByRole("tab", { name: "Subagent 1", exact: true })).toHaveCount(1);
  }
  await expect(main.getByRole("tab", { name: "Subagent 1", exact: true })).toHaveCount(1);
});

test("pull request search reuses the existing side-panel tab", async ({ page }) => {
  await page.goto(`${base}/#chats/${await publicChatID(page, "pagination")}`);
  await page.getByRole("button", { name: "Hide controls", exact: true }).click();
  const search = page.getByRole("searchbox", { name: "Search views", exact: true });
  await page.getByRole("button", { name: "Chat views", exact: true }).click();
  await search.fill("PR #19");
  await search.press("Enter");
  const side = page.getByRole("complementary", { name: "Side panel" });
  await expect(side.getByRole("tab", { name: "PR #19", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await side.getByRole("button", { name: "Side panel views", exact: true }).click();
  await search.fill("PR #19");
  await search.press("Enter");
  await expect(side.getByRole("tab", { name: "PR #19", exact: true })).toHaveCount(1);
});

test("shell search reuses shell IDs and disables unavailable saved shells", async ({ page }) => {
  await page.route("**/api/chats/subagents/shells", (route) =>
    route.fulfill({
      json: {
        shells: [{ id: "saved-shell", title: "workspace logs", state: "ended" }],
        count: 1,
      },
    }),
  );
  await page.goto(`${base}/#chats/${await publicChatID(page, "subagents")}`);
  await page.getByRole("button", { name: "Hide controls", exact: true }).click();
  const trigger = page.getByRole("button", { name: "Chat views", exact: true });
  const search = page.getByRole("searchbox", { name: "Search views", exact: true });
  for (let i = 0; i < 2; i++) {
    await trigger.click();
    await search.fill("workspace logs");
    await expect(
      page.getByRole("menuitem", { name: "workspace logs Ended", exact: true }),
    ).toBeVisible();
    await search.press("Enter");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "workspace logs", exact: true })).toHaveCount(1);
  }
  await page.route("**/api/chats/subagents/shells", (route) =>
    route.fulfill({ json: { shells: [], count: 0 } }),
  );
  await trigger.click();
  await search.fill("workspace logs");
  await expect(
    page.getByRole("menuitem", { name: "workspace logs Unavailable", exact: true }),
  ).toBeDisabled();
  await search.press("Enter");
  await expect(search).toBeVisible();
  await search.press("Escape");
  await expect(trigger).toBeFocused();
});
