import { useState } from "react";

import {
  Button,
  Link,
  NativeSelect,
  ListGroup,
  Item,
  ItemContent,
  ItemTitle,
  ItemActions,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  ClockIcon,
  PlusIcon,
} from "@flora/florets";

import type { Automation } from "./automation-schemas";
import { ListPage, ListFilters, ListEmpty } from "./list-page";
import type { ProjectSummary } from "./project-schemas";

const filters = [
  { id: "all", label: "All automations" },
  { id: "active", label: "Active" },
  { id: "inactive", label: "Inactive" },
] as const;
const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function schedule(a: Automation) {
  let frequency = a.frequency === "weekdays" ? "Weekdays" : "Daily";
  if (a.frequency === "weekly") frequency = (a.days ?? []).map((day) => days[day]).join(", ");
  return `${frequency} at ${a.time}`;
}

export function AutomationList({
  list,
  projects,
  error,
}: {
  list: Automation[] | undefined;
  projects: ProjectSummary[];
  error: string;
}) {
  const [filter, setFilter] = useState<(typeof filters)[number]["id"]>("all");
  const [query, setQuery] = useState("");
  const [project, setProject] = useState("");
  const rows = list ?? [];
  const names = new Map(projects.map((p) => [p.id, p.name]));
  const visible = rows.filter(
    (a) =>
      (filter === "all" || a.enabled === (filter === "active")) &&
      (project === "" || a.projectID === project) &&
      `${a.name} ${a.description ?? ""} ${names.get(a.projectID) ?? ""}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  return (
    <ListPage
      title="Automations"
      searchLabel="Search automations"
      searchPlaceholder="Search automations or projects"
      closeSearchLabel="Close automation search"
      query={query}
      onQueryChange={setQuery}
      actions={
        <Button
          variant="ghost"
          size="icon-sm"
          nativeButton={false}
          render={<a href="#automations/new" aria-label="New automation" />}
          aria-label="New automation"
        >
          <PlusIcon />
        </Button>
      }
      filters={
        <ListFilters
          label="Automation state"
          options={filters.map((f) => ({
            ...f,
            count: rows.filter((a) => f.id === "all" || a.enabled === (f.id === "active")).length,
          }))}
          value={filter}
          onChange={setFilter}
        >
          <NativeSelect
            size="sm"
            aria-label="Project"
            className="max-w-full"
            value={project}
            onChange={(event) => {
              setProject(event.target.value);
            }}
          >
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
        </ListFilters>
      }
    >
      {error && (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {error}
        </p>
      )}
      {list === undefined && (
        <p role="status" className="py-12 text-center text-sm text-muted-foreground">
          {error ? "Automations unavailable." : "Loading automations…"}
        </p>
      )}
      {list !== undefined && visible.length === 0 && (
        <ListEmpty>
          <p>{rows.length === 0 ? "No automations yet." : "No automations match these filters."}</p>
          {rows.length > 0 ? (
            <Button
              variant="link"
              onClick={() => {
                setFilter("all");
                setProject("");
                setQuery("");
              }}
            >
              Show all automations
            </Button>
          ) : (
            projects.length === 0 && (
              <Link href="#projects/new">Create a project to get started</Link>
            )
          )}
        </ListEmpty>
      )}
      <div className="space-y-2">
        {[true, false].map((enabled) => {
          const group = visible.filter((a) => a.enabled === enabled);
          const label = enabled ? "Active" : "Inactive";
          if (group.length === 0) return null;
          return (
            <ListGroup
              key={label}
              label={label}
              count={group.length}
              listLabel={`${label} automations`}
            >
              {group.map((a) => (
                <Item key={a.id} size="list" render={<li />} className="flex-wrap sm:flex-nowrap">
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <a
                          href={`#automations/${a.id}`}
                          aria-label={`Open automation: ${a.name}`}
                          className="flex min-w-0 flex-[1_1_16rem] items-center gap-2.5 rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
                        />
                      }
                    >
                      <ClockIcon
                        className="size-4 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <ItemContent>
                        <ItemTitle>{a.name}</ItemTitle>
                        <span className="hidden w-32 max-w-40 shrink-0 truncate text-xs text-muted-foreground sm:block">
                          {names.get(a.projectID)}
                        </span>
                      </ItemContent>
                    </TooltipTrigger>
                    <TooltipContent>
                      <span>
                        <span className="block">{a.name}</span>
                        {(a.description ?? "") !== "" && (
                          <span className="block">{a.description}</span>
                        )}
                        <span className="block">
                          {schedule(a)} · {a.timeZone}
                        </span>
                      </span>
                    </TooltipContent>
                  </Tooltip>
                  <ItemActions className="ml-auto w-full min-w-0 shrink-0 gap-3 sm:w-auto">
                    <span
                      className="w-24 shrink-0 truncate text-xs text-muted-foreground sm:hidden"
                      title={names.get(a.projectID)}
                    >
                      {names.get(a.projectID)}
                    </span>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground sm:w-40 sm:flex-none" />
                        }
                      >
                        {schedule(a)}
                      </TooltipTrigger>
                      <TooltipContent>
                        {schedule(a)} · {a.timeZone}
                      </TooltipContent>
                    </Tooltip>
                    <span className="w-20 shrink-0 text-right text-xs text-muted-foreground">
                      {a.latestRun ? (
                        a.latestRun.chatID ? (
                          <a
                            className="capitalize hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                            aria-label={`Open latest run for ${a.name}: ${a.latestRun.status}`}
                            href={`#chats/${a.latestRun.chatID}?run=${encodeURIComponent(a.latestRun.messageID)}`}
                          >
                            {a.latestRun.status}
                          </a>
                        ) : (
                          <span className="capitalize">{a.latestRun.status}</span>
                        )
                      ) : (
                        "No runs"
                      )}
                    </span>
                  </ItemActions>
                </Item>
              ))}
            </ListGroup>
          );
        })}
      </div>
    </ListPage>
  );
}
