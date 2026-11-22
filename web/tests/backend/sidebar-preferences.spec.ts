import type { Page } from "@playwright/test";

import { chatSchema, detailSchema } from "../../src/chat-schemas";
import { folderSchema } from "../../src/folder-state";
import { projectSummarySchema } from "../../src/project-schemas";
import { sidebarPreferenceKey } from "../../src/sidebar-preferences";
import { test, expect } from "../fixtures.ts";
import { logIn, pageErrors } from "../helpers.ts";

test.use({ scenario: "branches" });

async function options(page: Page, ...items: string[]) {
  const trigger = page.getByRole("button", { name: "Chat list options", exact: true });
  if ((await trigger.getAttribute("aria-expanded")) === "true") await trigger.click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await trigger.click();
  for (const name of items) {
    await page.getByRole("menuitem", { name, exact: true }).click();
  }
}

test("sidebar saves view choices, reveals search matches, and clears mobile filters", async ({
  page,
  context,
}, testInfo) => {
  const errors = pageErrors(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await logIn(page);
  await expect(page.getByRole("heading", { name: "New chat", exact: true })).toBeVisible();
  const origin = new URL(page.url()).origin;
  const headers = { Origin: origin };
  const projects = projectSummarySchema
    .array()
    .parse(await (await page.request.get("/api/projects")).json());
  const folder = folderSchema.parse(
    await (
      await page.request.post("/api/folders", { headers, data: { name: "Release planning" } })
    ).json(),
  );
  const created = [];
  for (const [index, title] of [
    "Zebra release checklist",
    "Alpha keyboard navigation",
    "Pinned review notes",
    "Archived release",
  ].entries()) {
    const chat = chatSchema.parse(
      await (
        await page.request.post(`/api/projects/${projects[index % 2]!.id}/chats`, {
          headers,
          data: { title, text: title, requestID: `sidebar-${index}` },
        })
      ).json(),
    );
    created.push(chat);
  }
  for (const [index, changes] of [
    [0, { folderID: folder.id }],
    [2, { pinned: true }],
    [3, { archived: true }],
  ] as const) {
    const chat = created[index]!;
    const response = await page.request.patch(`/api/chats/${chat.ID}`, {
      headers,
      data: { ...changes, revision: chat.OrganizationRevision ?? 0 },
    });
    expect(response.ok()).toBe(true);
  }
  await page.reload();
  const nav = page.getByRole("navigation", { name: "Main", exact: true });
  const release = nav.getByRole("link", { name: /Zebra release checklist/ });
  await expect(release).toBeVisible();
  await expect(nav.getByRole("region", { name: "Pinned", exact: true })).toContainText(
    "Pinned review notes",
  );
  await expect(nav.getByRole("link", { name: /Archived release/ })).toHaveCount(0);
  await nav.getByRole("button", { name: "Collapse folder Release planning", exact: true }).click();
  await page.reload();
  await expect(release).toHaveCount(0);
  await nav.getByRole("button", { name: "Search chats", exact: true }).click();
  const search = nav.getByRole("textbox", { name: "Search chats", exact: true });
  await search.fill("Zebra");
  await expect(release).toBeVisible();
  await expect(
    nav.getByRole("button", { name: "Collapse folder Release planning", exact: true }),
  ).toBeDisabled();
  await page.screenshot({
    path: testInfo.outputPath("search-reveals-collapsed.png"),
    animations: "disabled",
  });
  await search.press("Escape");
  await expect(release).toHaveCount(0);
  await options(page, "Group by Project");
  await page.getByRole("menuitemradio", { name: "Status", exact: true }).click();
  await options(page, "Density Detailed");
  await page.getByRole("menuitemradio", { name: "Compact", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(nav.getByRole("region", { name: "Release planning", exact: true })).toBeVisible();
  await expect(nav.getByRole("button", { name: /^Expand folder Release planning$/ })).toBeVisible();
  await expect(nav.locator(".florets-navigation-meta")).toHaveCount(0);
  await options(page);
  await expect(page.getByRole("menuitem", { name: /^Sort:/ })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: /all groups/ })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Density Compact", exact: true })).toBeVisible();
  await expect(nav.locator(".sidebar-status")).toHaveCount(0);
  await expect(nav.getByRole("img", { name: "Unread activity", exact: true })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Filters", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Clear filters", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitem", { name: "Group by Status", exact: true })).toBeVisible();
  await options(page, "Density Compact");
  await expect(page.getByRole("menuitemradio", { name: "Compact", exact: true })).toBeChecked();
  await page.screenshot({
    path: testInfo.outputPath("desktop-options.png"),
    animations: "disabled",
  });
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  await page.screenshot({ path: testInfo.outputPath("desktop-options-light.png") });
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await options(page, "Search chats");
  await expect(search).toBeFocused();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await search.press("Escape");
  await options(page, "Filters", "Status");
  await page.getByRole("menuitemradio", { name: "Failed", exact: true }).click();
  await expect(nav.getByRole("button", { name: "Clear filters", exact: true })).toBeVisible();
  await expect(nav.getByText("No chats found.", { exact: true })).toBeVisible();
  await page.reload();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await expect(nav.getByText("Failed", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Sidebar", exact: true })).toHaveCSS(
    "opacity",
    "1",
  );
  await page.screenshot({ path: testInfo.outputPath("mobile-filter-reset.png") });
  await options(page, "Filters", "Status");
  await expect(page.getByRole("menuitemradio", { name: "All chats", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("mobile-filter-menu.png") });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await nav.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect(nav.getByRole("link", { name: /Alpha keyboard navigation/ })).toBeVisible();
  await expect(nav.getByRole("button", { name: "Clear filters", exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await options(page, "Filters", "Project");
  await page.getByRole("menuitemradio", { name: projects[1]!.name, exact: true }).click();
  await expect(nav.getByRole("region", { name: "Pinned", exact: true })).toHaveCount(0);
  await expect(nav.getByRole("region", { name: "Release planning", exact: true })).toHaveCount(0);
  await options(page, "Filters");
  await page.getByRole("menuitemcheckbox", { name: "Unread only", exact: true }).click();
  await options(page);
  await page.getByRole("menuitem", { name: "Mark all as read", exact: true }).click();
  await expect(nav.getByRole("link", { name: /Alpha keyboard navigation/ })).toHaveCount(0);
  const releaseDetail = detailSchema.parse(
    await (await page.request.get(`/api/chats/${created[0]!.ID}`)).json(),
  );
  expect(releaseDetail.chat.LastViewedRevision ?? 0).toBeLessThan(
    releaseDetail.chat.ActivityRevision ?? 0,
  );
  await nav.getByRole("button", { name: "Clear filters", exact: true }).click();
  // A new page has fresh session storage but keeps browser-local view choices.
  const fresh = await context.newPage();
  await fresh.goto(`${origin}/#chats/new`);
  await expect(
    fresh.getByRole("button", { name: "Expand folder Release planning", exact: true }),
  ).toBeVisible();
  await options(fresh);
  await expect(fresh.getByRole("menuitem", { name: "Group by Status", exact: true })).toBeVisible();
  await fresh.close();
  expect(errors).toEqual([]);
});

test("removed groups are pruned only after successful loading and new groups start expanded", async ({
  page,
}) => {
  await logIn(page);
  await expect(page.getByRole("heading", { name: "New chat", exact: true })).toBeVisible();
  const origin = new URL(page.url()).origin;
  const projects = projectSummarySchema
    .array()
    .parse(await (await page.request.get("/api/projects")).json());
  await page.evaluate(
    ({ key, project }) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          sort: "title",
          project: "removed-project",
          collapsed: ["removed-project", "folder:removed", project],
        }),
      );
    },
    { key: sidebarPreferenceKey, project: projects[0]!.id },
  );
  await page.route("**/api/folders", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: '{"error":"Unavailable"}',
    }),
  );
  await page.reload();
  await expect(page.getByText("Folders unavailable. Retrying…", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key) ?? "{}").collapsed as string[],
      sidebarPreferenceKey,
    ),
  ).toContain("folder:removed");
  await page.unroute("**/api/folders");
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key) ?? "{}") as unknown,
        sidebarPreferenceKey,
      ),
    )
    .toMatchObject({ project: "", collapsed: [projects[0]!.id] });
  await expect(
    page.getByRole("button", { name: `Expand ${projects[0]!.name}`, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: `Collapse ${projects[1]!.name}`, exact: true }),
  ).toBeVisible();
  expect(
    (
      await page.request.post("/api/folders", {
        headers: { Origin: origin },
        data: { name: "New group" },
      })
    ).ok(),
  ).toBe(true);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Collapse folder New group", exact: true }),
  ).toBeVisible();
});
