import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import {
  Button,
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverTitle,
  PopoverDescription,
  Progress,
  Input,
  NativeSelect,
  SettingsGroup,
  SettingsRow,
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
    custom: boolean;
    value: string;
    dirty: boolean;
  }>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
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
                custom: value.threshold !== null,
                value: String(value.threshold ?? value.default ?? ""),
                dirty: false,
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
  const threshold = draft?.custom === true ? Number(draft.value) : null;
  const invalid =
    draft?.custom === true &&
    (!Number.isSafeInteger(threshold) ||
      threshold === null ||
      threshold < 1 ||
      settings?.maximum === null ||
      threshold > (settings?.maximum ?? 0));
  async function save() {
    if (!settings || !draft || invalid || saving) return;
    setSaving(true);
    setError("");
    try {
      const value = await request(compactionSchema, path, {
        method: "PATCH",
        body: {
          provider: settings.provider,
          model: settings.model,
          threshold,
        },
      });
      setSettings(value);
      setDraft({ ...draft, dirty: false });
      toast.success("Compaction setting saved. Applies to the next message.", {
        toasterId: "chat-organization",
      });
    } catch (cause) {
      setError(errorMessage(cause, "Could not save compaction settings."));
    } finally {
      setSaving(false);
    }
  }
  const used = usage?.tokens ?? null;
  const limit = usage?.limit ?? null;
  const percentage = used !== null && limit !== null ? Math.round((used / limit) * 100) : null;
  const fill = percentage === null ? 0 : Math.min(100, percentage);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
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
        className="max-h-[min(560px,calc(100dvh-32px))] w-[min(24rem,calc(100vw-24px))]! max-w-[calc(100vw-24px)]! overflow-y-auto"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <PopoverTitle className="text-base font-semibold">Context</PopoverTitle>
          <span
            className="text-sm text-muted-foreground tabular-nums"
            title={
              used === null
                ? undefined
                : `${used.toLocaleString()} / ${limit?.toLocaleString() ?? "—"} tokens`
            }
          >
            {used === null
              ? "—"
              : `${tokens(used)} / ${limit === null ? "—" : tokens(limit)}${percentage === null ? "" : ` (${percentage}%)`}`}
          </span>
        </div>
        {percentage !== null && (
          <Progress
            value={fill}
            aria-label="Context window used"
            aria-valuetext={`${percentage}% of ${limit?.toLocaleString()} tokens`}
            className="my-1 [&_[data-slot=progress-indicator]]:bg-foreground"
          />
        )}
        {settings &&
          usage &&
          usage.model !== "" &&
          (usage.model !== settings.model || usage.provider !== settings.provider) && (
            <PopoverDescription className="text-xs break-all">
              Usage from {usage.provider}/{usage.model}
            </PopoverDescription>
          )}
        {used === null && (
          <PopoverDescription className="text-xs">No context usage yet.</PopoverDescription>
        )}
        {used !== null && limit === null && (
          <PopoverDescription>
            The runtime has not reported a context limit for this model.
          </PopoverDescription>
        )}
        <div className="mt-2 border-t pt-3">
          {loading ? (
            <p role="status" className="text-sm text-muted-foreground">
              Loading compaction settings…
            </p>
          ) : (
            settings &&
            draft && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void save();
                }}
                className="flex flex-col gap-3"
              >
                <p
                  className="truncate text-xs text-muted-foreground"
                  title={`${settings.provider}/${settings.model}`}
                >
                  {settings.provider}/{settings.model}
                </p>
                {Number.isSafeInteger(settings.maximum) ? (
                  <>
                    <SettingsGroup>
                      <SettingsRow label="Compact at" htmlFor={`compact-mode-${id}`}>
                        <NativeSelect
                          id={`compact-mode-${id}`}
                          width="content"
                          value={draft.custom ? "custom" : "default"}
                          disabled={saving}
                          onChange={(event) => {
                            setDraft({
                              ...draft,
                              custom: event.target.value === "custom",
                              dirty: true,
                            });
                          }}
                        >
                          <option value="default">Runtime default</option>
                          <option value="custom">Custom</option>
                        </NativeSelect>
                      </SettingsRow>
                      {draft.custom && (
                        <SettingsRow label="Tokens" htmlFor={`compact-tokens-${id}`}>
                          <Input
                            id={`compact-tokens-${id}`}
                            className="w-28"
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={settings.maximum ?? undefined}
                            step={1}
                            value={draft.value}
                            disabled={saving}
                            aria-invalid={invalid}
                            aria-describedby={`compact-help-${id}`}
                            onChange={(event) => {
                              setDraft({ ...draft, value: event.target.value, dirty: true });
                            }}
                          />
                        </SettingsRow>
                      )}
                    </SettingsGroup>
                    <p id={`compact-help-${id}`} className="text-sm text-muted-foreground">
                      {draft.custom
                        ? `Choose 1 to ${settings.maximum?.toLocaleString()} tokens`
                        : `Compacts at ${settings.default?.toLocaleString()} tokens`}
                      . Saved for this model. Applies from the next message. Subagents share the
                      token reserve.
                    </p>
                  </>
                ) : (
                  <>
                    <div className="flex flex-wrap justify-between gap-2 text-sm">
                      <span>Compact at</span>
                      <span className="text-muted-foreground">
                        {settings.default === null
                          ? "Unknown"
                          : `${settings.default.toLocaleString()} tokens`}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">{settings.reason}</p>
                    {settings.threshold !== null && (
                      <p className="text-sm text-muted-foreground">
                        Saved threshold: {settings.threshold.toLocaleString()} tokens. Restore the
                        runtime default to continue.
                      </p>
                    )}
                  </>
                )}
                {(settings.maximum !== null || settings.threshold !== null) && (
                  <div className="flex justify-end gap-2">
                    {settings.threshold !== null && (
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={saving}
                        onClick={() => {
                          setDraft({ ...draft, custom: false, dirty: true });
                        }}
                      >
                        Use default
                      </Button>
                    )}
                    <Button type="submit" disabled={saving || !draft.dirty || invalid}>
                      {saving ? "Saving…" : "Save"}
                    </Button>
                  </div>
                )}
              </form>
            )
          )}
          {error && (
            <div className="mt-2 flex flex-col gap-2">
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
              <Button
                type="button"
                variant="ghost"
                disabled={saving}
                onClick={() => {
                  setAttempt((value) => value + 1);
                }}
              >
                Retry
              </Button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
