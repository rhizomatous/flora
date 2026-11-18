import { useEffect, useEffectEvent, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import {
  Alert,
  Button,
  Card,
  Command,
  CommandInput,
  CommandEmpty,
  CommandList,
  CommandItem,
  Popover,
  PopoverTrigger,
  PopoverContent,
  MadlibPicker,
  MadlibSelect,
  FieldLabel,
  EditableText,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  Heading,
  Input,
  Link,
  LoadingStatus,
  NativeSelect,
  Textarea,
  Switch,
  SectionStack,
  Section,
  SectionHeader,
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
import { ModelControls } from "./model-controls";
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

function WeekdayPicker({
  days,
  disabled,
  onChange,
}: {
  days: number[];
  disabled: boolean;
  onChange: (days: number[]) => void;
}) {
  const selected = weekdays.filter((_, index) => days.includes(index));
  let summary = `${selected.length} days`;
  if (selected.length === 0) summary = "Choose days";
  else if (selected.length === 7) summary = "Every day";
  else if (selected.length === 1) summary = selected.join("");
  else if (selected.length === 2) summary = selected.map((day) => day.slice(0, 3)).join(", ");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <MadlibPicker
            prefix="on"
            disabled={disabled}
            aria-label="Days"
            aria-description={selected.join(", ") || "No days selected"}
            className="font-normal"
          >
            {summary}
          </MadlibPicker>
        }
      />
      <DropdownMenuContent className="min-w-40" aria-label="Days">
        {weekdays.map((day, index) => (
          <DropdownMenuCheckboxItem
            key={day}
            checked={days.includes(index)}
            closeOnClick={false}
            onCheckedChange={(checked) => {
              onChange(
                checked
                  ? [...days, index].toSorted((a, b) => a - b)
                  : days.filter((value) => value !== index),
              );
            }}
          >
            {day}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
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
          <MadlibPicker
            prefix="in"
            disabled={disabled}
            aria-label="Time zone"
            className="max-w-full min-w-0 justify-between font-normal"
          >
            {value}
          </MadlibPicker>
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
  const dirty =
    (
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
    ).some((key) => JSON.stringify(value[key]) !== JSON.stringify(initial[key])) ||
    JSON.stringify(value.execution ?? null) !== JSON.stringify(initial.execution ?? null);
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
  return (
    <section className="mx-auto w-full max-w-3xl min-w-0 [&_input]:scroll-mt-20 [&_textarea]:scroll-mt-20">
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
                  className="hidden text-base font-medium text-foreground no-underline sm:inline"
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
            {initial.mode === "same" && value.mode === "same" && initial.chatID && (
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                role="link"
                render={<a href={`#chats/${initial.chatID}`} aria-label="Open chat" />}
              >
                Open chat
              </Button>
            )}
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
        <fieldset disabled={busy}>
          <SectionStack>
            <Section className="gap-2">
              <div>
                <EditableText
                  label="Name"
                  variant="title"
                  value={value.name}
                  onChange={(event) => {
                    change("name", event.target.value);
                  }}
                  required
                  maxLength={200}
                  placeholder="Name this automation"
                />
                <EditableText
                  label="Description"
                  className="text-sm"
                  multiline
                  value={value.description ?? ""}
                  maxLength={2000}
                  placeholder="Add a description (optional)"
                  onChange={(event) => {
                    change("description", event.target.value);
                  }}
                />
              </div>
              {initial.id && (
                <div className="mx-px flex items-center justify-between gap-3 px-4">
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
            </Section>
            <Section>
              <SectionHeader className="mx-px px-4">
                <FieldLabel htmlFor="automation-instructions">Instructions</FieldLabel>
                <p id="instructions-help" className="text-sm text-muted-foreground">
                  What Flora should do each time this automation runs
                </p>
              </SectionHeader>
              <Card variant="flush">
                <Textarea
                  id="automation-instructions"
                  aria-describedby="instructions-help"
                  className="min-h-32 resize-none border-0 bg-transparent"
                  value={value.instructions}
                  onChange={(e) => {
                    change("instructions", e.target.value);
                  }}
                  required
                  placeholder="Check for outdated dependencies. Update safe minor versions, run tests, and open a draft PR if anything changes."
                />
                <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
                  <ModelControls
                    scope={
                      value.mode === "same" && initial.chatID
                        ? `chat:${initial.chatID}`
                        : "automation"
                    }
                    disabled={busy}
                    automation={{
                      value: value.execution ?? null,
                      inheritedLabel:
                        value.mode === "same" ? "Chat's current model" : "Default model",
                      onChange: (execution) => {
                        change("execution", execution);
                      },
                    }}
                  />
                </div>
              </Card>
            </Section>
            <Card variant="flush" className="divide-y">
              <div className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <FieldLabel htmlFor="automation-project">Project</FieldLabel>
                  <p id="project-help" className="text-sm text-muted-foreground">
                    The project this automation works in
                  </p>
                </div>
                <NativeSelect
                  id="automation-project"
                  aria-describedby="project-help"
                  className="max-w-[55%] shrink-0 [&_select]:field-sizing-content [&_select]:w-auto [&_select]:max-w-full"
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
              <div className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <FieldLabel htmlFor="automation-mode">Runs in</FieldLabel>
                  <p id="run-mode-help" className="text-sm text-muted-foreground">
                    {value.mode === "same"
                      ? "Continue in the same chat"
                      : "Start a new chat each run"}
                  </p>
                </div>
                <NativeSelect
                  id="automation-mode"
                  className="max-w-[55%] shrink-0 [&_select]:field-sizing-content [&_select]:w-auto [&_select]:max-w-full"
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
              </div>
            </Card>
            <Section aria-labelledby="schedule-heading">
              <SectionHeader className="mx-px px-4">
                <Heading level={3} id="schedule-heading" className="text-sm">
                  Schedule
                </Heading>
                <p id="schedule-help" className="text-sm text-muted-foreground">
                  When to run, in the selected time zone
                </p>
              </SectionHeader>
              <Card variant="flush" className="gap-3 p-4">
                <div
                  role="group"
                  aria-label="Run schedule"
                  aria-describedby="schedule-help"
                  className="flex flex-wrap items-center gap-2"
                >
                  <MadlibSelect
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
                  </MadlibSelect>
                  {frequency === "weekly" && (
                    <WeekdayPicker
                      days={days ?? []}
                      disabled={busy}
                      onChange={(selected) => {
                        change("days", selected);
                      }}
                    />
                  )}
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground" aria-hidden="true">
                      at
                    </span>
                    <Input
                      className="field-sizing-content h-7 w-auto text-sm [&::-webkit-calendar-picker-indicator]:ml-1 [&::-webkit-calendar-picker-indicator]:p-0 [&::-webkit-datetime-edit]:p-0 [&::-webkit-datetime-edit-fields-wrapper]:p-0"
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
                    <TimeZonePicker
                      value={timeZone}
                      disabled={busy}
                      onChange={(zone) => {
                        change("timeZone", zone);
                      }}
                    />
                  </div>
                </div>
                {previewError && (
                  <p className="text-xs text-muted-foreground" role="alert">
                    {previewError}
                  </p>
                )}
              </Card>
            </Section>
          </SectionStack>
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
      <SectionStack className="mx-auto w-full max-w-3xl">
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
          <Section aria-label="Run history">
            <SectionHeader className="mx-px px-4">
              <Heading level={2}>Run history</Heading>
              <p className="text-sm text-muted-foreground">Recent runs and their results</p>
            </SectionHeader>
            {runs.length === 0 ? (
              <p className="mx-px px-4 text-sm text-muted-foreground">
                No runs yet. Wait for the schedule or choose Run now.
              </p>
            ) : (
              <ol className="divide-y rounded-lg border bg-surface-panel px-4">
                {runs.map((run) => (
                  <li key={run.id} className="py-4">
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="text-sm">{stamp(run.scheduledAt, item.timeZone)}</span>
                      <span className="text-sm capitalize">{run.status}</span>
                    </div>
                    {run.reason && (
                      <p className="mt-2 text-sm text-muted-foreground">{run.reason}</p>
                    )}
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
          </Section>
        )}
      </SectionStack>
    </>
  );
}
