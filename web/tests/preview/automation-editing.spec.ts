import { test, expect } from "./fixtures.ts";

const base = process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5199";

for (const width of [1440, 390]) {
  test(`inline automation fields save explicitly at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${base}/#automations/new`);
    await page.getByRole("button", { name: "Hide controls", exact: true }).click();
    const title = page.getByRole("textbox", { name: "Name", exact: true });
    const description = page.getByRole("textbox", { name: "Description", exact: true });
    const instructions = page.getByRole("textbox", { name: "Instructions", exact: true });
    await expect(title).toBeVisible();
    await expect(title).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    let saves = 0;
    page.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === "/api/automations") {
        saves++;
      }
    });
    await title.focus();
    await expect(title).toHaveCSS("background-color", "rgb(25, 25, 25)");
    await title.fill(`Weekly review ${width}`);
    await title.press("Tab");
    await expect(description).toBeFocused();
    await description.fill("Review recent changes.\nSummarize the results.");
    await description.press("Tab");
    expect(saves).toBe(0);
    const border = await instructions.evaluate(
      (element) => getComputedStyle(element).borderTopColor,
    );
    await instructions.focus();
    await expect(instructions).not.toHaveCSS("border-top-color", border);
    await expect(instructions).toHaveCSS("box-shadow", "none");
    await expect(instructions).toHaveCSS("padding-top", "16px");
    await instructions.fill("Review changes and summarize findings.");
    const create = page.getByRole("button", { name: "Create automation", exact: true });
    await expect(create).toBeEnabled();
    await create.click();
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    expect(saves).toBe(1);
    await page.reload();
    await expect(title).toHaveValue(`Weekly review ${width}`);
    await expect(description).toHaveValue("Review recent changes.\nSummarize the results.");
  });
}
