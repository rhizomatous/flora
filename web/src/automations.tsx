import { useEffect, useEffectEvent, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  Alert,
  Button,
  ButtonLink,
  FieldLabel,
  Heading,
  Input,
  Link,
  LoadingStatus,
  NativeSelect,
  Textarea,
} from "@flora/florets";

import {
  automationSchema,
  automationRunSchema,
  automationDetailSchema,
  nextRunSchema,
  type Automation,
  type AutomationDetail,
} from "./automation-schemas";
import { projectSummarySchema, type ProjectSummary } from "./project-schemas";
import { errorMessage, isExpired, request } from "./request";

const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function stamp(value: string, timeZone: string) {
  return new Date(value).toLocaleString(undefined, {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  });
}
function scheduleLabel(a: Automation) {
  let frequency = "Daily";
  if (a.frequency === "weekly") frequency = (a.days ?? []).map((day) => weekdays[day]).join(", ");
  else if (a.frequency === "weekdays") frequency = "Weekdays";
  return `${frequency} at ${a.time} · ${a.timeZone}`;
}
function blank(projectID: string): Automation {
  return {
    id: "",
    projectID,
    name: "",
    instructions: "",
    mode: "new",
    frequency: "weekdays",
    days: [1],
    time: "09:00",
    timeZone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
    enabled: true,
    nextRun: "",
    chatID: "",
    revision: 0,
  };
}

