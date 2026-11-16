export type DiffLine = {
  kind: "context" | "add" | "remove" | "meta";
  text: string;
  oldLine?: number;
  newLine?: number;
};

// Hunk headers reset both counters. Patch metadata never consumes a source line.
export function parseDiff(patch: string): DiffLine[] {
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  return patch
    .replace(/\n$/, "")
    .split("\n")
    .map((text) => {
      const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
      if (hunk) {
        oldLine = Number(hunk[1]);
        newLine = Number(hunk[2]);
        inHunk = true;
      } else if (text.startsWith("diff --git ")) {
        inHunk = false;
      } else if (inHunk) {
        if (text.startsWith("+")) return { kind: "add", text: text.slice(1), newLine: newLine++ };
        if (text.startsWith("-")) {
          return { kind: "remove", text: text.slice(1), oldLine: oldLine++ };
        }
        if (text.startsWith(" ")) {
          return { kind: "context", text: text.slice(1), oldLine: oldLine++, newLine: newLine++ };
        }
      }
      return { kind: "meta", text };
    });
}
