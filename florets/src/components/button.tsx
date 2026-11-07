import type { VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "../lib/utils";
import { buttonVariants } from "./button-variants";

export function Button({
  className,
  variant,
  size,
  type = "button",
  ...props
}: ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return (
    <button
      data-slot="button"
      // oxlint-disable-next-line react/button-has-type -- Native button props restrict type to button, submit, or reset.
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