function AutomationForm({
  initial,
  topbar,
  projects,
  busy,
  save,
  cancel,
}: {
  initial: Automation;
  topbar: HTMLDivElement | null;
  projects: ProjectSummary[];
  busy: boolean;
  save: (value: Automation) => void;
  cancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [preview, setPreview] = useState("");
  const [previewError, setPreviewError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (topbar) heading.current?.focus();
  }, [topbar]);
  const { frequency, days, time, timeZone } = value;
  const saveLabel = initial.id ? "Save changes" : "Create automation";
  const compactSaveLabel = initial.id ? "Save" : "Create";
  useEffect(() => {
    let live = true;
    async function refreshPreview() {
      try {
        const result = await request(nextRunSchema, "automations/preview", {
          method: "POST",
          body: {
            name: "Preview",
            instructions: "Preview",
            mode: "new",
            frequency,
            days,
            time,
            timeZone,
          },
        });
        if (live) {
          setPreview(result.nextRun);
          setPreviewError("");
        }
      } catch {
        if (live) {
          setPreview("");
          setPreviewError("Choose a valid time zone and at least one day for a weekly schedule.");
        }
      }
    }
    const timer = window.setTimeout(() => {
      void refreshPreview();
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [frequency, days, time, timeZone]);
  function change<K extends keyof Automation>(key: K, next: Automation[K]) {
    setValue((current) => ({ ...current, [key]: next }));
    if (key === "frequency" || key === "days" || key === "time" || key === "timeZone") {
      setPreview("");
    }
  }
  return (
    <section className="mx-auto max-w-3xl [&_input]:scroll-mt-20 [&_textarea]:scroll-mt-20">
      {topbar &&
        createPortal(
          <>
            <Heading
              level={1}
              ref={heading}
              tabIndex={-1}
              className="min-w-0 flex-1 truncate text-base"
            >
              {initial.id ? "Edit automation" : "New automation"}
            </Heading>
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={cancel}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="automation-form"
              size="sm"
              disabled={busy || !preview}
              aria-label={busy ? "Saving…" : saveLabel}
            >
              <span className="hidden sm:inline">{busy ? "Saving…" : saveLabel}</span>
              <span className="sm:hidden">{busy ? "Saving…" : compactSaveLabel}</span>
            </Button>
          </>,
          topbar,
        )}
      <form
        id="automation-form"
        onSubmit={(event) => {
          event.preventDefault();
          save(value);
        }}
      >
        <fieldset disabled={busy} className="space-y-5">
          <FieldLabel className="w-full flex-col items-start">
            Name
            <Input
              value={value.name}
              onChange={(e) => {
                change("name", e.target.value);
              }}
              required
              maxLength={200}
              placeholder="Weekly dependency check"
            />
          </FieldLabel>
          <FieldLabel className="w-full flex-col items-start">
            Instructions
            <Textarea
              className="min-h-32"
              value={value.instructions}
              onChange={(e) => {
                change("instructions", e.target.value);
              }}
              required
              placeholder="Check for outdated dependencies. Update safe minor versions, run tests, and open a draft PR if anything changes."
            />
          </FieldLabel>
          <div className="divide-y rounded-lg border">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <FieldLabel htmlFor="automation-project">Project</FieldLabel>
              <NativeSelect
                id="automation-project"
                className="w-[min(14rem,52vw)]"
                aria-label="Project"
                value={value.projectID}
                disabled={initial.id !== ""}
                onChange={(e) => {
                  change("projectID", e.target.value);
                }}
                required
              >
                <option value="" disabled>
                  Choose a project
                </option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3">
              <FieldLabel htmlFor="automation-mode">Runs in</FieldLabel>
              <NativeSelect
                id="automation-mode"
                className="col-start-2 row-start-1 w-[min(14rem,52vw)] sm:row-span-2"
                aria-label="Runs in"
                value={value.mode}
                onChange={(e) => {
                  change("mode", e.target.value === "same" ? "same" : "new");
                }}
                aria-describedby="run-mode-help"
              >
                <option value="new">A new chat each run</option>
                <option value="same">The same chat each run</option>
              </NativeSelect>
              <p
                id="run-mode-help"
                className="col-span-2 text-sm text-muted-foreground sm:col-span-1 sm:row-start-2"
              >
                {value.mode === "same"
                  ? "Keep the workspace and conversation."
                  : "Each run starts with a fresh workspace and conversation."}
              </p>
              {initial.id && value.mode !== initial.mode && (
                <p className="col-span-2 text-sm">
                  The next run will start a new chat. Previous chats stay available.
                </p>
              )}
            </div>
            <div className="space-y-3 px-4 py-4">
              <p className="text-sm font-medium">Schedule</p>
              <div
                role="group"
                aria-label="Run schedule"
                className="flex flex-wrap items-center gap-x-3 gap-y-2"
              >
                <NativeSelect
                  className="w-auto"
                  aria-label="Schedule"
                  value={frequency}
                  onChange={(e) => {
                    const next = e.target.value;
                    if (next === "daily" || next === "weekdays" || next === "weekly") {
                      change("frequency", next);
                    }
                  }}
                >
                  <option value="daily">Daily</option>
                  <option value="weekdays">Weekdays</option>
                  <option value="weekly">Weekly</option>
                </NativeSelect>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground" aria-hidden="true">
                    at
                  </span>
                  <Input
                    className="w-34"
                    aria-label="Time"
                    type="time"
                    value={time}
                    onChange={(e) => {
                      change("time", e.target.value);
                    }}
                    required
                  />
                </div>
                <div className="flex max-w-full min-w-0 items-center gap-2">
                  <span className="text-sm text-muted-foreground" aria-hidden="true">
                    in
                  </span>
                  <Input
                    className="w-52 min-w-0"
                    aria-label="Time zone"
                    value={timeZone}
                    onChange={(e) => {
                      change("timeZone", e.target.value);
                    }}
                    required
                    list="automation-zones"
                  />
                </div>
              </div>
              <datalist id="automation-zones">
                {Intl.supportedValuesOf("timeZone").map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
                <option value="UTC">UTC</option>
              </datalist>
              {frequency === "weekly" && (
                <fieldset>
                  <legend className="mb-2 text-sm font-medium">Days</legend>
                  <div className="flex flex-wrap gap-2">
                    {weekdays.map((day, index) => (
                      <Button
                        type="button"
                        key={day}
                        size="sm"
                        variant={(days ?? []).includes(index) ? "default" : "outline"}
                        aria-label={day}
                        aria-pressed={(days ?? []).includes(index)}
                        onClick={() => {
                          change(
                            "days",
                            (days ?? []).includes(index)
                              ? (days ?? []).filter((d) => d !== index)
                              : [...(days ?? []), index].toSorted((a, b) => a - b),
                          );
                        }}
                      >
                        {day.slice(0, 3)}
                      </Button>
                    ))}
                  </div>
                </fieldset>
              )}
              <div className="text-xs text-muted-foreground" aria-live="polite">
                {previewError ? (
                  <p>{previewError}</p>
                ) : (
                  <p>
                    {preview
                      ? `Next run: ${stamp(preview, timeZone)} · ${timeZone}`
                      : "Checking schedule…"}
                  </p>
                )}
              </div>
            </div>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Runs use your installation’s model, credentials, and limits. Missed runs and runs that
            overlap active work are skipped.
          </p>
        </fieldset>
      </form>
    </section>
  );
}

export function Automations({
  path,
  onExpired,
  topbar,
}: {
  path: string;
  onExpired: () => void;
  topbar: HTMLDivElement | null;
}) {
  const [list, setList] = useState<Automation[]>();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [detail, setDetail] = useState<AutomationDetail>();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const manualID = useRef<string | null>(null);
  const isNew = path === "automations/new";
  const id = isNew ? "" : (path.split("/")[1] ?? "");
  async function load() {
    try {
      const [items, projectList] = await Promise.all([
        request(automationSchema.array(), "automations"),
        request(projectSummarySchema.array(), "projects"),
      ]);
      setList(items);
      setProjects(projectList);
      if (id) setDetail(await request(automationDetailSchema, `automations/${id}`));
    } catch (e) {
      setError(errorMessage(e, "Could not load automations."));
      if (isExpired(e)) onExpired();
    }
  }
  const loadLatest = useEffectEvent(load);
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- Requests update state asynchronously.
    void loadLatest();
    const timer = window.setInterval(() => {
      void loadLatest();
    }, 5000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);
  async function action(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
      await load();
    } catch (e) {
      setError(errorMessage(e, "Could not save this change."));
      if (isExpired(e)) onExpired();
    } finally {
      setBusy(false);
    }
  }
  function save(value: Automation) {
    void action(async () => {
      const saved = await request(
        automationSchema,
        value.id ? `automations/${value.id}` : "automations",
        { method: value.id ? "PUT" : "POST", body: value },
      );
      setEditing(false);
      window.location.hash = `automations/${saved.id}`;
      setNotice("Automation saved.");
    });
  }
  const item = detail?.automation;
  const runs = detail?.runs ?? [];
  return (
    <>
      {error && (
        <Alert variant="destructive" role="alert" className="mb-6">
          {error}
          <Button
            variant="link"
            onClick={() => {
              setError("");
              void load();
            }}
          >
            Retry
          </Button>
        </Alert>
      )}
      {notice && (
        <Alert role="status" className="mb-6">
          {notice}
        </Alert>
      )}
      {list === undefined && !error && <LoadingStatus />}
      {list !== undefined && (isNew || (editing && item !== undefined)) && (
        <AutomationForm
          topbar={topbar}
          initial={item ?? blank(projects[0]?.id ?? "")}
          projects={projects}
          busy={busy}
          save={save}
          cancel={() => {
            if (editing) setEditing(false);
            else window.location.hash = "automations";
          }}
        />
      )}
      {list !== undefined && !isNew && !editing && id !== "" && item !== undefined && (
        <section className="mx-auto max-w-3xl">
          <Link href="#automations">Automations</Link>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
            <Heading level={1}>{item.name}</Heading>
            <span className="text-sm text-muted-foreground">
              {item.enabled ? "Scheduled" : "Paused"}
            </span>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            {projects.find((p) => p.id === item.projectID)?.name} · {scheduleLabel(item)}
          </p>
          <p className="mt-2 text-sm">
            {item.enabled
              ? `Next run: ${stamp(item.nextRun, item.timeZone)}`
              : "Paused. No scheduled runs will start."}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {item.mode === "same" ? "The same chat each run" : "A new chat each run"}
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button
              disabled={busy}
              title="Starts real work using your saved instructions"
              onClick={() => {
                void action(async () => {
                  manualID.current ??= crypto.randomUUID();
                  const run = await request(automationRunSchema, `automations/${id}/run`, {
                    method: "POST",
                    body: { requestID: manualID.current },
                  });
                  manualID.current = null;
                  setNotice(
                    run.status === "skipped" || run.status === "failed"
                      ? run.reason
                      : "Run started. Follow its progress below.",
                  );
                });
              }}
            >
              Run now
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                void action(async () => {
                  await request(automationSchema, `automations/${id}`, {
                    method: "PUT",
                    body: { ...item, latestRun: undefined, enabled: !item.enabled },
                  });
                });
              }}
            >
              {item.enabled ? "Pause" : "Resume"}
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setEditing(true);
              }}
            >
              Edit
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Run now starts real work. Pausing only prevents future scheduled runs.
          </p>
          <div className="my-8 rounded-lg border p-4 text-sm whitespace-pre-wrap">
            {item.instructions}
          </div>
          <Heading level={2}>Run history</Heading>
          {runs.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              No runs yet. Wait for the schedule or choose Run now.
            </p>
          ) : (
            <ol className="mt-4 divide-y rounded-lg border px-4">
              {runs.map((run) => (
                <li key={run.id} className="py-4">
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="text-sm">{stamp(run.scheduledAt, item.timeZone)}</span>
                    <span className="text-sm capitalize">{run.status}</span>
                  </div>
                  {run.reason && <p className="mt-2 text-sm text-muted-foreground">{run.reason}</p>}
                  {run.chatID && (
                    <Link
                      className="mt-2 inline-block text-sm"
                      href={`#chats/${run.chatID}?run=${encodeURIComponent(run.messageID)}`}
                    >
                      Open chat
                    </Link>
                  )}
                </li>
              ))}
            </ol>
          )}
          {runs.length === 100 && (
            <p className="mt-3 text-xs text-muted-foreground">Showing the latest 100 runs.</p>
          )}
        </section>
      )}
      {list !== undefined && !isNew && !editing && id === "" && (
        <section>
          <div className="flex items-center justify-between gap-4">
            <Heading level={1}>Automations</Heading>
            <ButtonLink href="#automations/new">New automation</ButtonLink>
          </div>
          {list.length === 0 ? (
            <div className="py-16 text-center">
              <p>Run a task on a schedule.</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Choose a project, give Flora instructions, and return to review its work.
              </p>
              {projects.length === 0 && (
                <Link className="mt-4 inline-block" href="#projects/new">
                  Create a project to get started
                </Link>
              )}
            </div>
          ) : (
            <ul className="mt-8 divide-y rounded-lg border px-5">
              {list.map((automation) => (
                <li key={automation.id} className="py-5">
                  <div className="flex justify-between gap-4">
                    <Link href={`#automations/${automation.id}`} className="font-medium">
                      {automation.name}
                    </Link>
                    <span className="text-sm text-muted-foreground">
                      {automation.enabled ? "Scheduled" : "Paused"}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {projects.find((p) => p.id === automation.projectID)?.name} ·{" "}
                    {scheduleLabel(automation)}
                  </p>
                  {automation.latestRun && (
                    <p className="mt-2 text-sm">
                      Latest run: <span className="capitalize">{automation.latestRun.status}</span>
                      {automation.latestRun.chatID && (
                        <>
                          {" "}
                          ·{" "}
                          <Link
                            href={`#chats/${automation.latestRun.chatID}?run=${encodeURIComponent(automation.latestRun.messageID)}`}
                          >
                            Open chat
                          </Link>
                        </>
                      )}
                    </p>
                  )}
                  <p className="mt-1 text-sm text-muted-foreground">
                    {automation.enabled
                      ? `Next: ${stamp(automation.nextRun, automation.timeZone)}`
                      : "No scheduled runs"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
