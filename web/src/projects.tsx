import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";

import {
  Alert,
  Button,
  ButtonLink,
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
  ChevronDownIcon,
  TextareaPanel,
  TextareaPanelInput,
  FieldLabel,
  FieldSet,
  Heading,
  Input,
  Link,
  NativeSelect,
  SettingsGroup,
  SettingsRow,
  Text,
} from "@flora/florets";

import { EnvironmentEditor } from "./environment";
import { repositoryPageSchema, type GitHubRepository } from "./github-schemas";
import { projectSchema, type Project, type Repository } from "./project-schemas";
import { errorMessage, isExpired, request } from "./request";
import { text, texts } from "./ui";

const blankRepository: Repository = { name: "", url: "", baseBranch: "", role: "core" };

function RepositoryChoice({
  available,
  url,
  onSelect,
  disabled = false,
  required = false,
}: {
  disabled?: boolean;
  required?: boolean;
  available: GitHubRepository[];
  url: string;
  onSelect: (url: string) => void;
}) {
  return (
    <FieldLabel className="w-full flex-col items-start">
      Choose a repository
      <Combobox
        autoHighlight
        disabled={disabled}
        required={required}
        items={available}
        value={available.find((r) => r.html_url === url || `${r.html_url}.git` === url) ?? null}
        itemToStringLabel={(repository) => repository.full_name}
        onValueChange={(repository) => {
          if (repository) onSelect(repository.html_url);
        }}
      >
        <ComboboxInput
          disabled={disabled}
          aria-label="Choose a repository"
          placeholder="Search repositories"
          className="mt-2 w-full"
        />
        <ComboboxContent className="max-w-[calc(100vw-1rem)] min-w-0">
          <ComboboxEmpty>No matching repositories</ComboboxEmpty>
          <ComboboxList>
            {(repository: GitHubRepository) => (
              <ComboboxItem
                key={repository.full_name}
                value={repository}
                className="min-w-0 whitespace-normal"
              >
                <span className="min-w-0 break-all whitespace-normal">{repository.full_name}</span>
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </FieldLabel>
  );
}

function RepositoryFields({
  repositories,
  compact = false,
  onPrimarySelect,
  active = true,
}: {
  active?: boolean;
  repositories: Repository[];
  compact?: boolean;
  onPrimarySelect?: (repository: GitHubRepository) => void;
}) {
  const [rows, setRows] = useState(() => repositories.map((repo, key) => ({ repo, key })));
  const nextKey = useRef(rows.length);
  const [available, setAvailable] = useState<GitHubRepository[]>([]);
  const [nextPage, setNextPage] = useState(1);
  const [discoveryError, setDiscoveryError] = useState("");
  const [loading, setLoading] = useState(true);
  async function loadRepositories(page: number) {
    setLoading(true);
    try {
      const result = await request(repositoryPageSchema, `github/repositories?page=${page}`);
      setAvailable((current) =>
        page === 1 ? result.repositories : [...current, ...result.repositories],
      );
      setNextPage(result.nextPage);
      setDiscoveryError("");
    } catch (e) {
      setDiscoveryError(errorMessage(e, "Could not load repositories."));
    } finally {
      setLoading(false);
    }
  }
  const discover = useEffectEvent(() => loadRepositories(1));
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- Repository state updates after the discovery request resolves.
    if (active) void discover();
  }, [active]);
  const container = useRef<HTMLDivElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<number | "add" | undefined>(undefined);
  // Move focus with the row commit. A deferred callback could otherwise run
  // after the user has moved to another field and redirect their typing.
  // Only the add and remove handlers set pendingFocus, right before they update
  // rows, so checking after every commit focuses exactly when the rows change.
  useLayoutEffect(() => {
    const target = pendingFocus.current;
    pendingFocus.current = undefined;
    if (target === "add") addButton.current?.focus();
    else if (target !== undefined) {
      container.current
        ?.querySelector<HTMLInputElement>(
          `[data-repository-key="${target}"] ${compact ? 'input[role="combobox"]' : 'input[name="repository"]'}`,
        )
        ?.focus();
    }
  });
  function addRepository() {
    const key = nextKey.current++;
    pendingFocus.current = key;
    setRows((current) => [...current, { key, repo: blankRepository }]);
  }
  function removeRepository(key: number) {
    pendingFocus.current = compact ? (rows.find((row) => row.key !== key)?.key ?? "add") : "add";
    setRows((current) => current.filter((row) => row.key !== key));
  }
  return (
    <div ref={container} className="space-y-5">
      {compact && !loading && !discoveryError && available.length === 0 && (
        <Alert>
          No repositories available. Choose repositories in GitHub access, then retry.{" "}
          <ButtonLink variant="link" href="#onboarding/github">
            Manage GitHub access
          </ButtonLink>
          <Button
            type="button"
            variant="link"
            onClick={() => {
              void loadRepositories(1);
            }}
          >
            Retry repositories
          </Button>
        </Alert>
      )}
      {!compact && (
        <Text tone="muted">
          Use owner/repository or an HTTPS GitHub URL. All repositories must be accessible to the
          GitHub connection. Leave a base branch blank to use its default. Core repositories
          download before setup; extra repositories are fetched on demand.
        </Text>
      )}
      {discoveryError && (
        <Alert variant="destructive">
          {discoveryError}
          {compact && (
            <ButtonLink variant="link" href="#onboarding/github">
              Manage GitHub access
            </ButtonLink>
          )}
          <Button
            type="button"
            variant="link"
            disabled={loading}
            onClick={() => {
              setLoading(true);
              void loadRepositories(nextPage || 1);
            }}
          >
            Retry repository discovery
          </Button>
        </Alert>
      )}
      {nextPage > 0 && !discoveryError && (
        <Button
          type="button"
          variant="outline"
          disabled={loading}
          onClick={() => {
            setLoading(true);
            void loadRepositories(nextPage);
          }}
        >
          {loading ? "Loading repositories…" : "Load more repositories"}
        </Button>
      )}
      {rows.map(({ repo, key }, index) => (
        <FieldSet
          key={key}
          data-repository-key={key}
          className={compact ? "space-y-4" : "space-y-4 rounded-md border border-border p-4"}
        >
          <legend className={compact ? "sr-only" : "px-1 text-sm font-medium"}>
            Repository {index + 1}
          </legend>
          {(compact || available.length > 0) && (
            <RepositoryChoice
              disabled={loading || (compact && available.length === 0)}
              required={compact}
              available={available}
              url={repo.url}
              onSelect={(url) => {
                const selected = available.find((r) => r.html_url === url);
                if (index === 0 && selected) onPrimarySelect?.(selected);
                setRows((current) =>
                  current.map((row) =>
                    row.key === key
                      ? {
                          ...row,
                          repo: {
                            ...row.repo,
                            url,
                            baseBranch:
                              available.find((r) => r.html_url === url)?.default_branch ?? "",
                          },
                        }
                      : row,
                  ),
                );
              }}
            />
          )}
          {compact ? (
            <input type="hidden" name="repository" value={repo.url} />
          ) : (
            <FieldLabel className="w-full flex-col items-start">
              GitHub repository
              <Input
                name="repository"
                className="mt-2"
                value={repo.url}
                onChange={(event) => {
                  const { value } = event.currentTarget;
                  setRows((current) =>
                    current.map((row) =>
                      row.key === key ? { ...row, repo: { ...row.repo, url: value } } : row,
                    ),
                  );
                }}
                placeholder="owner/repository"
                required
                maxLength={300}
              />
            </FieldLabel>
          )}
          <Collapsible defaultOpen={!compact}>
            {compact && (
              <CollapsibleTrigger
                render={<Button type="button" variant="ghost" size="sm" className="-ml-2" />}
              >
                Repository options
                <ChevronDownIcon aria-hidden="true" />
              </CollapsibleTrigger>
            )}
            <CollapsibleContent
              keepMounted
              className={compact ? "space-y-4 data-open:pt-3" : "space-y-4"}
            >
              <FieldLabel className="w-full flex-col items-start">
                Base branch
                <Input
                  name="baseBranch"
                  className="mt-2"
                  value={repo.baseBranch}
                  onChange={(event) => {
                    const baseBranch = event.currentTarget.value;
                    setRows((current) =>
                      current.map((row) =>
                        row.key === key ? { ...row, repo: { ...row.repo, baseBranch } } : row,
                      ),
                    );
                  }}
                  maxLength={255}
                  placeholder="Repository default branch"
                />
              </FieldLabel>
              <FieldLabel className="w-full flex-col items-start">
                Repository role
                <NativeSelect
                  aria-label="Repository role"
                  name="role"
                  className="mt-2"
                  defaultValue={repo.role}
                >
                  <option value="core">Core</option>
                  <option value="extra">Extra</option>
                </NativeSelect>
              </FieldLabel>
              {compact && index === rows.length - 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  ref={addButton}
                  disabled={rows.length >= 100}
                  onClick={addRepository}
                >
                  Add repository
                </Button>
              )}
            </CollapsibleContent>
          </Collapsible>
          {rows.length > 1 && (
            <Button
              variant="link"
              size="sm"
              type="button"
              className="text-sm text-foreground"
              onClick={() => {
                removeRepository(key);
              }}
            >
              Remove repository {index + 1}
            </Button>
          )}
        </FieldSet>
      ))}
      {!compact && (
        <Button
          variant="link"
          size="sm"
          type="button"
          ref={addButton}
          data-add-repository
          className="text-sm text-foreground"
          disabled={rows.length >= 100}
          onClick={addRepository}
        >
          Add repository
        </Button>
      )}
    </div>
  );
}

