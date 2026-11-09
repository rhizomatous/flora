import type { ComponentProps } from "react";

import { cn } from "../lib/utils";
import { Button } from "./button";

export function Link({ className, children, ...props }: ComponentProps<"a">) {
  return (
    <a
      className={cn(
        "underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring",
        className,
      )}
      {...props}
    >
      {children}
    </a>
  );
}

export function ButtonLink({ className, children, ...props }: ComponentProps<"a">) {
  return (
    <Button
      role="link"
      render={<a {...props}>{children}</a>}
      nativeButton={false}
      className={className}
    />
  );
}
