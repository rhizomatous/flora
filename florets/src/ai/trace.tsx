import { Root, Trigger, Content } from "@radix-ui/react-collapsible";
import { ChevronRightIcon } from "@radix-ui/react-icons";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "../lib/utils";

// Adapted from https://ui.shadcn.com/docs/components/radix/trace.
export function Trace({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="trace"
      className={cn("flex min-w-0 flex-col gap-1 text-sm", className)}
      {...props}
    />
  );
}
export function TraceLine({
  className,
  status,
  ...props
}: ComponentProps<"span"> & { status?: "running" | "pending" | "error" | undefined }) {
  return (
    <span
      data-slot="trace-line"
      data-status={status}
      className={cn(
        "inline-flex min-w-0 items-center gap-2 text-muted-foreground data-[status=error]:text-foreground data-[status=error]:font-medium",
        className,
      )}
      {...props}
    />
  );
}
export function TraceTitle({ className, ...props }: ComponentProps<"span">) {
  return (
    <span data-slot="trace-title" className={cn("min-w-0 break-words", className)} {...props} />
  );
}
export function TraceDescription({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="trace-description"
      className={cn("text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}
export function TraceIcon({ className, ...props }: ComponentProps<"span">) {
  return (
    <span aria-hidden="true" className={cn("shrink-0 [&_svg]:size-3.5", className)} {...props} />
  );
}
export const TraceCollapsible = Root;
export function TraceCollapsibleTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof Trigger>) {
  return (
    <Trigger
      data-slot="trace-trigger"
      className={cn(
        "group flex max-w-full items-center gap-2 py-1.5 text-left text-sm hover:text-foreground",
        className,
      )}
      {...props}
    >
      <ChevronRightIcon
        aria-hidden="true"
        className="size-3 shrink-0 transition-transform group-data-[state=open]:rotate-90"
      />
      {children}
    </Trigger>
  );
}
export function TraceCollapsibleContent({ className, ...props }: ComponentProps<typeof Content>) {
  return <Content data-slot="trace-content" className={cn("min-w-0 py-2", className)} {...props} />;
}
export type DisclosureProps = Omit<ComponentProps<typeof Root>, "title"> & {
  title: ReactNode;
  description?: ReactNode;
  status?: "running" | "pending" | "error" | undefined;
};
export function TraceDisclosure({
  title,
  description,
  status,
  children,
  ...props
}: DisclosureProps) {
  return (
    <TraceCollapsible {...props}>
      <TraceCollapsibleTrigger>
        <TraceLine status={status}>
          <TraceTitle>{title}</TraceTitle>
          {description !== undefined && <TraceDescription>{description}</TraceDescription>}
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>{children}</TraceCollapsibleContent>
    </TraceCollapsible>
  );
}
