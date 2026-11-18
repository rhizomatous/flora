import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";

import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  NativeSelect,
  NativeSelectOption,
  ListIcon,
  DropdownButton,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  CloudIcon,
  PlayIcon,
  SquareIcon,
  ClockIcon,
} from "@flora/florets";

import { chatSchema } from "./chat-schemas";
import { request, errorMessage } from "./request";

const runtimeSchema = z.object({
  state: z.enum(["stopped", "starting", "running", "failed", "missing", "unknown"]),
  observedAt: z.string(),
  cpuLimit: z.number().nullable(),
  memoryLimit: z.number().nullable(),
  usage: z
    .object({
      sampledAt: z.string(),
      cpuSeconds: z.number(),
      memoryBytes: z.number(),
      diskBytes: z.number().nullable(),
    })
    .nullable(),
  collectionError: z.string(),
  keepAwakeUntil: z.string().nullable(),
});
type Runtime = z.infer<typeof runtimeSchema>;
const labels = {
  stopped: "Stopped",
  starting: "Starting",
  running: "Running",
  failed: "Failed",
  missing: "Missing",
  unknown: "Unknown",
};
const bytes = (value: number) =>
  `${(value / 2 ** 30).toLocaleString(undefined, { maximumFractionDigits: 2 })} GiB`;

