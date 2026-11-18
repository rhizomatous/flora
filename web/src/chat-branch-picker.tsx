import { useEffect, useState } from "react";
import { z } from "zod";

import {
  ChevronLeftIcon,
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  DropdownButton,
  GitBranchIcon,
  Popover,
  PopoverContent,
  PopoverTrigger,
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
      <Popover
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) setRepository(undefined);
        }}
      >
        <PopoverTrigger
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
        <PopoverContent
          align="end"
          aria-label="Choose base branches"
          className="w-[340px]! max-w-[calc(100vw-24px)] gap-0 overflow-hidden p-0!"
        >
          {active ? (
            <RepositoryBranches
              key={active.name}
              projectID={projectID}
              repository={active}
              selected={overrides[active.name]}
              onChange={(branch) => {
                change(active.name, branch);
              }}
              onBack={
                repos.length > 1
                  ? () => {
                      setRepository(undefined);
                    }
                  : undefined
              }
            />
          ) : (
            <div>
              <div className="border-b border-border px-3 py-2.5 text-sm font-medium">
                Base branches
              </div>
              {error !== "" && (
                <div className="space-y-2 p-3">
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setRevision((v) => v + 1);
                    }}
                  >
                    Try again
                  </Button>
                </div>
              )}
              {error === "" && project && (
                <div>
                  <Command>
                    <CommandInput
                      ref={focusSearch}
                      aria-label="Search repositories"
                      placeholder="Search repositories…"
                    />
                    <CommandList aria-label="Repositories">
                      <CommandEmpty>No matching repositories.</CommandEmpty>
                      <CommandGroup>
                        {repos.map((repo) => (
                          <CommandItem
                            key={repo.name}
                            value={repo.name}
                            onSelect={() => {
                              setRepository(repo.name);
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
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </div>
              )}
              {error === "" && project === undefined && (
                <p role="status" className="p-3 text-sm text-muted-foreground">
                  Loading repositories…
                </p>
              )}
            </div>
          )}
          {count > 0 && (
            <Button
              type="button"
              variant="tertiary"
              size="sm"
              className="w-full"
              onClick={() => {
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
            </Button>
          )}
        </PopoverContent>
      </Popover>
    </>
  );
}

function focusSearch(input: HTMLInputElement | null) {
  input?.focus();
}

function RepositoryBranches({
  projectID,
  repository,
  selected,
  onChange,
  onBack,
}: {
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
  return (
    <div>
      <div className="flex min-w-0 items-center gap-2 border-b border-border px-3 py-2.5">
        {onBack && (
          <Button
            type="button"
            variant="tertiary"
            size="icon-sm"
            aria-label="All repositories"
            onClick={onBack}
          >
            <ChevronLeftIcon />
          </Button>
        )}
        <span className="truncate text-sm font-medium">{repository.name}</span>
      </div>
      <Command>
        <CommandInput
          ref={focusSearch}
          aria-label="Search branches"
          placeholder="Search branches…"
        />
        <CommandList aria-label={`Branches for ${repository.name}`}>
          <CommandGroup>
            <CommandItem
              value={`Project default ${repository.baseBranch}`}
              data-checked={selected === undefined}
              onSelect={() => {
                onChange();
              }}
            >
              <GitBranchIcon />
              <span className="min-w-0 flex-1 truncate">
                Project default{" "}
                <span className="text-muted-foreground">· {repository.baseBranch}</span>
              </span>
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading="Branches">
            {selected !== undefined && !branches.includes(selected) && (
              <CommandItem
                value={selected}
                data-checked
                onSelect={() => {
                  onChange(selected);
                }}
              >
                <GitBranchIcon />
                <span className="min-w-0 flex-1 truncate">{selected}</span>
              </CommandItem>
            )}
            {branches.map((branch) => (
              <CommandItem
                key={branch}
                value={branch}
                data-checked={selected === branch}
                onSelect={() => {
                  onChange(branch);
                }}
              >
                <GitBranchIcon />
                <span className="min-w-0 flex-1 truncate">{branch}</span>
              </CommandItem>
            ))}
          </CommandGroup>
          {!loading && !error && <CommandEmpty>No matching branches.</CommandEmpty>}
        </CommandList>
      </Command>
      {(loading || error || nextPage > 0) && (
        <div className="space-y-2 border-t border-border p-3">
          {loading && (
            <p role="status" className="text-xs text-muted-foreground">
              Loading branches…
            </p>
          )}
          {!loading && error !== "" && (
            <>
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => {
                  setRevision((v) => v + 1);
                }}
              >
                Try again
              </Button>
            </>
          )}
          {!loading && error === "" && nextPage > 0 && (
            <Button
              type="button"
              size="sm"
              variant="tertiary"
              className="w-full"
              onClick={() => {
                setPage(nextPage);
              }}
            >
              Load more branches
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