/** Reads the project payload that the create and update endpoints accept. */
function readProject(fields: FormData) {
  const branches = texts(fields, "baseBranch");
  const roles = texts(fields, "role");
  return {
    name: text(fields, "name"),
    configuration: {
      repositories: texts(fields, "repository").map((url, i) => ({
        url,
        baseBranch: branches[i],
        role: roles[i],
      })),
      setupCommand: text(fields, "setupCommand"),
    },
  };
}

// The parent keys this component by path, so state starts empty for each route.
export function Projects({
  path,
  onExpired,
  embedded = false,
  onCreated,
  onBusyChange,
  active = true,
}: {
  active?: boolean;
  path: string;
  onExpired: () => void;
  embedded?: boolean;
  onCreated?: (project: Project) => Promise<void>;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [list, setList] = useState<Project[]>();
  const [project, setProject] = useState<Project>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const [name, setName] = useState("");
  const nameEdited = useRef(false);
  const id = path.startsWith("projects/") ? path.slice(9) : "";
  const creating = id === "new";
  const expire = useEffectEvent(onExpired);

  useEffect(() => {
    if (!embedded) heading.current?.focus();
    if (creating) return;
    let alive = true;
    const load = async () => {
      try {
        if (id === "") {
          const projects = await request(projectSchema.array(), "projects");
          if (alive) setList(projects);
        } else {
          const loaded = await request(projectSchema, `projects/${encodeURIComponent(id)}`);
          if (alive) setProject(loaded);
        }
      } catch (e) {
        if (!alive) return;
        setError(errorMessage(e, "Could not load projects. Try again."));
        if (isExpired(e)) expire();
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, [id, creating, embedded]);

  async function save(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = readProject(new FormData(event.currentTarget));
    setBusy(true);
    onBusyChange?.(true);
    setError("");
    setNotice("");
    try {
      let savePath = `projects/${encodeURIComponent(id)}`;
      if (creating) savePath = embedded ? "onboarding/project" : "projects";
      const saved = await request(projectSchema, savePath, {
        method: creating ? "POST" : "PUT",
        body: payload,
      });
      setProject(saved);
      setRevision((value) => value + 1);
      if (creating && onCreated) await onCreated(saved);
      else if (creating) window.location.hash = `projects/${saved.id}`;
      else setNotice("Project saved. Existing chats keep their original settings.");
    } catch (e) {
      setError(errorMessage(e, "Could not save project. Try again."));
      if (isExpired(e)) onExpired();
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }

  let title = "Project settings";
  if (creating) title = "Connect project";
  else if (id !== "") title = project?.name ?? "Project";
  let submitLabel = creating ? "Validate and connect" : "Validate and save";
  if (busy) submitLabel = "Validating…";

  return (
    <section
      aria-labelledby={embedded ? undefined : "projects-heading"}
      aria-label={embedded ? "Project" : undefined}
    >
      {!embedded && (
        <div className="flex items-center justify-between gap-4">
          <Heading
            level={1}
            id="projects-heading"
            ref={heading}
            tabIndex={-1}
            className="min-w-0 break-words"
          >
            {title}
          </Heading>
          {id === "" ? (
            <ButtonLink href="#projects/new" className="shrink-0">
              Connect project
            </ButtonLink>
          ) : (
            <Link href="#projects" className="shrink-0 text-sm">
              All projects
            </Link>
          )}
        </div>
      )}
      {id === "" && (
        <Text tone="muted" className="mt-3">
          Manage the GitHub repositories and setup command used by new chats in each project.
        </Text>
      )}
      {project && (
        <Link
          className="mt-5 inline-block text-sm"
          href={`#chats/new?project=${encodeURIComponent(project.id)}`}
        >
          Start chat
        </Link>
      )}
      {error !== "" && (
        <Alert variant="destructive" role="alert" className="mt-6">
          {error}
        </Alert>
      )}
      {notice !== "" && (
        <Alert role="status" className="mt-6">
          {notice}
        </Alert>
      )}
      {list &&
        (list.length > 0 ? (
          <ul className="mt-8 divide-y divide-foreground/20">
            {list.map((p) => (
              <li key={p.id} className="py-5">
                <Link className="font-medium" href={`#projects/${p.id}`}>
                  {p.name}
                </Link>
                <ul className="mt-2 text-sm break-words text-muted-foreground">
                  {p.configuration.repositories.map((repo) => (
                    <li key={repo.name}>
                      {repo.url.replace("https://github.com/", "")} · Branch: {repo.baseBranch} ·{" "}
                      {repo.role === "core" ? "Available at startup" : "Fetched on demand"}
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex gap-4 text-sm">
                  <Link href={`#chats/new?project=${encodeURIComponent(p.id)}`}>Start chat</Link>
                  <Link href={`#projects/${p.id}`}>Edit settings</Link>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Text tone="muted" className="mt-8">
            No projects yet. Connect a GitHub repository to get started.
          </Text>
        ))}
      {!creating && !project && !list && error === "" && (
        <Text tone="muted" role="status" className="mt-8">
          Loading…
        </Text>
      )}
      {(creating || project) && (
        <form
          key={`${project?.id ?? "new"}-${revision}`}
          id={embedded ? "onboarding-project" : undefined}
          className={embedded ? "space-y-5" : "mt-8 space-y-6"}
          onSubmit={(event) => {
            void save(event);
          }}
        >
          {!creating && (
            <Text tone="muted">
              Changes apply only to new chats. Existing chats keep their original settings.
            </Text>
          )}
          <FieldSet disabled={busy}>
            <legend className="sr-only">Project settings</legend>
            <SettingsGroup>
              <SettingsRow label="Project name" htmlFor="project-name">
                <Input
                  id="project-name"
                  name="name"
                  value={creating ? name : undefined}
                  defaultValue={creating ? undefined : project?.name}
                  onChange={(event) => {
                    nameEdited.current = true;
                    setName(event.currentTarget.value);
                  }}
                  maxLength={200}
                  required
                />
              </SettingsRow>
            </SettingsGroup>
            <RepositoryFields
              compact={embedded}
              active={active}
              onPrimarySelect={(repository) => {
                if (creating && !nameEdited.current) {
                  setName(repository.full_name.split("/").at(-1) ?? "");
                }
              }}
              repositories={project?.configuration.repositories ?? [blankRepository]}
            />
            <Collapsible defaultOpen={!embedded}>
              {embedded && (
                <CollapsibleTrigger
                  render={<Button type="button" variant="ghost" size="sm" className="-ml-2" />}
                >
                  Setup command
                  <ChevronDownIcon aria-hidden="true" />
                </CollapsibleTrigger>
              )}
              <CollapsibleContent keepMounted className={embedded ? "data-open:pt-3" : undefined}>
                <FieldLabel className="w-full flex-col items-start">
                  Setup command (optional)
                  <TextareaPanel>
                    <TextareaPanelInput
                      name="setupCommand"
                      className="mt-2 min-h-28 font-mono"
                      defaultValue={project?.configuration.setupCommand}
                      maxLength={8192}
                      aria-describedby={embedded ? undefined : "setup-help"}
                    />
                  </TextareaPanel>
                </FieldLabel>
              </CollapsibleContent>
            </Collapsible>
            {!embedded && (
              <Text tone="muted" id="setup-help">
                Runs inside the chat container before the agent starts.
              </Text>
            )}
          </FieldSet>
          {!embedded && (
            <Button type="submit" disabled={busy}>
              {submitLabel}
            </Button>
          )}
        </form>
      )}
      {project && (
        <div className="mt-10">
          <EnvironmentEditor
            key={project.id}
            path={`projects/${encodeURIComponent(project.id)}/environment`}
          />
        </div>
      )}
    </section>
  );
}
