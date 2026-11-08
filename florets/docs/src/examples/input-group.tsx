import { SearchIcon } from "lucide-react";

import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText, Kbd } from "@flora/florets";

export function Example() {
  return (
    <InputGroup>
      <InputGroupAddon>
        <SearchIcon />
        <InputGroupText>Search</InputGroupText>
      </InputGroupAddon>
      <InputGroupInput aria-label="Search projects" placeholder="Project name" />
      <InputGroupAddon align="inline-end">
        <Kbd>⌘ K</Kbd>
      </InputGroupAddon>
    </InputGroup>
  );
}
