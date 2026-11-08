import { useState } from "react";

import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@flora/florets";

export function Example() {
  const [pinned, setPinned] = useState(false);
  return (
    <ContextMenu>
      <ContextMenuTrigger className="flex h-36 w-full items-center justify-center rounded-xl border border-dashed text-sm">
        Right-click here, or touch and hold
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuCheckboxItem checked={pinned} onCheckedChange={setPinned}>
          Pin project
        </ContextMenuCheckboxItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled>Delete project</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
