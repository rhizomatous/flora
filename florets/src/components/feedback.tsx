import type { ComponentProps } from "react";

import { Text } from "./typography";

export function LoadingStatus({ className, children = "Loading…", ...props }: ComponentProps<"p">) {
  return (
    <Text size="md" tone="muted" role="status" className={className} {...props}>
      {children}
    </Text>
  );
}
