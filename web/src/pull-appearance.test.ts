import { expect, test } from "vitest";

import { pullAppearance } from "./pull-appearance";
import type { Pull } from "./pull-schemas";

const now = Date.now();
const pull: Pull = {
  url: "https://github.com/example/core/pull/7",
  number: 7,
  state: "open",
  draft: false,
  headSHA: "head",
  checks: { sha: "head", checkedAt: new Date(now).toISOString(), items: [] },
};
function withChecks(states: string[]): Pull {
  return {
    ...pull,
    checks: {
      sha: "head",
      checkedAt: new Date(now).toISOString(),
      items: states.map((state) => ({ name: state, state })),
    },
  };
}
test("open PR colors reflect only current reported checks", () => {
  expect(pullAppearance(withChecks(["pending", "success"]), now).tone).toBe("pending");
  expect(pullAppearance(withChecks(["failure", "pending"]), now).tone).toBe("failure");
  expect(pullAppearance(withChecks(["success", "neutral"]), now).tone).toBe("success");
  for (const states of [[], ["neutral"], ["unavailable"], ["success", "unavailable"]]) {
    expect(pullAppearance(withChecks(states), now).tone).toBe("neutral");
  }
  const passed = withChecks(["success"]);
  expect(pullAppearance({ ...passed, headSHA: "new-head" }, now).tone).toBe("neutral");
  expect(pullAppearance(passed, now + 121_000).tone).toBe("neutral");
  expect(pullAppearance({ ...passed, checks: undefined }, now).tone).toBe("neutral");
});
test("draft, closed, and merged PRs retain their lifecycle appearance", () => {
  for (const state of ["success", "pending", "failure"]) {
    const checked = withChecks([state]);
    expect(pullAppearance({ ...checked, draft: true }, now)).toMatchObject({
      status: "draft",
      tone: "neutral",
    });
    expect(pullAppearance({ ...checked, state: "closed" }, now)).toMatchObject({
      status: "closed",
      tone: "failure",
    });
    expect(pullAppearance({ ...checked, state: "merged" }, now)).toMatchObject({
      status: "merged",
      tone: "merged",
    });
  }
  expect(pullAppearance({ ...withChecks(["success"]), draft: true }, now).description).toBe(
    "Draft · 1 passed",
  );
});
