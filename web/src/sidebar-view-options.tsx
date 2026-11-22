import {
  Settings2Icon,
  FolderIcon,
  ListIcon,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  SearchIcon,
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
  onSearch,
}: {
  preferences: SidebarPreferences;
  update: (value: Partial<SidebarPreferences>) => void;
  projects: Project[];
  onSearch: () => void;
}) {
  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuLabel>View</DropdownMenuLabel>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <FolderIcon />
            Group by
            <span className="ml-auto text-muted-foreground">
              {{ project: "Project", status: "Status", none: "None" }[preferences.grouping]}
            </span>
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
            Density
            <span className="ml-auto text-muted-foreground">
              {preferences.details ? "Detailed" : "Compact"}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={preferences.details ? "detailed" : "compact"}
              onValueChange={(value: unknown) => {
                if (value === "detailed" || value === "compact") {
                  update({ details: value === "detailed" });
                }
              }}
            >
              <DropdownMenuRadioItem value="compact">Compact</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="detailed">Detailed</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuLabel>Filter</DropdownMenuLabel>
        <DropdownMenuItem onClick={onSearch}>
          <SearchIcon />
          Search chats
        </DropdownMenuItem>
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
            {(preferences.status !== "all" || preferences.project !== "" || preferences.unread) && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    update({ status: "all", project: "", unread: false });
                  }}
                >
                  Clear filters
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuGroup>
    </>
  );
}
