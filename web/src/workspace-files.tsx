import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import {
  Button,
  Input,
  CloudIcon,
  FolderIcon,
  FileTypeIcon,
  ChevronRightIcon,
  SearchIcon,
  RefreshCwIcon,
  XIcon,
} from "@flora/florets";

import { useChatPanelState, workspaceFileView } from "./chat-panel-state";
import { RuntimeMenu } from "./runtime-controls";
import {
  listingSchema,
  repositoriesSchema,
  useWorkspaceResource,
  workspaceURL,
} from "./workspace-data";
import { WorkspaceSearch } from "./workspace-search";

type TreeProps = {
  chatID: string;
  repository: string;
  directory: string;
  active: boolean;
  revision: number;
  onExpired: () => void;
};

function DirectoryEntries({
  chatID,
  repository,
  directory,
  active,
  revision,
  onExpired,
}: TreeProps) {
  const [state, update] = useChatPanelState(chatID);
  const [offset, setOffset] = useState(0);
  const location = workspaceURL(chatID, { repository, path: directory }, { revision, offset });
  const { data: listing, error } = useWorkspaceResource(listingSchema, location, {
    active,
    onExpired,
  });
  const visible = listing?.entries;
  return (
    <>
      {error && (
        <li role="alert" className="px-3 py-2 text-sm text-destructive">
          {error}
        </li>
      )}
      {!listing && !error && (
        <li role="status" className="px-3 py-2 text-sm text-muted-foreground">
          Loading files…
        </li>
      )}
      {visible?.map((entry) => {
        const path = directory === "." ? entry.name : `${directory}/${entry.name}`;
        const file = { repository, path };
        const key = workspaceFileView(file);
        const expanded = state.workspaceExpanded.includes(key);
        const folder = entry.kind === "directory";
        const unsupported = entry.kind === "unsupported" || entry.kind === "symlink";
        return (
          <li key={entry.name} data-workspace-node>
            <button
              type="button"
              className="workspace-tree-row"
              aria-expanded={folder ? expanded : undefined}
              disabled={unsupported}
              title={path}
              onClick={() => {
                if (folder) {
                  update({
                    workspaceExpanded: expanded
                      ? state.workspaceExpanded.filter((value) => value !== key)
                      : [...state.workspaceExpanded, key],
                  });
                } else {
                  update({
                    workspaceTabs: state.workspaceTabs.some((tab) => workspaceFileView(tab) === key)
                      ? state.workspaceTabs
                      : [...state.workspaceTabs, file],
                    mainView: key,
                  });
                }
              }}
            >
              <span className="workspace-tree-caret">
                {folder && <ChevronRightIcon className={expanded ? "rotate-90" : ""} />}
              </span>
              {folder ? (
                <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
              ) : (
                <FileTypeIcon path={entry.name} />
              )}
              <span className="min-w-0 truncate">{entry.name}</span>
              {unsupported && (
                <span className="ml-auto pl-2 text-xs text-muted-foreground">
                  {entry.kind === "symlink" ? "Symlink" : "Unsupported"}
                </span>
              )}
            </button>
            {folder && expanded && (
              <ul className="workspace-tree-children">
                <DirectoryEntries
                  chatID={chatID}
                  repository={repository}
                  directory={path}
                  active={active}
                  revision={revision}
                  onExpired={onExpired}
                />
              </ul>
            )}
          </li>
        );
      })}
      {listing?.entries.length === 0 && (
        <li className="px-3 py-2 text-sm text-muted-foreground">This folder is empty.</li>
      )}
      {(offset > 0 || listing?.truncated === true) && (
        <li className="flex items-center gap-2 px-5 py-2">
          <Button
            variant="ghost"
            size="compact"
            disabled={offset === 0}
            onClick={() => {
              setOffset(Math.max(0, offset - 500));
            }}
          >
            Previous page
          </Button>
          <Button
            variant="ghost"
            size="compact"
            disabled={listing?.truncated !== true}
            onClick={() => {
              if (listing) setOffset(listing.nextOffset);
            }}
          >
            Next page
          </Button>
        </li>
      )}
    </>
  );
}

/** Native disclosure buttons keep nested folders reachable without moving the canvas. */
function treeKeys(event: KeyboardEvent<HTMLElement>) {
  const { target } = event;
  if (!(target instanceof HTMLButtonElement)) return;
  const buttons = [
    ...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
  ];
  const index = buttons.indexOf(target);
  let next: HTMLButtonElement | undefined;
  if (event.key === "ArrowDown") next = buttons[index + 1];
  if (event.key === "ArrowUp") next = buttons[index - 1];
  if (event.key === "Home") next = buttons[0];
  if (event.key === "End") next = buttons.at(-1);
  if (event.key === "ArrowRight" && target.getAttribute("aria-expanded") === "false") {
    event.preventDefault();
    target.click();
  }
  if (event.key === "ArrowRight" && target.getAttribute("aria-expanded") === "true") {
    next =
      target.parentElement?.querySelector<HTMLButtonElement>(":scope > ul button:not(:disabled)") ??
      undefined;
  }
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    if (target.getAttribute("aria-expanded") === "true") target.click();
    else {
      next =
        target.closest("ul")?.parentElement?.querySelector<HTMLButtonElement>(":scope > button") ??
        undefined;
    }
  }
  if (next) {
    event.preventDefault();
    next.focus();
  }
}

