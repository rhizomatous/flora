import type { Page } from "@playwright/test";
import { z } from "zod";

import { chatSchema, detailSchema, feedSchema, type Chat } from "../../src/chat-schemas";
import { test, expect } from "./fixtures.ts";

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
});

const base = process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5199";
const changeSchema = z.object({
  revision: z.number(),
  title: z.string().optional(),
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
});

/** Exercises real controls against mutable responses while captured runtime activity keeps polling. */
async function organizationAPI(page: Page) {
  const saved = new Map<string, Chat>();
  const state = { fail: false, conflict: false, staleFeed: false };
  await page.route("**/api/notifications*", async (route) => {
    const response = await route.fetch();
    const feed = feedSchema.parse(await response.json());
    feed.chats = feed.chats.map((chat) =>
      state.staleFeed ? chat : { ...chat, ...saved.get(chat.ID) },
    );
    await route.fulfill({ response, json: feed });
  });
  await page.route(/\/api\/chats\/[^/?]+$/, async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1) ?? "";
    if (route.request().method() !== "PATCH") {
      const response = await route.fetch();
      const detail = detailSchema.parse(await response.json());
      detail.chat = { ...detail.chat, ...saved.get(id) };
      await route.fulfill({ response, json: detail });
      return;
    }
    const change = changeSchema.parse(route.request().postDataJSON());
    const response = await page.request.get(`${base}/api/chats/${id}`);
    const detail = detailSchema.parse(await response.json());
    const chat = chatSchema.parse({ ...detail.chat, ...saved.get(id) });
    if (state.fail) {
      state.fail = false;
      await route.fulfill({ status: 503, json: { error: "Storage unavailable. Try again." } });
      return;
    }
    if (state.conflict) {
      state.conflict = false;
      saved.set(id, {
        ...chat,
        Title: "Changed elsewhere",
        OrganizationRevision: (chat.OrganizationRevision ?? 0) + 1,
      });
    }
    if (
      change.revision !== (saved.get(id)?.OrganizationRevision ?? chat.OrganizationRevision ?? 0)
    ) {
      await route.fulfill({ status: 409, json: { error: "Chat changed." } });
      return;
    }
    const archived = change.archived ?? chat.Archived ?? false;
    let pin = chat.PinnedAt;
    if (change.pinned === true) pin = new Date().toISOString();
    if (archived || change.pinned === false) pin = "";
    const updated = {
      ...chat,
      Title: change.title ?? chat.Title,
      Archived: archived,
      PinnedAt: pin,
      OrganizationRevision: change.revision + 1,
    };
    saved.set(id, updated);
    await route.fulfill({ json: updated });
  });
  return state;
}

