import { StrictMode, useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { FlowerMark } from "@flora/florets";
import "@flora/florets/styles.css";

type Status = { setupRequired: boolean; authenticated: boolean };
type Settings = { provider: string; model: string; githubConfigured: boolean; providerConfigured: boolean };

async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method, credentials: "same-origin", headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Request failed. Try again.");
  return result as T;
}

const control = "mt-2 w-full rounded-md border border-foreground/30 bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-foreground disabled:opacity-60";
const button = "rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50";

function App() {
  const [status, setStatus] = useState<Status>();
  const [settings, setSettings] = useState<Settings>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

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
      // Refresh session state after expiry without discarding unsaved form values.
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
    <main className="mx-auto min-h-svh max-w-2xl px-6 py-10 sm:px-10">
      <header className="mb-14 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-lg font-semibold"><FlowerMark /><span>Flora</span></div>
        {status?.authenticated && <button type="button" className="text-sm text-muted-foreground underline underline-offset-4" disabled={busy} onClick={logout}>Log out</button>}
      </header>
      {error && <p role="alert" className="mb-6 rounded-md border border-foreground/50 p-3 text-sm">{error}</p>}
      {notice && <p role="status" className="mb-6 rounded-md border p-3 text-sm">{notice}</p>}
      {!status && <p role="status" className="text-muted-foreground">Loading…</p>}
      {status && !status.authenticated && <section aria-labelledby="account-heading">
        <h1 id="account-heading" className="text-2xl font-semibold tracking-tight">{status.setupRequired ? "Create administrator" : "Log in"}</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{status.setupRequired ? "Create the single administrator account for this installation. Use a unique password of at least 12 characters." : "Enter your administrator password. Your session lasts seven days."}</p>
        <form className="mt-8 space-y-6" onSubmit={e => submit(e, "password")}>
          <label className="block text-sm font-medium">Password
            <input className={control} type="password" name="password" autoComplete={status.setupRequired ? "new-password" : "current-password"} minLength={status.setupRequired ? 12 : undefined} maxLength={1024} required disabled={busy} />
          </label>
          <button className={button} disabled={busy}>{busy ? "Please wait…" : status.setupRequired ? "Create administrator" : "Log in"}</button>
        </form>
      </section>}
      {status?.authenticated && settings && <section aria-labelledby="settings-heading">
        <h1 id="settings-heading" className="text-2xl font-semibold tracking-tight">Installation settings</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">Choose one hosted provider and model for all chats. Once saved, the provider and model cannot be changed.</p>
        <form className="mt-8 space-y-6" onSubmit={e => submit(e, "settings")}>
          <fieldset disabled={busy} className="space-y-6">
            <legend className="mb-4 text-base font-semibold">GitHub</legend>
            <label className="block text-sm font-medium">Fine-grained personal access token
              <input className={control} type="password" name="githubToken" autoComplete="off" required={!settings.githubConfigured} maxLength={4096} aria-describedby="github-help" />
            </label>
            <p id="github-help" className="text-sm leading-6 text-muted-foreground">Restrict the token to the repositories Flora will use. {settings.githubConfigured ? "A token is saved. Leave blank to keep it." : "No token saved."}</p>
          </fieldset>
          <fieldset disabled={busy} className="space-y-6 border-t border-foreground/20 pt-6">
            <legend className="text-base font-semibold">Model provider</legend>
            <label className="block text-sm font-medium">Hosted provider
              <select key={settings.provider} className={control} name="provider" defaultValue={settings.provider || "openai"} disabled={!!settings.provider}>
                <option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="google">Google</option>
              </select>
            </label>
            <label className="block text-sm font-medium">Model ID
              <input key={settings.model} className={control} name="model" defaultValue={settings.model} required maxLength={200} disabled={!!settings.model} placeholder="Exact model ID from your provider" />
            </label>
            <label className="block text-sm font-medium">Provider API key
              <input className={control} type="password" name="providerKey" autoComplete="off" required={!settings.providerConfigured} maxLength={4096} aria-describedby="provider-help" />
            </label>
            <p id="provider-help" className="text-sm leading-6 text-muted-foreground">{settings.providerConfigured ? "An API key is saved. Leave blank to keep it." : "No API key saved."} Saved credentials are never displayed.</p>
          </fieldset>
          <button className={button} disabled={busy}>{busy ? "Validating…" : "Validate and save"}</button>
        </form>
      </section>}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
