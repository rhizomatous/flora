import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";

import {
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
    if (!open) return;
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
  }, [open, refresh]);
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
  const durationLabels: Record<number, string> = {
    1800: "30 minutes",
    3600: "1 hour",
    14_400: "4 hours",
  };
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <DropdownButton
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
        className="w-80! max-w-[calc(100vw-24px)] p-1.5 text-[13px]"
      >
        <div className="px-2 py-2 leading-5" aria-live="polite">
          <div className="flex items-center justify-between gap-3 font-medium">
            <span>Cloud machine</span>
            <span className="text-muted-foreground">{stateLabel}</span>
          </div>
          {runtime && (
            <>
              <p className="mt-1 text-xs text-muted-foreground">Configured container limits</p>
              <p>
                {cpuLabel} · {memoryLabel}
              </p>
              <p className="text-muted-foreground">Disk: no configured quota</p>
              <div className="mt-2 border-t border-border pt-2">
                <p className="text-xs text-muted-foreground">
                  Measured container usage{sample ? ` · ${age(sample.sampledAt)}` : ""}
                </p>
                {sample ? (
                  <dl className="mt-1 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
                    <dt>CPU time (cumulative)</dt>
                    <dd className="tabular-nums">{sample.cpuSeconds.toFixed(1)} s</dd>
                    <dt>Memory (cgroup)</dt>
                    <dd>{bytes(sample.memoryBytes)}</dd>
                    <dt>Disk (writable layer)</dt>
                    <dd>{sample.diskBytes === null ? "Unavailable" : bytes(sample.diskBytes)}</dd>
                  </dl>
                ) : (
                  <p className="text-muted-foreground">
                    {running ? "Usage unavailable" : "No live usage sample"}
                  </p>
                )}
                {sample && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Disk excludes workspace and runtime mounts.
                  </p>
                )}
                <p className="mt-1 text-xs text-muted-foreground" title={runtime.observedAt}>
                  State inspected {age(runtime.observedAt)}
                </p>
              </div>
              {until !== null && until !== undefined && (
                <p className="mt-2 flex gap-1.5 text-muted-foreground">
                  <ClockIcon className="mt-0.5 size-4 shrink-0" />
                  {lease
                    ? `Keeping awake until ${new Date(until).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
                    : "Keep-awake ended; stops when idle"}
                </p>
              )}
              {runtime.collectionError && (
                <p className="mt-2 text-destructive">{runtime.collectionError}</p>
              )}
              {state === "missing" && (
                <p className="mt-2 text-muted-foreground">
                  The saved container is missing. Restore it to wake this workspace.
                </p>
              )}
            </>
          )}
          {displayedError && (
            <p role="alert" className="mt-2 text-destructive">
              {displayedError}
            </p>
          )}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={disabled || !!pending || !state || !["stopped", "failed"].includes(state)}
          onClick={() => {
            void act("wake");
          }}
          closeOnClick={false}
        >
          <PlayIcon />
          {pending === "wake" ? "Waking machine…" : "Wake machine"}
        </DropdownMenuItem>
        {running && (
          <>
            {[1800, 3600, 14_400].map((seconds) => (
              <DropdownMenuItem
                key={seconds}
                disabled={disabled || !!pending}
                closeOnClick={false}
                onClick={() => {
                  void act("keep-awake", seconds);
                }}
              >
                <ClockIcon />
                Keep awake {durationLabels[seconds]}
              </DropdownMenuItem>
            ))}
            {lease && (
              <DropdownMenuItem
                disabled={disabled || !!pending}
                closeOnClick={false}
                onClick={() => {
                  void act("keep-awake", 0);
                }}
              >
                <ClockIcon />
                Cancel keep-awake
              </DropdownMenuItem>
            )}
          </>
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
            {pending === "wake" ? "Cancel wake and stop" : "Stop container"}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          disabled={!!pending}
          closeOnClick={false}
          onClick={() => {
            setError("");
            void refresh();
          }}
        >
          Refresh machine state
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
