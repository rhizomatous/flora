import { test, expect } from "./fixtures.ts";

test("sidebar markers distinguish attention, startup, work, and failures", async ({ page }) => {
  let updated = "2026-01-01T00:00:00Z";
  await page.route("**/api/notifications*", async (route) => {
    const response = await route.fetch();
    const feed: unknown = await response.json();
    if (
      typeof feed !== "object" ||
      feed === null ||
      !("chats" in feed) ||
      !Array.isArray(feed.chats)
    ) {
      throw new Error("Missing chat feed");
    }
    const chats: unknown[] = feed.chats;
    for (const chat of chats) {
      if (
        typeof chat !== "object" ||
        chat === null ||
        !("ID" in chat) ||
        !("Status" in chat) ||
        !("UpdatedAt" in chat) ||
        !("StatusReason" in chat)
      ) {
        throw new Error("Invalid chat fixture");
      }
      if (chat.ID === "completed") {
        chat.Status = "idle";
        chat.UpdatedAt = updated;
      }
      if (chat.ID === "working") {
        chat.Status = "working";
        chat.StatusReason = "Preparing checkout and setup";
      }
      if (chat.ID === "recovery") chat.Status = "failed";
      if (chat.ID === "checkout") chat.Status = "stopped";
    }
    await route.fulfill({ response, json: feed });
  });
  const base = process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5199";
  await page.goto(`${base}/#chats/new`);
  const nav = page.getByRole("navigation", { name: "Main", exact: true });
  const completed = nav.getByRole("link", { name: /Review the workspace changes/ });
  const starting = nav.getByRole("link", { name: /Check the project setup/ });
  await expect(completed).toContainText("Needs you");
  await expect(completed.locator(".sidebar-status")).toHaveAttribute("data-filled");
  await expect(starting).toContainText("Starting");
  await expect(starting.locator(".sidebar-status")).not.toHaveAttribute("data-filled");
  await expect(nav.getByRole("link", { name: /Fix the workspace checks/ })).toContainText("Failed");
  await expect(nav.getByRole("link", { name: /Keep the cart/ })).toContainText("Stopped");
  await completed.click();
  await expect(completed).toContainText("Your turn");
  await expect(completed.locator(".sidebar-status")).not.toHaveAttribute("data-filled");
  await nav.getByRole("link", { name: "New chat", exact: true }).click();
  await page.reload();
  await expect(completed).toContainText("Your turn");
  updated = "2026-01-02T00:00:00Z";
  await expect(completed).toContainText("Needs you");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(starting.locator(".sidebar-status > span")).toHaveCSS("animation-name", "none");
});
