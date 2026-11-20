import { useState } from "react";

import {
  DropdownButton,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  CloudIcon,
  PlayIcon,
  SquareIcon,
  ClockIcon,
} from "@flora/florets";

import { useRuntime, type Runtime } from "./runtime-state";

const labels = {
  stopped: "Asleep",
  starting: "Starting",
  running: "Awake",
  failed: "Failed",
  missing: "Missing",
  unknown: "Unknown",
};
const bytes = (value: number) =>
  `${(value / 2 ** 30).toLocaleString(undefined, { maximumFractionDigits: 2 })} GiB`;

function stateLabel(runtime: Runtime | undefined, pending: string, error: string) {
  if (pending === "wake") return "Starting";
  if (runtime) return labels[runtime.state];
  return error ? "Unknown" : "Loading…";
}

/** Reads machine state separately from the saved conversation's status. */
export function RuntimeMenu({
  id,
  onStop,
  disabled,
  status = false,
  active = false,
}: {
  id: string;
  onStop?: () => void;
  status?: boolean;
  active?: boolean;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { runtime, pending, error, now, act } = useRuntime(id, open || active);
  const state = runtime?.state;
  const running = state === "running";
  const sample = runtime?.usage;
  const age = (at: string) =>
    `${Math.max(0, Math.floor((now - new Date(at).getTime()) / 1000))}s ago`;
  let summary = "Checking machine state…";
  if (runtime) {
    let cpu = "CPU unavailable";
    if (runtime.cpuLimit !== null) {
      cpu = runtime.cpuLimit === 0 ? "CPU uncapped" : `${runtime.cpuLimit} vCPU`;
    }
    let memory = "Memory unavailable";
    if (runtime.memoryLimit !== null) {
      memory =
        runtime.memoryLimit === 0 ? "Memory uncapped" : `${bytes(runtime.memoryLimit)} memory`;
    }
    summary = `Limits · ${cpu} · ${memory}`;
  } else if (error) summary = "Machine state unavailable";
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <DropdownButton
            variant="tertiary"
            size="compact"
            className="composer-up [&_[data-slot=dropdown-chevron]]:rotate-180"
            aria-label={status ? "Workspace machine" : "Chat actions"}
          >
            {!status && <CloudIcon />}
            {!status && <span className="florets-control-label">Cloud</span>}
            <span
              className={`size-[5px] rounded-full ${running ? "bg-green-500" : "bg-muted-foreground"}`}
            />
            {status && <span>{stateLabel(runtime, pending, error)}</span>}
          </DropdownButton>
        }
      />
      <DropdownMenuContent
        side="top"
        align="start"
        className="w-80! max-w-[calc(100vw-24px)] p-1.5 text-[13px]"
      >
        <div className="px-1.5 pt-1 pb-1.5 leading-5" aria-live="polite">
          <div className="flex items-center justify-between gap-3">
            <span>Cloud machine</span>
            <span
              className="flex items-center gap-1.5 text-muted-foreground"
              title={
                runtime
                  ? `State inspected ${age(runtime.observedAt)} (${runtime.observedAt})`
                  : undefined
              }
            >
              <span
                className={`size-[5px] rounded-full ${running ? "bg-green-500" : "bg-muted-foreground"}`}
              />
              {stateLabel(runtime, pending, error)}
            </span>
          </div>
          <p className="text-muted-foreground">{summary}</p>
          {sample && (
            <p
              className="mt-1 text-xs text-muted-foreground"
              title={`Sampled ${sample.sampledAt}. CPU time is cumulative. Disk is the writable layer, excluding workspace and runtime mounts.`}
            >
              Used · CPU time {sample.cpuSeconds.toFixed(1)} s · Memory {bytes(sample.memoryBytes)}{" "}
              · Disk layer {sample.diskBytes === null ? "unavailable" : bytes(sample.diskBytes)} ·{" "}
              {age(sample.sampledAt)}
            </p>
          )}
          {running && !sample && (
            <p className="text-xs text-muted-foreground" title={runtime?.collectionError}>
              Usage unavailable
            </p>
          )}
          {state === "missing" && (
            <p className="mt-1 text-muted-foreground">Restore the saved machine to wake it.</p>
          )}
          {state === "unknown" && runtime && runtime.collectionError !== "" && (
            <p className="mt-1 text-muted-foreground">{runtime.collectionError}</p>
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
        {(state === "starting" || state === "unknown" || pending === "wake") && (
          <DropdownMenuItem
            disabled={disabled || (pending !== "" && pending !== "wake")}
            closeOnClick={false}
            onClick={() => {
              if (pending === "wake") void act("stop");
              else if (onStop) onStop();
              else void act("stop");
            }}
          >
            <SquareIcon />
            {pending === "wake" ? "Cancel wake and stop" : "Stop machine"}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Each label names the lease action; the expiry is reported as machine status. */
export function KeepAwakeItem({ id, open }: { id: string; open: boolean }) {
  const { runtime, pending, error, now, act } = useRuntime(id, open);
  const until = runtime?.keepAwakeUntil;
  const active = until !== undefined && until !== null && new Date(until).getTime() > now;
  let status = stateLabel(runtime, pending, error);
  if (runtime?.state === "running") {
    status = active
      ? `Awake until ${new Date(until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
      : "Awake";
  }
  if (runtime?.state === "stopped") status = "Asleep";
  return (
    <>
      <DropdownMenuItem
        disabled={!!pending || (!active && runtime?.state !== "running")}
        closeOnClick={false}
        onClick={() => {
          void act("keep-awake", active ? 0 : 14_400);
        }}
      >
        <ClockIcon />
        <span className="shrink-0">{active ? "Cancel keep-awake" : "Keep awake 4h"}</span>
        <span className="ml-auto flex items-center gap-1.5 whitespace-nowrap text-muted-foreground">
          <span
            className={`size-[5px] rounded-full ${runtime?.state === "running" ? "bg-green-500" : "bg-muted-foreground"}`}
          />
          {status}
        </span>
      </DropdownMenuItem>
      {error && (
        <p role="alert" className="px-1.5 py-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </>
  );
}

/** Explicit stop remains available independently of the machine summary. */
export function StopMachineItem({ id }: { id: string }) {
  const { pending, error, act } = useRuntime(id, false);
  return (
    <>
      <DropdownMenuItem
        disabled={!!pending}
        closeOnClick={false}
        onClick={() => {
          void act("stop");
        }}
      >
        <SquareIcon />
        {pending ? "Stopping machine…" : "Stop machine"}
      </DropdownMenuItem>
      {error && (
        <p role="alert" className="px-1.5 py-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </>
  );
}
