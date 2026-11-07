import type { ComponentProps } from "react";

import { cn } from "../lib/utils";
import { Text } from "./typography";

export function Alert({
  className,
  variant = "default",
  role = "alert",
  ...props
}: ComponentProps<"div"> & { variant?: "default" | "destructive" }) {
  return (
    <div
      data-slot="alert"
      role={role}
      className={cn(
        "rounded-md border border-border p-3 text-sm",
        variant === "destructive" && "border-destructive",
        className,
      )}
      {...props}
    />
  );
}

export function LoadingStatus({ className, children = "Loading…", ...props }: ComponentProps<"p">) {
  return (
    <Text size="md" tone="muted" role="status" className={className} {...props}>
      {children}
    </Text>
  );
}
