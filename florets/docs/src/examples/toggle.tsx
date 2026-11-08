import { BoldIcon } from "lucide-react";

import { Toggle } from "@flora/florets";

export function Example() {
  return (
    <Toggle aria-label="Bold text" variant="outline">
      <BoldIcon />
    </Toggle>
  );
}
