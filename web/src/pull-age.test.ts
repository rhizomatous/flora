import { expect, test } from "vitest";

import { pullAge } from "./pull-age";

test("PR age uses creation time and handles absent or future timestamps", () => {
  const now = Date.parse("2026-11-17T18:00:00Z");
  expect(pullAge(undefined, now)).toBe("");
  expect(pullAge("invalid", now)).toBe("");
  expect(pullAge("2026-11-17T18:01:00Z", now)).toBe("just now");
  expect(pullAge("2026-11-17T17:54:00Z", now)).toBe("6m ago");
  expect(pullAge("2026-11-17T12:00:00Z", now)).toBe("6h ago");
  expect(pullAge("2026-11-15T18:00:00Z", now)).toBe("2d ago");
});
