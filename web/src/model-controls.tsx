import { useEffect, useState } from "react";
import { z } from "zod";

import {
  Button,
  CheckIcon,
  DropdownButton,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Spinner,
  Popover,
  PopoverTrigger,
  PopoverContent,
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandItem,
} from "@flora/florets";

import type { AttachmentPolicy } from "./attachments";
import { executionSchema, type Execution } from "./chat-schemas";
import { ModelIcon } from "./model-icon";
import { errorMessage, request } from "./request";

const modelOptionSchema = z.object({
  provider: z.string(),
  id: z.string(),
  name: z.string(),
  variants: z.array(z.string()),
  image: z.boolean(),
  pdf: z.boolean(),
});
const modelsSchema = z.object({
  default: executionSchema,
  models: z.array(modelOptionSchema),
  error: z.string(),
});
const effortLabel = (value: string) =>
  value === "xhigh" ? "Extra high" : value.charAt(0).toUpperCase() + value.slice(1);

/** Draft choices are submitted with the message; only acceptance changes saved chat preferences. */
export function ModelControls({
  scope,
  saved,
  disabled,
  onPolicy,
}: {
  scope: string;
  saved?: Execution | undefined;
  disabled: boolean;
  onPolicy: (policy: AttachmentPolicy | undefined) => void;
}) {
  const [selected, setSelected] = useState<Execution | null>(() => {
    try {
      const draft = executionSchema.safeParse(
        JSON.parse(sessionStorage.getItem(`flora-model:${scope}`) ?? "null"),
      );
      if (draft.success) return draft.data;
    } catch {
      // Storage may be disabled.
    }
    return null;
  });
  const [options, setOptions] = useState<z.infer<typeof modelsSchema>>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [modelOpen, setModelOpen] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const result = await request(modelsSchema, "models", { signal: controller.signal });
        setOptions(result);
        setError(result.error);
      } catch (e) {
        if (!controller.signal.aborted) setError(errorMessage(e, "Could not load models."));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => {
      controller.abort();
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Retrying starts a fresh discovery request.
  }, [attempt]);
  const effective =
    selected ?? (saved?.model !== undefined && saved.model !== "" ? saved : options?.default);
  const current = options?.models.find((model) => model.id === effective?.model);
  useEffect(() => {
    onPolicy(
      current && current.id !== options?.default.model && options?.error === ""
        ? {
            image: current.image,
            pdf: current.pdf,
            reason: "The selected model does not support this file type.",
          }
        : undefined,
    );
  }, [current, options, onPolicy]);
  const reasoningAvailable =
    (current?.variants.length ?? 0) > 0 || (effective?.variant ?? "") !== "";
  const label = current?.name ?? effective?.model ?? "Default model";
  function choose(value: Execution) {
    setSelected(value);
    try {
      sessionStorage.setItem(`flora-model:${scope}`, JSON.stringify(value));
    } catch {
      // Storage may be disabled.
    }
  }
  return (
    <>
      {selected && <input type="hidden" name="execution" value={JSON.stringify(selected)} />}
      <Popover open={modelOpen} onOpenChange={setModelOpen}>
        <PopoverTrigger
          render={
            <DropdownButton
              type="button"
              variant="ghost"
              size="compact"
              disabled={disabled}
              aria-label={`Model: ${label}`}
              className="composer-model max-w-[min(220px,42vw)] min-w-0"
            >
              <ModelIcon provider={effective?.provider} model={effective?.model} />
              <span className="florets-control-label truncate">{label}</span>
            </DropdownButton>
          }
        />
        <PopoverContent
          align="start"
          side="top"
          className="composer-menu w-[300px]! max-w-[calc(100vw-24px)] gap-0 p-0!"
          aria-label="Choose model"
        >
          <Command>
            <CommandInput aria-label="Search models" placeholder="Search models" />
            {loading ? (
              <div
                className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground"
                role="status"
              >
                <Spinner />
                Loading models…
              </div>
            ) : (
              <CommandList className="max-h-64">
                <CommandEmpty>No models found.</CommandEmpty>
                {options?.models.map((model) => (
                  <CommandItem
                    key={model.id}
                    value={model.id}
                    keywords={[model.name]}
                    onSelect={() => {
                      choose({ provider: model.provider, model: model.id, variant: "" });
                      setModelOpen(false);
                    }}
                  >
                    <ModelIcon provider={model.provider} model={model.id} />
                    <span className="min-w-0 flex-1 truncate">{model.name}</span>
                    {effective?.model === model.id && <CheckIcon />}
                  </CommandItem>
                ))}
              </CommandList>
            )}
          </Command>
          {error && (
            <div className="border-t border-border px-3 py-2">
              <p className="text-xs text-muted-foreground" role="status">
                {error}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="compact"
                disabled={loading}
                onClick={() => {
                  setLoading(true);
                  setAttempt((value) => value + 1);
                }}
              >
                Retry discovery
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <DropdownButton
              type="button"
              variant="ghost"
              size="compact"
              disabled={disabled || !effective || loading || !reasoningAvailable}
              aria-label={`Reasoning effort: ${(effective?.variant ?? "") !== "" && effective ? effortLabel(effective.variant) : "Default"}`}
            >
              <span className="florets-control-label">
                {(effective?.variant ?? "") !== "" && effective
                  ? effortLabel(effective.variant)
                  : "Default"}
              </span>
            </DropdownButton>
          }
        />
        <DropdownMenuContent align="start" side="top" className="composer-menu w-[200px]!">
          <DropdownMenuItem
            onClick={() => {
              if (effective) choose({ ...effective, variant: "" });
            }}
          >
            Default{(effective?.variant ?? "") === "" && <CheckIcon className="ml-auto" />}
          </DropdownMenuItem>
          {current?.variants.map((variant) => (
            <DropdownMenuItem
              key={variant}
              onClick={() => {
                if (effective) choose({ ...effective, variant });
              }}
            >
              {effortLabel(variant)}
              {effective?.variant === variant && <CheckIcon className="ml-auto" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
