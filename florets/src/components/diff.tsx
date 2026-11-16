// oxlint-disable react/no-array-index-key -- Patch rows retain their order within each immutable snapshot.
import { useMemo } from "react";

import { useHighlightedCode } from "../hooks/use-highlighted-code";
import { parseDiff } from "../lib/diff";

// Each side is highlighted separately so removed code cannot affect added code's grammar state.
export function Diff({ patch, path }: { patch: string; path: string }) {
  const rows = useMemo(() => parseDiff(patch), [patch]);
  const language = path.split(".").at(-1) ?? "text";
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
    <div
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users need to scroll long code lines.
      tabIndex={0}
      role="region"
      aria-label={`Diff for ${path}`}
      className="overflow-auto font-mono text-xs leading-5"
    >
      <table className="w-full border-collapse whitespace-pre">
        <tbody>
          {rows.map((row, index) => {
            const oldCode = row.oldLine === undefined ? undefined : before[oldIndex++];
            const newCode = row.newLine === undefined ? undefined : after[newIndex++];
            const colors = {
              add: "bg-emerald-500/10",
              remove: "bg-red-500/10",
              meta: "bg-muted/40 text-muted-foreground",
              context: "",
            };
            const color = colors[row.kind];
            return (
              <tr key={index} className={color}>
                <td
                  aria-hidden="true"
                  className="w-10 px-2 text-right text-muted-foreground select-none"
                >
                  {row.oldLine}
                </td>
                <td
                  aria-hidden="true"
                  className="w-10 border-r border-border px-2 text-right text-muted-foreground select-none"
                >
                  {row.newLine}
                </td>
                <td className="w-5 px-1 select-none">
                  {{ add: "+", remove: "−", context: "", meta: "" }[row.kind]}
                </td>
                <td className="pr-4">{newCode ?? oldCode ?? row.text}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
