import { useCallback, useEffect, useState } from "react";

import {
  Button,
  CloudIcon,
  FlowerMark,
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
}: {
  chat: Chat;
  path: string;
  close: () => void;
  now: number;
}) {
  const status = chat.Status.charAt(0).toUpperCase() + chat.Status.slice(1);
  return (
    <li className="sidebar-chat-row" data-active={path === `chats/${chat.ID}` || undefined}>
      <HoverCard>
        <HoverCardTrigger
          delay={500}
          render={
            <a
              href={`#chats/${chat.ID}`}
              aria-current={path === `chats/${chat.ID}` ? "page" : undefined}
              className="sidebar-chat-link"
              onClick={close}
            >
              {chat.Status === "working" ? (
                <FlowerMark className="sidebar-chat-icon motion-safe:animate-pulse" />
              ) : (
                <CloudIcon className="sidebar-chat-icon" />
              )}
              <span className="min-w-0 flex-1">
                <span className="sidebar-chat-title">{chat.Title || "Chat"}</span>
                <span className="sidebar-chat-meta">{status}</span>
              </span>
              <time
                className="sidebar-chat-age"
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
          className="sidebar-chat-preview cn-menu-surface"
        >
          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span className="truncate">{chat.ID}</span>
            <span>{status}</span>
          </div>
          <p className="mt-2">{chat.Title || "Chat"}</p>
          <p className="mt-3 text-xs text-muted-foreground">
            Updated {new Date(chat.UpdatedAt).toLocaleString()}
          </p>
        </HoverCardContent>
      </HoverCard>
      <div className="sidebar-chat-actions">
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
    <section aria-label="Chats" className="sidebar-chats">
      <div className="sidebar-section-heading">
        {searching ? (
          <div className="sidebar-search">
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
        <p className="sidebar-empty" role="status">
          Loading chats…
        </p>
      )}
      {groups.map(({ project, rows }) => {
        const expanded = !!filter || !collapsed.includes(project.id);
        return (
          <section key={project.id} aria-label={project.name} className="sidebar-project">
            <div className="sidebar-project-heading">
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
              <a href={`#projects/${project.id}`} onClick={close}>
                <InboxIcon />
                <span className="truncate">{project.name}</span>
                <span className="sidebar-project-count">{rows.length}</span>
              </a>
            </div>
            {expanded && (
              <ul>
                {rows.map((chat) => (
                  <ChatRow key={chat.ID} chat={chat} path={path} close={close} now={now} />
                ))}
                {chats !== undefined && rows.length === 0 && (
                  <li>
                    <a
                      className="sidebar-empty block"
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
        <p className="sidebar-empty" role="status">
          No chats found.
        </p>
      )}
    </section>
  );
}
