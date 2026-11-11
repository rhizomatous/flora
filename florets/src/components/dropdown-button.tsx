import { ChevronDownIcon } from "lucide-react";
import type { ComponentProps } from "react";

import { cn } from "../lib/utils";
import { Button } from "./button";

/** Use as a menu or popover trigger’s render element; the trigger supplies expanded state. */
function DropdownButton({
  children,
  className,
  variant = "ghost",
  size = "sm",
  type = "button",
  ...props
}: ComponentProps<typeof Button>) {
  return (
    <Button
      type={type}
      variant={variant}
      size={size}
      className={cn("florets-dropdown-button", className)}
      {...props}
    >
      {children}
      <ChevronDownIcon data-slot="dropdown-chevron" aria-hidden="true" />
    </Button>
  );
}

export { DropdownButton };
