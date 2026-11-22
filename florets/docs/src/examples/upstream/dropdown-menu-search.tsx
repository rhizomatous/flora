import { useState } from "react";

import {
  Button,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  FilesIcon,
  GitBranchIcon,
  ListIcon,
} from "@flora/florets";

import { Example, ExampleWrapper } from "../example";

function ViewsMenu({ many = false }: { many?: boolean }) {
  const [selected, setSelected] = useState("overview");
  const choices = [
    { id: "overview", label: "Overview", Icon: ListIcon },
    { id: "browser", label: "Browser", Icon: FilesIcon, disabled: true },
    { id: "diffs", label: "Diffs", Icon: GitBranchIcon },
    { id: "files", label: "Files", Icon: FilesIcon },
    ...(many
      ? Array.from({ length: 40 }, (_, index) => ({
          id: `file:${index}`,
          label: `File ${index + 1} · workspace/src/long-directory-name/component.tsx`,
          Icon: FilesIcon,
        }))
      : []),
  ];
  return (
    <DropdownMenu search={many ? true : { label: "Search views", emptyText: "No matching views." }}>
      <DropdownMenuTrigger render={<Button variant="outline">Views</Button>} />
      <DropdownMenuContent align="start" aria-label="Views" className="w-80!">
        <DropdownMenuGroup label="Views">
          {choices.map(({ id, label, Icon, disabled = false }) => (
            <DropdownMenuItem
              key={id}
              value={id}
              keywords={[label]}
              disabled={disabled}
              data-checked={selected === id}
              onClick={() => {
                setSelected(id);
              }}
            >
              <Icon />
              <span className="min-w-0 flex-1 truncate">{label}</span>
              {disabled && <span className="text-xs text-muted-foreground">Unavailable</span>}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SettingsMenu() {
  const [status, setStatus] = useState(false);
  const [density, setDensity] = useState("compact");
  return (
    <DropdownMenu search={{ label: "Search actions" }}>
      <DropdownMenuTrigger render={<Button variant="outline">Actions</Button>} />
      <DropdownMenuContent aria-label="Actions" className="w-80!">
        <DropdownMenuGroup label="Appearance">
          <DropdownMenuCheckboxItem checked={status} onCheckedChange={setStatus}>
            Show status
          </DropdownMenuCheckboxItem>
          <DropdownMenuRadioGroup value={density} onValueChange={setDensity}>
            <DropdownMenuRadioItem value="compact">Compact</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="comfortable">Comfortable</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSub search={{ label: "Search more views" }}>
          <DropdownMenuSubTrigger>More views</DropdownMenuSubTrigger>
          <DropdownMenuSubContent aria-label="More views" className="w-64!">
            <DropdownMenuItem value="history">History</DropdownMenuItem>
            <DropdownMenuItem value="activity">Activity</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Preview() {
  return (
    <ExampleWrapper>
      <Example title="Searchable menu">
        <ViewsMenu />
      </Example>
      <Example title="Scrolling results">
        <ViewsMenu many />
      </Example>
      <Example title="Checkboxes, radio choices, and submenus">
        <SettingsMenu />
      </Example>
    </ExampleWrapper>
  );
}
