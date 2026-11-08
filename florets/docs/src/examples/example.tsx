import type { ComponentProps } from "react";

import { cn } from "@flora/florets";

export function ExampleWrapper({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("grid w-full min-w-0 items-start gap-6 p-4 md:grid-cols-2", className)}
      {...props}
    />
  );
}

export function Example({
  title,
  children,
  className,
  containerClassName,
  ...props
}: ComponentProps<"div"> & { title?: string; containerClassName?: string }) {
  return (
    <section
      data-slot="example"
      aria-label={title}
      className={cn("min-w-0 rounded-2xl border bg-card", containerClassName)}
      {...props}
    >
      {title !== undefined && <h2 className="border-b px-5 py-3 text-sm font-medium">{title}</h2>}
      <div
        data-slot="example-content"
        className={cn(
          "flex min-w-0 flex-col items-start gap-6 overflow-x-auto p-5 *:[div:not([class*='w-'])]:w-full",
          className,
        )}
      >
        {children}
      </div>
    </section>
  );
}
