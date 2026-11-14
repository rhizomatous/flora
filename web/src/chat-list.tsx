import { useEffect, useRef, useState } from "react";

import {
  Button,
  ButtonLink,
  ChevronDownIcon,
  Heading,
  Input,
  PlusIcon,
  SearchIcon,
  XIcon,
} from "@flora/florets";

import type { Chat } from "./chat-schemas";
import type { ProjectSummary } from "./project-schemas";
import { PullCount } from "./pull-links";
import { sidebarStatus, useSeenSidebarChats } from "./sidebar-status";

const filters = [
  { id: "all", label: "All chats" },
  { id: "working", label: "Working" },
  { id: "waiting", label: "Needs you" },
  { id: "idle", label: "Idle" },
  { id: "failed", label: "Failed" },
  { id: "stopped", label: "Stopped" },
] as const;
type Filter = (typeof filters)[number]["id"];

function ageLabel(updated: string, now: number) {
  const age = Math.max(0, now - Date.parse(updated));
  if (!Number.isFinite(age)) return "";
  if (age < 60_000) return "now";
  if (age < 3_600_000) return `${Math.floor(age / 60_000)}m`;
  if (age < 86_400_000) return `${Math.floor(age / 3_600_000)}h`;
  if (age < 604_800_000) return `${Math.floor(age / 86_400_000)}d`;
  return new Date(updated).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(new Date(updated).getFullYear() === new Date(now).getFullYear() ? {} : { year: "numeric" }),
  });
}

