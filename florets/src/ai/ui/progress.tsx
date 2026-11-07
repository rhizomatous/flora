"use client";

import { Progress as ProgressPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "../../lib/utils";

function Progress({ className, value, ...props }: ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn(
        "bg-muted h-2 rounded-2xl relative flex w-full items-center overflow-x-hidden",
        className,
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="size-full flex-1 bg-primary transition-all"
        // oxlint-disable-next-line react/forbid-component-props -- The indicator transform follows the numeric progress value.
        style={{ transform: `translateX(-${100 - (value ?? 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
