import { useEffect, useRef, useState } from "react";

import { readPreferences, type Preferences } from "./preferences";
import { request } from "./request";
import { PreferenceFields } from "./settings";
import { button, control, text } from "./ui";

export type Settings = {
  provider: string;
  model: string;
  githubConfigured: boolean;
  providerConfigured: boolean;
  preferences: Preferences;
  maxRunningOverride?: number;
};
type Diagnostic = { name: string; ok: boolean; message: string };

/** Edits credentials, the fixed provider and model, and installation-wide preferences. */
export function Installation({
  settings,
  busy,
  run,
  onSaved,
}: {
  settings: Settings;
  busy: boolean;
  run: (task: () => Promise<void>, fallback: string) => Promise<void>;
  onSaved: (settings: Settings) => void;
}) {
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);

  function save(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    void run(async () => {
      // Disabled provider and model fields are not submitted, and blank credentials keep the
      // saved ones; the server treats "" as "unchanged" for all four.
      const next = await request<Settings>("settings", "PUT", {
        provider: text(fields, "provider"),
        model: text(fields, "model"),
        githubToken: text(fields, "githubToken"),
        providerKey: text(fields, "providerKey"),
        preferences: readPreferences(fields),
      });
      onSaved(next);
      form.reset();
    }, "Request failed. Try again.");
  }

  function diagnose() {
    void run(async () => {
      setDiagnostics(await request<Diagnostic[]>("settings/diagnostics", "POST", {}));
    }, "Dependency check failed.");
  }

  return (
    <section aria-labelledby="settings-heading">
      <h1
        ref={heading}
        tabIndex={-1}
        id="settings-heading"
        className="text-2xl font-semibold tracking-tight"
      >
        Installation settings
      </h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        Choose one hosted provider and model for all chats. Once saved, the provider and model
        cannot be changed.
      </p>
      <form className="mt-8 space-y-6" onSubmit={save}>
        <fieldset disabled={busy} className="space-y-6">
          <legend className="mb-4 text-base font-semibold">GitHub</legend>
          <label className="block text-sm font-medium">
            Fine-grained personal access token
            <input
              className={control}
              type="password"
              name="githubToken"
              autoComplete="off"
              required={!settings.githubConfigured}
              maxLength={4096}
              aria-describedby="github-help"
            />
          </label>
          <p id="github-help" className="text-sm leading-6 text-muted-foreground">
            Restrict the token to the repositories Flora will use.{" "}
            {settings.githubConfigured
              ? "A token is saved. Leave blank to keep it."
              : "No token saved."}
          </p>
        </fieldset>
        <fieldset disabled={busy} className="space-y-6 border-t border-foreground/20 pt-6">
          <legend className="text-base font-semibold">Model provider</legend>
          <label className="block text-sm font-medium">
            Hosted provider
            <select
              key={settings.provider}
              aria-label="Hosted provider"
              className={control}
              name="provider"
              defaultValue={settings.provider === "" ? "openai" : settings.provider}
              disabled={settings.provider !== ""}
            >
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="google">Google</option>
            </select>
          </label>
          <label className="block text-sm font-medium">
            Model ID
            <input
              key={settings.model}
              className={control}
              name="model"
              defaultValue={settings.model}
              required
              maxLength={200}
              disabled={settings.model !== ""}
              placeholder="Exact model ID from your provider"
            />
          </label>
          <label className="block text-sm font-medium">
            Provider API key
            <input
              className={control}
              type="password"
              name="providerKey"
              autoComplete="off"
              required={!settings.providerConfigured}
              maxLength={4096}
              aria-describedby="provider-help"
            />
          </label>
          <p id="provider-help" className="text-sm leading-6 text-muted-foreground">
            {settings.providerConfigured
              ? "An API key is saved. Leave blank to keep it."
              : "No API key saved."}{" "}
            Saved credentials are never displayed.
          </p>
        </fieldset>
        <PreferenceFields
          value={settings.preferences}
          busy={busy}
          override={settings.maxRunningOverride}
        />
        <button type="submit" className={button} disabled={busy}>
          {busy ? "Saving…" : "Validate and save"}
        </button>
      </form>
      <section
        className="mt-10 space-y-4 border-t border-foreground/20 pt-6"
        aria-labelledby="diagnostics-heading"
      >
        <h2 id="diagnostics-heading" className="font-semibold">
          Dependency checks
        </h2>
        <p className="text-sm text-muted-foreground">
          Checks storage, Docker, the agent image and credential metadata. No model generation,
          image pull or GitHub write is performed. Provider keys reach only new containers; running
          and restarted containers keep their original key. GitHub rotation applies to future broker
          requests.
        </p>
        <button type="button" className={button} disabled={busy} onClick={diagnose}>
          Check dependencies
        </button>
        {diagnostics !== undefined && (
          <ul aria-live="polite" className="space-y-3 text-sm">
            {diagnostics.map((d) => (
              <li key={d.name}>
                <strong>
                  {d.name}: {d.ok ? "OK" : "Needs attention"}
                </strong>
                <p className="mt-1 text-muted-foreground">{d.message}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
