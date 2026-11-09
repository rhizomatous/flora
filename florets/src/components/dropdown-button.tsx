import { ChevronDownIcon } from "lucide-react";
import type { ComponentProps } from "react";

import { cn } from "../lib/utils";
import { Button } from "./button";

/** Use inside a menu or popover trigger with asChild; the trigger supplies expanded state. */
function DropdownButton({
  children,
  className,
  variant = "ghost",
  size = "sm",
  type = "button",
  ...props
}: Omit<ComponentProps<typeof Button>, "asChild">) {
  return (
    <Button
      type={type}
      variant={variant}
      size={size}
      className={cn("cn-dropdown-button", className)}
      {...props}
    >
      {children}
      <ChevronDownIcon data-slot="dropdown-chevron" aria-hidden="true" />
    </Button>
  );
}

export { DropdownButton };