test("organize chats across header, sidebar, search, archive, reload, and restore", async ({
  page,
}, testInfo) => {
  const state = await organizationAPI(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/#chats/completed`);
  await page.getByRole("button", { name: "Hide controls", exact: true }).click();
  const nav = page.getByRole("navigation", { name: "Main", exact: true });
  const actions = page.getByRole("button", { name: "More chat actions", exact: true });
  const draft = page.getByLabel("Follow-up", { exact: true });
  await draft.fill("Keep this draft while organizing");
  await actions.click();
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  const title = page.getByRole("textbox", { name: "Chat title", exact: true });
  await expect(title).toBeFocused();
  await title.fill("Release checklist");
  state.staleFeed = true;
  await title.press("Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.waitForResponse((response) => response.url().includes("/api/notifications"));
  await expect(page.getByRole("heading", { name: "Release checklist", exact: true })).toBeVisible();
  await expect(draft).toHaveValue("Keep this draft while organizing");
  await expect(nav.getByRole("link", { name: /Release checklist/ })).toHaveCount(1);
  state.staleFeed = false;
  await actions.click();
  await page.getByRole("menuitem", { name: "Pin", exact: true }).click();
  await expect(nav.getByRole("region", { name: "Pinned", exact: true })).toContainText(
    "Release checklist",
  );
  await expect(nav.getByRole("link", { name: /Release checklist/ })).toHaveCount(1);
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.screenshot({
    animations: "disabled",
    path: testInfo.outputPath("pinned-desktop.png"),
  });
  await actions.click();
  await page.getByRole("menuitem", { name: "Archive", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("Chat archived", { exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: /Release checklist/ })).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "Archived chat" })).toBeVisible();
  await expect(draft).toHaveValue("Keep this draft while organizing");
  await page.reload();
  await page.getByRole("button", { name: "Hide controls", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Release checklist", exact: true })).toBeVisible();
  await nav.getByRole("button", { name: "Chat list options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Archived chats", exact: true }).click();
  const region = page
    .locator("#main-content")
    .getByRole("region", { name: "Archived chats", exact: true });
  await expect(
    region.getByRole("link", { name: "Open chat: Release checklist", exact: true }),
  ).toBeVisible();
  await region.getByRole("button", { name: "Search chats", exact: true }).click();
  await region.getByRole("textbox", { name: "Search chats", exact: true }).fill("Release");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({
    animations: "disabled",
    path: testInfo.outputPath("archived-narrow.png"),
  });
  await region.getByRole("button", { name: "Actions for Release checklist", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Pin", exact: true })).toBeDisabled();
  await page.screenshot({
    animations: "disabled",
    path: testInfo.outputPath("restore-menu-narrow.png"),
  });
  await page.getByRole("menuitem", { name: "Restore", exact: true }).click();
  await expect(page.getByText("Chat restored", { exact: true })).toBeVisible();
  await expect(region.getByText("No archived chats.")).toBeVisible();
  await region
    .getByRole("combobox", { name: "Chat collection", exact: true })
    .selectOption("current");
  await expect(
    page.getByRole("link", { name: "Open chat: Release checklist", exact: true }),
  ).toBeVisible();
});

test("rename keeps drafts on errors and conflicts and supports keyboard cancellation", async ({
  page,
}, testInfo) => {
  const state = await organizationAPI(page);
  await page.goto(`${base}/#chats/completed`);
  await page.getByRole("button", { name: "Hide controls", exact: true }).click();
  const actions = page.getByRole("button", { name: "More chat actions", exact: true });
  await actions.focus();
  await actions.press("Enter");
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  const title = page.getByRole("textbox", { name: "Chat title", exact: true });
  await title.fill(" ");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await title.fill("🌸".repeat(51));
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await title.fill("My retained draft");
  state.fail = true;
  await title.press("Enter");
  await expect(page.getByRole("alert")).toContainText("Storage unavailable");
  await expect(title).toHaveValue("My retained draft");
  state.conflict = true;
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("changed elsewhere");
  await expect(title).toHaveValue("My retained draft");
  await page.screenshot({
    animations: "disabled",
    path: testInfo.outputPath("rename-conflict.png"),
  });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "My retained draft", exact: true })).toBeVisible();
  await actions.click();
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  await title.fill("Cancelled title");
  await title.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(actions).toBeFocused();
  await expect(page.getByRole("heading", { name: "My retained draft", exact: true })).toBeVisible();
});

test("archive reports failures and keeps its success toast after the list row disappears", async ({
  page,
}) => {
  const state = await organizationAPI(page);
  await page.goto(`${base}/#chats`);
  await page.getByRole("button", { name: "Hide controls", exact: true }).click();
  const region = page.locator("#main-content").getByRole("region", { name: "Chats", exact: true });
  const actions = region.getByRole("button", {
    name: "Actions for Review the workspace changes",
    exact: true,
  });
  state.fail = true;
  await actions.click();
  await page.getByRole("menuitem", { name: "Archive", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Storage unavailable");
  await expect(page.getByText("Chat archived", { exact: true })).toHaveCount(0);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .first()
    .click();
  await expect(
    region.getByRole("link", { name: "Open chat: Review the workspace changes", exact: true }),
  ).toBeVisible();
  await actions.click();
  await page.getByRole("menuitem", { name: "Archive", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    region.getByRole("link", { name: "Open chat: Review the workspace changes", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("Chat archived", { exact: true })).toBeVisible();
});