export function WorkspaceFiles({
  chatID,
  active,
  onExpired,
}: {
  chatID: string;
  active: boolean;
  onExpired: () => void;
}) {
  const [state, update] = useChatPanelState(chatID);
  const [query, setQuery] = useState("");
  const [revision, setRevision] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const url = `chats/${encodeURIComponent(chatID)}/workspace?revision=${revision}`;
  const { data, error } = useWorkspaceResource(repositoriesSchema, url, { active, onExpired });
  useEffect(() => {
    if (!active) return;
    function key(event: globalThis.KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        input.current?.focus();
      }
    }
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
    };
  }, [active]);
  return (
    <section
      aria-label="Workspace files"
      className="flex h-full min-h-0 min-w-0 flex-col bg-surface-canvas"
    >
      <div className="workspace-search flex min-h-11 shrink-0 items-center gap-2 border-b px-4">
        <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
        <Input
          ref={input}
          value={query}
          aria-label="Search workspace files"
          placeholder="Search files…"
          className="h-10 rounded-none border-0 bg-transparent! px-0 text-sm shadow-none focus-visible:ring-0"
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setQuery("");
              document
                .querySelector<HTMLButtonElement>('.chat-main-pane [data-workspace-view="files"]')
                ?.focus();
            }
          }}
        />
        {query !== "" && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Clear file search"
            onClick={() => {
              setQuery("");
              input.current?.focus();
            }}
          >
            <XIcon />
          </Button>
        )}
        <kbd className="hidden shrink-0 rounded-sm bg-surface-panel px-1 text-xs text-muted-foreground sm:inline">
          {navigator.userAgent.includes("Mac") ? "⌘ P" : "Ctrl P"}
        </kbd>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Refresh files"
          title="Refresh files"
          onClick={() => {
            setRevision((value) => value + 1);
          }}
        >
          <RefreshCwIcon />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-4 py-3 sm:px-5">
        <div className="mb-2 flex min-h-8 items-center gap-2 text-sm">
          <CloudIcon className="size-4 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">Workspace</span>
          <RuntimeMenu id={chatID} disabled={false} status active={active} />
        </div>
        {error && (
          <p role="alert" className="p-3 text-sm text-destructive">
            {error}
          </p>
        )}
        {!data && !error && (
          <p role="status" className="p-3 text-sm text-muted-foreground">
            Loading repositories…
          </p>
        )}
        {data?.repositories.length === 0 && (
          <p className="p-3 text-sm text-muted-foreground">No repositories in this workspace.</p>
        )}
        {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Delegates arrow keys from the nested native disclosure buttons. */}
        <nav hidden={query.trim() !== ""} aria-label="Workspace file tree" onKeyDown={treeKeys}>
          {data?.repositories.map((repository) => {
            const root = workspaceFileView({ repository: repository.name, path: "." });
            const collapsed = state.workspaceExpanded.includes(`collapsed:${root}`);
            return (
              <section key={repository.name} aria-label={repository.name} className="mb-3">
                <button
                  type="button"
                  className="workspace-tree-row font-medium"
                  aria-expanded={!collapsed}
                  onClick={() => {
                    update({
                      workspaceExpanded: collapsed
                        ? state.workspaceExpanded.filter((value) => value !== `collapsed:${root}`)
                        : [...state.workspaceExpanded, `collapsed:${root}`],
                    });
                  }}
                >
                  <span className="workspace-tree-caret">
                    <ChevronRightIcon className={collapsed ? "" : "rotate-90"} />
                  </span>
                  <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{repository.name}</span>
                  {repository.role === "extra" && (
                    <span className="ml-1 text-xs text-muted-foreground">extra</span>
                  )}
                </button>
                {!collapsed && (
                  <ul className="workspace-tree-root">
                    <DirectoryEntries
                      key={`${repository.name}:${revision}`}
                      chatID={chatID}
                      repository={repository.name}
                      directory="."
                      active={active && query.trim() === ""}
                      revision={revision}
                      onExpired={onExpired}
                    />
                  </ul>
                )}
              </section>
            );
          })}
        </nav>
        {query.trim() !== "" &&
          data?.repositories.map((repository) => (
            <WorkspaceSearch
              key={repository.name}
              chatID={chatID}
              repository={repository.name}
              query={query.trim()}
              active={active}
              onExpired={onExpired}
            />
          ))}
      </div>
    </section>
  );
}