export function ChatList({
  list,
  projects,
  error,
}: {
  list: Chat[] | undefined;
  projects: ProjectSummary[] | undefined;
  error: string;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [project, setProject] = useState("");
  const [searching, setSearching] = useState(false);
  const [now, setNow] = useState(Date.now);
  const heading = useRef<HTMLHeadingElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const isSeen = useSeenSidebarChats(list, "chats");
  useEffect(() => {
    heading.current?.focus();
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 60_000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (searching) search.current?.focus();
  }, [searching]);
  const rows = list ?? [];
  const projectNames = new Map(projects?.map((item) => [item.id, item.name]));
  const groups = [...new Set(rows.map((chat) => chat.ProjectID))].map((id) => ({
    id,
    name: projectNames.get(id) ?? "Project",
  }));
  const visible = rows
    .filter(
      (chat) =>
        (filter === "all" || chat.Status === filter) &&
        (project === "" || chat.ProjectID === project) &&
        `${chat.Title} ${chat.ID} ${projectNames.get(chat.ProjectID) ?? ""}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
    )
    .toSorted((a, b) => Date.parse(b.UpdatedAt) - Date.parse(a.UpdatedAt));
  function closeSearch() {
    setQuery("");
    setSearching(false);
    searchButton.current?.focus();
  }
  return (
    <section aria-labelledby="chats-heading" className="flex min-h-0 flex-1 flex-col">
      <header className="florets-topbar flex shrink-0 items-center gap-2 border-b px-3">
        <span className="sidebar-toggle-space" aria-hidden="true" />
        <Heading
          level={1}
          id="chats-heading"
          ref={heading}
          tabIndex={-1}
          className="min-w-0 flex-1 text-base"
        >
          Chats
        </Heading>
        <Button
          variant="ghost"
          size="icon-sm"
          ref={searchButton}
          aria-label="Search chats"
          aria-expanded={searching}
          onClick={() => {
            if (searching) closeSearch();
            else setSearching(true);
          }}
        >
          <SearchIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          nativeButton={false}
          render={<a href="#chats/new" aria-label="New chat" />}
          aria-label="New chat"
        >
          <PlusIcon />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div role="group" aria-label="Chat state" className="flex flex-wrap gap-1.5">
            {filters.map(({ id, label }) => (
              <Button
                key={id}
                size="sm"
                variant={filter === id ? "secondary" : "outline"}
                aria-pressed={filter === id}
                onClick={() => {
                  setFilter(id);
                }}
              >
                {label}
                <span className="text-xs text-muted-foreground">
                  {rows.filter((chat) => id === "all" || chat.Status === id).length}
                </span>
              </Button>
            ))}
          </div>
          <select
            aria-label="Project"
            value={project}
            onChange={(event) => {
              setProject(event.target.value);
            }}
            className="h-8 max-w-full rounded-md border border-border bg-background px-2 text-xs focus-visible:outline-2 focus-visible:outline-ring"
          >
            <option value="">All projects</option>
            {groups.map(({ id, name }) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>
        {searching && (
          <div className="mb-4 flex items-center gap-2">
            <Input
              ref={search}
              aria-label="Search chats"
              placeholder="Search chats or projects"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") closeSearch();
              }}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close chat search"
              onClick={closeSearch}
            >
              <XIcon />
            </Button>
          </div>
        )}
        {error !== "" && (
          <p role="alert" className="mb-4 text-sm text-destructive">
            {error}
          </p>
        )}
        {list === undefined && (
          <p role="status" className="py-12 text-center text-sm text-muted-foreground">
            {error ? "Chats unavailable. Reconnecting…" : "Loading chats…"}
          </p>
        )}
        {list !== undefined && visible.length === 0 && (
          <div role="status" className="py-12 text-center text-sm text-muted-foreground">
            <p>{rows.length === 0 ? "No chats yet." : "No chats match these filters."}</p>
            {rows.length === 0 ? (
              <ButtonLink href="#chats/new" className="mt-2">
                Start a chat
              </ButtonLink>
            ) : (
              <Button
                variant="link"
                className="mt-2"
                onClick={() => {
                  setFilter("all");
                  setProject("");
                  setQuery("");
                }}
              >
                Show all chats
              </Button>
            )}
          </div>
        )}
        <div className="space-y-4">
          {groups.map(({ id, name }) => {
            const chats = visible.filter((chat) => chat.ProjectID === id);
            if (chats.length === 0) return null;
            return (
              <details key={id} open className="group">
                <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg bg-muted/60 px-3 py-2.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
                  <ChevronDownIcon
                    className="size-3.5 text-muted-foreground group-not-open:-rotate-90"
                    aria-hidden="true"
                  />
                  <span className="min-w-0 truncate">{name}</span>
                  <span className="text-muted-foreground">{chats.length}</span>
                </summary>
                <ul aria-label={`${name} chats`} className="mt-1">
                  {chats.map((chat) => {
                    const status = sidebarStatus(chat, isSeen(chat));
                    const label = chat.Status === "idle" ? "Idle" : status.label;
                    return (
                      <li key={chat.ID}>
                        <a
                          href={`#chats/${chat.ID}`}
                          className="flex min-w-0 items-center gap-3 rounded-lg px-3 py-3 hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring sm:px-4"
                          aria-label={`Open chat: ${chat.Title || chat.ID}`}
                        >
                          <span
                            className="sidebar-status flex size-4 shrink-0 items-center justify-center"
                            data-tone={status.tone}
                            data-filled={status.filled || undefined}
                            data-pulse={status.pulse || undefined}
                            aria-hidden="true"
                          >
                            <span />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">
                              {chat.Title || "Untitled chat"}
                            </span>
                            <span
                              className="mt-0.5 block truncate text-xs text-muted-foreground"
                              title={chat.StatusReason}
                            >
                              {label}
                              {(chat.Status === "failed" || chat.Status === "waiting") &&
                              chat.StatusReason
                                ? ` · ${chat.StatusReason}`
                                : ""}
                            </span>
                          </span>
                          <span className="hidden shrink-0 sm:block">
                            <PullCount pulls={chat.pulls?.items ?? []} />
                          </span>
                          <time
                            dateTime={chat.UpdatedAt}
                            title={new Date(chat.UpdatedAt).toLocaleString()}
                            className="w-16 shrink-0 text-right text-xs text-muted-foreground tabular-nums"
                          >
                            {ageLabel(chat.UpdatedAt, now)}
                          </time>
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </details>
            );
          })}
        </div>
      </div>
    </section>
  );
}
