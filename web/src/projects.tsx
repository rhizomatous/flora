import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";

import {
  Alert,
  Button,
  ButtonLink,
  FieldLabel,
  FieldSet,
  Heading,
  Input,
  Link,
  NativeSelect,
  Text,
  Textarea,
} from "@flora/florets";

import { projectSchema, type Project, type Repository } from "./project-schemas";
import { errorMessage, isExpired, request } from "./request";
import { text, texts } from "./ui";

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
      <Text tone="muted">
        Use owner/repository or an HTTPS GitHub URL. All repositories must be accessible to the
        saved GitHub token. Leave a base branch blank to use its default. Core repositories download
        before setup; extra repositories are fetched on demand.
      </Text>
      {rows.map(({ repo, key }, index) => (
        <FieldSet
          key={key}
          data-repository-key={key}
          className="space-y-4 rounded-md border border-foreground/20 p-4"
        >
          <legend className="px-1 text-sm font-medium">Repository {index + 1}</legend>
          <FieldLabel className="w-full flex-col items-start">
            GitHub repository
            <Input
              name="repository"
              className="mt-2"
              defaultValue={repo.url}
              placeholder="owner/repository"
              required
              maxLength={300}
            />
          </FieldLabel>
          <FieldLabel className="w-full flex-col items-start">
            Base branch
            <Input
              name="baseBranch"
              className="mt-2"
              defaultValue={repo.baseBranch}
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
          const projects = await request(projectSchema.array(), "projects");
          if (active) setList(projects);
        } else {
          const loaded = await request(projectSchema, `projects/${encodeURIComponent(id)}`);
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
      const saved = await request(
        projectSchema,
        creating ? "projects" : `projects/${encodeURIComponent(id)}`,
        { method: creating ? "POST" : "PUT", body: payload },
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

  let title = "Project settings";
  if (creating) title = "Connect project";
  else if (id !== "") title = project?.name ?? "Project";
  let submitLabel = creating ? "Validate and connect" : "Validate and save";
  if (busy) submitLabel = "Validating…";

  return (
    <section aria-labelledby="projects-heading">
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
          className="mt-8 space-y-6"
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
            <FieldLabel className="w-full flex-col items-start">
              Project name
              <Input
                name="name"
                className="mt-2"
                defaultValue={project?.name}
                maxLength={200}
                required
              />
            </FieldLabel>
            <RepositoryFields
              repositories={project?.configuration.repositories ?? [blankRepository]}
            />
            <FieldLabel className="w-full flex-col items-start">
              Setup command (optional)
              <Textarea
                name="setupCommand"
                className="mt-2 min-h-28 font-mono"
                defaultValue={project?.configuration.setupCommand}
                maxLength={8192}
                aria-describedby="setup-help"
              />
            </FieldLabel>
            <Text tone="muted" id="setup-help">
              Runs inside the chat container before the agent starts.
            </Text>
          </FieldSet>
          <Button type="submit" disabled={busy}>
            {submitLabel}
          </Button>
        </form>
      )}
    </section>
  );
}
