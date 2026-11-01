import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";

import { request, RequestError } from "./request";

type Repository = { name: string; url: string; baseBranch: string; role: "core" | "extra" };
type Project = {
  id: string;
  name: string;
  configuration: { repositories: Repository[]; setupCommand: string };
};
const control =
  "mt-2 w-full rounded-md border border-foreground/30 bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-foreground disabled:opacity-60";
const button =
  "rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50";

function RepositoryFields({ repositories }: { repositories?: Repository[] }) {
  const [rows, setRows] = useState(() =>
    (repositories || [{ name: "", url: "", baseBranch: "", role: "core" as const }]).map(
      (repo, key) => ({ repo, key }),
    ),
  );
  const nextKey = useRef(rows.length);
  const container = useRef<HTMLDivElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<number | "add" | undefined>(undefined);
  // Move focus with the row commit. A deferred callback could otherwise run
  // after the user has moved to another field and redirect their typing.
  useLayoutEffect(() => {
    const target = pendingFocus.current;
    pendingFocus.current = undefined;
    if (target === "add") addButton.current?.focus();
    else if (target !== undefined) {
      container.current
        ?.querySelector<HTMLInputElement>(
          `[data-repository-key="${target}"] input[name="repository"]`,
        )
        ?.focus();
    }
  }, [rows]);
  function addRepository() {
    const key = nextKey.current++;
    pendingFocus.current = key;
    setRows((current) => [
      ...current,
      { key, repo: { name: "", url: "", baseBranch: "", role: "core" } },
    ]);
  }
  function removeRepository(key: number) {
    pendingFocus.current = "add";
    setRows((current) => current.filter((row) => row.key !== key));
  }
  return (
    <div ref={container} className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Use owner/repository or an HTTPS GitHub URL. All repositories must be accessible to the
        saved GitHub token. Leave a base branch blank to use its default. Core repositories download
        before setup; extra repositories are fetched on demand.
      </p>
      {rows.map(({ repo, key }, index) => (
        <fieldset
          key={key}
          data-repository-key={key}
          className="space-y-4 rounded-md border border-foreground/20 p-4"
        >
          <legend className="px-1 text-sm font-medium">Repository {index + 1}</legend>
          <label className="block text-sm font-medium">
            GitHub repository
            <input
              name="repository"
              className={control}
              defaultValue={repo.url}
              placeholder="owner/repository"
              required
              maxLength={300}
            />
          </label>
          <label className="block text-sm font-medium">
            Base branch
            <input
              name="baseBranch"
              className={control}
              defaultValue={repo.baseBranch}
              maxLength={255}
              placeholder="Repository default branch"
            />
          </label>
          <label className="block text-sm font-medium">
            Repository role
            <select
              aria-label="Repository role"
              name="role"
              className={control}
              defaultValue={repo.role}
            >
              <option value="core">Core</option>
              <option value="extra">Extra</option>
            </select>
          </label>
          {rows.length > 1 && (
            <button
              type="button"
              className="text-sm underline underline-offset-4"
              onClick={() => {
                removeRepository(key);
              }}
            >
              Remove repository {index + 1}
            </button>
          )}
        </fieldset>
      ))}
      <button
        type="button"
        ref={addButton}
        data-add-repository
        className="text-sm underline underline-offset-4"
        disabled={rows.length >= 100}
        onClick={addRepository}
      >
        Add repository
      </button>
    </div>
  );
}

