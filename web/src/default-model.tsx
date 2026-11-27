/* oxlint-disable import/max-dependencies -- Default selection combines the shared picker, provider labels, and validated manual entry. */
import { useRef, useState } from "react";
import { toast } from "sonner";

import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownButton,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  FieldLabel,
  Heading,
  Input,
  NativeSelect,
  Section,
  SectionHeader,
  SettingsGroup,
  SettingsRow,
} from "@flora/florets";

import { ModelIcon } from "./model-icon";
import { modelDisplayName } from "./model-label";
import { matchModel, type ModelOption } from "./model-options";
import { ModelPicker } from "./model-picker";
import { providerName } from "./model-providers";
import { errorMessage } from "./request";
import type { Settings } from "./settings-schemas";
import { text } from "./ui";

export function DefaultModel({
  active,
  settings,
  models,
  loading,
  busy,
  onSave,
}: {
  active: boolean;
  settings: Settings;
  models: ModelOption[];
  loading: boolean;
  busy: boolean;
  onSave: (body: object) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [manual, setManual] = useState(false);
  const [error, setError] = useState("");
  const manualButton = useRef<HTMLButtonElement>(null);
  if (!active && open) setOpen(false);
  if (!active && manual) setManual(false);
  const current = models.find(
    (model) => model.provider === settings.provider && model.id === settings.model,
  );
  async function select(model: ModelOption) {
    setOpen(false);
    try {
      await onSave({ provider: model.provider, model: model.id });
    } catch (cause) {
      toast.error(errorMessage(cause, "Could not save the default model."), {
        toasterId: "chat-organization",
      });
    }
  }
  async function saveManual(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setError("");
    try {
      await onSave({ provider: text(fields, "provider"), model: text(fields, "model") });
      setManual(false);
    } catch (cause) {
      setError(errorMessage(cause, "Could not save the default model."));
    }
  }
  return (
    <Section aria-labelledby="default-model-heading">
      <SectionHeader inset>
        <Heading level={2} id="default-model-heading">
          Default model
        </Heading>
      </SectionHeader>
      <SettingsGroup>
        <SettingsRow label="New chats" htmlFor="default-model">
          <DropdownMenu
            open={open}
            onOpenChange={setOpen}
            search={{
              label: "Search default models",
              placeholder: "Search models",
              filter: matchModel,
            }}
          >
            <DropdownMenuTrigger
              render={
                <DropdownButton
                  id="default-model"
                  focusableWhenDisabled
                  variant="outline"
                  disabled={busy || loading || models.length === 0}
                  className="w-full max-w-72 justify-between"
                >
                  <ModelIcon provider={settings.provider} model={settings.model} />
                  <span className="min-w-0 flex-1 truncate">
                    {current?.name ??
                      (settings.model ? modelDisplayName(settings.model) : "Choose a model")}
                  </span>
                </DropdownButton>
              }
            />
            <DropdownMenuContent align="end" className="w-80! max-w-[calc(100vw-24px)]">
              <ModelPicker
                models={models}
                selected={
                  settings.model
                    ? { provider: settings.provider, model: settings.model, variant: "" }
                    : undefined
                }
                loading={loading}
                onSelect={(model) => {
                  void select(model);
                }}
              />
            </DropdownMenuContent>
          </DropdownMenu>
        </SettingsRow>
        <SettingsRow label="Model ID" htmlFor="manual-model">
          <Button
            ref={manualButton}
            id="manual-model"
            aria-label="Enter model ID"
            variant="outline"
            disabled={busy || settings.providers.length === 0}
            onClick={() => {
              setError("");
              setManual(true);
            }}
          >
            Enter model ID
          </Button>
        </SettingsRow>
      </SettingsGroup>
      {manual && (
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next && !busy) setManual(false);
          }}
        >
          <DialogContent
            finalFocus={manualButton}
            showCloseButton={!busy}
            className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md"
          >
            <DialogHeader>
              <DialogTitle>Set default model</DialogTitle>
            </DialogHeader>
            <form
              className="space-y-5"
              onSubmit={(event) => {
                void saveManual(event);
              }}
            >
              <div className="space-y-2">
                <FieldLabel htmlFor="manual-provider">Provider</FieldLabel>
                <NativeSelect
                  id="manual-provider"
                  name="provider"
                  defaultValue={settings.provider}
                  disabled={busy}
                >
                  {settings.providers.map((provider) => (
                    <option key={provider.provider} value={provider.provider}>
                      {providerName(provider.provider)}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-2">
                <FieldLabel htmlFor="manual-model-id">Model ID</FieldLabel>
                <Input
                  id="manual-model-id"
                  name="model"
                  defaultValue={settings.model}
                  required
                  maxLength={200}
                  disabled={busy}
                  aria-invalid={error !== ""}
                />
              </div>
              {error && (
                <Alert variant="destructive" role="alert">
                  {error}
                </Alert>
              )}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setManual(false);
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy ? "Checking access…" : "Save default"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </Section>
  );
}
