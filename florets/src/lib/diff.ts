// oxlint-disable typescript/no-non-null-assertion -- Matrix and token indices are bounded by the loop conditions.
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

export type ChangeRange = { start: number; end: number };

const words = (value: string) =>
  [...value.matchAll(/[\p{L}\p{N}_]+|\s+|[^\s]/gu)].map((match) => ({
    text: match[0],
    start: match.index,
  }));
// Bound the token matrix so minified files cannot stall the viewer.
export function changedRanges(before: string, after: string) {
  if (before.length > 4000 || after.length > 4000) return null;
  const a = words(before);
  const b = words(after);
  if (a.length > 256 || b.length > 256) return null;
  const lengths = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i]![j] =
        a[i]!.text === b[j]!.text
          ? 1 + lengths[i + 1]![j + 1]!
          : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
    }
  }
  const removed: ChangeRange[] = [];
  const added: ChangeRange[] = [];
  let shared = 0;
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i]!.text === b[j]!.text) {
      shared += a[i]!.text.trim().length;
      i++;
      j++;
    } else if (j < b.length && (i === a.length || lengths[i]![j + 1]! >= lengths[i + 1]![j]!)) {
      const token = b[j++]!;
      added.push({ start: token.start, end: token.start + token.text.length });
    } else {
      const token = a[i++]!;
      removed.push({ start: token.start, end: token.start + token.text.length });
    }
  }
  const score =
    shared / Math.max(before.replaceAll(/\s/g, "").length, after.replaceAll(/\s/g, "").length, 1);
  return score >= 0.45 ? { removed, added, score } : null;
}

// Pair similar lines only inside one adjacent deletion/addition block, in source order.
export function inlineChanges(rows: DiffLine[]) {
  const ranges = new Map<number, ChangeRange[]>();
  for (let start = 0; start < rows.length; start++) {
    if (rows[start]?.kind !== "remove") continue;
    let split = start;
    while (rows[split]?.kind === "remove") split++;
    let end = split;
    while (rows[end]?.kind === "add") end++;
    if (end - start > 100) {
      start = end - 1;
      continue;
    }
    let next = split;
    for (let old = start; old < split; old++) {
      let best:
        | { index: number; changes: NonNullable<ReturnType<typeof changedRanges>> }
        | undefined;
      for (let candidate = next; candidate < Math.min(end, next + 8); candidate++) {
        const changes = changedRanges(rows[old]!.text, rows[candidate]!.text);
        if (changes && (!best || changes.score > best.changes.score)) {
          best = { index: candidate, changes };
        }
      }
      if (best) {
        ranges.set(old, best.changes.removed);
        ranges.set(best.index, best.changes.added);
        next = best.index + 1;
      }
    }
    start = end - 1;
  }
  return ranges;
}

export function fileLanguage(path: string) {
  const name = path.split("/").at(-1)?.toLowerCase() ?? "";
  if (name === "dockerfile" || name.startsWith("dockerfile.")) return "dockerfile";
  if (name === "makefile" || name === "gnumakefile") return "makefile";
  if (name === ".bashrc" || name === ".zshrc") return "bash";
  return name.split(".").at(-1) ?? "text";
}
