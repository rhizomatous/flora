import { describe, expect, it } from "vitest";

import type { Chat } from "./notifications";
import type { Pull } from "./pull";
import { collectPullRequests } from "./pull-requests";

const pull: Pull = {
  url: "https://github.com/example/app/pull/1",
  number: 1,
  state: "open",
  draft: false,
};
function chat(id: string, items: Pull[] | null, checkedAt = "2026-01-01"): Chat {
  return {
    ID: id,
    Title: id,
    ProjectID: "project",
    Status: "idle",
    StatusReason: "",
    UpdatedAt: "",
    ImageDigest: "",
    HarnessVersion: "",
    StartingCommits: {},
    pulls: { items, checkedAt, error: "" },
  };
}

describe("collectPullRequests", () => {
  it("combines related chats and uses the latest successful status regardless of input order", () => {
    const older = chat("older", [pull]);
    const newer = chat(
      "newer",
      [{ ...pull, state: "merged", additions: 0, deletions: 2 }],
      "2026-01-02",
    );
    const failed = chat("failed", [pull], "2026-01-03");
    failed.pulls = { items: [pull], checkedAt: "2026-01-03", error: "Unavailable" };
    for (const chats of [
      [older, newer, failed],
      [failed, newer, older],
    ]) {
      const rows = collectPullRequests(chats);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.pull).toMatchObject({ state: "merged", additions: 0, deletions: 2 });
      expect(rows[0]?.chats.map((item) => item.ID).toSorted()).toEqual([
        "failed",
        "newer",
        "older",
      ]);
      expect(rows[0]?.stale).toBe(false);
    }
  });
  it("keeps matching PR numbers in different repositories separate and skips missing data", () => {
    const rows = collectPullRequests([
      chat("one", [pull]),
      chat("two", [{ ...pull, url: "https://github.com/example/other/pull/1" }]),
      chat("empty", null),
    ]);
    expect(rows.map((row) => row.repository)).toEqual(["example/app", "example/other"]);
  });
});
