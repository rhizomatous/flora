// oxlint-disable react/no-clone-element, react/no-react-children -- Only locally generated syntax spans are traversed to preserve their colors.
// oxlint-disable react/no-array-index-key -- Rows and tokens retain their order within each immutable patch.
import { Children, cloneElement, isValidElement, useMemo, type ReactNode } from "react";

import { useHighlightedCode } from "../hooks/use-highlighted-code";
import {
  fileLanguage,
  inlineChanges,
  parseDiff,
  type ChangeRange,
  type DiffLine,
} from "../lib/diff";

// Split the highlighter's text spans at change boundaries while retaining their syntax colors.
function markChanges(node: ReactNode, ranges: ChangeRange[], kind: string) {
  let offset = 0;
  function visit(value: ReactNode): ReactNode {
    if (typeof value === "string") {
      const start = offset;
      offset += value.length;
      const cuts = new Set([0, value.length]);
      for (const range of ranges) {
        if (range.start < offset && range.end > start) {
          cuts.add(Math.max(0, range.start - start));
          cuts.add(Math.min(value.length, range.end - start));
        }
      }
      const sorted = [...cuts].toSorted((a, b) => a - b);
      return sorted.slice(0, -1).map((cut, i) => {
        const text = value.slice(cut, sorted[i + 1]);
        const changed = ranges.some(
          (range) => range.start <= start + cut && range.end > start + cut,
        );
        return changed ? (
          <span
            key={cut}
            data-inline-change={kind}
            className={kind === "add" ? "bg-emerald-500/25" : "bg-red-500/25"}
          >
            {text}
          </span>
        ) : (
          text
        );
      });
    }
    if (isValidElement<{ children?: ReactNode }>(value)) {
      return cloneElement(value, undefined, visit(value.props.children));
    }
    if (Array.isArray(value)) return Children.map(value, visit);
    return value;
  }
  return visit(node);
}

function Hunk({ rows, language }: { rows: DiffLine[]; language: string }) {
  const ranges = useMemo(() => inlineChanges(rows), [rows]);
  const before = useHighlightedCode(
    rows
      .filter((r) => r.oldLine !== undefined)
      .map((r) => r.text)
      .join("\n"),
    language,
  );
  const after = useHighlightedCode(
    rows
      .filter((r) => r.newLine !== undefined)
      .map((r) => r.text)
      .join("\n"),
    language,
  );
  let oldIndex = 0;
  let newIndex = 0;
  return (
    <>
      {rows.map((row, index) => {
        const oldCode = row.oldLine === undefined ? undefined : before[oldIndex++];
        const newCode = row.newLine === undefined ? undefined : after[newIndex++];
        const colors = {
          add: "bg-emerald-500/10",
          remove: "bg-red-500/10",
          meta: "text-muted-foreground",
          context: "",
        };
        const gutter = {
          add: "border-l-emerald-500 text-emerald-700 dark:text-emerald-400",
          remove: "border-l-red-500 text-red-700 dark:text-red-400",
          meta: "border-l-transparent text-muted-foreground",
          context: "border-l-transparent text-muted-foreground",
        };
        if (row.kind === "meta") {
          return (
            <tr key={index}>
              <td colSpan={4} aria-label={row.text} className="p-0 font-sans text-muted-foreground">
                <div className="sticky left-0 flex w-[100cqw] items-center gap-3 px-3 py-1">
                  <span aria-hidden="true" className="h-px min-w-3 flex-1 bg-border" />
                  <span>{row.text}</span>
                  <span aria-hidden="true" className="h-px min-w-3 flex-1 bg-border" />
                </div>
              </td>
            </tr>
          );
        }
        return (
          <tr key={index} className={colors[row.kind]}>
            <td
              aria-hidden="true"
              className={`w-8 border-l-2 px-1 text-right select-none ${gutter[row.kind]}`}
            >
              {row.oldLine}
            </td>
            <td
              aria-hidden="true"
              className="w-8 border-r border-border px-1 text-right text-muted-foreground select-none"
            >
              {row.newLine}
            </td>
            <td className="w-4 px-1 select-none">
              {{ add: "+", remove: "−", context: "" }[row.kind]}
            </td>
            <td className="pr-4">
              {markChanges(newCode ?? oldCode ?? row.text, ranges.get(index) ?? [], row.kind)}
            </td>
          </tr>
        );
      })}
    </>
  );
}

export function Diff({ patch, path }: { patch: string; path: string }) {
  const hunks = useMemo(() => {
    const groups: DiffLine[][] = [];
    let current: DiffLine[] = [];
    let previousEnd = 0;
    for (const row of parseDiff(patch)) {
      if (row.kind === "meta" && row.text.startsWith("diff --git ")) {
        previousEnd = 0;
        if (current.length > 0) groups.push(current);
        current = [];
        continue;
      }
      if (row.kind === "meta" && /^(@@ |--- |\+\+\+ )/.test(row.text)) {
        if (!row.text.startsWith("@@ ")) continue;
        if (current.length > 0) groups.push(current);
        current = [];
        const header = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(row.text);
        const start = Number(header?.[1] ?? 0);
        const omitted = Math.max(0, start - previousEnd - 1);
        if (omitted > 0) {
          current.push({
            kind: "meta",
            text: `${omitted} unchanged ${omitted === 1 ? "line" : "lines"}`,
          });
        }
        previousEnd = start + Number(header?.[2] ?? 1) - 1;
      } else current.push(row);
    }
    if (current.length > 0) groups.push(current);
    return groups;
  }, [patch]);
  return (
    <div className="@container min-w-0">
      <div
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users need to scroll long code lines.
        tabIndex={0}
        role="region"
        aria-label={`Diff for ${path}`}
        className="overflow-auto font-mono text-xs leading-5"
      >
        <table className="w-full border-collapse whitespace-pre">
          <tbody>
            {hunks.map((rows, index) => (
              <Hunk key={index} rows={rows} language={fileLanguage(path)} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
