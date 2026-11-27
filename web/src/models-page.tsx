import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Alert, Button, Heading, SectionStack } from "@flora/florets";

import { DefaultModel } from "./default-model";
import { ModelCatalog } from "./model-catalog";
import { ModelConnections } from "./model-connections";
import { useModelDiscovery } from "./model-discovery";
import type { ModelOption } from "./model-options";
import { errorMessage, isExpired, request } from "./request";
import { settingsSchema, type Settings } from "./settings-schemas";

export function ModelsPage({
  embedded = false,
  active = true,
  settings,
  onSaved,
  onExpired,
  onBusyChange,
}: {
  embedded?: boolean;
  active?: boolean;
  settings: Settings;
  onSaved: (settings: Settings) => void;
  onExpired: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [busy, setBusy] = useState(false);
  const { options, loading, error, retry } = useModelDiscovery("models", !embedded);
  const models = options?.models ?? [];
  useEffect(() => {
    if (!embedded) heading.current?.focus();
  }, [embedded]);
  async function save(body: object) {
    setBusy(true);
    onBusyChange?.(true);
    try {
      const next = await request(settingsSchema, "settings", { method: "PUT", body });
      onSaved(next);
      if (!embedded) {
        retry();
        toast.success("Models updated", { toasterId: "chat-organization" });
      }
    } catch (cause) {
      if (isExpired(cause)) onExpired();
      throw cause;
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }
  async function setDefault(model: ModelOption) {
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
        {!embedded && (
          <DefaultModel
            active={active}
            settings={settings}
            models={models}
            loading={loading}
            busy={busy}
            onSave={save}
          />
        )}
        {!embedded && connections}
        {!embedded && error !== "" && settings.providers.length > 0 && (
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
