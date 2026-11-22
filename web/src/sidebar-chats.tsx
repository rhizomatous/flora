/* oxlint-disable import/max-dependencies -- Sidebar composes shared chat and folder actions with navigation. */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  Button,
  InboxIcon,
  ChevronRightIcon,
  SearchIcon,
  XIcon,
  EllipsisIcon,
  PinIcon,
  FolderIcon,
  ListIcon,
  Settings2Icon,
  CheckIcon,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
} from "@flora/florets";

import { FolderActions } from "./chat-folders";
import { pinnedChats } from "./chat-organization";
import { ChatOrganizationActions } from "./chat-organization-actions";
import type { Chat } from "./chat-schemas";
import { chatStatus } from "./chat-status";
import { ChatSummary } from "./chat-summary";
import { useFolders } from "./folder-state";
import { UnreadDot } from "./mark-chats-read";
import { PullCount } from "./pull-links";
import { isChatSeen, useMarkChatsRead } from "./sidebar-status";

type Project = { id: string; name: string };

function ageLabel(updated: string, now: number) {
  const age = Math.max(0, now - Date.parse(updated));
  if (!Number.isFinite(age)) return "";
  if (age < 60_000) return "now";
  if (age < 3_600_000) return `${Math.floor(age / 60_000)}m`;
  if (age < 86_400_000) return `${Math.floor(age / 3_600_000)}h`;
  return `${Math.floor(age / 86_400_000)}d`;
}

function ChatRow({
  chat,
  path,
  close,
  now,
  seen,
  projectName,
}: {
  chat: Chat;
  path: string;
  close: () => void;
  now: number;
  seen: boolean;
  projectName?: string | undefined;
}) {
  const status = chatStatus(chat, seen);
  const [summaryOpen, setSummaryOpen] = useState(false);
  return (
    <li className="florets-navigation-row" data-active={path === `chats/${chat.ID}` || undefined}>
      <HoverCard open={summaryOpen} onOpenChange={setSummaryOpen}>
        <HoverCardTrigger
          delay={500}
          render={
            <a
              href={`#chats/${chat.ID}`}
              aria-current={path === `chats/${chat.ID}` ? "page" : undefined}
              className="florets-navigation-link"
              onClick={() => {
                setSummaryOpen(false);
                close();
              }}
              onFocus={() => {
                setSummaryOpen(true);
              }}
            >
              <span
                className="florets-navigation-icon sidebar-status"
                aria-hidden="true"
                data-tone={status.tone}
                data-filled={status.filled || undefined}
                data-pulse={status.pulse || undefined}
              >
                <span />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="florets-navigation-title">{chat.Title || "Chat"}</span>
                  <UnreadDot seen={seen} />
                </span>
                <span className="florets-navigation-meta flex! flex-wrap items-center gap-x-2">
                  {projectName !== undefined && (
                    <span className="max-w-28 truncate">{projectName}</span>
                  )}
                  {(chat.Status === "working" ||
                    chat.Status === "waiting" ||
                    chat.Status === "failed") && <span>{status.label}</span>}
                  {(chat.pulls?.items.length ?? 0) > 0 && (
                    <PullCount pulls={chat.pulls?.items ?? []} />
                  )}
                </span>
              </span>
              <time
                className="florets-navigation-age"
                dateTime={chat.UpdatedAt}
                title={new Date(chat.UpdatedAt).toLocaleString()}
              >
                {ageLabel(chat.UpdatedAt, now)}
              </time>
            </a>
          }
        />
        <HoverCardContent
          side="right"
          align="start"
          density="compact"
          className="sidebar-chat-preview chat-summary-card"
        >
          <ChatSummary chat={chat} title={chat.Title || "Chat"} pulls={chat.pulls} now={now} />
        </HoverCardContent>
      </HoverCard>
      <div className="florets-navigation-actions">
        <ChatOrganizationActions chat={chat} />
      </div>
    </li>
  );
}

