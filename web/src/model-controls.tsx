/* oxlint-disable import/max-dependencies -- Model controls combine saved choices, discovery, file policy, and picker UI. */
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  CheckIcon,
  DropdownButton,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuTrigger,
} from "@flora/florets";

import type { AttachmentPolicy } from "./attachments";
import type { Execution } from "./chat-schemas";
import { resolveModelChoice, useModelChoice } from "./model-choice";
import { useModelDiscovery } from "./model-discovery";
import { ModelIcon } from "./model-icon";
import { modelChoiceLabel } from "./model-label";
import { matchModel } from "./model-options";
import { ModelPicker } from "./model-picker";
import { errorMessage } from "./request";

const effortLabel = (value: string) =>
  value === "xhigh" ? "Extra high" : value.charAt(0).toUpperCase() + value.slice(1);

/** Chat choices save immediately; controlled automation choices save with their form. */
export function ModelControls({
  scope,
  saved,
  savedRevision,
  onSaving,
  disabled,
  onPolicy,
  automation,
}: {
  scope: string;
  saved?: Execution | undefined;
  savedRevision?: number | undefined;
  onSaving?: ((saving: boolean) => void) | undefined;
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
  const { selected, pending, choose: saveChoice } = useModelChoice(scope, saved, savedRevision);
  const { options, loading, error, retry } = useModelDiscovery(scope);
  const [modelOpen, setModelOpen] = useState(false);
  const effective = automation
    ? (automation.value ?? undefined)
    : resolveModelChoice(selected, options?.default);
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
  async function choose(value: Execution) {
    if (automation) {
      automation.onChange(value);
      return;
    }
    onSaving?.(true);
    try {
      await saveChoice(value);
    } catch (cause) {
      toast.error(errorMessage(cause, "Could not save the model. Try again."), {
        toasterId: "chat-organization",
      });
    } finally {
      onSaving?.(false);
    }
  }
  return (
    <>
      {!automation && !scope.startsWith("chat:") && selected && (
        <input type="hidden" name="execution" value={JSON.stringify(selected)} />
      )}
      <DropdownMenu
        search={{
          label: "Search models",
          placeholder: "Search models",
          filter: (text, query) =>
            loading ||
            (error !== "" && ["Models unavailable", "Retry discovery"].includes(text)) ||
            matchModel(text, query),
          emptyText: loading ? null : "No models found.",
          listClassName: "scroll-py-2",
        }}
        open={modelOpen}
        onOpenChange={setModelOpen}
      >
        <DropdownMenuTrigger
          render={
            <DropdownButton
              type="button"
              variant="ghost"
              size="compact"
              disabled={disabled || pending}
              focusableWhenDisabled
              aria-label={`Model: ${label}`}
              className="composer-model max-w-[min(220px,42vw)] min-w-0 aria-disabled:pointer-events-none aria-disabled:opacity-50"
            >
              <ModelIcon provider={effective?.provider} model={effective?.model} />
              <span className="florets-control-label truncate">{label}</span>
            </DropdownButton>
          }
        />
        <DropdownMenuContent
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
              void choose({ provider: model.provider, model: model.id, variant: "" });
              setModelOpen(false);
            }}
          />
          {error !== "" && (
            <DropdownMenuGroup>
              <DropdownMenuItem
                value="models-unavailable"
                label="Models unavailable"
                disabled
                aria-description={error}
              >
                Models unavailable
              </DropdownMenuItem>
              <DropdownMenuItem
                value="retry-models"
                label="Retry discovery"
                disabled={loading}
                closeOnClick={false}
                onClick={() => {
                  retry();
                }}
              >
                Retry discovery
              </DropdownMenuItem>
            </DropdownMenuGroup>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {(!automation || effective) && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <DropdownButton
                type="button"
                variant="ghost"
                size="compact"
                disabled={disabled || pending || !effective || loading || !reasoningAvailable}
                focusableWhenDisabled={pending || disabled}
                className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
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
                if (effective) void choose({ ...effective, variant: "" });
              }}
            >
              Default{(effective?.variant ?? "") === "" && <CheckIcon className="ml-auto" />}
            </DropdownMenuItem>
            {current?.variants.map((variant) => (
              <DropdownMenuItem
                key={variant}
                onClick={() => {
                  if (effective) void choose({ ...effective, variant });
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
