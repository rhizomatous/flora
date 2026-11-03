import { StrictMode, useEffect, useEffectEvent, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { FlowerMark } from "@flora/florets";

import { Chats } from "./chats";
import { Installation, type Settings } from "./installation";
import { useNotifications } from "./notifications";
import { Projects } from "./projects";
import { errorMessage, request } from "./request";
import { CompletionToasts } from "./toasts";
import { button, control, link, text } from "./ui";

import "@flora/florets/styles.css";

type Status = { setupRequired: boolean; authenticated: boolean; enrollmentRequired?: boolean };

const currentPath = () => window.location.hash.slice(1) || "chats";

/** Creates the administrator on first run, otherwise logs in. */
function Account({
  setupRequired,
  enrollmentRequired,
  busy,
  run,
  onLogin,
}: {
  setupRequired: boolean;
  enrollmentRequired?: boolean;
  busy: boolean;
  run: (task: () => Promise<void>, fallback: string) => Promise<void>;
  onLogin: () => Promise<void>;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const action = setupRequired ? "Create administrator" : "Log in";

  function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const password = text(new FormData(form), "password");
    const enrollmentCode = text(new FormData(form), "enrollmentCode");
    void run(async () => {
      await request(`auth/${setupRequired ? "bootstrap" : "login"}`, "POST", {
        password,
        enrollmentCode,
      });
      form.reset();
      await onLogin();
    }, "Request failed. Try again.");
  }

  return (
    <section aria-labelledby="account-heading">
      <h1
        ref={heading}
        tabIndex={-1}
        id="account-heading"
        className="text-2xl font-semibold tracking-tight"
      >
        {action}
      </h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        {setupRequired
          ? "Create the single administrator account for this installation. Use a unique password of at least 12 characters."
          : "Enter your administrator password. Sessions expire at the absolute lifetime set by the administrator."}
      </p>
      <form className="mt-8 space-y-6" onSubmit={submit}>
        {setupRequired && enrollmentRequired === true && (
          <label className="block text-sm font-medium">
            Enrollment code
            <input
              className={control}
              type="password"
              name="enrollmentCode"
              autoComplete="off"
              maxLength={256}
              required
              disabled={busy}
            />
            <span className="mt-2 block text-muted-foreground">
              Enter the one-time code shown by Flora on your host.
            </span>
          </label>
        )}
        <label className="block text-sm font-medium">
          Password
          <input
            className={control}
            type="password"
            name="password"
            autoComplete={setupRequired ? "new-password" : "current-password"}
            minLength={setupRequired ? 12 : undefined}
            maxLength={1024}
            required
            disabled={busy}
          />
        </label>
        <button type="submit" className={button} disabled={busy}>
          {busy ? "Please wait…" : action}
        </button>
      </form>
    </section>
  );
}

function App() {
  const [status, setStatus] = useState<Status>();
  const [settings, setSettings] = useState<Settings>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [path, setPath] = useState(currentPath);
  const ready = status?.authenticated === true && settings !== undefined;

  // Re-reads the session so an expired one shows the login screen. A failure here keeps the
  // current view; the action that prompted the check has already reported its own error.
  async function recheckSession() {
    try {
      setStatus(await request<Status>("auth/status"));
    } catch {
      // Keep the last known status.
    }
  }
  function onExpired() {
    void recheckSession();
  }

  const notifications = useNotifications(ready, settings?.preferences.sound === true, onExpired);

  useEffect(() => {
    const changed = () => {
      setPath(currentPath());
      setError("");
      setNotice("");
    };
    window.addEventListener("hashchange", changed);
    return () => {
      window.removeEventListener("hashchange", changed);
    };
  }, []);

  async function refresh() {
    const next = await request<Status>("auth/status");
    setStatus(next);
    setSettings(next.authenticated ? await request<Settings>("settings") : undefined);
  }
  async function load() {
    try {
      await refresh();
    } catch (e) {
      setError(errorMessage(e, "Could not load Flora."));
    }
  }
  const loadOnMount = useEffectEvent(load);
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- load sets state only after awaiting the request.
    void loadOnMount();
  }, []);

  // Runs a user action with the busy flag set. On failure it shows the error and rechecks the
  // session, so an expired one shows login. Unsaved settings are cleared on unmount.
  async function run(task: () => Promise<void>, fallback: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
    } catch (e) {
      setError(errorMessage(e, fallback));
      await recheckSession();
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    void run(async () => {
      await request("auth/logout", "POST");
      await refresh();
    }, "Logout failed. Try again.");
  }

  function saved(next: Settings) {
    setSettings(next);
    setNotice("Settings saved. Credentials are not shown.");
  }

  return (
    <main className="mx-auto min-h-svh max-w-4xl px-6 py-10 sm:px-10">
      <header className="mb-14 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <FlowerMark />
          <span>Flora</span>
        </div>
        {status?.authenticated === true && (
          <button
            type="button"
            className="text-sm text-muted-foreground underline underline-offset-4"
            disabled={busy}
            onClick={logout}
          >
            Log out
          </button>
        )}
      </header>
      {status?.authenticated === true && (
        <nav aria-label="Main" className="mb-8 flex flex-wrap gap-6 text-sm">
          <a
            href="#chats"
            aria-current={path.startsWith("chats") ? "page" : undefined}
            className={link}
          >
            Chats
          </a>
          <a
            href="#projects"
            aria-current={path.startsWith("projects") ? "page" : undefined}
            className={link}
          >
            Projects
          </a>
          <a
            href="#settings"
            aria-current={path === "settings" ? "page" : undefined}
            className={link}
          >
            Installation settings
          </a>
        </nav>
      )}
      {error !== "" && (
        <p role="alert" className="mb-6 rounded-md border border-foreground/50 p-3 text-sm">
          {error}
        </p>
      )}
      {notice !== "" && (
        <p role="status" className="mb-6 rounded-md border p-3 text-sm">
          {notice}
        </p>
      )}
      {ready && (
        <>
          {notifications.error !== "" && (
            <p role="status" className="mb-6 rounded-md border p-3 text-sm">
              {notifications.error}
            </p>
          )}
          {settings.preferences.sound && (
            <div className="mb-6 text-sm">
              <button
                type="button"
                className={link}
                onClick={() => {
                  void notifications.audio.enable();
                }}
              >
                {notifications.audio.ready
                  ? "Sound enabled for this page"
                  : "Enable notification sound"}
              </button>
              {!notifications.audio.ready && (
                <p className="mt-2 text-muted-foreground">
                  Use this button to allow audio in this browser. If sound stays blocked, allow
                  sound or autoplay in site settings, then try again. Completion toasts still
                  appear. Missed sounds are not replayed.
                </p>
              )}
            </div>
          )}
          <CompletionToasts toasts={notifications.toasts} dismiss={notifications.dismiss} />
        </>
      )}
      {(status === undefined || (status.authenticated && settings === undefined)) &&
        (error === "" ? (
          <p role="status" className="text-muted-foreground">
            Loading…
          </p>
        ) : (
          <button
            type="button"
            className={button}
            onClick={() => {
              setError("");
              void load();
            }}
          >
            Retry loading Flora
          </button>
        ))}
      {status?.authenticated === false && (
        <Account
          key={String(status.setupRequired)}
          setupRequired={status.setupRequired}
          enrollmentRequired={status.enrollmentRequired === true}
          busy={busy}
          run={run}
          onLogin={refresh}
        />
      )}
      {ready && path === "settings" && (
        <Installation settings={settings} busy={busy} run={run} onSaved={saved} />
      )}
      {ready &&
        path !== "settings" &&
        (path.startsWith("chats") ? (
          <Chats
            key={path}
            path={path}
            list={notifications.chats}
            listError={notifications.error}
            messageBytes={settings.preferences.messageBytes}
            onExpired={onExpired}
          />
        ) : (
          <Projects key={path} path={path} onExpired={onExpired} />
        ))}
    </main>
  );
}

const root = document.querySelector("#root");
if (root === null) throw new Error("Flora cannot start: index.html has no #root element.");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
