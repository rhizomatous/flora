/* oxlint-disable import/max-dependencies -- The Models page composes provider management, discovery, catalog, and default selection. */
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  Alert,
  Button,
  DropdownButton,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  Heading,
  Section,
  SectionHeader,
  SectionStack,
  SettingsGroup,
  SettingsRow,
} from "@flora/florets";

import { ModelCatalog } from "./model-catalog";
import { ModelConnections } from "./model-connections";
import { useModelDiscovery } from "./model-discovery";
import { ModelIcon } from "./model-icon";
import { modelDisplayName } from "./model-label";
import { matchModel, type ModelOption } from "./model-options";
import { ModelPicker } from "./model-picker";
import { errorMessage, isExpired, request } from "./request";
import { settingsSchema, type Settings } from "./settings-schemas";

export function ModelsPage({
  embedded = false,
  active = true,
  settings,
  onSaved,
  onExpired,
}: {
  embedded?: boolean;
  active?: boolean;
  settings: Settings;
  onSaved: (settings: Settings) => void;
  onExpired: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  if (!active && open) setOpen(false);
  const { options, loading, error, retry } = useModelDiscovery("models");
  const models = options?.models ?? [];
  const current = models.find(
    (model) => model.provider === settings.provider && model.id === settings.model,
  );
  useEffect(() => {
    if (!embedded) heading.current?.focus();
  }, [embedded]);
  async function save(body: object) {
    setBusy(true);
    try {
      const next = await request(settingsSchema, "settings", { method: "PUT", body });
      onSaved(next);
      retry();
      toast.success("Models updated", { toasterId: "chat-organization" });
    } catch (cause) {
      if (isExpired(cause)) onExpired();
      throw cause;
    } finally {
      setBusy(false);
    }
  }
  async function setDefault(model: ModelOption) {
    setOpen(false);
    try {
      await save({ provider: model.provider, model: model.id });
    } catch (cause) {
      toast.error(errorMessage(cause, "Could not save the default model."), {
        toasterId: "chat-organization",
      });
    }
  }
  const connections = (
    <ModelConnections
      active={active}
      compact={embedded}
      settings={settings}
      models={models}
      loading={loading}
      busy={busy}
      onSave={save}
    />
  );
  return (
    <section
      aria-labelledby={embedded ? undefined : "models-heading"}
      aria-label={embedded ? "Models" : undefined}
      className={embedded ? "" : "mx-auto w-full max-w-5xl px-4 py-8 sm:px-8 sm:py-10"}
    >
      {!embedded && (
        <Heading
          level={1}
          id="models-heading"
          ref={heading}
          tabIndex={-1}
          className="mx-px mb-10 px-4"
        >
          Models
        </Heading>
      )}
      <SectionStack className={embedded ? "gap-6!" : undefined}>
        {embedded && connections}
        {(!embedded || settings.providerConfigured) && (
          <Section aria-labelledby={embedded ? undefined : "default-model-heading"}>
            {!embedded && (
              <SectionHeader inset>
                <Heading level={2} id="default-model-heading">
                  Default model
                </Heading>
              </SectionHeader>
            )}
            <SettingsGroup>
              <SettingsRow
                label={embedded ? "Default model" : "New chats"}
                htmlFor="default-model"
                description={embedded ? undefined : "Used when no model is selected"}
                descriptionId="default-model-help"
              >
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
                        aria-describedby={embedded ? undefined : "default-model-help"}
                        variant="outline"
                        disabled={busy || models.length === 0}
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
                        void setDefault(model);
                      }}
                    />
                  </DropdownMenuContent>
                </DropdownMenu>
              </SettingsRow>
            </SettingsGroup>
          </Section>
        )}
        {!embedded && connections}
        {error !== "" && settings.providers.length > 0 && (
          <Alert role="status" className="flex flex-wrap items-center justify-between gap-3">
            <span>{error}</span>
            <Button variant="outline" size="sm" disabled={loading} onClick={retry}>
              Retry discovery
            </Button>
          </Alert>
        )}
        {!embedded && (
          <ModelCatalog
            models={models}
            settings={settings}
            loading={loading}
            busy={busy}
            onDefault={(model) => {
              void setDefault(model);
            }}
          />
        )}
      </SectionStack>
    </section>
  );
}
