import { ChevronDownIcon } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

/** Groups list items under a native disclosure; children must be list items. */
export function ListGroup({
  label,
  count,
  listLabel,
  children,
  actions,
  forceOpen = false,
}: {
  label: string;
  count: number;
  listLabel: string;
  children: ReactNode;
  actions?: ReactNode;
  forceOpen?: boolean;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  const wasOpen = useRef(true);
  useEffect(() => {
    const node = details.current;
    if (!node || !forceOpen) return;
    wasOpen.current = node.open;
    node.open = true;
    return () => {
      node.open = wasOpen.current;
    };
  }, [forceOpen]);
  return (
    <div className="relative">
      {actions !== undefined && (
        <div className="absolute end-1 top-2 z-10 sm:top-0.5">{actions}</div>
      )}
      <details ref={details} open className="group/list-group" data-slot="list-group">
        <summary
          style={actions === undefined ? undefined : { paddingInlineEnd: "3rem" }}
          className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-sm font-medium sm:min-h-8 sm:py-1.5 [&::-webkit-details-marker]:hidden"
        >
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
    </div>
  );
}
