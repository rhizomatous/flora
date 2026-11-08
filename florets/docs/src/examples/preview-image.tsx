import type { ComponentProps } from "react";

import { cn } from "@flora/florets";

/** Displays upstream image examples without requiring Next.js image optimization. */
export function PreviewImage({
  fill = false,
  className,
  alt,
  ...props
}: ComponentProps<"img"> & { fill?: boolean }) {
  return (
    <img
      alt={alt}
      className={cn(fill && "absolute inset-0 size-full object-cover", className)}
      {...props}
    />
  );
}
