import { Portal, Content, Item, Separator, Label } from "@radix-ui/react-dropdown-menu";
import type { ComponentProps } from "react";

import { cn } from "../lib/utils";

export {
  Root as DropdownMenu,
  Trigger as DropdownMenuTrigger,
  Group as DropdownMenuGroup,
} from "@radix-ui/react-dropdown-menu";

/** Portals the menu so scrollable containers cannot clip it; placement follows the trigger. */
export function DropdownMenuContent({
  className,
  sideOffset = 6,
  collisionPadding = 8,
  ...props
}: ComponentProps<typeof Content>) {
  return (
    <Portal>
      <Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          "z-50 min-w-48 max-w-[calc(100vw-1rem)] max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-lg outline-none",
          className,
        )}
        {...props}
      />
    </Portal>
  );
}

export function DropdownMenuItem({ className, ...props }: ComponentProps<typeof Item>) {
  return (
    <Item
      data-slot="dropdown-menu-item"
      className={cn(
        "flex cursor-default items-center gap-3 rounded-md px-3 py-2 text-sm outline-none data-[highlighted]:bg-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof Separator>) {
  return <Separator className={cn("-mx-1.5 my-1.5 h-px bg-border", className)} {...props} />;
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof Label>) {
  return <Label className={cn("px-3 py-2 text-xs text-muted-foreground", className)} {...props} />;
}
