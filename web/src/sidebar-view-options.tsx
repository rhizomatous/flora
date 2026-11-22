import {
  Settings2Icon,
  FolderIcon,
  ListIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuCheckboxItem,
} from "@flora/florets";

import { chatStatuses } from "./chat-status";
import type { SidebarPreferences } from "./sidebar-preferences";

type Project = { id: string; name: string };

export function SidebarViewOptions({
  preferences,
  update,
  projects,
}: {
  preferences: SidebarPreferences;
  update: (value: Partial<SidebarPreferences>) => void;
  projects: Project[];
}) {
  return (
    <>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <FolderIcon />
          Group: {{ project: "Project", status: "Status", none: "None" }[preferences.grouping]}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuRadioGroup
            value={preferences.grouping}
            onValueChange={(value: unknown) => {
              if (value === "project" || value === "status" || value === "none") {
                update({ grouping: value });
              }
            }}
          >
            <DropdownMenuRadioItem value="project">Project</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="status">Status</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="none">None</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <Settings2Icon />
          Display
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuCheckboxItem
            checked={preferences.details}
            onCheckedChange={(details) => {
              update({ details });
            }}
          >
            Show chat details
          </DropdownMenuCheckboxItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <ListIcon />
          Filters
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-52">
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Status</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={preferences.status}
                onValueChange={(value) => {
                  const status = [{ id: "all" as const }, ...chatStatuses].find(
                    (s) => s.id === value,
                  )?.id;
                  if (status) update({ status });
                }}
              >
                {[{ id: "all", label: "All chats" }, ...chatStatuses].map((s) => (
                  <DropdownMenuRadioItem key={s.id} value={s.id}>
                    {s.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Project</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-w-64">
              <DropdownMenuRadioGroup
                value={preferences.project}
                onValueChange={(project) => {
                  update({ project: String(project) });
                }}
              >
                {[{ id: "", name: "All projects" }, ...projects].map((p) => (
                  <DropdownMenuRadioItem key={p.id} value={p.id}>
                    <span className="truncate">{p.name}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuCheckboxItem
            checked={preferences.unread}
            onCheckedChange={(unread) => {
              update({ unread });
            }}
          >
            Unread only
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={preferences.status === "all" && !preferences.project && !preferences.unread}
            onClick={() => {
              update({ status: "all", project: "", unread: false });
            }}
          >
            Clear filters
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </>
  );
}
