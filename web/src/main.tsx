import { StrictMode, useEffect, useRef, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import {
  Alert, Button, Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend,
  FieldSet, Input, LoadingStatus, NativeSelect, Page, PageDescription, PageHeader,
  PageTitle, Wordmark,
} from "@flora/florets";
import { request } from "./request";
import "./styles.css";

type Status = { setupRequired: boolean; authenticated: boolean };
type Settings = { provider: string; model: string; githubConfigured: boolean; providerConfigured: boolean };

function App() {
  const [status, setStatus] = useState<Status>();
  const [settings, setSettings] = useState<Settings>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const screen = !status ? "loading" : status.authenticated ? (settings ? "settings" : "loading") : status.setupRequired ? "setup" : "login";

  useEffect(() => { heading.current?.focus(); }, [screen]);

  async function refresh() {
    const next = await request<Status>("auth/status");
    setStatus(next);
    setSettings(next.authenticated ? await request<Settings>("settings") : undefined);
  }
  useEffect(() => { refresh().catch(e => setError(e.message)); }, []);

  async function submit(event: FormEvent<HTMLFormElement>, action: "password" | "settings") {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    setBusy(true); setError(""); setNotice("");
    try {
      if (action === "password") {
        await request(`auth/${status?.setupRequired ? "bootstrap" : "login"}`, "POST", { password: fields.get("password") });
        form.reset();
        await refresh();
      } else {
        const next = await request<Settings>("settings", "PUT", Object.fromEntries(fields));
        setSettings(next);
        form.reset();
        setNotice("Settings saved. Credentials are not shown.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed. Try again.");
      // Show login after session expiry. Unsaved settings are cleared on unmount.
      request<Status>("auth/status").then(setStatus).catch(() => {});
    } finally { setBusy(false); }
  }

  async function logout() {
    setBusy(true); setError(""); setNotice("");
    try { await request("auth/logout", "POST"); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Logout failed. Try again."); }
    finally { setBusy(false); }
  }

  return (
    <Page>
      <PageHeader>
        <Wordmark />
        {status?.authenticated && <Button variant="link" size="inline" disabled={busy} onClick={logout}>Log out</Button>}
      </PageHeader>
      {error && <Alert variant="destructive" className="mb-6">{error}</Alert>}
      {notice && <Alert role="status" className="mb-6">{notice}</Alert>}
      {!status && <LoadingStatus />}
      {status && !status.authenticated && <section aria-labelledby="account-heading">
        <PageTitle ref={heading} tabIndex={-1} id="account-heading">{status.setupRequired ? "Create administrator" : "Log in"}</PageTitle>
        <PageDescription>{status.setupRequired ? "Create the single administrator account for this installation. Use a unique password of at least 12 characters." : "Enter your administrator password. Your session lasts seven days."}</PageDescription>
        <form className="mt-8" onSubmit={e => submit(e, "password")}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <Input type="password" id="password" name="password" autoComplete={status.setupRequired ? "new-password" : "current-password"} minLength={status.setupRequired ? 12 : undefined} maxLength={1024} required disabled={busy} />
            </Field>
            <Button type="submit" disabled={busy}>{busy ? "Please wait…" : status.setupRequired ? "Create administrator" : "Log in"}</Button>
          </FieldGroup>
        </form>
      </section>}
      {status?.authenticated && settings && <section aria-labelledby="settings-heading">
        <PageTitle ref={heading} tabIndex={-1} id="settings-heading">Installation settings</PageTitle>
        <PageDescription>Choose one hosted provider and model for all chats. Once saved, the provider and model cannot be changed.</PageDescription>
        <form className="mt-8" onSubmit={e => submit(e, "settings")}>
          <FieldGroup>
            <FieldSet disabled={busy}>
              <FieldLegend>GitHub</FieldLegend>
              <Field>
                <FieldLabel htmlFor="githubToken">Fine-grained personal access token</FieldLabel>
                <Input type="password" id="githubToken" name="githubToken" autoComplete="off" required={!settings.githubConfigured} maxLength={4096} aria-describedby="github-help" />
              </Field>
              <FieldDescription id="github-help">Restrict the token to the repositories Flora will use. {settings.githubConfigured ? "A token is saved. Leave blank to keep it." : "No token saved."}</FieldDescription>
            </FieldSet>
            <FieldSet disabled={busy} className="border-t border-border pt-6">
              <FieldLegend>Model provider</FieldLegend>
              <Field>
                <FieldLabel htmlFor="provider">Hosted provider</FieldLabel>
                <NativeSelect key={settings.provider} id="provider" name="provider" defaultValue={settings.provider || "openai"} disabled={!!settings.provider}>
                  <option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="google">Google</option>
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="model">Model ID</FieldLabel>
                <Input key={settings.model} id="model" name="model" defaultValue={settings.model} required maxLength={200} disabled={!!settings.model} placeholder="Exact model ID from your provider" />
              </Field>
              <Field>
                <FieldLabel htmlFor="providerKey">Provider API key</FieldLabel>
                <Input type="password" id="providerKey" name="providerKey" autoComplete="off" required={!settings.providerConfigured} maxLength={4096} aria-describedby="provider-help" />
              </Field>
              <FieldDescription id="provider-help">{settings.providerConfigured ? "An API key is saved. Leave blank to keep it." : "No API key saved."} Saved credentials are never displayed.</FieldDescription>
            </FieldSet>
            <Button type="submit" disabled={busy}>{busy ? "Validating…" : "Validate and save"}</Button>
          </FieldGroup>
        </form>
      </section>}
    </Page>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
