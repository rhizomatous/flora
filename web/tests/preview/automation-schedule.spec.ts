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
    await expect(trigger).toHaveText("onMonday");
    for (const control of [
      trigger,
      page.getByRole("combobox", { name: "Schedule", exact: true }),
      page.getByRole("button", { name: "Time zone", exact: true }),
      page.getByLabel("Time", { exact: true }),
    ]) {
      await expect(control).toHaveCSS("font-size", "14px");
      await expect(control).toHaveCSS("height", "28px");
    }
    await expect(trigger.locator("svg")).toHaveCount(0);
    const fill = await trigger.evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(fill).not.toBe(
      await page
        .getByLabel("Time", { exact: true })
        .evaluate((element) => getComputedStyle(element).backgroundColor),
    );

    await trigger.click();
    const friday = page.getByRole("menuitemcheckbox", { name: "Friday", exact: true });
    await friday.click();
    await expect(friday).toBeChecked();
    await expect(trigger).toHaveText("onMon, Fri");
    await page.getByRole("menuitemcheckbox", { name: "Wednesday", exact: true }).click();
    await expect(trigger).toHaveText("on3 days");
    await expect(trigger).toHaveAccessibleDescription("Monday, Wednesday, Friday");
    await friday.press("Escape");
    await expect(trigger).toBeFocused();
    await expect(friday).not.toBeVisible();
    await trigger.press("Enter");
    await expect(friday).toBeChecked();
    for (const day of ["Monday", "Wednesday", "Friday"]) {
      await page.getByRole("menuitemcheckbox", { name: day, exact: true }).click();
    }
    await expect(trigger).toHaveText("onChoose days");
    await friday.press("Escape");
    await expect(
      page.getByRole("button", { name: "Create automation", exact: true }),
    ).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.getByRole("combobox", { name: "Schedule", exact: true }).selectOption("daily");
    await expect(trigger).not.toBeVisible();
  });
}
