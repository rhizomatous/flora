import { useState } from "react";

import {
  Popover,
  PopoverTrigger,
  PopoverContent,
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
  MessageSquareIcon,
} from "@flora/florets";

import type { Chat } from "./chat-schemas";
import { ListPage, ListFilters, ListEmpty } from "./list-page";
import { pullStatus } from "./pull";
import { PullLineCounts, PullStatusIcon } from "./pull-links";
import { openPull, usePullNavigation } from "./pull-navigation";
import { collectPullRequests, type TrackedPull } from "./pull-requests";

const filters = [
  { id: "open", label: "Ready for review" },
  { id: "draft", label: "Draft" },
  { id: "merged", label: "Merged" },
  { id: "closed", label: "Closed" },
  { id: "all", label: "All" },
] as const;
type Filter = (typeof filters)[number]["id"];
const groups = [
  { id: "open", label: "Ready for review" },
  { id: "draft", label: "Draft" },
  { id: "merged", label: "Merged" },
  { id: "closed", label: "Closed" },
  { id: "unknown", label: "Unknown status" },
] as const;

function matchesFilter(row: TrackedPull, filter: Filter) {
  if (filter === "all") return true;
  return pullStatus(row.pull) === filter;
}

function ChatLink({ chat, expanded = false }: { chat: Chat; expanded?: boolean }) {
  const link = (
    <a
      href={`#chats/${chat.PublicID}`}
      aria-label={`Open chat: ${chat.Title || chat.PublicID}`}
      className={`inline-flex min-h-7 min-w-0 items-center gap-1.5 rounded-sm text-xs text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring ${expanded ? "w-full" : "max-w-32"}`}
    >
      <MessageSquareIcon className="size-3 shrink-0" aria-hidden="true" />
      <span className={expanded ? "break-words" : "truncate"}>
        {chat.PublicID} · {chat.Title || "Untitled chat"}
      </span>
    </a>
  );
  return expanded ? (
    link
  ) : (
    <Tooltip>
      <TooltipTrigger render={link} />
      <TooltipContent>{chat.Title || chat.PublicID}</TooltipContent>
    </Tooltip>
  );
}

function PullRow({ row }: { row: TrackedPull }) {
  const { pull, repository, chats } = row;
  const [first, ...remaining] = chats;
  const navigation = usePullNavigation(first);
  return (
    <Item size="list" render={<li />} className="flex-wrap sm:flex-nowrap">
      <Tooltip>
        <TooltipTrigger
          render={
            <a
              href={pull.url}
              onClick={(event) => {
                openPull(event, pull, navigation);
              }}
              target="_blank"
              rel="noreferrer"
              aria-label={`${repository} #${pull.number}: ${pull.title ?? "Pull request"}`}
              className="flex min-w-0 flex-[1_1_16rem] items-center gap-2.5 rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
            />
          }
        >
          <PullStatusIcon pull={pull} />
          <span className="shrink-0 text-sm text-muted-foreground">#{pull.number}</span>
          <ItemContent>
            <ItemTitle>{pull.title ?? "Pull request"}</ItemTitle>
            <span className="hidden max-w-40 truncate text-xs text-muted-foreground sm:block sm:w-32">
              {repository}
            </span>
          </ItemContent>
        </TooltipTrigger>
        <TooltipContent>
          {repository} #{pull.number}: {pull.title ?? "Pull request"}
        </TooltipContent>
      </Tooltip>
      <ItemActions className="ml-auto w-full min-w-0 shrink-0 gap-3 sm:w-auto">
        <span
          className="w-24 shrink-0 truncate text-xs text-muted-foreground sm:hidden"
          title={repository}
        >
          {repository}
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:w-40 sm:flex-none">
          {first && <ChatLink chat={first} />}
          {remaining.length > 0 && (
            <Popover>
              <PopoverTrigger
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 shrink-0 px-1.5"
                    aria-label={`${remaining.length} more linked ${remaining.length === 1 ? "chat" : "chats"}`}
                  />
                }
              >
                +{remaining.length}
              </PopoverTrigger>
              <PopoverContent className="w-72" aria-label="More linked chats">
                <ul className="space-y-2">
                  {remaining.map((chat) => (
                    <li key={chat.ID}>
                      <ChatLink chat={chat} expanded />
                    </li>
                  ))}
                </ul>
              </PopoverContent>
            </Popover>
          )}
        </div>
        <span className="flex w-20 justify-end">
          <PullLineCounts pull={pull} />
        </span>
      </ItemActions>
    </Item>
  );
}

