import { useEffect, useRef, useState } from "react";

import {
  Button,
  Section,
  SectionHeader,
  SectionStack,
  SettingsGroup,
  SettingsRow,
  Heading,
  Input,
  Text,
} from "@flora/florets";

import { AccountSettings } from "./account-settings";
import { EnvironmentEditor } from "./environment";
import { GitHubConnection } from "./github-connection";
import { readPreferences } from "./preferences";
import { request } from "./request";
import { PreferenceFields } from "./settings";
import {
  settingsSchema,
  diagnosticSchema,
  type Settings,
  type Diagnostic,
} from "./settings-schemas";
import { text } from "./ui";

/** Edits provider connections, the default model, and installation preferences. */
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
  const [githubRevision, setGithubRevision] = useState(0);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);

  function save(connection: "github" | "preferences", event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    void run(async () => {
      const body =
        connection === "github"
          ? { githubToken: text(fields, "githubToken") }
          : { preferences: readPreferences(fields) };
      const next = await request(settingsSchema, "settings", { method: "PUT", body });
      onSaved(next);
      if (connection === "github") setGithubRevision((value) => value + 1);
      setDiagnostics(undefined);
      form.reset();
    }, "Request failed. Try again.");
  }

  function diagnose() {
    void run(async () => {
      setDiagnostics(
        await request(diagnosticSchema.array(), "settings/diagnostics", {
          method: "POST",
          body: {},
        }),
      );
    }, "Dependency check failed.");
  }

  return (
    <section aria-labelledby="settings-heading">
      <Heading level={1} ref={heading} tabIndex={-1} id="settings-heading">
        Installation settings
      </Heading>
      <nav aria-label="Settings pages" className="mt-4 flex gap-4 text-sm">
        <a href="#models" className="underline">
          Models
        </a>
        <a href="#mcps" className="underline">
          MCP servers
        </a>
      </nav>
      <SectionStack className="mt-8">
        <AccountSettings busy={busy} run={run} />
        <Section>
          <GitHubConnection key={githubRevision} busy={busy} run={run} onSaved={onSaved} />
        </Section>
        <Section>
          <SectionHeader inset>
            <Heading level={2}>Personal access token</Heading>
          </SectionHeader>
          <form
            aria-label="GitHub connection"
            className="space-y-4"
            onSubmit={(event) => {
              save("github", event);
            }}
          >
            <SettingsGroup>
              <SettingsRow
                label="Fine-grained personal access token"
                htmlFor="github-token"
                description="Restrict the token to the repositories Flora will use"
                descriptionId="github-help"
              >
                <Input
                  id="github-token"
                  type="password"
                  name="githubToken"
                  autoComplete="off"
                  disabled={busy}
                  required
                  maxLength={4096}
                  aria-describedby="github-help"
                />
              </SettingsRow>
            </SettingsGroup>
            <Button type="submit" disabled={busy}>
              Validate and save GitHub
            </Button>
          </form>
        </Section>
        <Section>
          <form
            aria-label="Installation preferences"
            className="space-y-4"
            onSubmit={(event) => {
              save("preferences", event);
            }}
          >
            <PreferenceFields
              value={settings.preferences}
              busy={busy}
              override={settings.maxRunningOverride}
            />
            <Button type="submit" disabled={busy}>
              Save preferences
            </Button>
          </form>
        </Section>
      </SectionStack>
      <div className="mt-10">
        <EnvironmentEditor path="settings/environment" />
      </div>
      <section
        className="mt-10 space-y-4 border-t border-border pt-6"
        aria-labelledby="diagnostics-heading"
      >
        <Heading level={2} id="diagnostics-heading">
          Dependency checks
        </Heading>
        <Text tone="muted">
          Checks storage, Docker, the agent image and credential metadata. No model generation,
          image pull or GitHub write is performed. Provider keys reach only new containers; running
          and restarted containers keep their original key. GitHub rotation applies to future broker
          requests.
        </Text>
        <Button type="button" disabled={busy} onClick={diagnose}>
          Check dependencies
        </Button>
        {diagnostics !== undefined && (
          <ul aria-live="polite" className="space-y-3 text-sm">
            {diagnostics.map((d) => (
              <li key={d.name}>
                <strong>
                  {d.name}: {d.ok ? "OK" : "Needs attention"}
                </strong>
                <Text tone="muted" className="mt-1">
                  {d.message}
                </Text>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