/** Keeps Docker observations separate from the saved conversation's status. */
export function RuntimeMenu({
  id,
  onStop,
  disabled,
}: {
  id: string;
  onStop: () => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [duration, setDuration] = useState(14_400);
  const trigger = useRef<HTMLButtonElement>(null);
  const [runtime, setRuntime] = useState<Runtime>();
  const [error, setError] = useState("");
  const [refreshError, setRefreshError] = useState("");
  const actionRevision = useRef(0);
  const [pending, setPending] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const path = `chats/${encodeURIComponent(id)}`;
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const value = await request(runtimeSchema, `${path}/runtime`, signal ? { signal } : {});
        setRuntime(value);
        setRefreshError("");
        setNow(Date.now());
      } catch (e) {
        if (signal?.aborted !== true) {
          setRuntime(undefined);
          setRefreshError(errorMessage(e, "Could not refresh machine state."));
        }
      }
    },
    [path],
  );
  useEffect(() => {
    if (!open && !detailsOpen) return;
    const controller = new AbortController();
    const initial = setTimeout(() => {
      void refresh(controller.signal);
    }, 0);
    const timer = setInterval(() => {
      setNow(Date.now());
      void refresh(controller.signal);
    }, 5000);
    return () => {
      clearTimeout(initial);
      controller.abort();
      clearInterval(timer);
    };
  }, [open, detailsOpen, refresh]);
  async function act(action: "wake" | "keep-awake" | "stop", seconds?: number) {
    const revision = ++actionRevision.current;
    setError("");
    setPending(action);
    try {
      await (action === "keep-awake"
        ? request(z.object({ ok: z.boolean() }), `${path}/${action}`, {
            method: "POST",
            body: { seconds },
          })
        : request(chatSchema, `${path}/${action}`, { method: "POST", body: {} }));
    } catch (e) {
      if (revision === actionRevision.current) setError(errorMessage(e, "Machine action failed."));
    } finally {
      if (revision === actionRevision.current) {
        setPending("");
        await refresh();
      }
    }
  }
  const state = runtime?.state;
  const running = state === "running";
  const until = runtime?.keepAwakeUntil;
  const lease = until !== null && until !== undefined && new Date(until).getTime() > now;
  const sample = runtime?.usage;
  const age = (date: string) =>
    `${Math.max(0, Math.floor((now - new Date(date).getTime()) / 1000))}s ago`;
  const displayedError = error || refreshError;
  let stateLabel = displayedError ? "Unknown" : "Loading…";
  if (runtime) stateLabel = labels[runtime.state];
  if (pending === "wake") stateLabel = "Starting";
  let cpuLabel = "CPU unavailable";
  if (runtime?.cpuLimit !== null && runtime?.cpuLimit !== undefined) {
    cpuLabel = runtime.cpuLimit === 0 ? "CPU uncapped" : `${runtime.cpuLimit} vCPU`;
  }
  let memoryLabel = "Memory unavailable";
  if (runtime?.memoryLimit !== null && runtime?.memoryLimit !== undefined) {
    memoryLabel =
      runtime.memoryLimit === 0 ? "Memory uncapped" : `${bytes(runtime.memoryLimit)} memory`;
  }
  const deadline =
    until !== null && until !== undefined
      ? new Date(until).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
      : "";
  let summaryLabel = "Checking machine state…";
  if (runtime) summaryLabel = `Limits · ${cpuLabel} · ${memoryLabel.replace(" memory", "")}`;
  else if (displayedError) summaryLabel = "Machine state unavailable";
  function showDetails() {
    setOpen(false);
    setDetailsOpen(true);
  }
  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          render={
            <DropdownButton
              ref={trigger}
              variant="tertiary"
              size="compact"
              className="composer-up [&_[data-slot=dropdown-chevron]]:rotate-180"
              aria-label="Chat actions"
            >
              <CloudIcon />
              <span className="florets-control-label">Cloud</span>
              <span
                className={`size-[5px] rounded-full ${running ? "bg-green-500" : "bg-muted-foreground"}`}
              />
            </DropdownButton>
          }
        />
        <DropdownMenuContent
          side="top"
          align="start"
          className="w-72! max-w-[calc(100vw-24px)] p-1.5 text-[13px]"
        >
          <div className="px-1.5 pt-1 pb-1.5 leading-5" aria-live="polite">
            <div className="flex items-center justify-between gap-3">
              <span>Cloud machine</span>
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span
                  className={`size-[5px] rounded-full ${running ? "bg-green-500" : "bg-muted-foreground"}`}
                />
                {stateLabel}
              </span>
            </div>
            <p className="text-muted-foreground">{summaryLabel}</p>
            {state === "missing" && (
              <p className="mt-1 text-muted-foreground">Restore the saved machine to wake it.</p>
            )}
            {error && (
              <p role="alert" className="mt-1 text-destructive">
                {error}
              </p>
            )}
          </div>
          {(state === "stopped" || state === "failed") && pending !== "wake" && (
            <DropdownMenuItem
              disabled={disabled || !!pending}
              closeOnClick={false}
              onClick={() => {
                void act("wake");
              }}
            >
              <PlayIcon />
              Wake machine
            </DropdownMenuItem>
          )}
          {(running || state === "starting" || state === "unknown" || pending === "wake") && (
            <DropdownMenuItem
              disabled={disabled || (pending !== "" && pending !== "wake")}
              closeOnClick={false}
              onClick={() => {
                if (pending === "wake") void act("stop");
                else onStop();
              }}
            >
              <SquareIcon />
              {pending === "wake" ? "Cancel wake and stop" : "Stop machine"}
            </DropdownMenuItem>
          )}
          {running && pending !== "wake" && (
            <DropdownMenuItem
              disabled={disabled || !!pending}
              closeOnClick={false}
              onClick={() => {
                if (lease) showDetails();
                else void act("keep-awake", 14_400);
              }}
            >
              <ClockIcon />
              {lease ? `Keep awake until ${deadline}` : "Keep awake 4h"}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={showDetails}>
            <ListIcon />
            Machine details…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent finalFocus={trigger} className="max-h-[calc(100dvh-32px)] overflow-y-auto">
          <DialogTitle>Machine details</DialogTitle>
          <DialogDescription className="sr-only">
            Machine state, resource limits, and measured usage.
          </DialogDescription>
          <div className="flex items-center justify-between gap-3">
            <span>Cloud machine</span>
            <span className="text-muted-foreground">{stateLabel}</span>
          </div>
          {runtime && (
            <>
              <section className="space-y-1" aria-label="Configured limits">
                <h3 className="font-medium">Configured limits</h3>
                <p className="text-muted-foreground">
                  {cpuLabel} · {memoryLabel}
                </p>
                <p className="text-muted-foreground">Disk: no configured quota</p>
              </section>
              <section
                className="space-y-2 border-t border-border pt-3"
                aria-label="Measured usage"
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-medium">Measured usage</h3>
                  {sample && (
                    <span className="text-xs text-muted-foreground" title={sample.sampledAt}>
                      {age(sample.sampledAt)}
                    </span>
                  )}
                </div>
                {sample ? (
                  <>
                    <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
                      <dt>CPU time (cumulative)</dt>
                      <dd className="tabular-nums">{sample.cpuSeconds.toFixed(1)} s</dd>
                      <dt>Memory (cgroup)</dt>
                      <dd>{bytes(sample.memoryBytes)}</dd>
                      <dt>Disk (writable layer)</dt>
                      <dd>{sample.diskBytes === null ? "Unavailable" : bytes(sample.diskBytes)}</dd>
                    </dl>
                    <p className="text-xs text-muted-foreground">
                      Disk excludes workspace and runtime mounts.
                    </p>
                  </>
                ) : (
                  <p className="text-muted-foreground">
                    {running ? "Usage unavailable" : "No live usage sample"}
                  </p>
                )}
                {runtime.collectionError && (
                  <p className="text-destructive">{runtime.collectionError}</p>
                )}
                {state === "missing" && (
                  <p className="text-muted-foreground">
                    The saved machine is missing. Restore it to wake this workspace.
                  </p>
                )}
              </section>
              {(running || until !== null) && (
                <section className="space-y-2 border-t border-border pt-3" aria-label="Keep awake">
                  <h3 className="font-medium">Keep awake</h3>
                  {until !== null && (
                    <p className="text-muted-foreground">
                      {lease ? `Until ${deadline}` : "Ended; machine stops when idle"}
                    </p>
                  )}
                  {running && (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <NativeSelect
                          aria-label="Keep-awake duration"
                          value={duration}
                          disabled={disabled || !!pending}
                          onChange={(event) => {
                            setDuration(Number(event.target.value));
                          }}
                        >
                          <NativeSelectOption value={1800}>30 minutes</NativeSelectOption>
                          <NativeSelectOption value={3600}>1 hour</NativeSelectOption>
                          <NativeSelectOption value={14_400}>4 hours</NativeSelectOption>
                        </NativeSelect>
                        <Button
                          size="sm"
                          disabled={disabled || !!pending}
                          onClick={() => {
                            void act("keep-awake", duration);
                          }}
                        >
                          {lease ? "Update" : "Keep awake"}
                        </Button>
                      </div>
                      {lease && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={disabled || !!pending}
                          onClick={() => {
                            void act("keep-awake", 0);
                          }}
                        >
                          Cancel keep-awake
                        </Button>
                      )}
                    </>
                  )}
                </section>
              )}
            </>
          )}
          {displayedError && (
            <p role="alert" className="text-destructive">
              {displayedError}
            </p>
          )}
          <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
            <span className="text-xs text-muted-foreground" title={runtime?.observedAt}>
              {runtime ? `State inspected ${age(runtime.observedAt)}` : "State unavailable"}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={!!pending}
              onClick={() => {
                setError("");
                void refresh();
              }}
            >
              Refresh
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
