import { chatSchema } from "../../src/chat-schemas";
import { folderSchema } from "../../src/folder-state";
import { test, expect } from "../fixtures.ts";
import { logIn, pageErrors } from "../helpers.ts";

test.use({ scenario: "branches" });

test("folders share moves, preserve drafts and pins, and search collapsed groups", async ({
  page,
}) => {
  const errors = pageErrors(page);
  await logIn(page);
  await expect(page.getByRole("heading", { name: "New chat", exact: true })).toBeVisible();
  // Seed a conversation through the real API; execution uses the fixture runtime.
  const projects = (await (await page.request.get("/api/projects")).json()) as { id: string }[];
  const response = await page.request.post(`/api/projects/${projects[0]!.id}/chats`, {
    headers: { Origin: new URL(page.url()).origin },
    data: {
      title: "Release checklist",
      requestID: "folder-browser-chat",
      text: "Plan the release",
    },
  });
  expect(response.status()).toBe(202);
  await page
    .getByRole("region", { name: "Completion notifications", exact: true })
    .getByRole("listitem").filter({ hasText: "Release checklist" })
    .getByRole("button", { name: "Dismiss completion", exact: true })
    .click();
  let chat = chatSchema.parse(await response.json());
  await page.getByLabel("Message", { exact: true }).fill("Keep my unsent draft");
  await page.getByRole("button", { name: "Chat list options", exact: true }).click();
  await page.getByRole("menuitem", { name: "New folder", exact: true }).click();
  await page.getByLabel("Folder name", { exact: true }).fill("Release planning");
  await page.getByLabel("Folder name", { exact: true }).press("Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Chat list options", exact: true })).toBeFocused();
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue(
    "Keep my unsent draft",
  );
  await expect(page.getByRole("region", { name: "Release planning", exact: true })).toContainText(
    "No current chats in this folder",
  );
  await page.getByRole("link", { name: "All chats", exact: true }).click();
  const main = page.getByRole("main");
  await main.getByRole("button", { name: "Actions for Release checklist", exact: true }).click();
  await page.getByRole("menuitem", { name: "Move to folder", exact: true }).click();
  await page.getByLabel("Folder", { exact: true }).selectOption({ label: "Release planning" });
  await page.getByRole("button", { name: "Move", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Release planning", exact: true })).toContainText(
    "Release checklist",
  );
  const group = main.locator("details").filter({
    has: page.getByRole("list", {
      name: "Release planning chats",
      exact: true,
      includeHidden: true,
    }),
  });
  await group.locator("summary").click();
  await expect(group).not.toHaveAttribute("open", "");
  await main.getByRole("button", { name: "Search chats", exact: true }).click();
  await main.getByRole("textbox", { name: "Search chats", exact: true }).fill("Release checklist");
  await expect(
    main.getByRole("link", { name: "Open chat: Release checklist", exact: true }),
  ).toBeVisible();
  await main.getByRole("button", { name: "Close chat search", exact: true }).click();
  await expect(group).not.toHaveAttribute("open", "");
  await page.getByRole("button", { name: "Collapse folder Release planning", exact: true }).click();
  const nav = page.getByRole("navigation", { name: "Main", exact: true });
  await nav.getByRole("button", { name: "Search chats", exact: true }).click();
  await nav.getByRole("textbox", { name: "Search chats", exact: true }).fill("Release checklist");
  await expect(nav.getByRole("link", { name: /Release checklist/ })).toBeVisible();
  await nav.getByRole("button", { name: "Close chat search", exact: true }).click();
  await expect(nav.getByRole("link", { name: /Release checklist/ })).toHaveCount(0);
  await page.reload();
  await expect(
    main.getByRole("link", { name: "Open chat: Release checklist", exact: true }),
  ).toBeVisible();
  await main.getByRole("button", { name: "Actions for Release checklist", exact: true }).click();
  await page.getByRole("menuitem", { name: "Pin", exact: true }).click();
  await expect(nav.getByRole("region", { name: "Pinned", exact: true })).toContainText(
    "Release checklist",
  );
  await main.getByRole("button", { name: "Actions for Release checklist", exact: true }).click();
  await page.getByRole("menuitem", { name: "Move to folder", exact: true }).click();
  await page.getByLabel("Folder", { exact: true }).selectOption("__new");
  await page.getByLabel("Folder name", { exact: true }).fill("release planning");
  await page.getByRole("button", { name: "Move", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("already exists");
  await expect(page.getByLabel("Folder name", { exact: true })).toHaveValue("release planning");
  await page.getByLabel("Folder name", { exact: true }).fill("Research");
  await page.getByRole("button", { name: "Move", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  chat = chatSchema.parse(
    ((await (await page.request.get(`/api/chats/${chat.ID}`)).json()) as { chat: unknown }).chat,
  );
  expect(chat.PinnedAt).not.toBe("");
  let folders = folderSchema.array().parse(await (await page.request.get("/api/folders")).json());
  expect(chat.FolderID).toBe(folders.find((row) => row.name === "Research")?.id);
  await main.getByRole("button", { name: "Actions for Release checklist", exact: true }).click();
  await page.getByRole("menuitem", { name: "Archive", exact: true }).click();
  await main
    .getByRole("combobox", { name: "Chat collection", exact: true })
    .selectOption("archived");
  await main.getByRole("button", { name: "Actions for Release checklist", exact: true }).click();
  await page.getByRole("menuitem", { name: "Move to folder", exact: true }).click();
  await page.getByLabel("Folder", { exact: true }).selectOption({ label: "Release planning" });
  await page.getByRole("button", { name: "Move", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await main
    .getByRole("button", { name: "Actions for folder Release planning", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Rename folder", exact: true }).click();
  await page.getByLabel("Folder name", { exact: true }).fill("Launch");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await main.getByRole("button", { name: "Actions for folder Launch", exact: true }).click();
  await page.getByRole("menuitem", { name: "Remove folder", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Its chats will remain available");
  await page.getByRole("button", { name: "Remove folder", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    main.getByRole("link", { name: "Open chat: Release checklist", exact: true }),
  ).toBeVisible();
  await page.reload();
  chat = chatSchema.parse(
    ((await (await page.request.get(`/api/chats/${chat.ID}`)).json()) as { chat: unknown }).chat,
  );
  expect(chat.FolderID).toBe("");
  expect(chat.Archived).toBe(true);
  folders = folderSchema.array().parse(await (await page.request.get("/api/folders")).json());
  expect(folders.map((row) => row.name)).toEqual(["Research"]);
  expect(errors).toEqual([]);
});

test("concurrent edits preserve drafts and deleted destinations cannot hide chats", async ({
  page,
}) => {
  await logIn(page);
  await expect(page.getByRole("heading", { name: "New chat", exact: true })).toBeVisible();
  const origin = new URL(page.url()).origin;
  const projects = (await (await page.request.get("/api/projects")).json()) as { id: string }[];
  const folder = folderSchema.parse(
    await (
      await page.request.post("/api/folders", {
        headers: { Origin: origin },
        data: { name: "Planning" },
      })
    ).json(),
  );
  const created = await page.request.post(`/api/projects/${projects[0]!.id}/chats`, {
    headers: { Origin: origin },
    data: {
      title: "Concurrent work",
      requestID: "concurrent-folder-chat",
      text: "Keep the conversation",
    },
  });
  let chat = chatSchema.parse(await created.json());
  await page
    .getByRole("region", { name: "Completion notifications", exact: true })
    .getByRole("listitem").filter({ hasText: "Concurrent work" })
    .getByRole("button", { name: "Dismiss completion", exact: true })
    .click();
  await page.getByRole("link", { name: "All chats", exact: true }).click();
  const main = page.getByRole("main");
  await main.getByRole("button", { name: "Actions for Concurrent work", exact: true }).click();
  await page.getByRole("menuitem", { name: "Move to folder", exact: true }).click();
  await page.getByLabel("Folder", { exact: true }).selectOption(folder.id);
  const renamed = await page.request.patch(`/api/chats/${chat.ID}`, {
    headers: { Origin: origin },
    data: { title: "Changed elsewhere", revision: chat.OrganizationRevision },
  });
  chat = chatSchema.parse(await renamed.json());
  await page.getByRole("button", { name: "Move", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("changed elsewhere");
  await expect(page.getByLabel("Folder", { exact: true })).toHaveValue(folder.id);
  await page.getByRole("button", { name: "Move", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    main.getByRole("link", { name: "Open chat: Changed elsewhere", exact: true }),
  ).toBeVisible();
  await main.getByRole("button", { name: "Actions for folder Planning", exact: true }).click();
  await page.getByRole("menuitem", { name: "Rename folder", exact: true }).click();
  await page.getByLabel("Folder name", { exact: true }).fill("My draft name");
  const renameFolder = await page.request.patch(`/api/folders/${folder.id}`, {
    headers: { Origin: origin },
    data: { name: "Other name", revision: folder.revision },
  });
  const fresh = folderSchema.parse(await renameFolder.json());
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("changed elsewhere");
  await expect(page.getByLabel("Folder name", { exact: true })).toHaveValue("My draft name");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await main.getByRole("button", { name: "Actions for Changed elsewhere", exact: true }).click();
  await page.getByRole("menuitem", { name: "Move to folder", exact: true }).click();
  await expect(page.getByLabel("Folder", { exact: true })).toHaveValue(folder.id);
  const removed = await page.request.delete(`/api/folders/${folder.id}`, {
    headers: { Origin: origin },
    data: { revision: fresh.revision },
  });
  expect(removed.status()).toBe(200);
  await expect(page.getByRole("alert")).toContainText("Choose an available folder");
  await expect(page.getByRole("button", { name: "Move", exact: true })).toBeDisabled();
  await page.getByLabel("Folder", { exact: true }).selectOption("");
  await page.getByRole("button", { name: "Move", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("changed elsewhere");
  await page.getByRole("button", { name: "Move", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    main.getByRole("link", { name: "Open chat: Changed elsewhere", exact: true }),
  ).toBeVisible();
  const folders = folderSchema.array().parse(await (await page.request.get("/api/folders")).json());
  expect(folders).toEqual([]);
});

test("menus stay anchored off hover and filters keep stable widths", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await logIn(page);
  await expect(page.getByRole("heading", { name: "New chat", exact: true })).toBeVisible();
  const origin = new URL(page.url()).origin;
  const projects = (await (await page.request.get("/api/projects")).json()) as { id: string }[];
  for (const [index, project] of projects.entries()) {
    const title = index === 0 ? "Anchor check" : "Other project";
    const response = await page.request.post(`/api/projects/${project.id}/chats`, {
      headers: { Origin: origin },
      data: { title, requestID: `anchor-${index}`, text: "Check navigation" },
    });
    expect(response.status()).toBe(202);
    await page
      .getByRole("region", { name: "Completion notifications", exact: true })
      .getByRole("listitem").filter({ hasText: title })
      .getByRole("button", { name: "Dismiss completion", exact: true })
      .click();
  }
  const folderResponse = await page.request.post("/api/folders", {
    headers: { Origin: origin },
    data: { name: "Review folder" },
  });
  expect(folderResponse.status()).toBe(200);
  await page.getByRole("link", { name: "All chats", exact: true }).click();
  const nav = page.getByRole("navigation", { name: "Main", exact: true });
  const main = page.getByRole("main");
  const title = nav.getByRole("link", { name: /Anchor check/ });
  await title.hover();
  const actions = nav.getByRole("button", { name: "Actions for Anchor check", exact: true });
  const anchor = await actions.boundingBox();
  expect(anchor).not.toBeNull();
  await actions.click();
  const menu = page.getByRole("menu");
  await menu.evaluate(async (element) => {
    await Promise.allSettled(element.getAnimations().map((animation) => animation.finished));
  });
  const positioned = await menu.boundingBox();
  expect(positioned).not.toBeNull();
  await page.mouse.move(1100, 750);
  await expect(actions.locator("..")).toHaveCSS("opacity", "1");
  const after = await menu.boundingBox();
  expect(after?.x).toBeCloseTo(positioned!.x, 0);
  expect(after?.y).toBeCloseTo(positioned!.y, 0);
  expect((await actions.boundingBox())?.width).toBe(anchor!.width);
  await page.getByRole("menuitem", { name: "Rename", exact: true }).hover();
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Rename chat", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  const options = nav.getByRole("button", { name: "Chat list options", exact: true });
  const folderActions = nav.getByRole("button", {
    name: "Actions for folder Review folder",
    exact: true,
  });
  const optionsBox = await options.boundingBox();
  const folderBox = await folderActions.boundingBox();
  expect(folderBox?.width).toBe(optionsBox!.width);
  expect(folderBox?.height).toBe(optionsBox!.height);
  expect(folderBox!.x + folderBox!.width / 2).toBe(optionsBox!.x + optionsBox!.width / 2);
  expect(anchor!.x + anchor!.width / 2).toBe(optionsBox!.x + optionsBox!.width / 2);
  await options.click();
  await expect(page.getByRole("menuitem", { name: "Archived chats", exact: true })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "View all chats", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const collection = main.getByRole("combobox", { name: "Chat collection", exact: true });
    const project = main.getByRole("combobox", { name: "Project", exact: true });
    const beforeCollection = await collection.boundingBox();
    const beforeProject = await project.boundingBox();
    await project.selectOption(projects[0]!.id);
    expect((await collection.boundingBox())?.width).toBe(beforeCollection!.width);
    expect((await project.boundingBox())?.width).toBe(beforeProject!.width);
    await project.selectOption("");
    await collection.selectOption("archived");
    expect((await collection.boundingBox())?.width).toBe(beforeCollection!.width);
    expect((await project.boundingBox())?.width).toBe(beforeProject!.width);
    await collection.selectOption("current");
    const folderButton = main.getByRole("button", {
      name: "Actions for folder Review folder",
      exact: true,
    });
    const buttonBox = await folderButton.boundingBox();
    const summaryBox = await folderButton
      .locator("..")
      .locator("..")
      .locator("summary")
      .boundingBox();
    expect(buttonBox!.y + buttonBox!.height / 2).toBe(summaryBox!.y + summaryBox!.height / 2);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  }
});
