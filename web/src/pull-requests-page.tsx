import { useState } from "react";

import { ListGroup, Button, MessageSquareIcon } from "@flora/florets";

import type { Chat } from "./chat-schemas";
import { ListPage, ListFilters, ListEmpty } from "./list-page";
import { pullStatus } from "./pull";
import { PullLineCounts, PullStatusIcon } from "./pull-links";
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

function PullRow({ row }: { row: TrackedPull }) {
  const { pull, repository, chats } = row;
  return (
    <li className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg px-3 py-3 hover:bg-muted/40 sm:px-4">
      <a
        href={pull.url}
        target="_blank"
        rel="noreferrer"
        aria-label={`${repository} #${pull.number}: ${pull.title ?? "Pull request"}`}
        title={`${repository} #${pull.number}`}
        className="flex min-w-0 flex-[1_1_18rem] items-center gap-2.5 rounded-sm text-sm hover:underline focus-visible:outline-2 focus-visible:outline-ring"
      >
        <PullStatusIcon pull={pull} />
        <span className="shrink-0 text-muted-foreground">#{pull.number}</span>
        <span className="min-w-0">
          <span className="block truncate font-medium">{pull.title ?? "Pull request"}</span>
          <span className="block truncate text-xs text-muted-foreground">{repository}</span>
        </span>
      </a>
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2 sm:flex-none">
        {chats.map((chat) => (
          <a
            key={chat.ID}
            href={`#chats/${chat.ID}`}
            aria-label={`Open chat: ${chat.Title || chat.ID}`}
            title={chat.Title || chat.ID}
            className="inline-flex max-w-40 items-center gap-1.5 rounded-full border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <MessageSquareIcon className="size-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{chat.Title || chat.ID}</span>
          </a>
        ))}
        <PullLineCounts pull={pull} />
      </div>
    </li>
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
      `${row.pull.title ?? ""} ${row.repository} #${row.pull.number} ${row.chats.map((chat) => `${chat.Title} ${chat.ID}`).join(" ")}`
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
          <select
            aria-label="Repository"
            value={repository}
            onChange={(event) => {
              setRepository(event.target.value);
            }}
            className="h-8 max-w-full rounded-md border border-border bg-background px-2 text-xs focus-visible:outline-2 focus-visible:outline-ring"
          >
            <option value="">All repositories</option>
            {repositories.map((repo) => (
              <option key={repo} value={repo}>
                {repo}
              </option>
            ))}
          </select>
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
                <a className="underline" href={`#chats/${chat.ID}`}>
                  {chat.Title || chat.ID}
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
        <div className="space-y-4">
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