export function SidebarChats({
  projects,
  chats,
  path,
  close,
  searching,
  setSearching,
}: {
  projects: Project[];
  chats: Chat[] | undefined;
  path: string;
  close: () => void;
  searching: boolean;
  setSearching: (value: boolean) => void;
}) {
  const folderTrigger = useRef<HTMLButtonElement>(null);
  const focusSearch = useCallback((node: HTMLInputElement | null) => {
    node?.focus();
  }, []);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [sort, setSort] = useState<"updated" | "title">("updated");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 60_000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  const { folders, error: folderError, openFolder } = useFolders();
  const filter = query.trim().toLowerCase();
  const folderGroups = (folders ?? [])
    .map((folder) => ({
      project: { id: `folder:${folder.id}`, name: folder.name },
      folder,
      rows: (chats ?? [])
        .filter(
          (chat) =>
            chat.Archived !== true &&
            (chat.PinnedAt ?? "") === "" &&
            chat.FolderID === folder.id &&
            (!filter ||
              `${chat.Title} ${chat.ID} ${folder.name} ${projects.find((p) => p.id === chat.ProjectID)?.name ?? ""}`
                .toLowerCase()
                .includes(filter)),
        )
        .toSorted((a, b) =>
          sort === "title"
            ? a.Title.localeCompare(b.Title)
            : b.UpdatedAt.localeCompare(a.UpdatedAt),
        ),
    }))
    .filter(({ rows }) => !filter || rows.length > 0);
  const projectGroups = projects
    .map((project) => ({
      project,
      rows: (chats ?? [])
        .filter(
          (chat) =>
            chat.Archived !== true &&
            (chat.PinnedAt ?? "") === "" &&
            chat.ProjectID === project.id &&
            ((chat.FolderID ?? "") === "" ||
              folders?.some((folder) => folder.id === chat.FolderID) !== true) &&
            (!filter || `${chat.Title} ${project.name} ${chat.ID}`.toLowerCase().includes(filter)),
        )
        .toSorted((a, b) =>
          sort === "title"
            ? a.Title.localeCompare(b.Title)
            : b.UpdatedAt.localeCompare(a.UpdatedAt),
        ),
    }))
    .filter(({ rows }) => !filter || rows.length > 0);
  const groups = [
    ...folderGroups,
    ...projectGroups.map((group) => ({ ...group, folder: undefined })),
  ];
  const pinned = pinnedChats(chats ?? []).filter(
    (chat) =>
      !filter ||
      `${chat.Title} ${chat.ID} ${folders?.find((f) => f.id === chat.FolderID)?.name ?? ""} ${projects.find((project) => project.id === chat.ProjectID)?.name ?? ""}`
        .toLowerCase()
        .includes(filter),
  );
  const {
    mark: markRead,
    disabled: readDisabled,
    busy: readBusy,
  } = useMarkChatsRead(
    chats === undefined ? undefined : [...pinned, ...groups.flatMap(({ rows }) => rows)],
  );
  return (
    <section aria-label="Chats" className="sidebar-chats px-2 py-4">
      <div className="sidebar-section-heading flex min-h-8 items-center ps-2 pe-0 text-xs text-subtle-foreground">
        {searching ? (
          <div className="sidebar-search flex min-w-0 flex-1 items-center gap-1.5">
            <SearchIcon />
            <input
              aria-label="Search chats"
              placeholder="Search chats"
              value={query}
              ref={focusSearch}
              onChange={(e) => {
                setQuery(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setQuery("");
                  setSearching(false);
                }
              }}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close chat search"
              onClick={() => {
                setQuery("");
                setSearching(false);
              }}
            >
              <XIcon />
            </Button>
          </div>
        ) : (
          <>
            <span className="flex-1">Chats</span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Search chats"
              onClick={() => {
                setSearching(true);
              }}
            >
              <SearchIcon />
            </Button>
          </>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                ref={folderTrigger}
                variant="ghost"
                size="icon-sm"
                aria-label="Chat list options"
              >
                <EllipsisIcon />
              </Button>
            }
          />
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem
              onClick={() => {
                openFolder({ finalFocus: folderTrigger });
              }}
            >
              <FolderIcon />
              New folder
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                setSort(sort === "updated" ? "title" : "updated");
              }}
            >
              <ListIcon />
              Sort: {sort === "updated" ? "Updated" : "Title"}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                setCollapsed(
                  collapsed.length === groups.length ? [] : groups.map((group) => group.project.id),
                );
              }}
            >
              <InboxIcon />
              {collapsed.length === groups.length ? "Expand" : "Collapse"} all groups
            </DropdownMenuItem>
            <DropdownMenuItem disabled>
              <Settings2Icon />
              Display and filters
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={readDisabled} aria-busy={readBusy} onClick={markRead}>
              <CheckIcon />
              Mark all as read
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {folderError && (
        <p role="status" className="px-4 py-1.5 text-xs text-destructive">
          {folderError}
        </p>
      )}
      {chats === undefined && (
        <p className="sidebar-empty px-4 py-1.5 text-xs text-muted-foreground" role="status">
          Loading chats…
        </p>
      )}
      {pinned.length > 0 && (
        <section aria-label="Pinned" className="florets-navigation-group">
          <div className="florets-navigation-group-heading">
            <span className="flex min-w-0 items-center gap-[9px]">
              <PinIcon className="size-3.5 shrink-0" />
              <span className="truncate">Pinned</span>
              <span className="florets-navigation-count">{pinned.length}</span>
            </span>
          </div>
          <ul>
            {pinned.map((chat) => (
              <ChatRow
                key={chat.ID}
                chat={chat}
                seen={isChatSeen(chat)}
                path={path}
                close={close}
                now={now}
              />
            ))}
          </ul>
        </section>
      )}
      {groups.map(({ project, rows, folder }) => {
        const expanded = !!filter || !collapsed.includes(project.id);
        return (
          <section
            key={project.id}
            aria-label={project.name}
            className="florets-navigation-group"
            data-expanded={expanded}
          >
            <div
              className={`florets-navigation-group-heading${folder ? " sidebar-folder-heading" : ""}`}
            >
              {folder ? (
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    className="flex min-h-7 w-full min-w-0 cursor-pointer items-center gap-[9px] text-left hover:text-foreground"
                    aria-label={`${expanded ? "Collapse" : "Expand"} folder ${folder.name}`}
                    aria-expanded={expanded}
                    onClick={() => {
                      setCollapsed((ids) =>
                        ids.includes(project.id)
                          ? ids.filter((id) => id !== project.id)
                          : [...ids, project.id],
                      );
                    }}
                  >
                    <FolderIcon className="size-3.5 shrink-0" />
                    <span className="min-w-0 truncate">{folder.name}</span>
                    <span className="florets-navigation-count">{rows.length}</span>
                    <ChevronRightIcon
                      className={expanded ? "size-2.5 shrink-0 rotate-90" : "size-2.5 shrink-0"}
                    />
                  </button>
                </div>
              ) : (
                <a href={`#projects/${project.id}`} onClick={close}>
                  <InboxIcon />
                  <span className="truncate">{project.name}</span>
                  <span className="florets-navigation-count">{rows.length}</span>
                </a>
              )}
              {folder ? (
                <span className="sidebar-folder-actions">
                  <FolderActions folder={folder} />
                </span>
              ) : (
                <button
                  type="button"
                  aria-label={`${expanded ? "Collapse" : "Expand"} ${project.name}`}
                  aria-expanded={expanded}
                  onClick={() => {
                    setCollapsed((ids) =>
                      ids.includes(project.id)
                        ? ids.filter((id) => id !== project.id)
                        : [...ids, project.id],
                    );
                  }}
                >
                  <ChevronRightIcon className={expanded ? "rotate-90" : ""} />
                </button>
              )}
            </div>
            {expanded && (
              <ul>
                {rows.map((chat) => (
                  <ChatRow
                    key={chat.ID}
                    chat={chat}
                    projectName={
                      folder ? projects.find((p) => p.id === chat.ProjectID)?.name : undefined
                    }
                    seen={isChatSeen(chat)}
                    path={path}
                    close={close}
                    now={now}
                  />
                ))}
                {chats !== undefined && rows.length === 0 && (
                  <li>
                    {folder ? (
                      <p className="sidebar-empty px-4 py-1.5 text-xs text-muted-foreground">
                        {chats.some(
                          (chat) =>
                            chat.FolderID === folder.id &&
                            chat.Archived !== true &&
                            (chat.PinnedAt ?? "") !== "",
                        )
                          ? "Chats in this folder are pinned"
                          : "No current chats in this folder"}
                      </p>
                    ) : (
                      <a
                        className="sidebar-empty block px-4 py-1.5 text-xs text-muted-foreground"
                        href={`#chats/new?project=${encodeURIComponent(project.id)}`}
                        onClick={close}
                      >
                        Start a chat
                      </a>
                    )}
                  </li>
                )}
              </ul>
            )}
          </section>
        );
      })}
      {filter && groups.length === 0 && pinned.length === 0 && (
        <p className="sidebar-empty px-4 py-1.5 text-xs text-muted-foreground" role="status">
          No chats found.
        </p>
      )}
    </section>
  );
}
