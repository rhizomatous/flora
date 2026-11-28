import { useRef, useState, type RefObject } from "react";

import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  FieldLabel,
  Heading,
  Input,
  KeyRoundIcon,
  PlusIcon,
  Section,
  SectionHeader,
  SettingsGroup,
  Text,
} from "@flora/florets";

import { ModelIcon } from "./model-icon";
import type { ModelOption } from "./model-options";
import { hostedProviders, providerName } from "./model-providers";
import { errorMessage } from "./request";
import type { Settings } from "./settings-schemas";
import { text } from "./ui";

function ConnectionDialog({
  provider,
  configured,
  busy,
  onClose,
  onSave,
  returnFocus,
}: {
  returnFocus: RefObject<HTMLElement | null>;
  provider: string;
  configured: boolean;
  busy: boolean;
  onClose: () => void;
  onSave: (body: object) => Promise<void>;
}) {
  const [error, setError] = useState("");
  const submitLabel = configured ? "Update key" : "Connect";
  async function connect(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setError("");
    try {
      await onSave({
        provider,
        providerKey: text(fields, "providerKey"),
        makeDefault: false,
      });
      onClose();
    } catch (cause) {
      setError(errorMessage(cause, "Could not connect this provider."));
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md"
        showCloseButton={!busy}
        finalFocus={returnFocus}
      >
        <DialogHeader>
          <DialogTitle>
            {configured
              ? `Update ${providerName(provider)} key`
              : `Connect ${providerName(provider)}`}
          </DialogTitle>
        </DialogHeader>
        <form
          className="space-y-5"
          onSubmit={(event) => {
            void connect(event);
          }}
        >
          <div className="space-y-2">
            <FieldLabel htmlFor="connection-key">API key</FieldLabel>
            <Input
              id="connection-key"
              name="providerKey"
              type="password"
              autoComplete="off"
              required
              minLength={8}
              maxLength={4096}
              disabled={busy}
              aria-invalid={error !== ""}
            />
          </div>
          {error !== "" && (
            <Alert variant="destructive" role="alert">
              {error}
            </Alert>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Checking access…" : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ModelConnections({
  active = true,
  compact = false,
  settings,
  models,
  loading,
  busy,
  onSave,
}: {
  active?: boolean;
  compact?: boolean;
  settings: Settings;
  models: ModelOption[];
  loading: boolean;
  busy: boolean;
  onSave: (body: object) => Promise<void>;
}) {
  const [editing, setEditing] = useState("");
  // Unmount credential dialogs when their page is hidden so secret drafts are discarded.
  if (!active && editing !== "") setEditing("");
  const addButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const connected = settings.providers;
  const remaining = hostedProviders.filter(
    (provider) => !connected.some((item) => item.provider === provider.id),
  );
  const dialog = editing !== "" && (
    <ConnectionDialog
      key={editing}
      returnFocus={returnFocus}
      provider={editing}
      configured={connected.some((item) => item.provider === editing)}
      busy={busy}
      onClose={() => {
        setEditing("");
      }}
      onSave={onSave}
    />
  );
  if (compact) {
    return (
      <SettingsGroup>
        {hostedProviders.map((provider) => {
          const configured = connected.some((item) => item.provider === provider.id);
          return (
            <div key={provider.id} className="flex items-center gap-3 px-4 py-4 sm:py-5">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-panel">
                <ModelIcon provider={provider.id} model={undefined} />
              </span>
              <div className="min-w-0 flex-1">
                <Text className="font-medium">{provider.name}</Text>
                {configured && (
                  <Text tone="muted" size="xs" className="mt-1">
                    Connected
                  </Text>
                )}
              </div>
              <Button
                variant="outline"
                disabled={busy}
                aria-label={`${configured ? "Update" : "Connect"} ${provider.name}${configured ? " key" : ""}`}
                onClick={(event) => {
                  returnFocus.current = event.currentTarget;
                  setEditing(provider.id);
                }}
              >
                {configured ? "Update key" : "Connect"}
              </Button>
            </div>
          );
        })}
        {dialog}
      </SettingsGroup>
    );
  }
  return (
    <Section aria-labelledby="connections-heading">
      <SectionHeader inset className="flex-row items-center justify-between gap-3">
        <Heading level={2} id="connections-heading">
          Connections
        </Heading>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                ref={addButton}
                variant="outline"
                size="sm"
                disabled={busy || remaining.length === 0}
              >
                <PlusIcon />
                Add connection
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-48">
            {hostedProviders.map((provider) => (
              <DropdownMenuItem
                key={provider.id}
                value={provider.id}
                disabled={!remaining.includes(provider)}
                onClick={() => {
                  returnFocus.current = addButton.current;
                  setEditing(provider.id);
                }}
              >
                <ModelIcon provider={provider.id} model={undefined} />
                {provider.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SectionHeader>
      <SettingsGroup>
        {connected.length === 0 ? (
          <div className="flex items-center gap-3 px-4 py-6">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
              <KeyRoundIcon className="size-5 text-muted-foreground" />
            </span>
            <Text tone="muted">No connections</Text>
          </div>
        ) : (
          connected.map((connection) => {
            const count = models.filter((model) => model.provider === connection.provider).length;
            return (
              <div key={connection.provider} className="flex min-w-0 items-center gap-3 px-4 py-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-surface-panel">
                  <ModelIcon provider={connection.provider} model={undefined} />
                </span>
                <div className="min-w-0 flex-1">
                  <Text className="font-medium">{providerName(connection.provider)}</Text>
                  <Text size="xs" tone="muted" className="mt-1">
                    {loading
                      ? "Discovering models…"
                      : `${count} ${count === 1 ? "model" : "models"}`}
                  </Text>
                </div>
                <Badge variant="secondary" className="hidden sm:inline-flex">
                  Connected
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  aria-label={`Update ${providerName(connection.provider)} key`}
                  onClick={(event) => {
                    returnFocus.current = event.currentTarget;
                    setEditing(connection.provider);
                  }}
                >
                  Update key
                </Button>
              </div>
            );
          })
        )}
      </SettingsGroup>
      {dialog}
    </Section>
  );
}
