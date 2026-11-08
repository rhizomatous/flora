import { FolderIcon } from "lucide-react";

import {
  Badge,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@flora/florets";

export function Example() {
  return (
    <Item variant="outline" className="w-full">
      <ItemMedia variant="icon">
        <FolderIcon />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>Flora</ItemTitle>
        <ItemDescription>Updated a few minutes ago</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Badge variant="secondary">Ready</Badge>
      </ItemActions>
    </Item>
  );
}
