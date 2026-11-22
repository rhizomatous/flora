import { useContext, useEffect, useRef, useState, type ReactNode } from "react";

import {
  Button,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuGroup,
  DropdownMenuLabel,
  Input,
  PlusIcon,
  ListIcon,
  GitBranchIcon,
  FilesIcon,
  CloudIcon,
  FileTypeIcon,
  GitPullRequestIcon,
} from "@flora/florets";

import { useChatPanelState, workspaceFileView } from "./chat-panel-state";
import type { PullSummary } from "./pull-schemas";
import { KeepAwakeItem } from "./runtime-controls";
import { ShellMenuItems } from "./shells";
import { SubagentPaneContext, subagentLabel, subagentStatus, useSubagents } from "./subagent-state";

type Destination = {
  id: string;
  title: string;
  group: string;
  icon: ReactNode;
  current: boolean;
  detail?: string | undefined;
  status?: string;
  disabled?: boolean;
  select?: () => void;
};

export function ChatViewMenu({
  chatID,
  pulls,
  label = "Chat views",
  diffsOpen,
  onDiffsChange,
  onFilesOpen,
  filesOpen = false,
  overviewActive = !diffsOpen && !filesOpen,
}: {
  chatID?: string | undefined;
  pulls?: PullSummary | undefined;
  label?: string;
  diffsOpen: boolean;
  onDiffsChange: (open: boolean) => void;
  onFilesOpen: () => void;
  filesOpen?: boolean;
  overviewActive?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const isOpen = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const focusPane = useRef<"main" | "side" | null>(null);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      input.current?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [open]);
  const [state, update] = useChatPanelState(chatID ?? "");
  const pane = useContext(SubagentPaneContext);
  const { agents, open: openAgent } = useSubagents();
  const search = query.trim().toLocaleLowerCase();
  const matches = (text: string) =>
    search.split(/\s+/).every((word) => text.toLocaleLowerCase().includes(word));
  const active = pane === "main" ? state.mainView : state.view;
  const destinations: Destination[] = [
    {
      id: "overview",
      title: "Overview",
      group: "Views",
      icon: <ListIcon />,
      current: overviewActive,
      select: () => {
        onDiffsChange(false);
      },
    },
    {
      id: "diffs",
      title: "Diffs",
      group: "Views",
      icon: <GitBranchIcon />,
      current: diffsOpen,
      select: () => {
        onDiffsChange(true);
      },
    },
    {
      id: "files",
      title: "Files",
      group: "Views",
      icon: <FilesIcon />,
      current: filesOpen,
      select: onFilesOpen,
    },
    ...state.workspaceTabs.map((file) => ({
      id: workspaceFileView(file),
      title: file.path.split("/").at(-1) ?? file.path,
      detail: `${file.repository}/${file.path}`,
      group: "Open files",
      icon: <FileTypeIcon path={file.path} />,
      current: state.mainView === workspaceFileView(file),
      select: () => {
        update((current) => ({
          mainView: workspaceFileView(file),
          open: current.open && !window.matchMedia("(max-width: 900px)").matches,
        }));
      },
    })),
    ...(pulls?.items ?? []).map((pull) => ({
      id: `pull:${pull.url}`,
      title: `PR #${pull.number}`,
      detail: pull.title ?? pull.repository,
      group: "Pull requests",
      icon: <GitPullRequestIcon />,
      current: state.view === `pull:${pull.url}`,
      select: () => {
        update((current) => ({
          open: true,
          view: `pull:${pull.url}`,
          pullTabs: [...new Set([...current.pullTabs, pull.url])],
        }));
      },
    })),
    ...agents.map((agent) => ({
      id: `subagent:${agent.id}`,
      title: subagentLabel(agent),
      detail: agent.title,
      group: "Subagents",
      icon: <CloudIcon />,
      current: active === `subagent:${agent.id}`,
      status: subagentStatus(agent),
      select: () => {
        openAgent(agent.id);
      },
    })),
    ...(pane === "main" ? state.mainSubagentTabs : state.subagentTabs)
      .filter((id) => !agents.some((agent) => agent.id === id))
      .map((id) => ({
        id: `subagent:${id}`,
        title: "Saved subagent",
        detail: id,
        group: "Subagents",
        icon: <CloudIcon />,
        current: active === `subagent:${id}`,
        status: "Unavailable",
        disabled: true,
      })),
  ].filter((view) => matches(`${view.title} ${"detail" in view ? view.detail : ""} ${view.group}`));
  function selectedTab() {
    const selector = focusPane.current === "main" ? ".chat-main-pane" : ".chat-side-pane";
    return (
      document.querySelector<HTMLElement>(`${selector} [role="tab"][aria-selected="true"]`) ??
      document.querySelector<HTMLElement>(`${selector} .chat-title`)
    );
  }
  function close() {
    isOpen.current = false;
    setOpen(false);
    if (focusPane.current !== null) {
      // A destination can remove the owning pane before the menu restores focus.
      requestAnimationFrame(() => {
        if (!isOpen.current) selectedTab()?.focus();
      });
    }
  }
  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        isOpen.current = next;
        setOpen(next);
        if (next && !open) {
          setQuery("");
          focusPane.current = null;
        }
      }}
    >
      <DropdownMenuTrigger
        ref={trigger}
        render={
          <Button variant="ghost" size="icon-sm" aria-label={label}>
            <PlusIcon />
          </Button>
        }
      />
      <DropdownMenuContent
        aria-hidden={!open || undefined}
        inert={!open || undefined}
        align="start"
        finalFocus={() => {
          if (isOpen.current) return false;
          if (focusPane.current === null) return trigger.current;
          return selectedTab() ?? trigger.current;
        }}
        className="flex max-h-[min(36rem,var(--available-height))] w-80 max-w-[calc(100vw-24px)] flex-col overflow-hidden"
        onKeyDownCapture={(event) => {
          if (event.key !== "ArrowUp" || event.target === input.current) return;
          const items = event.currentTarget.querySelectorAll<HTMLElement>(
            '[role="menuitem"]:not([aria-disabled="true"]):not([data-disabled])',
          );
          if (event.target === items[0]) {
            event.preventDefault();
            event.stopPropagation();
            input.current?.focus();
          }
        }}
      >
        <div className="shrink-0 border-b border-border px-1 pt-1 pb-2">
          <Input
            ref={input}
            aria-label="Search views"
            placeholder="Search views…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                close();
                return;
              }
              if (event.key === "Tab") return;
              event.stopPropagation();
              if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter") {
                event.preventDefault();
                const items = event.currentTarget
                  .closest('[role="menu"]')
                  ?.querySelectorAll<HTMLElement>(
                    '[role="menuitem"]:not([aria-disabled="true"]):not([data-disabled])',
                  );
                const item = event.key === "ArrowUp" ? [...(items ?? [])].at(-1) : items?.[0];
                if (event.key === "Enter") item?.click();
                else item?.focus();
              }
            }}
          />
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain pt-1">
          {[...new Set(destinations.map((view) => view.group))].map((group) => (
            <DropdownMenuGroup key={group}>
              {group !== "Views" && <DropdownMenuLabel>{group}</DropdownMenuLabel>}
              {destinations
                .filter((view) => view.group === group)
                .map((view) => (
                  <DropdownMenuItem
                    key={view.id}
                    disabled={chatID === undefined || view.disabled}
                    onClick={() => {
                      focusPane.current = pane;
                      if (view.id.startsWith("pull:")) focusPane.current = "side";
                      if (view.id === "files" || view.id.startsWith("file:")) {
                        focusPane.current = "main";
                      }
                      close();
                      view.select?.();
                    }}
                  >
                    {view.icon}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{view.title}</span>
                      {"detail" in view && (
                        <span
                          className="block truncate text-xs text-muted-foreground"
                          title={view.detail}
                        >
                          {view.detail}
                        </span>
                      )}
                    </span>
                    {(view.current || "status" in view) && (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {view.current && view.disabled !== true ? "Current view" : view.status}
                      </span>
                    )}
                  </DropdownMenuItem>
                ))}
            </DropdownMenuGroup>
          ))}
          {chatID === undefined ? (
            destinations.length === 0 && (
              <DropdownMenuItem disabled>No matching views</DropdownMenuItem>
            )
          ) : (
            <ShellMenuItems
              chatID={chatID}
              open={open}
              onSelect={() => {
                focusPane.current = "main";
                close();
              }}
              query={search}
              hasViews={destinations.length > 0}
            />
          )}
          {chatID !== undefined && search === "" && (
            <>
              <DropdownMenuSeparator />
              <KeepAwakeItem id={chatID} open={open} />
            </>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
