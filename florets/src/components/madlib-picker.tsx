import type { ComponentProps } from "react";

import { cn } from "../lib/utils";
import { Button } from "./button";

const pickerStyles =
  "h-7 w-fit min-w-0 gap-1.5 rounded-md border-transparent bg-madlib-background px-2 py-1 text-sm font-normal text-foreground hover:bg-madlib-hover focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50";

/** A compact trigger for a choice embedded in a sentence. Supply a menu or popover separately. */
function MadlibPicker({
  prefix,
  children,
  className,
  ...props
}: ComponentProps<typeof Button> & { prefix?: string }) {
  return (
    <Button type="button" variant="secondary" {...props} className={cn(pickerStyles, className)}>
      {prefix !== undefined && <span className="text-muted-foreground">{prefix}</span>}
      <span className="truncate">{children}</span>
    </Button>
  );
}

function MadlibSelect({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      data-slot="madlib-select"
      className={cn(
        pickerStyles,
        "field-sizing-content appearance-none border outline-none",
        className,
      )}
      {...props}
    />
  );
}

export { MadlibPicker, MadlibSelect };
