import { useState } from "react";

import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@flora/florets";

export function Example() {
  const [notifications, setNotifications] = useState(true);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">Project actions</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>Notifications</DropdownMenuLabel>
        <DropdownMenuCheckboxItem checked={notifications} onCheckedChange={setNotifications}>
          Enable notifications
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>Delete project</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
