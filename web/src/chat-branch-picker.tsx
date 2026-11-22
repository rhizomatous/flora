import { useEffect, useState } from "react";
import { z } from "zod";

import {
  ChevronLeftIcon,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownButton,
  GitBranchIcon,
  DropdownMenu,
  DropdownMenuEmpty,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@flora/florets";

import { projectSchema, type Project, type Repository } from "./project-schemas";
import { errorMessage, request } from "./request";

const branchesSchema = z.object({ branches: z.array(z.string()), nextPage: z.number().int() });
const overridesSchema = z.record(z.string(), z.string());

/** Keeps each repository's starting branch with its project draft. */
export function ChatBranchPicker({
  projectID,
  disabled,
  onChange,
}: {
  projectID: string;
  disabled: boolean;
  onChange: () => void;
}) {
  const [project, setProject] = useState<Project>();
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [open, setOpen] = useState(false);
  const [repository, setRepository] = useState<string>();
  const [query, setQuery] = useState("");
  const [overrides, setOverrides] = useState<Record<string, string>>(() => {
    try {
      return overridesSchema.parse(
        JSON.parse(sessionStorage.getItem(`flora-branches:${projectID}`) ?? "{}"),
      );
    } catch {
      return {};
    }
  });

  useEffect(() => {
    const abort = new AbortController();
    async function load() {
      setError("");
      try {
        setProject(
          await request(projectSchema, `projects/${encodeURIComponent(projectID)}`, {
            signal: abort.signal,
          }),
        );
      } catch (e) {
        if (!abort.signal.aborted) {
          setError(errorMessage(e, "Could not load repositories. Try again."));
        }
      }
    }
    void load();
    return () => {
      abort.abort();
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Revision explicitly retries a failed request.
  }, [projectID, revision]);

  function change(name: string, branch?: string) {
    const next = Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== name));
    if (branch !== undefined) next[name] = branch;
    setOverrides(next);
    onChange();
    try {
      sessionStorage.setItem(`flora-branches:${projectID}`, JSON.stringify(next));
    } catch {
      /* Storage may be disabled. */
    }
    setOpen(false);
    setRepository(undefined);
  }

  const repos = project?.configuration.repositories ?? [];
  const active = repos.length === 1 ? repos[0] : repos.find((r) => r.name === repository);
  const count = Object.keys(overrides).length;
  const single = repos.length === 1 ? repos[0] : undefined;
  let label = "Defaults";
  if (single) label = overrides[single.name] ?? single.baseBranch;
  else if (count > 0) label = `${count} ${count === 1 ? "override" : "overrides"}`;

  return (
    <>
      <input type="hidden" name="branches" value={JSON.stringify(overrides)} />
      <DropdownMenu
        search={
          single === undefined
            ? {
                label: active ? "Search branches" : "Search repositories",
                query,
                onQueryChange: setQuery,
                filter: null,
                emptyText: null,
              }
            : false
        }
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) {
            setRepository(undefined);
            setQuery("");
          }
        }}
      >
        <DropdownMenuTrigger
          render={
            <DropdownButton
              type="button"
              variant="tertiary"
              size="compact"
              disabled={disabled}
              aria-label={`Base branches: ${label}`}
              className="max-w-[180px] min-w-0"
            >
              <GitBranchIcon />
              <span className="florets-control-label truncate">{label}</span>
            </DropdownButton>
          }
        />
        <DropdownMenuContent
          align="end"
          aria-label="Choose base branches"
          className="w-[340px]! max-w-[calc(100vw-24px)]!"
        >
          {active ? (
            <RepositoryBranches
              key={active.name}
              projectID={projectID}
              repository={active}
              single={single !== undefined}
              query={query}
              selected={overrides[active.name]}
              onChange={(branch) => {
                change(active.name, branch);
              }}
              onBack={
                repos.length > 1
                  ? () => {
                      setRepository(undefined);
                      setQuery("");
                    }
                  : undefined
              }
            />
          ) : (
            <DropdownMenuGroup label="Base branches">
              {error !== "" && (
                <>
                  <DropdownMenuItem
                    value="repositories-unavailable"
                    disabled

                    aria-description={error}
                  >
                    Repositories unavailable
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    value="retry-repositories"
                    closeOnClick={false}

                    onSelect={() => {
                      setRevision((v) => v + 1);
                    }}
                  >
                    Try again
                  </DropdownMenuItem>
                </>
              )}
              {error === "" &&
                project &&
                repos
                  .filter((repo) =>
                    repo.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
                  )
                  .map((repo) => (
                    <DropdownMenuItem
                      key={repo.name}
                      value={repo.name}
                      closeOnClick={false}
                      onSelect={() => {
                        setRepository(repo.name);
                        setQuery("");
                      }}
                    >
                      <GitBranchIcon className="text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{repo.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {overrides[repo.name] ?? repo.baseBranch}
                          {overrides[repo.name] === undefined ? " · Project default" : ""}
                        </span>
                      </span>
                    </DropdownMenuItem>
                  ))}
              {error === "" && project === undefined && (
                <DropdownMenuItem value="loading-repositories" disabled>
                  Loading repositories…
                </DropdownMenuItem>
              )}
              {error === "" && project && (
                <DropdownMenuEmpty>No matching repositories.</DropdownMenuEmpty>
              )}
            </DropdownMenuGroup>
          )}
          {count > 0 && single === undefined && (
            <DropdownMenuGroup>
              <DropdownMenuItem
                value="project-defaults"

                onSelect={() => {
                  setOverrides({});
                  onChange();
                  try {
                    sessionStorage.removeItem(`flora-branches:${projectID}`);
                  } catch {
                    /* Storage may be disabled. */
                  }
                }}
              >
                Use project defaults
              </DropdownMenuItem>
            </DropdownMenuGroup>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

function RepositoryBranches({
  single,
  query,
  projectID,
  repository,
  selected,
  onChange,
  onBack,
}: {
  single: boolean;
  query: string;
  projectID: string;
  repository: Repository;
  selected: string | undefined;
  onChange: (branch?: string) => void;
  onBack: (() => void) | undefined;
}) {
  const [branches, setBranches] = useState<string[]>([]);
  const [nextPage, setNextPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState(1);
  useEffect(() => {
    const abort = new AbortController();
    async function load() {
      setLoading(true);
      setError("");
      try {
        const result = await request(
          branchesSchema,
          `projects/${encodeURIComponent(projectID)}/branches?repository=${encodeURIComponent(repository.name)}&page=${page}`,
          { signal: abort.signal },
        );
        if (abort.signal.aborted) return;
        setBranches((previous) => [
          ...new Set([...(page === 1 ? [] : previous), ...result.branches]),
        ]);
        setNextPage(result.nextPage);
      } catch (e) {
        if (!abort.signal.aborted) setError(errorMessage(e, "Could not load branches. Try again."));
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => {
      abort.abort();
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Revision explicitly retries a failed request.
  }, [projectID, repository.name, page, revision]);
  const matches = (value: string) =>
    value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const visible = branches.filter(
    (branch) => (!single || branch !== repository.baseBranch) && matches(branch),
  );
  const defaultVisible = matches(`Project default ${repository.baseBranch}`);
  const savedVisible =
    selected !== undefined &&
    (!single || selected !== repository.baseBranch) &&
    !branches.includes(selected) &&
    matches(selected);
  return (
    <>
      {onBack && (
        <DropdownMenuItem
          value="all-repositories"
          closeOnClick={false}

          onSelect={onBack}
        >
          <ChevronLeftIcon />
          All repositories
        </DropdownMenuItem>
      )}
      <DropdownMenuGroup label={single ? undefined : repository.name}>
        {defaultVisible && (
          <DropdownMenuItem
            value={single ? repository.baseBranch : `Project default ${repository.baseBranch}`}
            data-checked={selected === undefined || (single && selected === repository.baseBranch)}
            onSelect={() => {
              onChange();
            }}
          >
            <GitBranchIcon />
            {single ? (
              <>
                <span className="min-w-0 flex-1 truncate">{repository.baseBranch}</span>
                <span className="text-muted-foreground">Default</span>
              </>
            ) : (
              <span className="min-w-0 flex-1 truncate">
                Project default{" "}
                <span className="text-muted-foreground">· {repository.baseBranch}</span>
              </span>
            )}
          </DropdownMenuItem>
        )}
      </DropdownMenuGroup>
      <DropdownMenuGroup label={single ? undefined : "Branches"}>
        {savedVisible && (
          <DropdownMenuItem
            value={selected}
            data-checked
            onSelect={() => {
              onChange(selected);
            }}
          >
            <GitBranchIcon />
            <span className="min-w-0 flex-1 truncate">{selected}</span>
          </DropdownMenuItem>
        )}
        {visible.map((branch) => (
          <DropdownMenuItem
            key={branch}
            value={branch}
            data-checked={selected === branch}
            onSelect={() => {
              onChange(branch);
            }}
          >
            <GitBranchIcon />
            <span className="min-w-0 flex-1 truncate">{branch}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuGroup>
      {!loading && !error && !defaultVisible && !savedVisible && visible.length === 0 && (
        <DropdownMenuItem value="no-branches" disabled>
          <span role="status">No matching branches.</span>
        </DropdownMenuItem>
      )}
      {(loading || error !== "" || nextPage > 0) && (
        <DropdownMenuGroup>
          {loading && (
            <DropdownMenuItem value="loading-branches" disabled>
              Loading branches…
            </DropdownMenuItem>
          )}
          {!loading && error !== "" && (
            <>
              <DropdownMenuItem
                value="branches-unavailable"
                disabled

                aria-description={error}
              >
                Branches unavailable
              </DropdownMenuItem>
              <DropdownMenuItem
                value="retry-branches"
                closeOnClick={false}

                onSelect={() => {
                  setRevision((v) => v + 1);
                }}
              >
                Try again
              </DropdownMenuItem>
            </>
          )}
          {!loading && error === "" && nextPage > 0 && (
            <DropdownMenuItem
              value="more-branches"
              closeOnClick={false}

              onSelect={() => {
                setPage(nextPage);
              }}
            >
              Load more branches
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
      )}
    </>
  );
}
