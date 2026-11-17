import { useEffect, useEffectEvent, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import {
  Alert,
  Button,
  Command,
  CommandInput,
  CommandEmpty,
  CommandList,
  CommandItem,
  Popover,
  PopoverTrigger,
  PopoverContent,
  ChevronDownIcon,
  FieldLabel,
  Heading,
  Input,
  Link,
  LoadingStatus,
  NativeSelect,
  Textarea,
  Switch,
  Toaster,
  ChevronLeftIcon,
} from "@flora/florets";

import { AutomationList } from "./automation-list";
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

const commonTimeZones = [
  "UTC",
  "America/New_York",
  "America/Los_Angeles",
  "America/Chicago",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Tokyo",
];
const timeZones = [...new Set([...commonTimeZones, ...Intl.supportedValuesOf("timeZone")])];

const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function stamp(value: string, timeZone: string) {
  return new Date(value).toLocaleString(undefined, {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  });
}
function blank(projectID: string): Automation {
  return {
    id: "",
    projectID,
    name: "",
    instructions: "",
    description: "",
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

function TimeZonePicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (zone: string) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const zones = timeZones.includes(value) ? timeZones : [value, ...timeZones];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            aria-label="Time zone"
            className="w-52 min-w-0 justify-between font-normal"
          >
            <span className="truncate">{value}</span>
            <ChevronDownIcon />
          </Button>
        }
      />
      <PopoverContent
        align="start"
        className="w-72! max-w-[calc(100vw-24px)]! p-0"
        aria-label="Time zones"
      >
        <Command className="rounded-lg! p-0">
          <CommandInput
            variant="plain"
            aria-label="Search time zones"
            placeholder="Search time zones"
          />
          <CommandList aria-label="Time zones" className="p-1.5">
            <CommandEmpty>No time zones found.</CommandEmpty>
            {zones.map((zone) => (
              <CommandItem
                key={zone}
                value={zone}
                keywords={[zone.replaceAll("_", " ")]}
                data-checked={zone === value}
                className="min-h-7 rounded-sm py-1"
                onSelect={() => {
                  onChange(zone);
                  setOpen(false);
                }}
              >
                {zone}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function AutomationForm({
  initial,
  topbar,
  projects,
  busy,
  pending,
  save,
  cancel,
  runNow,
  toggleActive,
}: {
  initial: Automation;
  topbar: HTMLDivElement | null;
  projects: ProjectSummary[];
  busy: boolean;
  pending: "save" | "run" | "active" | null;
  save: (value: Automation, runAfter?: boolean) => void;
  runNow: () => void;
  toggleActive: () => void;
  cancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [preview, setPreview] = useState("");
  const [previewError, setPreviewError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (topbar) heading.current?.focus();
  }, [topbar]);
  const { frequency, days, time, timeZone } = value;
  const dirty = (
    [
      "name",
      "description",
      "instructions",
      "projectID",
      "mode",
      "frequency",
      "days",
      "time",
      "timeZone",
    ] as const
  ).some((key) => JSON.stringify(value[key]) !== JSON.stringify(initial[key]));
  let runLabel = dirty ? "Save and run" : "Run now";
  if (pending === "run") runLabel = "Starting…";
  const saveLabel = initial.id ? "Save" : "Create automation";
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
  function submit(runAfter = false) {
    save(
      { ...value, revision: initial.revision, enabled: initial.enabled, chatID: initial.chatID },
      runAfter,
    );
  }
  let nextRunLabel = preview
    ? `Next run: ${stamp(preview, timeZone)} · ${timeZone}`
    : "Checking schedule…";
  if (initial.id && !initial.enabled) nextRunLabel = "Inactive";
  return (
    <section className="mx-auto max-w-3xl [&_input]:scroll-mt-20 [&_textarea]:scroll-mt-20">
      {topbar &&
        createPortal(
          <>
            {initial.id && (
              <>
                <Link
                  href="#automations"
                  aria-label="Back to automations"
                  className="inline-flex size-8 shrink-0 items-center justify-center sm:hidden"
                >
                  <ChevronLeftIcon className="size-4" />
                </Link>
                <Link
                  href="#automations"
                  className="hidden text-base font-semibold text-foreground no-underline sm:inline"
                >
                  Automations
                </Link>
                <span className="hidden text-muted-foreground sm:inline" aria-hidden="true">
                  ›
                </span>
              </>
            )}
            <Heading
              level={1}
              ref={heading}
              tabIndex={-1}
              className="min-w-0 flex-1 truncate text-base"
            >
              {initial.id ? initial.name : "New automation"}
            </Heading>
            {initial.id ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || !preview}
                onClick={() => {
                  if (!dirty) runNow();
                  else if (form.current?.reportValidity() === true) submit(true);
                }}
              >
                {runLabel}
              </Button>
            ) : (
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={cancel}>
                Cancel
              </Button>
            )}
            <Button
              type="submit"
              form="automation-form"
              size="sm"
              disabled={busy || !preview || (initial.id !== "" && !dirty)}
              aria-label={pending === "save" ? "Saving…" : saveLabel}
            >
              <span className="hidden sm:inline">{pending === "save" ? "Saving…" : saveLabel}</span>
              <span className="sm:hidden">{pending === "save" ? "Saving…" : compactSaveLabel}</span>
            </Button>
          </>,
          topbar,
        )}
      <form
        ref={form}
        id="automation-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
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
            <span className="sr-only">Description</span>
            <Input
              value={value.description ?? ""}
              maxLength={2000}
              placeholder="Add a description (optional)"
              onChange={(event) => {
                change("description", event.target.value);
              }}
            />
          </FieldLabel>
          {initial.id && (
            <div className="flex items-center justify-between gap-3">
              <label className="flex w-fit items-center gap-2 text-sm">
                <Switch
                  disabled={busy}
                  checked={initial.enabled}
                  onCheckedChange={toggleActive}
                  aria-label="Active"
                />
                {initial.enabled ? "Active" : "Inactive"}
              </label>
            </div>
          )}
          <FieldLabel className="w-full flex-col items-start">
            Instructions
            <Textarea
              className="min-h-32 resize-none"
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
                  ? "Continue in the same chat."
                  : "Start a new chat each run."}
              </p>
              {initial.mode === "same" && value.mode === "same" && initial.chatID && (
                <Link className="col-span-2 text-sm" href={`#chats/${initial.chatID}`}>
                  Open chat
                </Link>
              )}
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
                  <TimeZonePicker
                    value={timeZone}
                    disabled={busy}
                    onChange={(zone) => {
                      change("timeZone", zone);
                    }}
                  />
                </div>
              </div>
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
                {previewError ? <p>{previewError}</p> : <p>{nextRunLabel}</p>}
              </div>
            </div>
          </div>
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
  const [pending, setPending] = useState<"save" | "run" | "active" | null>(null);
  const busy = pending !== null;
  const [error, setError] = useState("");
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
  async function action(kind: "save" | "run" | "active", task: () => Promise<void>) {
    setPending(kind);
    setError("");
    try {
      await task();
      await load();
    } catch (e) {
      setError(errorMessage(e, "Could not save this change."));
      if (isExpired(e)) onExpired();
    } finally {
      setPending(null);
    }
  }
  async function runAutomation(automationID: string, name: string) {
    setPending("run");
    manualID.current ??= crypto.randomUUID();
    const run = await request(automationRunSchema, `automations/${automationID}/run`, {
      method: "POST",
      body: { requestID: manualID.current },
    });
    manualID.current = null;
    if (run.status === "failed" || run.status === "skipped") {
      toast.error(run.status === "failed" ? "Run failed to start" : "Run skipped", {
        description: run.reason,
        duration: 5000,
      });
    } else {
      toast.success("Run started", {
        description: name,
        duration: 5000,
        action: run.chatID
          ? {
              label: "Open chat",
              onClick: () => {
                window.location.hash = `chats/${run.chatID}?run=${encodeURIComponent(run.messageID)}`;
              },
            }
          : undefined,
      });
    }
  }
  function save(value: Automation, runAfter = false) {
    void action("save", async () => {
      const saved = await request(
        automationSchema,
        value.id ? `automations/${value.id}` : "automations",
        { method: value.id ? "PUT" : "POST", body: value },
      );
      setDetail((current) => ({ automation: saved, runs: current?.runs ?? [] }));
      window.location.hash = `automations/${saved.id}`;
      if (runAfter) await runAutomation(saved.id, saved.name);
    });
  }
  const item = detail?.automation;
  const runs = detail?.runs ?? [];
  if (!isNew && id === "") return <AutomationList list={list} projects={projects} error={error} />;
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
      <Toaster
        position="bottom-right"
        closeButton
        toastOptions={{
          classNames: {
            toast: "florets-toast",
            success: "[&_[data-icon]]:text-emerald-600 dark:[&_[data-icon]]:text-emerald-400",
          },
        }}
      />
      {list === undefined && !error && <LoadingStatus />}
      {list !== undefined && (isNew || item !== undefined) && (
        <AutomationForm
          topbar={topbar}
          initial={item ?? blank(projects[0]?.id ?? "")}
          projects={projects}
          busy={busy}
          pending={pending}
          save={save}
          runNow={() => {
            if (item) void action("run", () => runAutomation(item.id, item.name));
          }}
          toggleActive={() => {
            if (item) {
              void action("active", async () => {
                const saved = await request(automationSchema, `automations/${item.id}`, {
                  method: "PUT",
                  body: { ...item, latestRun: undefined, enabled: !item.enabled },
                });
                setDetail((current) => ({ automation: saved, runs: current?.runs ?? [] }));
              });
            }
          }}
          cancel={() => {
            window.location.hash = "automations";
          }}
        />
      )}
      {list !== undefined && !isNew && id !== "" && item !== undefined && (
        <section className="mx-auto mt-10 max-w-3xl" aria-label="Run history">
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
    </>
  );
}
