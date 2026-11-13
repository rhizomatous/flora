import { useCallback, useEffect, useState } from "react";

import {
  Button,
  InboxIcon,
  ChevronRightIcon,
  SearchIcon,
  XIcon,
  EllipsisIcon,
  PinIcon,
  ArchiveIcon,
  FolderIcon,
  ListIcon,
  Settings2Icon,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
} from "@flora/florets";

import type { Chat } from "./notifications";
import { PullCount, PullList } from "./pull-links";
import { sidebarStatus, useSeenSidebarChats } from "./sidebar-status";

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
}: {
  chat: Chat;
  path: string;
  close: () => void;
  now: number;
  seen: boolean;
}) {
  const status = sidebarStatus(chat, seen);
  return (
    <li className="florets-navigation-row" data-active={path === `chats/${chat.ID}` || undefined}>
      <HoverCard>
        <HoverCardTrigger
          delay={500}
          render={
            <a
              href={`#chats/${chat.ID}`}
              aria-current={path === `chats/${chat.ID}` ? "page" : undefined}
              className="florets-navigation-link"
              onClick={close}
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
                <span className="florets-navigation-title">{chat.Title || "Chat"}</span>
                <span className="florets-navigation-meta flex! flex-wrap items-center gap-x-2">
                  <span>{status.label}</span>
                  <PullCount pulls={chat.pulls?.items ?? []} />
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
          className="sidebar-chat-preview florets-menu-surface w-[420px]! max-w-[calc(100vw-32px)]! wrap-anywhere"
        >
          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span className="truncate">{chat.ID}</span>
          </div>
          <p className="mt-2">{chat.Title || "Chat"}</p>
          {((chat.pulls?.items?.length ?? 0) > 0 || (chat.pulls?.error ?? "") !== "") && (
            <div className="mt-3 border-t border-border pt-2">
              <p className="mb-1 text-xs text-muted-foreground">Pull requests</p>
              <PullList summary={chat.pulls} />
            </div>
          )}
        </HoverCardContent>
      </HoverCard>
      <div className="florets-navigation-actions">
        <Button
          variant="ghost"
          size="icon-sm"
          disabled
          aria-label={`Pin ${chat.Title} (coming soon)`}
        >
          <PinIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled
          aria-label={`Archive ${chat.Title} (coming soon)`}
        >
          <ArchiveIcon />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${chat.Title}`}>
                <EllipsisIcon />
              </Button>
            }
          />
          <DropdownMenuContent align="start" side="right" className="w-48">
            <DropdownMenuItem disabled>
              <PinIcon />
              Pin
            </DropdownMenuItem>
            <DropdownMenuItem disabled>
              <FolderIcon />
              Move to folder
            </DropdownMenuItem>
            <DropdownMenuItem disabled>
              <ArchiveIcon />
              Archive
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              nativeButton={false}
              render={
                <a href={`#chats/${chat.ID}`} onClick={close}>
                  Open chat
                </a>
              }
            />
          </DropdownMenuContent>
        </DropdownMenu>
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
  const isSeen = useSeenSidebarChats(chats, path);
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
  const filter = query.trim().toLowerCase();
  const groups = projects
    .map((project) => ({
      project,
      rows: (chats ?? [])
        .filter(
          (chat) =>
            chat.ProjectID === project.id &&
            (!filter || `${chat.Title} ${project.name} ${chat.ID}`.toLowerCase().includes(filter)),
        )
        .toSorted((a, b) =>
          sort === "title"
            ? a.Title.localeCompare(b.Title)
            : b.UpdatedAt.localeCompare(a.UpdatedAt),
        ),
    }))
    .filter(({ rows }) => !filter || rows.length > 0);
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
              <Button variant="ghost" size="icon-sm" aria-label="Chat list options">
                <EllipsisIcon />
              </Button>
            }
          />
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem disabled>
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
                setCollapsed(collapsed.length === projects.length ? [] : projects.map((p) => p.id));
              }}
            >
              <InboxIcon />
              {collapsed.length === projects.length ? "Expand" : "Collapse"} all projects
            </DropdownMenuItem>
            <DropdownMenuItem disabled>
              <Settings2Icon />
              Display and filters
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled>Mark all as read</DropdownMenuItem>
            <DropdownMenuItem
              nativeButton={false}
              render={
                <a href="#chats" onClick={close}>
                  <ListIcon />
                  View all chats
                </a>
              }
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {chats === undefined && (
        <p className="sidebar-empty px-4 py-1.5 text-xs text-muted-foreground" role="status">
          Loading chats…
        </p>
      )}
      {groups.map(({ project, rows }) => {
        const expanded = !!filter || !collapsed.includes(project.id);
        return (
          <section
            key={project.id}
            aria-label={project.name}
            className="florets-navigation-group"
            data-expanded={expanded}
          >
            <div className="florets-navigation-group-heading">
              <a href={`#projects/${project.id}`} onClick={close}>
                <InboxIcon />
                <span className="truncate">{project.name}</span>
                <span className="florets-navigation-count">{rows.length}</span>
              </a>
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
            </div>
            {expanded && (
              <ul>
                {rows.map((chat) => (
                  <ChatRow
                    key={chat.ID}
                    chat={chat}
                    seen={isSeen(chat)}
                    path={path}
                    close={close}
                    now={now}
                  />
                ))}
                {chats !== undefined && rows.length === 0 && (
                  <li>
                    <a
                      className="sidebar-empty block px-4 py-1.5 text-xs text-muted-foreground"
                      href={`#chats/new?project=${encodeURIComponent(project.id)}`}
                      onClick={close}
                    >
                      Start a chat
                    </a>
                  </li>
                )}
              </ul>
            )}
          </section>
        );
      })}
      {filter && groups.length === 0 && (
        <p className="sidebar-empty px-4 py-1.5 text-xs text-muted-foreground" role="status">
          No chats found.
        </p>
      )}
    </section>
  );
}
