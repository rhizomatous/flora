import { useEffect, useRef, useState } from "react";
import { z } from "zod";

import {
  Button,
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverTitle,
  Progress,
  Input,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogFooter,
  FieldLabel,
} from "@flora/florets";

import type { ContextUsage } from "./chat-schemas";
import { useModelChoice } from "./model-choice";
import { errorMessage, request } from "./request";

const tokens = (value: number) =>
  value.toLocaleString(undefined, { notation: "compact", maximumFractionDigits: 1 });

const compactionSchema = z.object({
  provider: z.string(),
  model: z.string(),
  threshold: z.number().int().positive().nullable(),
  default: z.number().int().positive().nullable(),
  maximum: z.number().int().positive().nullable(),
  reason: z.string(),
});

export function ContextUsagePopover({
  id,
  usage,
}: {
  id: string;
  usage: ContextUsage | undefined;
}) {
  const [open, setOpen] = useState(false);
  const { selected } = useModelChoice(`chat:${id}`);
  const [settings, setSettings] = useState<z.infer<typeof compactionSchema>>();
  const [draft, setDraft] = useState<{
    key: string;
    value: string;
    dirty: boolean;
    reset: boolean;
  }>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false);
  const path = `chats/${encodeURIComponent(id)}/compaction`;
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError("");
      try {
        const value = await request(compactionSchema, path, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setSettings(value);
        const key = `${id}/${value.provider}/${value.model}`;
        setDraft((current) =>
          current?.key === key && current.dirty
            ? current
            : {
                key,
                value: (value.threshold ?? value.default)?.toLocaleString() ?? "",
                dirty: false,
                reset: value.threshold === null,
              },
        );
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(errorMessage(cause, "Could not load compaction settings."));
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => {
      controller.abort();
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Refresh limits when the next-message model changes or the user retries.
  }, [open, path, id, selected?.provider, selected?.model, attempt]);
  const threshold = Number((draft?.value ?? "").replaceAll(",", ""));
  const invalid =
    draft?.dirty === true &&
    !draft.reset &&
    (!Number.isSafeInteger(threshold) || threshold < 1 || threshold > (settings?.maximum ?? 0));
  function closeDialog() {
    if (savingRef.current) return;
    setDialogOpen(false);
    setError("");
    if (settings && draft) {
      setDraft({
        key: draft.key,
        value: (settings.threshold ?? settings.default)?.toLocaleString() ?? "",
        dirty: false,
        reset: settings.threshold === null,
      });
    }
  }
  async function save() {
    if (!settings || !draft || !draft.dirty || invalid || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const result = await request(compactionSchema, path, {
        method: "PATCH",
        body: {
          provider: settings.provider,
          model: settings.model,
          threshold: draft.reset ? null : threshold,
        },
      });
      setSettings(result);
      setDraft({
        key: draft.key,
        value: (result.threshold ?? result.default)?.toLocaleString() ?? "",
        dirty: false,
        reset: result.threshold === null,
      });
      setDialogOpen(false);
    } catch (cause) {
      setError(errorMessage(cause, "Could not save compaction settings."));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }
  const currentThreshold = settings ? (settings.threshold ?? settings.default) : undefined;
  const used = usage?.tokens ?? null;
  const limit = usage?.limit ?? null;
  const percentage = used !== null && limit !== null ? Math.round((used / limit) * 100) : null;
  const fill = percentage === null ? 0 : Math.min(100, percentage);
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              ref={triggerRef}
              variant="ghost"
              size="icon-sm"
              className="composer-context ml-auto size-7!"
              aria-label="Context usage"
              title={percentage === null ? "Context usage" : `Context usage: ${percentage}%`}
            >
              <svg className="size-3.5" viewBox="0 0 20 20" aria-hidden="true">
                <circle
                  cx="10"
                  cy="10"
                  r="8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="text-border"
                />
                <circle
                  cx="10"
                  cy="10"
                  r="8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  pathLength="100"
                  strokeDasharray={`${fill} 100`}
                  transform="rotate(-90 10 10)"
                />
              </svg>
            </Button>
          }
        />
        <PopoverContent
          side="top"
          align="end"
          className="max-h-[calc(100dvh-32px)] w-[min(24rem,calc(100vw-24px))]! max-w-[calc(100vw-24px)]! gap-4 overflow-y-auto p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <PopoverTitle className="text-base font-medium">Context</PopoverTitle>
            <span
              className="text-sm text-muted-foreground tabular-nums"
              title={
                used === null
                  ? undefined
                  : `${used.toLocaleString()} / ${limit?.toLocaleString() ?? "Unknown"} tokens · ${usage?.provider}/${usage?.model}`
              }
            >
              {used === null
                ? "No usage yet"
                : `${tokens(used)} / ${limit === null ? "—" : tokens(limit)}${percentage === null ? "" : ` (${percentage}%)`}`}
            </span>
          </div>
          {percentage !== null && (
            <Progress
              value={fill}
              aria-label="Context window used"
              aria-valuetext={`${percentage}% of ${limit?.toLocaleString()} tokens`}
              className="h-1.5 [&_[data-slot=progress-indicator]]:bg-foreground"
            />
          )}
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 text-sm transition-colors outline-none hover:bg-control-hover focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:hover:bg-transparent"
            aria-label="Compact at"
            disabled={
              loading || !settings || (settings.maximum === null && settings.threshold === null)
            }
            title={
              settings?.maximum === null
                ? "Custom compaction unavailable for this model"
                : undefined
            }
            onClick={() => {
              setOpen(false);
              setDialogOpen(true);
              setError("");
            }}
          >
            <span>Compact at</span>
            <span className="tabular-nums">
              {loading ? (
                "…"
              ) : (
                <>
                  <span className="font-medium">
                    {typeof currentThreshold === "number" ? tokens(currentThreshold) : "Unknown"}
                  </span>
                  {settings?.maximum !== null && settings?.maximum !== undefined && (
                    <span className="text-muted-foreground"> / {tokens(settings.maximum)}</span>
                  )}
                </>
              )}
            </span>
          </button>
          {error && !dialogOpen && (
            <div className="flex items-start justify-between gap-3">
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setAttempt((value) => value + 1);
                }}
              >
                Retry
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>
      <Dialog
        open={dialogOpen}
        onOpenChange={(next) => {
          if (!next) closeDialog();
        }}
      >
        <DialogContent
          className="gap-6 p-6 sm:max-w-md"
          initialFocus={inputRef}
          finalFocus={triggerRef}
          aria-describedby={undefined}
        >
          <DialogTitle>Compact at</DialogTitle>
          <form
            className="flex flex-col gap-6"
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void save();
            }}
          >
            <div className="flex flex-col gap-2">
              <FieldLabel htmlFor={`compact-tokens-${id}`}>Tokens</FieldLabel>
              <Input
                ref={inputRef}
                id={`compact-tokens-${id}`}
                inputMode="numeric"
                value={draft?.value ?? ""}
                disabled={saving || settings?.maximum === null}
                aria-invalid={invalid}
                aria-describedby={invalid || error ? `compact-error-${id}` : undefined}
                onChange={(event) => {
                  if (draft) {
                    setDraft({ ...draft, value: event.target.value, reset: false, dirty: true });
                  }
                  setError("");
                }}
              />
              {(invalid || error) && (
                <p id={`compact-error-${id}`} role="alert" className="text-sm text-destructive">
                  {invalid ? `Enter 1 to ${settings?.maximum?.toLocaleString()} tokens.` : error}
                </p>
              )}
            </div>
            <DialogFooter className="m-0 flex-row flex-wrap items-center justify-end gap-2 border-0 bg-transparent p-0">
              <Button
                type="button"
                variant="ghost"
                className="mr-auto"
                disabled={saving || draft?.reset !== false}
                onClick={() => {
                  if (draft && settings) {
                    setDraft({
                      ...draft,
                      value: settings.default?.toLocaleString() ?? "",
                      reset: true,
                      dirty: true,
                    });
                    setError("");
                  }
                }}
              >
                Reset to default
              </Button>
              <Button type="button" variant="ghost" disabled={saving} onClick={closeDialog}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving || draft?.dirty !== true || invalid}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
