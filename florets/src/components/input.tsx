import type { ComponentProps } from "react";
import { cn } from "../lib/utils";

const control = "w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60 aria-invalid:border-destructive aria-invalid:outline-destructive";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input data-slot="input" className={cn(control, "placeholder:text-muted-foreground", className)} {...props} />;
}

export function NativeSelect({ className, ...props }: ComponentProps<"select">) {
  return <select data-slot="native-select" className={cn(control, className)} {...props} />;
}