export function Projects({ path, onExpired }: { path: string; onExpired: () => void }) {
  const [list, setList] = useState<Project[]>();
  const [project, setProject] = useState<Project>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const id = path.startsWith("projects/") ? path.slice(9) : "";
  const creating = id === "new";
  useEffect(() => {
    let active = true;
    setError("");
    setNotice("");
    setProject(undefined);
    setList(undefined);
    heading.current?.focus();
    if (creating) return;
    const load = id
      ? request<Project>(`projects/${encodeURIComponent(id)}`).then((p) => {
          if (active) setProject(p);
        })
      : request<Project[]>("projects").then((p) => {
          if (active) setList(p);
        });
    load.catch((e) => {
      if (active) {
        setError(e.message);
        if (e instanceof RequestError && e.status === 401) onExpired();
      }
    });
    return () => {
      active = false;
    };
  }, [id, creating]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const saved = await request<Project>(
        creating ? "projects" : `projects/${encodeURIComponent(id)}`,
        creating ? "POST" : "PUT",
        {
          name: fields.get("name"),
          configuration: {
            repositories: fields.getAll("repository").map((url, i) => ({
              url,
              baseBranch: fields.getAll("baseBranch")[i],
              role: fields.getAll("role")[i],
            })),
            setupCommand: fields.get("setupCommand"),
          },
        },
      );
      setProject(saved);
      setRevision((value) => value + 1);
      if (creating) window.location.hash = `projects/${saved.id}`;
      else setNotice("Project saved. Existing chats keep their original settings.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save project. Try again.");
      if (e instanceof RequestError && e.status === 401) onExpired();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="projects-heading">
      <div className="flex items-center justify-between gap-4">
        <h1
          id="projects-heading"
          ref={heading}
          tabIndex={-1}
          className="min-w-0 text-2xl font-semibold tracking-tight break-words"
        >
          {creating ? "Connect project" : id ? project?.name || "Project" : "Projects"}
        </h1>
        {id ? (
          <a href="#projects" className="shrink-0 text-sm underline underline-offset-4">
            All projects
          </a>
        ) : (
          <a href="#projects/new" className={`${button} shrink-0`}>
            Connect project
          </a>
        )}
      </div>
      {project && (
        <a
          className="mt-5 inline-block text-sm underline underline-offset-4"
          href={`#chats/new?project=${encodeURIComponent(project.id)}`}
        >
          Start chat
        </a>
      )}
      {error && (
        <p role="alert" className="mt-6 rounded-md border border-foreground/50 p-3 text-sm">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-6 rounded-md border p-3 text-sm">
          {notice}
        </p>
      )}
      {!id &&
        list &&
        (list.length > 0 ? (
          <ul className="mt-8 divide-y divide-foreground/20">
            {list.map((p) => (
              <li key={p.id} className="py-5">
                <a className="font-medium underline underline-offset-4" href={`#projects/${p.id}`}>
                  {p.name}
                </a>
                <ul className="mt-2 text-sm break-words text-muted-foreground">
                  {p.configuration.repositories.map((repo) => (
                    <li key={repo.name}>
                      {repo.name} · {repo.baseBranch} · {repo.role}
                    </li>
                  ))}
                </ul>
                <a
                  className="mt-3 inline-block text-sm underline underline-offset-4"
                  href={`#chats/new?project=${encodeURIComponent(p.id)}`}
                >
                  Start chat
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-8 text-sm text-muted-foreground">
            No projects yet. Connect a GitHub repository to get started.
          </p>
        ))}
      {!creating && !project && !list && !error && (
        <p role="status" className="mt-8 text-sm text-muted-foreground">
          Loading…
        </p>
      )}
      {(creating || project) && (
        <form
          key={`${project?.id || "new"}-${revision}`}
          className="mt-8 space-y-6"
          onSubmit={save}
        >
          {!creating && (
            <p className="text-sm text-muted-foreground">
              Changes apply only to new chats. Existing chats keep their original settings.
            </p>
          )}
          <fieldset disabled={busy} className="space-y-6">
            <legend className="sr-only">Project settings</legend>
            <label className="block text-sm font-medium">
              Project name
              <input
                name="name"
                className={control}
                defaultValue={project?.name}
                maxLength={200}
                required
              />
            </label>
            <RepositoryFields repositories={project?.configuration.repositories} />
            <label className="block text-sm font-medium">
              Setup command (optional)
              <textarea
                name="setupCommand"
                className={`${control} min-h-28 font-mono`}
                defaultValue={project?.configuration.setupCommand}
                maxLength={8192}
                aria-describedby="setup-help"
              />
            </label>
            <p id="setup-help" className="text-sm text-muted-foreground">
              Runs inside the chat container before the agent starts.
            </p>
          </fieldset>
          <button className={button} disabled={busy}>
            {busy ? "Validating…" : creating ? "Validate and connect" : "Validate and save"}
          </button>
        </form>
      )}
    </section>
  );
}
