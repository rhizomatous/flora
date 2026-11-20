import { expect, test } from "vitest";

import { pullChecksSummary } from "./pull-checks-summary";
import type { Pull } from "./pull-schemas";

const now = Date.now();
const pull = {
  url: "https://github.com/example/core/pull/7",
  number: 7,
  state: "open",
  draft: false,
  headSHA: "new",
  checks: {
    sha: "new",
    checkedAt: new Date(now).toISOString(),
    items: [
      { name: "Build", state: "success" },
      { name: "Browser", state: "pending" },
    ],
  },
} satisfies Pull;
test("checks summarize mixed results without claiming readiness", () => {
  expect(pullChecksSummary(pull, now)).toEqual({
    label: "1 pending, 1 passed",
    state: "pending",
    stale: false,
  });
  expect(
    pullChecksSummary(
      { ...pull, checks: { ...pull.checks, items: [{ name: "Optional", state: "neutral" }] } },
      now,
    ).state,
  ).toBe("neutral");
  expect(
    pullChecksSummary(
      {
        ...pull,
        checks: {
          ...pull.checks,
          items: [
            { name: "Build", state: "failure" },
            { name: "Test", state: "success" },
            { name: "Lint", state: "success" },
          ],
        },
      },
      now,
    ).label,
  ).toBe("1 failed, 2 passed");
  expect(pullChecksSummary({ ...pull, checks: { ...pull.checks, items: [] } }, now).label).toBe(
    "No checks reported",
  );
});
test("previous heads, aged data, and refresh failures are never current", () => {
  expect(pullChecksSummary({ ...pull, headSHA: "force-push" }, now).state).toBe("unavailable");
  expect(pullChecksSummary(pull, now + 121_000).stale).toBe(true);
  expect(
    pullChecksSummary({ ...pull, checks: { ...pull.checks, error: "Permission denied" } }, now)
      .stale,
  ).toBe(true);
  expect(pullChecksSummary({ ...pull, checks: undefined }, now).label).toBe("Checks unavailable");
});
