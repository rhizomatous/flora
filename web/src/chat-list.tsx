/* oxlint-disable import/max-dependencies -- Collection rows use shared read and organization controls. */
import { useEffect, useState } from "react";

import {
  NativeSelect,
  Item,
  ItemContent,
  ItemTitle,
  ItemActions,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  ListGroup,
  Button,
  ButtonLink,
  PlusIcon,
  PinIcon,
} from "@flora/florets";

import { pinnedChats } from "./chat-organization";
import { ChatOrganizationActions } from "./chat-organization-actions";
import type { Chat } from "./chat-schemas";
import { chatStatus, chatStatuses } from "./chat-status";
import { ListPage, ListFilters, ListEmpty } from "./list-page";
import { MarkChatsRead, UnreadDot } from "./mark-chats-read";
import type { ProjectSummary } from "./project-schemas";
import { PullCount } from "./pull-links";
import { isChatSeen } from "./sidebar-status";

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
  archived = false,
}: {
  list: Chat[] | undefined;
  projects: ProjectSummary[] | undefined;
  error: string;
  archived?: boolean;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [project, setProject] = useState("");
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 60_000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);
  const rows = (list ?? []).filter((chat) => (chat.Archived === true) === archived);
  const emptyMessage = archived ? "No archived chats." : "No chats yet.";
  const projectNames = new Map(projects?.map((item) => [item.id, item.name]));
  const groups = [
    { id: "pinned", name: "Pinned" },
    ...[...new Set(rows.map((chat) => chat.ProjectID))].map((id) => ({
      id,
      name: projectNames.get(id) ?? "Project",
    })),
  ];
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
      title={archived ? "Archived chats" : "Chats"}
      searchLabel="Search chats"
      searchPlaceholder="Search chats or projects"
      closeSearchLabel="Close chat search"
      query={query}
      onQueryChange={setQuery}
      actions={
        <>
          <MarkChatsRead chats={list === undefined ? undefined : visible} />
          <Button
            variant="ghost"
            size="icon-sm"
            nativeButton={false}
            render={<a href="#chats/new" aria-label="New chat" />}
            aria-label="New chat"
          >
            <PlusIcon />
          </Button>
        </>
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
          <NativeSelect
            size="sm"
            aria-label="Chat collection"
            value={archived ? "archived" : "current"}
            onChange={(event) => {
              window.location.hash =
                event.target.value === "archived" ? "chats?view=archived" : "chats";
            }}
          >
            <option value="current">Current chats</option>
            <option value="archived">Archived chats</option>
          </NativeSelect>
          <NativeSelect
            size="sm"
            aria-label="Project"
            value={project}
            onChange={(event) => {
              setProject(event.target.value);
            }}
            className="max-w-full"
          >
            <option value="">All projects</option>
            {groups.map(({ id, name }) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </NativeSelect>
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
          <p>{rows.length === 0 ? emptyMessage : "No chats match these filters."}</p>
          {rows.length === 0 && !archived ? (
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
                if (archived && rows.length === 0) window.location.hash = "chats";
              }}
            >
              {archived && rows.length === 0 ? "View current chats" : "Show all chats"}
            </Button>
          )}
        </ListEmpty>
      )}
      <div className="space-y-2">
        {groups.map(({ id, name }) => {
          const chats =
            id === "pinned"
              ? pinnedChats(visible)
              : visible.filter((chat) => chat.ProjectID === id && (chat.PinnedAt ?? "") === "");
          if (chats.length === 0) return null;
          return (
            <ListGroup key={id} label={name} count={chats.length} listLabel={`${name} chats`}>
              {chats.map((chat) => {
                const status = chatStatus(chat, isChatSeen(chat));
                return (
                  <li key={chat.ID} className="flex min-w-0 items-center gap-1">
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Item
                            size="list"
                            className="min-w-0 flex-1"
                            render={
                              <a
                                href={`#chats/${chat.ID}`}
                                aria-label={`Open chat: ${chat.Title || chat.ID}`}
                              />
                            }
                            aria-label={`Open chat: ${chat.Title || chat.ID}`}
                            aria-description={chat.StatusReason || status.label}
                          />
                        }
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
                        <ItemContent>
                          <ItemTitle className="group-data-[size=list]/item:flex">
                            {(chat.PinnedAt ?? "") !== "" && (
                              <PinIcon className="size-3 shrink-0 text-muted-foreground" />
                            )}
                            <span className="truncate">{chat.Title || "Untitled chat"}</span>
                            <UnreadDot seen={isChatSeen(chat)} />
                          </ItemTitle>
                          <span className="shrink-0 text-xs text-muted-foreground sm:w-20">
                            {status.label}
                          </span>
                        </ItemContent>
                        <ItemActions className="shrink-0 gap-3">
                          <span className="hidden w-16 sm:block">
                            <PullCount pulls={chat.pulls?.items ?? []} />
                          </span>
                          <time
                            dateTime={chat.UpdatedAt}
                            title={new Date(chat.UpdatedAt).toLocaleString()}
                            className="w-16 text-right text-xs text-muted-foreground tabular-nums"
                          >
                            {ageLabel(chat.UpdatedAt, now)}
                          </time>
                        </ItemActions>
                      </TooltipTrigger>
                      <TooltipContent>
                        <span className="min-w-0">
                          <span className="block">{chat.Title || "Untitled chat"}</span>
                          <span className="block">{chat.StatusReason || status.label}</span>
                        </span>
                      </TooltipContent>
                    </Tooltip>
                    <ItemActions className="shrink-0">
                      <ChatOrganizationActions chat={chat} />
                    </ItemActions>
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
