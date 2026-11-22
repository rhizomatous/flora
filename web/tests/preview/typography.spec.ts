import { test, expect } from "./fixtures.ts";

const base = process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5199";

for (const width of [1440, 390]) {
  test(`automation text shares one inset at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`${base}/#automations/accessibility`);
    await page.getByRole("button", { name: "Hide controls", exact: true }).click();
    const title = page.getByRole("textbox", { name: "Name", exact: true });
    await expect(title).toBeVisible();
    const textLeft = await title.evaluate((element) => {
      const style = getComputedStyle(element);
      return (
        element.getBoundingClientRect().left +
        Number(style.paddingLeft.replace("px", "")) +
        Number(style.borderLeftWidth.replace("px", ""))
      );
    });
    const aligned = [
      page.getByRole("textbox", { name: "Description", exact: true }),
      page.getByRole("textbox", { name: "Instructions", exact: true }),
      page.getByText("Instructions", { exact: true }),
      page.getByRole("switch", { name: "Active", exact: true }),
      page.locator('label[for="automation-project"]'),
      page.getByRole("heading", { name: "Run history", exact: true }),
    ];
    for (const element of aligned) {
      const left = await element.evaluate((node) => {
        const style = getComputedStyle(node);
        const border =
          node.getAttribute("role") === "switch"
            ? 0
            : Number(style.borderLeftWidth.replace("px", ""));
        return (
          node.getBoundingClientRect().left + Number(style.paddingLeft.replace("px", "")) + border
        );
      });
      expect(Math.abs(left - textLeft)).toBeLessThan(0.5);
    }
    await expect(title).toHaveCSS("font-weight", "500");
    await title.hover();
    await title.focus();
    await expect(title).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(title).toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");
  });
}

test("page and collection headings use the shared medium weight", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const [route, selector, size] of [
    ["automations/accessibility", '[data-slot="editable-text"]', "24px"],
    ["settings", "#settings-heading", "24px"],
    ["chats", "#main-content h1", "16px"],
  ] as const) {
    await page.goto(`${base}/#${route}`);
    const heading = page.locator(selector).first();
    await expect(heading).toBeVisible();
    await expect(heading).toHaveCSS("font-weight", "500");
    await expect(heading).toHaveCSS("font-size", size);
    await page.screenshot({
      path: testInfo.outputPath(`${route.replaceAll("/", "-")}.png`),
      animations: "disabled",
    });
  }
});

test("editable controls keep their text size across viewport widths", async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${base}/#automations/accessibility`);
    await expect(page.getByLabel("Instructions", { exact: true })).toHaveCSS("font-size", "14px");
    await expect(page.getByLabel("Time", { exact: true })).toHaveCSS("font-size", "14px");
    for (const [route, label] of [
      ["chats/new", "Message"],
      ["chats/working", "Follow-up"],
    ] as const) {
      await page.goto(`${base}/#${route}`);
      await expect(page.getByLabel(label, { exact: true })).toHaveCSS("font-size", "14px");
    }
    await page.goto(`${base}/#chats/new`);
    await page.getByRole("button", { name: /^Model:/ }).click();
    await expect(page.getByRole("searchbox", { name: "Search models" })).toHaveCSS(
      "font-size",
      "14px",
    );
    await page.keyboard.press("Escape");
  }
});
