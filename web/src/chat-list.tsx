import { useEffect, useState } from "react";

import { ListGroup, Button, ButtonLink, PlusIcon } from "@flora/florets";

import type { Chat } from "./chat-schemas";
import { chatStatus, chatStatuses } from "./chat-status";
import { ListPage, ListFilters, ListEmpty } from "./list-page";
import type { ProjectSummary } from "./project-schemas";
import { PullCount } from "./pull-links";
import { useSeenSidebarChats } from "./sidebar-status";

const filters = [{ id: "all", label: "All chats" }, ...chatStatuses] as const;
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
  const [now, setNow] = useState(Date.now);
  const isSeen = useSeenSidebarChats(list, "chats");
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 60_000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);
  const rows = list ?? [];
  const projectNames = new Map(projects?.map((item) => [item.id, item.name]));
  const groups = [...new Set(rows.map((chat) => chat.ProjectID))].map((id) => ({
    id,
    name: projectNames.get(id) ?? "Project",
  }));
  const visible = rows
    .filter(
      (chat) =>
        (filter === "all" || chatStatus(chat).id === filter) &&
        (project === "" || chat.ProjectID === project) &&
        `${chat.Title} ${chat.ID} ${projectNames.get(chat.ProjectID) ?? ""}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
    )
    .toSorted((a, b) => Date.parse(b.UpdatedAt) - Date.parse(a.UpdatedAt));
  return (
    <ListPage
      title="Chats"
      searchLabel="Search chats"
      searchPlaceholder="Search chats or projects"
      closeSearchLabel="Close chat search"
      query={query}
      onQueryChange={setQuery}
      actions={
        <Button
          variant="ghost"
          size="icon-sm"
          nativeButton={false}
          render={<a href="#chats/new" aria-label="New chat" />}
          aria-label="New chat"
        >
          <PlusIcon />
        </Button>
      }
      filters={
        <ListFilters
          label="Chat state"
          options={filters.map((option) => ({
            ...option,
            count: rows.filter((chat) => option.id === "all" || chatStatus(chat).id === option.id)
              .length,
          }))}
          value={filter}
          onChange={setFilter}
        >
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
        </ListFilters>
      }
    >
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
        <ListEmpty>
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
        </ListEmpty>
      )}
      <div className="space-y-4">
        {groups.map(({ id, name }) => {
          const chats = visible.filter((chat) => chat.ProjectID === id);
          if (chats.length === 0) return null;
          return (
            <ListGroup key={id} label={name} count={chats.length} listLabel={`${name} chats`}>
              {chats.map((chat) => {
                const status = chatStatus(chat, isSeen(chat));
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
                          {status.label}
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
            </ListGroup>
          );
        })}
      </div>
    </ListPage>
  );
}
