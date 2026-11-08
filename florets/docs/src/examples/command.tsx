import { useState } from "react";

import {
  Button,
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@flora/florets";

export function Example() {
  const [action, setAction] = useState("Choose an action above.");
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">Open command menu</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Project actions</DialogTitle>
          <DialogDescription>Search or use the arrow keys to choose an action.</DialogDescription>
        </DialogHeader>
        <Command className="w-full rounded-xl border">
          <CommandInput placeholder="Search actions…" />
          <CommandList>
            <CommandEmpty>No matching actions.</CommandEmpty>
            <CommandGroup heading="Actions">
              <CommandItem
                onSelect={() => {
                  setAction("New chat selected");
                }}
              >
                New chat
              </CommandItem>
              <CommandItem
                onSelect={() => {
                  setAction("Settings selected");
                }}
              >
                Settings
              </CommandItem>
            </CommandGroup>
          </CommandList>
          <p role="status" className="min-h-8 border-t px-3 py-2 text-xs text-muted-foreground">
            {action}
          </p>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
