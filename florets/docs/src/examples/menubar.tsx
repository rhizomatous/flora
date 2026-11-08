import { useState } from "react";

import {
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarTrigger,
} from "@flora/florets";

export function Example() {
  const [action, setAction] = useState("Choose a menu action.");
  const [showDetails, setShowDetails] = useState(true);
  return (
    <div className="grid gap-3">
      <Menubar>
        <MenubarMenu>
          <MenubarTrigger>File</MenubarTrigger>
          <MenubarContent>
            <MenubarItem
              onSelect={() => {
                setAction("New file selected");
              }}
            >
              New file
            </MenubarItem>
            <MenubarItem disabled>Export</MenubarItem>
          </MenubarContent>
        </MenubarMenu>
        <MenubarMenu>
          <MenubarTrigger>View</MenubarTrigger>
          <MenubarContent>
            <MenubarCheckboxItem checked={showDetails} onCheckedChange={setShowDetails}>
              Show details
            </MenubarCheckboxItem>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>
      <p role="status" className="text-sm text-muted-foreground">
        {action}
      </p>
    </div>
  );
}
