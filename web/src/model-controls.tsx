import { useEffect, useState } from "react";

import {
  Button,
  CheckIcon,
  DropdownButton,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@flora/florets";

import type { AttachmentPolicy } from "./attachments";
import type { Execution } from "./chat-schemas";
import { resolveModelChoice, useModelChoice } from "./model-choice";
import { useModelDiscovery } from "./model-discovery";
import { ModelIcon } from "./model-icon";
import { modelChoiceLabel } from "./model-label";
import { ModelPicker } from "./model-picker";

const effortLabel = (value: string) =>
  value === "xhigh" ? "Extra high" : value.charAt(0).toUpperCase() + value.slice(1);

/** Chat drafts save on message acceptance; controlled automation choices save with the form. */
export function ModelControls({
  scope,
  saved,
  disabled,
  onPolicy,
  automation,
}: {
  scope: string;
  saved?: Execution | undefined;
  disabled: boolean;
  onPolicy?: ((policy: AttachmentPolicy | undefined) => void) | undefined;
  automation?:
    | {
        value: Execution | null;
        inheritedLabel: string;
        onChange: (value: Execution | null) => void;
      }
    | undefined;
}) {
  const { selected, choose: chooseDraft } = useModelChoice(scope);
  const { options, loading, error, retry } = useModelDiscovery(scope);
  const [modelOpen, setModelOpen] = useState(false);
  const effective = automation
    ? (automation.value ?? undefined)
    : resolveModelChoice(selected, saved, options?.default);
  const current = options?.models.find(
    (model) => model.provider === effective?.provider && model.id === effective.model,
  );
  useEffect(() => {
    onPolicy?.(
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
  const label =
    effective !== undefined && effective.model !== ""
      ? modelChoiceLabel(effective, current?.name).text
      : (automation?.inheritedLabel ?? "Default model");
  function choose(value: Execution) {
    if (automation) {
      automation.onChange(value);
      return;
    }
    chooseDraft(value);
  }
  return (
    <>
      {!automation && selected && (
        <input type="hidden" name="execution" value={JSON.stringify(selected)} />
      )}
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
          className="composer-menu max-h-(--available-height) w-[320px]! max-w-[calc(100vw-24px)]! gap-0 overflow-hidden p-0! transition-none"
          aria-label="Choose model"
        >
          <ModelPicker
            models={options?.models ?? []}
            selected={effective}
            loading={loading}
            inherited={
              automation
                ? {
                    label: automation.inheritedLabel,
                    selected: automation.value === null,
                    onSelect: () => {
                      automation.onChange(null);
                      setModelOpen(false);
                    },
                  }
                : undefined
            }
            onSelect={(model) => {
              choose({ provider: model.provider, model: model.id, variant: "" });
              setModelOpen(false);
            }}
          />
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
                  retry();
                }}
              >
                Retry discovery
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>
      {(!automation || effective) && (
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
      )}
    </>
  );
}
