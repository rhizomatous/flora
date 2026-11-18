import { test, expect } from "./fixtures.ts";

const base = process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5199";

for (const width of [1440, 390]) {
  test(`weekday picker supports multiple days and keyboard dismissal at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${base}/#automations/new`);
    await page.getByRole("button", { name: "Hide controls", exact: true }).click();
    await page.getByRole("combobox", { name: "Schedule", exact: true }).selectOption("weekly");
    const trigger = page.getByRole("button", { name: "Days", exact: true });
    await expect(trigger).toHaveText("Monday");
    await trigger.click();
    const friday = page.getByRole("menuitemcheckbox", { name: "Friday", exact: true });
    await friday.click();
    await expect(friday).toBeChecked();
    await expect(trigger).toHaveText("Mon, Fri");
    await page.getByRole("menuitemcheckbox", { name: "Wednesday", exact: true }).click();
    await expect(trigger).toHaveText("3 days");
    await expect(trigger).toHaveAccessibleDescription("Monday, Wednesday, Friday");
    await friday.press("Escape");
    await expect(trigger).toBeFocused();
    await expect(friday).not.toBeVisible();
    await trigger.press("Enter");
    await expect(friday).toBeChecked();
    for (const day of ["Monday", "Wednesday", "Friday"]) {
      await page.getByRole("menuitemcheckbox", { name: day, exact: true }).click();
    }
    await expect(trigger).toHaveText("Choose days");
    await friday.press("Escape");
    await expect(
      page.getByRole("button", { name: "Create automation", exact: true }),
    ).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.getByRole("combobox", { name: "Schedule", exact: true }).selectOption("daily");
    await expect(trigger).not.toBeVisible();
  });
}
