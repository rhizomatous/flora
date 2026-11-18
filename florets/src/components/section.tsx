import type { ComponentProps } from "react";

import { cn } from "../lib/utils";

function SectionStack({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="section-stack"
      className={cn("flex min-w-0 flex-col gap-10 sm:gap-12", className)}
      {...props}
    />
  );
}

function Section({ className, ...props }: ComponentProps<"section">) {
  return (
    <section
      data-slot="section"
      className={cn("flex min-w-0 flex-col gap-4", className)}
      {...props}
    />
  );
}

function SectionHeader({
  className,
  inset = false,
  ...props
}: ComponentProps<"div"> & { inset?: boolean }) {
  return (
    <div
      data-slot="section-header"
      className={cn("flex min-w-0 flex-col gap-2", inset && "mx-px px-4", className)}
      {...props}
    />
  );
}

export { SectionStack, Section, SectionHeader };
