import { ChevronDownIcon } from "lucide-react";
import type { ReactNode } from "react";

/** Groups list items under a native disclosure; children must be list items. */
export function ListGroup({
  label,
  count,
  listLabel,
  children,
}: {
  label: string;
  count: number;
  listLabel: string;
  children: ReactNode;
}) {
  return (
    <details open className="group/list-group" data-slot="list-group">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg bg-muted/60 px-3 py-2.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <ChevronDownIcon
          className="size-3.5 text-muted-foreground group-not-open/list-group:-rotate-90"
          aria-hidden="true"
        />
        <span className="min-w-0 truncate">{label}</span>
        <span className="text-muted-foreground">{count}</span>
      </summary>
      <ul aria-label={listLabel} className="mt-1">
        {children}
      </ul>
    </details>
  );
}