export function PullRequests({
  chats,
  disconnected,
}: {
  chats: Chat[] | undefined;
  disconnected: boolean;
}) {
  const [filter, setFilter] = useState<Filter>("open");
  const [query, setQuery] = useState("");
  const [repository, setRepository] = useState("");
  const rows = collectPullRequests(chats ?? []);
  const repositories = [...new Set(rows.map((row) => row.repository))].toSorted();
  const searchText = query.trim().toLowerCase();
  const visible = rows.filter(
    (row) =>
      matchesFilter(row, filter) &&
      (repository === "" || row.repository === repository) &&
      `${row.pull.title ?? ""} ${row.repository} #${row.pull.number} ${row.chats.map((chat) => `${chat.Title} ${chat.PublicID}`).join(" ")}`
        .toLowerCase()
        .includes(searchText),
  );
  const unavailable = (chats ?? []).filter((chat) => (chat.pulls?.error ?? "") !== "");
  return (
    <ListPage
      title="Pull requests"
      searchLabel="Search pull requests"
      searchPlaceholder="Search titles, repositories, PR numbers, or chats"
      closeSearchLabel="Close pull request search"
      query={query}
      onQueryChange={setQuery}
      filters={
        <ListFilters
          label="Pull request state"
          options={filters.map((option) => ({
            ...option,
            count: rows.filter((row) => matchesFilter(row, option.id)).length,
          }))}
          value={filter}
          onChange={setFilter}
        >
          <NativeSelect
            size="sm"
            aria-label="Repository"
            value={repository}
            onChange={(event) => {
              setRepository(event.target.value);
            }}
            className="max-w-full"
          >
            <option value="">All repositories</option>
            {repositories.map((repo) => (
              <option key={repo} value={repo}>
                {repo}
              </option>
            ))}
          </NativeSelect>
        </ListFilters>
      }
    >
      {unavailable.length > 0 && (
        <details className="mb-4 rounded-md border border-border p-3 text-xs text-muted-foreground">
          <summary className="cursor-pointer">
            PR updates unavailable for {unavailable.length}{" "}
            {unavailable.length === 1 ? "chat" : "chats"}. Saved statuses may be out of date.
          </summary>
          <ul className="mt-2 space-y-1">
            {unavailable.map((chat) => (
              <li key={chat.ID}>
                <a className="underline" href={`#chats/${chat.PublicID}`}>
                  {chat.Title || chat.PublicID}
                </a>
                : {chat.pulls?.error}
              </li>
            ))}
          </ul>
        </details>
      )}
      {chats === undefined && (
        <p role="status" className="py-12 text-center text-sm text-muted-foreground">
          {disconnected ? "Pull requests unavailable. Reconnecting…" : "Loading pull requests…"}
        </p>
      )}
      {chats !== undefined && visible.length === 0 && (
        <ListEmpty>
          <p>
            {rows.length === 0
              ? "No linked pull requests yet."
              : "No pull requests match these filters."}
          </p>
          {rows.length === 0 ? (
            <a href="#chats/new" className="mt-3 inline-block underline">
              Start a chat
            </a>
          ) : (
            <Button
              variant="link"
              className="mt-2"
              onClick={() => {
                setFilter("all");
                setQuery("");
                setRepository("");
              }}
            >
              Show all pull requests
            </Button>
          )}
        </ListEmpty>
      )}
      {chats !== undefined && visible.length > 0 && (
        <div className="space-y-2">
          {groups.map(({ id, label }) => {
            const items = visible.filter((row) => pullStatus(row.pull) === id);
            if (items.length === 0) return null;
            return (
              <ListGroup
                key={id}
                label={label}
                count={items.length}
                listLabel={`${label} pull requests`}
              >
                {items.map((row) => (
                  <PullRow key={row.pull.url} row={row} />
                ))}
              </ListGroup>
            );
          })}
        </div>
      )}
    </ListPage>
  );
}
