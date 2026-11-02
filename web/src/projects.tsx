import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";

import { errorMessage, isExpired, request } from "./request";
import { button, control, link, text, texts } from "./ui";

type Repository = { name: string; url: string; baseBranch: string; role: "core" | "extra" };
type Project = {
  id: string;
  name: string;
  configuration: { repositories: Repository[]; setupCommand: string };
};

const blankRepository: Repository = { name: "", url: "", baseBranch: "", role: "core" };

function RepositoryFields({ repositories }: { repositories: Repository[] }) {
  const [rows, setRows] = useState(() => repositories.map((repo, key) => ({ repo, key })));
  const nextKey = useRef(rows.length);
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
          `[data-repository-key="${target}"] input[name="repository"]`,
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
              className={`${link} text-sm`}
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
        className={`${link} text-sm`}
        disabled={rows.length >= 100}
        onClick={addRepository}
      >
        Add repository
      </button>
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
  const expire = useEffectEvent(onExpired);

  useEffect(() => {
    heading.current?.focus();
    if (creating) return;
    let active = true;
    const load = async () => {
      try {
        if (id === "") {
          const projects = await request<Project[]>("projects");
          if (active) setList(projects);
        } else {
          const loaded = await request<Project>(`projects/${encodeURIComponent(id)}`);
          if (active) setProject(loaded);
        }
      } catch (e) {
        if (!active) return;
        setError(errorMessage(e, "Could not load projects. Try again."));
        if (isExpired(e)) expire();
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [id, creating]);

  async function save(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = readProject(new FormData(event.currentTarget));
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const saved = await request<Project>(
        creating ? "projects" : `projects/${encodeURIComponent(id)}`,
        creating ? "POST" : "PUT",
        payload,
      );
      setProject(saved);
      setRevision((value) => value + 1);
      if (creating) window.location.hash = `projects/${saved.id}`;
      else setNotice("Project saved. Existing chats keep their original settings.");
    } catch (e) {
      setError(errorMessage(e, "Could not save project. Try again."));
      if (isExpired(e)) onExpired();
    } finally {
      setBusy(false);
    }
  }

  let title = "Projects";
  if (creating) title = "Connect project";
  else if (id !== "") title = project?.name ?? "Project";
  let submitLabel = creating ? "Validate and connect" : "Validate and save";
  if (busy) submitLabel = "Validating…";

  return (
    <section aria-labelledby="projects-heading">
      <div className="flex items-center justify-between gap-4">
        <h1
          id="projects-heading"
          ref={heading}
          tabIndex={-1}
          className="min-w-0 text-2xl font-semibold tracking-tight break-words"
        >
          {title}
        </h1>
        {id === "" ? (
          <a href="#projects/new" className={`${button} shrink-0`}>
            Connect project
          </a>
        ) : (
          <a href="#projects" className={`${link} shrink-0 text-sm`}>
            All projects
          </a>
        )}
      </div>
      {project && (
        <a
          className={`${link} mt-5 inline-block text-sm`}
          href={`#chats/new?project=${encodeURIComponent(project.id)}`}
        >
          Start chat
        </a>
      )}
      {error !== "" && (
        <p role="alert" className="mt-6 rounded-md border border-foreground/50 p-3 text-sm">
          {error}
        </p>
      )}
      {notice !== "" && (
        <p role="status" className="mt-6 rounded-md border p-3 text-sm">
          {notice}
        </p>
      )}
      {list &&
        (list.length > 0 ? (
          <ul className="mt-8 divide-y divide-foreground/20">
            {list.map((p) => (
              <li key={p.id} className="py-5">
                <a className={`${link} font-medium`} href={`#projects/${p.id}`}>
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
                  className={`${link} mt-3 inline-block text-sm`}
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
      {!creating && !project && !list && error === "" && (
        <p role="status" className="mt-8 text-sm text-muted-foreground">
          Loading…
        </p>
      )}
      {(creating || project) && (
        <form
          key={`${project?.id ?? "new"}-${revision}`}
          className="mt-8 space-y-6"
          onSubmit={(event) => {
            void save(event);
          }}
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
            <RepositoryFields
              repositories={project?.configuration.repositories ?? [blankRepository]}
            />
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
          <button type="submit" className={button} disabled={busy}>
            {submitLabel}
          </button>
        </form>
      )}
    </section>
  );
}
