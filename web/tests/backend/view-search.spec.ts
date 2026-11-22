import { test, expect } from "../fixtures.ts";
import { logIn } from "../helpers.ts";

test.use({ scenario: "workspace" });

test("search reuses file identities across repositories and preserves the file browser", async ({ page, backend }) => {
  await logIn(page);
  await page.goto(`${backend.url}/#chats/${backend.chatID}`);
  const trigger = page.getByRole("button", { name: "Chat views", exact: true });
  const search = page.getByRole("searchbox", { name: "Search views", exact: true });
  await trigger.click();
  await expect(search).toBeFocused();
  await search.fill("files");
  await search.press("Enter");
  for (const repository of ["flora/web", "flora/api"]) {
    await page.getByRole("region", { name: repository, exact: true }).getByRole("button", { name: "README.txt", exact: true }).click();
    await page.getByRole("tab", { name: "Files", exact: true }).click();
  }
  for (const repository of ["flora/web", "flora/api", "flora/web"]) {
    await trigger.click();
    await search.fill(`${repository} README.txt`);
    await expect(page.getByRole("menuitem")).toHaveCount(1);
    await search.press("Enter");
    await expect(page.getByRole("tab", { name: `${repository}/README.txt`, exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("region", { name: `${repository}/README.txt preview`, exact: true }).getByLabel("File contents")).toContainText(`Repository: ${repository}`);
  }
  await expect(page.getByRole("tab", { name: "flora/web/README.txt", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Open side panel", exact: true }).click();
  const side = page.getByRole("complementary", { name: "Side panel" });
  await page.setViewportSize({ width: 390, height: 844 });
  await side.getByRole("button", { name: "Side panel views", exact: true }).click();
  await search.fill("flora/api README.txt");
  await search.press("Enter");
  await expect(side).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "flora/api/README.txt", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "flora/api/README.txt", exact: true })).toBeFocused();
  await page.reload();
  await expect(page.getByRole("tab", { name: "flora/api/README.txt", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("region", { name: "flora/api/README.txt preview", exact: true }).getByLabel("File contents")).toContainText("Repository: flora/api");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});
