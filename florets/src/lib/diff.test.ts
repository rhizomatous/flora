import { describe, expect, it } from "vitest";

import { changedRanges, fileLanguage, inlineChanges, parseDiff } from "./diff";

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

describe("within-line changes", () => {
  it("marks multiple edits and retains unchanged text between them", () => {
    const before = "return paginate(query, 10, false);";
    const after = "return paginate(query, 50, true);";
    const changes = changedRanges(before, after);
    expect(changes?.removed.map((range) => before.slice(range.start, range.end))).toEqual([
      "10",
      "false",
    ]);
    expect(changes?.added.map((range) => after.slice(range.start, range.end))).toEqual([
      "50",
      "true",
    ]);
  });
  it("does not mark an unchanged prefix when arguments are inserted", () => {
    const before = "return encode(createdAt)";
    const after = "return encode(createdAt, id)";
    const changes = changedRanges(before, after);
    expect(changes?.removed).toEqual([]);
    expect(changes?.added.map((range) => after.slice(range.start, range.end)).join("")).toBe(
      ", id",
    );
  });
  it("falls back to whole lines for unrelated or oversized replacements", () => {
    expect(changedRanges("alpha", "omega")).toBeNull();
    expect(changedRanges("a ".repeat(300), "b ".repeat(300))).toBeNull();
  });
  it("pairs similar lines across an inserted line, but never across hunk boundaries", () => {
    const rows = parseDiff(
      "@@ -1 +1,2 @@\n-return encode(time);\n+// new cursor\n+return encode(time, id);\n@@ -10 +11 @@\n+return encode(other);\n",
    );
    const changes = inlineChanges(rows);
    expect(changes.has(1)).toBe(true);
    expect(changes.has(2)).toBe(false);
    expect(changes.has(3)).toBe(true);
    expect(changes.has(5)).toBe(false);
  });
  it("recognizes extensionless build files", () => {
    expect(fileLanguage("build/Dockerfile.dev")).toBe("dockerfile");
    expect(fileLanguage("Makefile")).toBe("makefile");
    expect(fileLanguage("internal/notes/list.go")).toBe("go");
  });
});
