import { useState } from "react";

import {
  Button,
  ButtonLink,
  Link,
  NativeSelect,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@flora/florets";

import type { Automation } from "./automation-schemas";
import { ListPage, ListFilters, ListEmpty } from "./list-page";
import type { ProjectSummary } from "./project-schemas";

const filters = [
  { id: "all", label: "All" },
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
        <ButtonLink href="#automations/new" className="h-8 px-3 text-sm">
          New automation
        </ButtonLink>
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
      {visible.length > 0 && (
        <Table aria-label="Automations" className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[65%] sm:w-auto">Name</TableHead>
              <TableHead className="hidden w-36 lg:table-cell">Project</TableHead>
              <TableHead className="hidden w-56 sm:table-cell">Schedule</TableHead>
              <TableHead className="w-[35%] sm:w-32">Last run</TableHead>
            </TableRow>
          </TableHeader>
          {[true, false].map((enabled) => {
            const group = visible.filter((a) => a.enabled === enabled);
            return (
              group.length > 0 && (
                <TableBody key={String(enabled)}>
                  <TableRow className="bg-muted/40">
                    <TableHead colSpan={4} scope="rowgroup" className="h-8 text-xs">
                      {enabled ? "Active" : "Inactive"}{" "}
                      <span className="ml-1 text-muted-foreground">{group.length}</span>
                    </TableHead>
                  </TableRow>
                  {group.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="py-3 whitespace-normal">
                        <Link
                          href={`#automations/${a.id}`}
                          className="block truncate font-medium no-underline"
                          title={a.name}
                        >
                          {a.name}
                        </Link>
                        {(a.description ?? "") !== "" && (
                          <p
                            className="truncate text-xs text-muted-foreground"
                            title={a.description}
                          >
                            {a.description}
                          </p>
                        )}
                        <p className="truncate text-xs text-muted-foreground lg:hidden">
                          {names.get(a.projectID)}
                        </p>
                        <p
                          className="truncate text-xs text-muted-foreground sm:hidden"
                          title={a.timeZone}
                        >
                          {schedule(a)} · {a.timeZone}
                        </p>
                      </TableCell>
                      <TableCell
                        className="hidden truncate text-muted-foreground lg:table-cell"
                        title={names.get(a.projectID)}
                      >
                        {names.get(a.projectID)}
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground sm:table-cell">
                        <div>{schedule(a)}</div>
                        <div className="truncate text-xs" title={a.timeZone}>
                          {a.timeZone}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        {a.latestRun ? (
                          a.latestRun.chatID ? (
                            <Link
                              className="capitalize no-underline"
                              aria-label={`Open latest run for ${a.name}: ${a.latestRun.status}`}
                              href={`#chats/${a.latestRun.chatID}?run=${encodeURIComponent(a.latestRun.messageID)}`}
                            >
                              {a.latestRun.status}
                            </Link>
                          ) : (
                            <span className="capitalize">{a.latestRun.status}</span>
                          )
                        ) : (
                          <span className="text-muted-foreground">No runs</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              )
            );
          })}
        </Table>
      )}
    </ListPage>
  );
}
