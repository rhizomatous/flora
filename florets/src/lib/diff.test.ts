import { describe, expect, it } from "vitest";

import { parseDiff } from "./diff";

describe("parseDiff", () => {
  it("keeps patch headers out of line counts and resets at each hunk", () => {
    const rows = parseDiff(
      "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -4,2 +8,2 @@\n same\n-old\n+new\n\\ No newline at end of file\n@@ -20,0 +24 @@\n+added\n",
    );
    expect(rows.filter((r) => r.kind !== "meta")).toEqual([
      { kind: "context", text: "same", oldLine: 4, newLine: 8 },
      { kind: "remove", text: "old", oldLine: 5 },
      { kind: "add", text: "new", newLine: 9 },
      { kind: "add", text: "added", newLine: 24 },
    ]);
  });
  it("handles file-type changes with two patches and source lines beginning with signs", () => {
    const rows = parseDiff(
      "@@ -1 +0,0 @@\n---old\ndiff --git a/a b/a\n--- /dev/null\n+++ b/a\n@@ -0,0 +1 @@\n+++new\n",
    );
    expect(rows.filter((r) => r.kind === "add" || r.kind === "remove")).toEqual([
      { kind: "remove", text: "--old", oldLine: 1 },
      { kind: "add", text: "++new", newLine: 1 },
    ]);
  });
});
